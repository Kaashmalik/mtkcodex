import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hunterFailure } from '@/lib/hunter-http';
import { llmConfigured } from '@/lib/llm';
import { refreshOpportunities, scoreNext } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/**
 * Daily MTK Hunter run, called by netlify/functions/hunter-daily.mjs (or any
 * cron service) with `Authorization: Bearer $CRON_SECRET`.
 *   ?step=refresh  fetch every board
 *   ?step=score    AI-score one batch (call repeatedly while remaining > 0)
 * Steps are separate requests so each stays inside the host's function time limit.
 */

function authorised(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 16) return false;
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const step = new URL(req.url).searchParams.get('step') || 'refresh';
  try {
    if (step === 'refresh') return NextResponse.json(await refreshOpportunities());
    if (step === 'score') {
      if (!llmConfigured()) return NextResponse.json({ scored: 0, remaining: 0, skipped: 'AI not configured' });
      return NextResponse.json(await scoreNext());
    }
    return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
  } catch (error) {
    return hunterFailure(error, `cron ${step} failed`);
  }
}
