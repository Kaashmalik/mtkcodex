import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hunterFailure, readJsonBody } from '@/lib/hunter-http';
import { sendSelected } from '@/lib/hunter-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** Review mode: send several reviewed drafts at once. */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 25) : [];
  if (!ids.length) return NextResponse.json({ error: 'Select at least one draft' }, { status: 422 });
  try {
    return NextResponse.json(await sendSelected(ids));
  } catch (error) {
    return hunterFailure(error, 'Batch send failed');
  }
}
