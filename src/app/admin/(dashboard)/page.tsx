import { getAdminSession } from '@/lib/admin-auth';
import { listLeads, storageMode, type StorageMode } from '@/lib/leads';
import Dashboard from '@/components/admin/Dashboard';
import { AlertTriangle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const session = await getAdminSession();
  let mode: StorageMode = storageMode();
  let leads = [] as Awaited<ReturnType<typeof listLeads>>['leads'];
  let loadError = '';

  try {
    const result = await listLeads();
    mode = result.mode;
    leads = result.leads;
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load leads.';
  }

  if (loadError) {
    return (
      <div className="card mx-auto max-w-2xl p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-amber-500" />
          <div>
            <h1 className="text-xl font-bold">Database not ready</h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              The leads table could not be reached. Run the migration in{' '}
              <code className="rounded bg-muted px-1">supabase/migrations/0001_leads.sql</code>, then refresh.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-night p-3 text-xs text-white/80">{loadError}</pre>
          </div>
        </div>
      </div>
    );
  }

  return <Dashboard initialLeads={leads} mode={mode} email={session?.email || ''} />;
}
