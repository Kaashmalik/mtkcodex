import { listLeads, storageMode } from '@/lib/leads';
import OutreachQueue from '@/components/admin/OutreachQueue';

export const dynamic = 'force-dynamic';

export default async function OutreachPage() {
  try {
    const { leads, mode } = await listLeads();
    return <OutreachQueue initialLeads={leads} mode={mode} />;
  } catch (error) {
    return (
      <div className="card mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-bold">Outreach unavailable</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {error instanceof Error ? error.message : 'Could not load the outreach queue.'} (storage: {storageMode()})
        </p>
      </div>
    );
  }
}
