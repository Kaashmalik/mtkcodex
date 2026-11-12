import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hunterFailure } from '@/lib/hunter-http';
import { scoreNext } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** AI-score the next batch of promising posts. Call again while `remaining` > 0. */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json(await scoreNext());
  } catch (error) {
    return hunterFailure(error, 'Failed to score jobs');
  }
}
