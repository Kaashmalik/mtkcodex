import type { Metadata } from 'next';
import SettingsPanel, { type ChannelRow } from '@/components/admin/SettingsPanel';
import { channelStatus } from '@/lib/channels';
import { llmConfigured } from '@/lib/llm';
import { smsConfigured } from '@/lib/sms';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Names of env vars that are not set. Only names are shown, never values. */
const missing = (...keys: string[]) => keys.filter((key) => !(process.env[key] || '').trim());

export default function SettingsPage() {
  const status = channelStatus();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://mtkcodex.tech').replace(/\/+$/, '');

  const channels: ChannelRow[] = [
    { name: 'Database (Supabase)', on: status.database, what: 'Stores leads, chats, messages and history.', missing: missing('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') },
    { name: 'Website live chat', on: status.chat, what: 'The "Chat with the team" tab in the site widget. Needs only the database.', missing: [] },
    { name: 'Email — sending', on: status.emailSend, what: 'Reply to leads by email from the inbox (Resend, free 3,000/month).', missing: missing('RESEND_API_KEY', 'EMAIL_FROM') },
    { name: 'Email — receiving', on: status.emailReceive, what: 'Client replies land in the inbox (Resend receiving + MX record).', missing: missing('RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_REPLY_DOMAIN') },
    { name: 'WhatsApp Cloud API', on: status.whatsapp, what: 'Two-way WhatsApp from the inbox (Meta).', missing: missing('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN') },
    { name: 'Push alerts', on: status.push, what: 'Notifications on your phone/laptop via the installed app.', missing: missing('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT') },
    { name: 'Telegram alerts', on: status.telegram, what: 'Optional backup alerts to your Telegram.', missing: missing('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID') },
    { name: 'SMS campaigns (Twilio)', on: smsConfigured(), what: 'Text consented US contacts from Campaigns. Needs A2P 10DLC registration in Twilio.', missing: missing('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', ...((process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM || '').trim() ? [] : ['TWILIO_MESSAGING_SERVICE_SID'])) },
    { name: 'MTK Hunter — AI', on: llmConfigured(), what: 'Scores remote jobs and writes proposals (River: DeepSeek for scoring, Kimi for writing).', missing: missing('LLM_API_KEY') },
    { name: 'MTK Hunter — hourly run', on: Boolean((process.env.CRON_SECRET || '').trim()), what: 'Fetches fresh jobs, scores and drafts them, and in auto mode sends the ones that pass every check.', missing: missing('CRON_SECRET') },
    { name: 'Book-a-call link', on: status.booking, what: 'Cal.com / Google Calendar booking link shown in chat and on the contact page.', missing: missing('NEXT_PUBLIC_BOOKING_URL') },
  ];

  return (
    <SettingsPanel
      channels={channels}
      webhooks={[
        { label: 'Resend (email.received)', url: `${site}/api/email/webhook` },
        { label: 'Meta WhatsApp', url: `${site}/api/whatsapp/webhook` },
        { label: 'Twilio SMS (incoming + status)', url: `${site}/api/sms/webhook` },
      ]}
    />
  );
}
