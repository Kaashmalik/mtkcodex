import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { HunterStep } from '@/lib/hunter-automation';
import { hunterFailure } from '@/lib/hunter-http';
import { runStep } from '@/lib/hunter-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/**
 * Hourly MTK Hunter run, called by netlify/functions/hunter-run.mjs (or any
 * cron service) with `Authorization: Bearer $CRON_SECRET`. Each request does
 * one step (fetch, score, draft or send); the caller repeats with
 * `?done=<steps so far>` until the answer is `idle`.
 */

const STEPS: HunterStep[] = ['refresh', 'score', 'draft', 'send', 'idle'];

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
  const done = (new URL(req.url).searchParams.get('done') || '')
    .split(',')
    .filter((s): s is HunterStep => STEPS.includes(s as HunterStep))
    .slice(0, 20);
  try {
    return NextResponse.json(await runStep('cron', done));
  } catch (error) {
    return hunterFailure(error, 'cron step failed');
  }
}
