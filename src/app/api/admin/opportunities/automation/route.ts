import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { lastRefreshAt, loadAutomation, loadDaily, loadHealth, loadRuns, saveAutomation } from '@/lib/hunter-automation';
import { hunterFailure, readJsonBody } from '@/lib/hunter-http';
import { autoQueue, draftQueue } from '@/lib/hunter-runner';
import { listOpportunities } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';

async function snapshot() {
  const [settings, daily, runs, health, refreshedAt, opps] = await Promise.all([
    loadAutomation(),
    loadDaily(),
    loadRuns(),
    loadHealth(),
    lastRefreshAt(),
    listOpportunities(),
  ]);
  return {
    settings,
    daily,
    runs,
    health,
    lastRefreshAt: refreshedAt,
    queues: { draft: draftQueue(opps, settings).length, auto: autoQueue(opps, { ...settings, mode: 'auto' }).length },
  };
}

export async function GET(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await snapshot());
  } catch (error) {
    return hunterFailure(error, 'Failed to load automation');
  }
}

/** Review/auto mode, pause, and the daily numbers. */
export async function PUT(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  try {
    await saveAutomation(body);
    return NextResponse.json(await snapshot());
  } catch (error) {
    return hunterFailure(error, 'Failed to save automation');
  }
}
