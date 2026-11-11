import type { Metadata } from 'next';
import OpportunityBoard from '@/components/admin/OpportunityBoard';
import { emailConfigured } from '@/lib/email';
import { hunterProfile } from '@/lib/hunter-profile';
import { storageMode } from '@/lib/leads';
import { llmConfigured, llmModels } from '@/lib/llm';
import { emailsSentToday, hunterSettings, listOpportunities } from '@/lib/opportunities';
import { hunterQueries, parseWatchlist } from '@/lib/opportunity-sources';

export const metadata: Metadata = {
  title: 'Opportunities',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const result = await Promise.all([listOpportunities(), emailsSentToday()]).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : 'Could not load opportunities.',
  }));

  if ('error' in result) {
    return (
      <div className="card mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-bold">MTK Hunter unavailable</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {result.error} Run <code>supabase/migrations/0005_opportunities.sql</code> if the table is missing.
        </p>
      </div>
    );
  }

  const [opportunities, sentToday] = result;
  const models = llmModels();
  const settings = hunterSettings();
  const profile = hunterProfile();
  return (
    <OpportunityBoard
      initial={opportunities}
      config={{
        readOnly: storageMode() === 'readonly',
        ai: llmConfigured(),
        email: emailConfigured(),
        models: { fast: models.fast, writer: models.writer },
        sentToday,
        dailyLimit: settings.dailySendLimit,
        minScore: settings.minScore,
        queries: hunterQueries(),
        watchlist: parseWatchlist().map((w) => `${w.ats}:${w.slug}`),
        projects: profile.projects.map((p) => ({ slug: p.slug, name: p.name })),
      }}
    />
  );
}
