import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hunterFailure } from '@/lib/hunter-http';
import { refreshOpportunities } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** Pull fresh posts from every board now (the daily job does the same). */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await refreshOpportunities());
  } catch (error) {
    return hunterFailure(error, 'Failed to fetch jobs');
  }
}
