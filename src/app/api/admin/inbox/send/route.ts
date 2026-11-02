import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { sendFromDashboard } from '@/lib/inbox';
import { LeadError } from '@/lib/leads';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  let body: { leadId?: unknown; text?: unknown; template?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.leadId !== 'string' || !body.leadId) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 422 });
  }

  const raw = (body.template || null) as { name?: unknown; language?: unknown; params?: unknown } | null;
  const template =
    raw && typeof raw.name === 'string' && raw.name.trim()
      ? {
          name: raw.name.trim(),
          language: typeof raw.language === 'string' && raw.language ? raw.language : 'en',
          params: Array.isArray(raw.params) ? raw.params.filter((p): p is string => typeof p === 'string') : [],
        }
      : undefined;

  try {
    const message = await sendFromDashboard({
      leadId: body.leadId,
      text: typeof body.text === 'string' ? body.text : undefined,
      template,
    });
    return NextResponse.json({ message });
  } catch (error) {
    const status = error instanceof LeadError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Send failed' }, { status });
  }
}
