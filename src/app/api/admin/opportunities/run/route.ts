import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import type { HunterStep } from '@/lib/hunter-automation';
import { hunterFailure, readJsonBody } from '@/lib/hunter-http';
import { runStep } from '@/lib/hunter-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

const STEPS: HunterStep[] = ['refresh', 'score', 'draft', 'send', 'idle'];

/** "Run now": one step per request; the page calls again until it gets `idle`. */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  const done = Array.isArray(body?.done) ? (body.done as unknown[]).filter((s): s is HunterStep => STEPS.includes(s as HunterStep)).slice(0, 20) : [];
  try {
    return NextResponse.json(await runStep('admin', done));
  } catch (error) {
    return hunterFailure(error, 'Run failed');
  }
}
