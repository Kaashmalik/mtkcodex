import { NextResponse } from 'next/server';
import { runCampaigns } from '@/lib/campaigns';
import { cronAuthorised } from '@/lib/cron-auth';
import { hunterFailure } from '@/lib/hunter-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** Every 15 minutes from netlify/functions/campaigns-run.mjs: send the next small batch. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ reports: await runCampaigns(18_000) });
  } catch (error) {
    return hunterFailure(error, 'campaign run failed');
  }
}
