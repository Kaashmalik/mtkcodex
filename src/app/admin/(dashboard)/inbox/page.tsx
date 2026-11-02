import type { Metadata } from 'next';
import { listConversations } from '@/lib/inbox';
import { defaultTemplate, whatsappConfigured } from '@/lib/whatsapp';
import Inbox from '@/components/admin/Inbox';
import type { Conversation } from '@/lib/lead-types';

export const metadata: Metadata = {
  title: 'Inbox',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const configured = whatsappConfigured();
  let conversations: Conversation[] = [];
  let error = '';
  if (configured) {
    try {
      conversations = await listConversations();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load chats';
    }
  }

  return (
    <>
      {error && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Inbox storage unavailable — run <code>supabase/migrations/0004_crm_v2.sql</code>. ({error})
        </p>
      )}
      <Inbox configured={configured} initialConversations={conversations} defaultTemplate={defaultTemplate()} />
    </>
  );
}
