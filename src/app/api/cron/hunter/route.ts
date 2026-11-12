import { NextResponse } from 'next/server';
import { cronAuthorised } from '@/lib/cron-auth';
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

export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
