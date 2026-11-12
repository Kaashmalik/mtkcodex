import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { writeProposal, type ProposalOptions } from '@/lib/hunter-ai';
import { hunterFailure, readJsonBody, str } from '@/lib/hunter-http';
import { LeadError } from '@/lib/leads';
import { llmConfigured } from '@/lib/llm';
import { getOpportunity, updateOpportunity } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/** Draft (or redraft) the proposal or a follow-up. Nothing is sent. */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Opportunity id is required' }, { status: 422 });

  try {
    if (!llmConfigured()) throw new LeadError('AI is not configured. Add LLM_API_KEY in your environment.', 503);
    const opp = await getOpportunity(body.id);
    if (!opp) throw new LeadError('Opportunity not found', 404);
    const options: ProposalOptions = {
      kind: pick(body.kind, ['proposal', 'followup'] as const),
      tone: pick(body.tone, ['warm', 'direct', 'formal'] as const),
      length: pick(body.length, ['short', 'medium'] as const),
      instructions: str(body.instructions, 500),
    };
    if (options.kind === 'followup' && !opp.sent_at) throw new LeadError('Send the proposal before writing a follow-up.', 409);
    const proposal = await writeProposal(opp, options);
    // A follow-up draft is returned only; the sent proposal stays on record.
    if (options.kind === 'followup') return NextResponse.json({ proposal, opportunity: opp });
    const opportunity = await updateOpportunity(opp.id, {
      proposal,
      ...(['new', 'shortlisted'].includes(opp.status) ? { status: 'drafted' as const } : {}),
    });
    return NextResponse.json({ proposal, opportunity });
  } catch (error) {
    return hunterFailure(error, 'Failed to write the proposal');
  }
}
