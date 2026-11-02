import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listConversations } from '@/lib/inbox';
import { whatsappConfigured } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  try {
    const conversations = await listConversations();
    return NextResponse.json({ conversations, configured: whatsappConfigured() });
  } catch (error) {
    return NextResponse.json(
      { conversations: [], configured: whatsappConfigured(), error: error instanceof Error ? error.message : 'Inbox unavailable' },
      { status: 500 },
    );
  }
}
