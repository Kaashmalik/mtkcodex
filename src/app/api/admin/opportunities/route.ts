import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hunterFailure, readJsonBody, str } from '@/lib/hunter-http';
import { LeadError } from '@/lib/leads';
import { addManualOpportunity, getOpportunity, listOpportunities, syncReplies, updateOpportunity } from '@/lib/opportunities';
import { OPPORTUNITY_STATUSES, type Opportunity, type OpportunityStatus } from '@/lib/opportunity-types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    const opportunities = await syncReplies(await listOpportunities());
    return NextResponse.json({ opportunities });
  } catch (error) {
    return hunterFailure(error, 'Failed to load opportunities');
  }
}

/** Add a job by hand (Upwork, LinkedIn, a referral…). */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  try {
    const opportunity = await addManualOpportunity({
      title: str(body.title, 200) || '',
      company: str(body.company, 120),
      url: str(body.url, 600),
      apply_email: str(body.apply_email, 200),
      description: str(body.description, 20_000) || '',
    });
    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (error) {
    return hunterFailure(error, 'Failed to add opportunity');
  }
}

/** Status, notes, hiring email, or edits to the draft. */
export async function PATCH(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Opportunity id is required' }, { status: 422 });

  try {
    const changes: Partial<Opportunity> = {};
    if (body.status !== undefined) {
      if (!OPPORTUNITY_STATUSES.includes(body.status as OpportunityStatus)) throw new LeadError('Unknown status', 422);
      changes.status = body.status as OpportunityStatus;
      // Closing the loop stops follow-up reminders.
      if (['replied', 'interview', 'won', 'lost', 'skipped'].includes(changes.status)) changes.followup_at = null;
    }
    if (body.notes !== undefined) changes.notes = str(body.notes, 5000) || '';
    if (body.apply_email !== undefined) {
      const email = (str(body.apply_email, 200) || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LeadError('Email is not valid', 422);
      changes.apply_email = email;
    }
    if (body.proposal && typeof body.proposal === 'object') {
      const current = await getOpportunity(body.id);
      if (!current) throw new LeadError('Opportunity not found', 404);
      const draft = body.proposal as Record<string, unknown>;
      changes.proposal = {
        kind: current.proposal?.kind || 'proposal',
        model: current.proposal?.model || 'edited',
        created_at: current.proposal?.created_at || new Date().toISOString(),
        subject: str(draft.subject, 200) ?? current.proposal?.subject ?? '',
        body: str(draft.body, 8000) ?? current.proposal?.body ?? '',
        cover: str(draft.cover, 1200) ?? current.proposal?.cover ?? '',
      };
    }
    if (!Object.keys(changes).length) throw new LeadError('Nothing to update', 422);
    const opportunity = await updateOpportunity(body.id, changes);
    return NextResponse.json({ opportunity });
  } catch (error) {
    return hunterFailure(error, 'Failed to update opportunity');
  }
}
