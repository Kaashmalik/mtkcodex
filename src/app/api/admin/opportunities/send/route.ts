import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hunterFailure, readJsonBody, str } from '@/lib/hunter-http';
import { LeadError } from '@/lib/leads';
import { sendOpportunity } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';

/**
 * The one-click send after review. `email` sends through Resend (replies land
 * in the Inbox); `apply_link` records that you applied on the company's page.
 */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Opportunity id is required' }, { status: 422 });

  try {
    if (body.via !== 'email' && body.via !== 'apply_link') throw new LeadError('Choose email or apply link', 422);
    const opportunity = await sendOpportunity({
      id: body.id,
      via: body.via,
      to: str(body.to, 200),
      subject: str(body.subject, 200) || '',
      body: str(body.body, 8000) || '',
      cover: str(body.cover, 1200),
      kind: body.kind === 'followup' ? 'followup' : 'proposal',
    });
    return NextResponse.json({ opportunity });
  } catch (error) {
    return hunterFailure(error, 'Failed to send');
  }
}
