import type { Metadata } from 'next';
import CampaignsBoard from '@/components/admin/CampaignsBoard';
import { campaignOverview } from '@/lib/campaigns';
import { storageMode } from '@/lib/leads';
import { smsConfigured, smsWebhookUrl } from '@/lib/sms';
import { whatsappConfigured } from '@/lib/whatsapp';

export const metadata: Metadata = {
  title: 'Campaigns',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const result = await campaignOverview().catch((error: unknown) => ({
    error: error instanceof Error ? error.message : 'Could not load campaigns.',
  }));

  if ('error' in result) {
    return (
      <div className="card mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-bold">Campaigns unavailable</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {result.error} Run <code>supabase/migrations/0006_campaigns.sql</code> if the tables are missing.
        </p>
      </div>
    );
  }

  return (
    <CampaignsBoard
      initial={result}
      config={{
        readOnly: storageMode() === 'readonly',
        sms: smsConfigured(),
        whatsapp: whatsappConfigured(),
        smsWebhook: smsWebhookUrl(),
        siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://mtkcodex.tech').replace(/\/+$/, ''),
      }}
    />
  );
}
