import { NextResponse } from 'next/server';
import { cronAuthorised } from '@/lib/cron-auth';
import type { HunterStep } from '@/lib/hunter-automation';
import { hunterFailure } from '@/lib/hunter-http';
import { runStep } from '@/lib/hunter-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hourly MTK Hunter batch, called by the Vercel Schedule in vercel.json (or
 * any cron service) with `Authorization: Bearer $CRON_SECRET`.
 *
 * Vercel gives one invocation per schedule run, so this route runs steps
 * in-process until the queue is empty or the time budget is spent. Progress is
 * stored after every step, so a run cut short simply resumes next hour; the
 * single-step /api/cron/hunter route stays available for manual callers.
 */

const BUDGET_MS = 45_000; // Hobby functions stop at 60 s
const MAX_STEPS = 8;

export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const started = Date.now();
  const done: HunterStep[] = [];
  const steps: Awaited<ReturnType<typeof runStep>>[] = [];

  try {
    for (let i = 0; i < MAX_STEPS && Date.now() - started < BUDGET_MS; i += 1) {
      const result = await runStep('cron', done);
      steps.push(result);
      if (result.step === 'idle' || result.error) break;
      done.push(result.step);
    }
    return NextResponse.json({ steps });
  } catch (error) {
    return hunterFailure(error, 'hunter batch failed');
  }
}
