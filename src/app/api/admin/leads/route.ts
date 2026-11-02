import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { listLeads, leadStats, updateLead, type LeadPatch, type LeadStatus } from '@/lib/leads';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { leads, mode } = await listLeads();
    return NextResponse.json({ leads, stats: leadStats(leads), mode, email: session.email });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load leads' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'Lead id is required' }, { status: 422 });

  const patch: LeadPatch = {};
  if (typeof body.status === 'string') patch.status = body.status as LeadStatus;
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (typeof body.next_followup === 'string' || body.next_followup === null) {
    patch.next_followup = body.next_followup as string | null;
  }
  if (typeof body.last_contacted === 'string' || body.last_contacted === null) {
    patch.last_contacted = body.last_contacted as string | null;
  }
  if (typeof body.do_not_contact === 'boolean') patch.do_not_contact = body.do_not_contact;
  if (typeof body.message === 'string') patch.message = body.message;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
  }

  try {
    const lead = await updateLead(id, patch);
    return NextResponse.json({ lead });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update lead';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
