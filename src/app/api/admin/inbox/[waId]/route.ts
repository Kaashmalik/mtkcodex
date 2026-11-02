import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listMessages, markConversationRead } from '@/lib/inbox';
import { findLeadByPhone } from '@/lib/leads';

export const dynamic = 'force-dynamic';

/** One conversation. Opening it clears the lead's unread badge. */
export async function GET(req: Request, { params }: { params: Promise<{ waId: string }> }) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const { waId } = await params;
  try {
    const [messages, lead] = await Promise.all([listMessages(waId), findLeadByPhone(waId)]);
    if (lead && new URL(req.url).searchParams.get('read') !== '0') await markConversationRead(lead.id);
    return NextResponse.json({ messages, lead: lead ? { ...lead, unread_count: 0 } : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load chat' }, { status: 500 });
  }
}
