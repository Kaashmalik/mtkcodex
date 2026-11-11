import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { runCampaigns } from '@/lib/campaigns';
import { hunterFailure } from '@/lib/hunter-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** "Send next batch now": the same pass the 15-minute job makes. */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ reports: await runCampaigns(15_000) });
  } catch (error) {
    return hunterFailure(error, 'Campaign run failed');
  }
}
