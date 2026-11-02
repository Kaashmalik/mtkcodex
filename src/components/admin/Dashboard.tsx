'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  LEAD_STATUSES,
  STATUS_LABELS,
  applyLocalOverrides,
  leadStats,
  leadsToCsv,
  statusTone,
  waLink,
  writeLocalOverride,
  type Lead,
  type LeadOverride,
  type LeadStatus,
} from '@/lib/lead-types';
import { WhatsappIcon } from '@/components/ui/BrandIcons';
import { LEADS_SHEET_URL } from '@/lib/crm-links';
import type { StorageMode } from '@/lib/leads';

type Draft = Pick<Lead, 'status' | 'notes' | 'next_followup' | 'do_not_contact' | 'message'>;

const emptyDraft: Draft = {
  status: 'new',
  notes: '',
  next_followup: null,
  do_not_contact: false,
  message: '',
};

export default function Dashboard({
  initialLeads,
  mode,
  email,
}: {
  initialLeads: Lead[];
  mode: StorageMode;
  email: string;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | LeadStatus>('all');
  const [tier, setTier] = useState('all');
  const [visible, setVisible] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  const stats = useMemo(() => leadStats(leads), [leads]);
  const selected = leads.find((lead) => lead.id === selectedId) || null;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Read-only deployments have no database. Merge any progress the owner saved
  // in this browser over the bundled seed so the queue survives a page reload.
  useEffect(() => {
    if (mode !== 'readonly') return;
    setLeads((rows) => applyLocalOverrides(rows));
  }, [mode]);

  const tiers = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.lead_tier).filter(Boolean))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return leads
      .filter((lead) => (status === 'all' ? true : lead.status === status))
      .filter((lead) => (tier === 'all' ? true : lead.lead_tier === tier))
      .filter((lead) => {
        if (!needle) return true;
        return [lead.name, lead.business_type, lead.area, lead.phone, lead.notes, lead.email]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        const dateA = a.created_at || '';
        const dateB = b.created_at || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return (b.lead_score || 0) - (a.lead_score || 0);
      });
  }, [leads, query, status, tier]);

  function openLead(lead: Lead) {
    setSelectedId(lead.id);
    setError('');
    setDraft({
      status: lead.status,
      notes: lead.notes || '',
      next_followup: lead.next_followup || null,
      do_not_contact: Boolean(lead.do_not_contact),
      message: lead.message || '',
    });
  }

  function closeDrawer() {
    setSelectedId(null);
    setDraft(emptyDraft);
  }

  async function patchLead(id: string, patch: Record<string, unknown>, quiet = false) {
    if (mode === 'readonly') {
      const current = leads.find((lead) => lead.id === id);
      if (!current) throw new Error('Lead not found');
      const local = { ...patch } as LeadOverride;
      if (local.status === 'contacted' && local.last_contacted === undefined) {
        local.last_contacted = new Date().toISOString().slice(0, 10);
      }
      const merged = writeLocalOverride(id, local);
      const next = { ...current, ...merged } as Lead;
      setLeads((rows) => rows.map((row) => (row.id === id ? next : row)));
      if (!quiet) setToast('Saved in this browser only');
      return next;
    }

    const res = await fetch('/api/admin/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = (await res.json().catch(() => ({}))) as { lead?: Lead; error?: string };
    if (!res.ok || !data.lead) {
      throw new Error(data.error || 'Could not save changes');
    }
    setLeads((current) => current.map((lead) => (lead.id === id ? data.lead! : lead)));
    if (!quiet) setToast('Saved');
    return data.lead;
  }

  /** Exports exactly what the table shows, including browser-only overrides. */
  function downloadCsv() {
    const blob = new Blob([leadsToCsv(leads)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mtk-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast('CSV downloaded');
  }

  async function changeStatus(lead: Lead, next: LeadStatus) {
    setBusyId(lead.id);
    setError('');
    try {
      await patchLead(lead.id, { status: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setBusyId(null);
    }
  }

  async function saveDraft() {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await patchLead(selected.id, {
        status: draft.status,
        notes: draft.notes,
        next_followup: draft.next_followup || null,
        do_not_contact: draft.do_not_contact,
        message: draft.message,
      });
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast('Message copied');
    } catch {
      setError('Copy failed — select the text manually.');
    }
  }

  async function importSeed() {
    setImporting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/leads/import', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
      if (!res.ok) throw new Error(data.error || 'Import failed');
      const reload = await fetch('/api/admin/leads', { cache: 'no-store' });
      const fresh = (await reload.json()) as { leads?: Lead[] };
      if (fresh.leads) setLeads(fresh.leads);
      setToast(data.count ? `Added ${data.count} new leads` : 'All seed leads are already in the CRM');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const shown = filtered.slice(0, visible);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Lead CRM</p>
          <h1 className="mt-2 text-3xl font-bold">Pipeline</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Signed in as {email}. {stats.total} leads in this workspace.
          </p>        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/admin/outreach"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-sm font-semibold text-on-cta transition hover:bg-cta-hover"
          >
            <Send className="size-4" /> Outreach ({stats.queued})
          </a>
          {mode === 'readonly' ? (
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-fg-muted transition hover:border-brand hover:text-brand"
            >
              <Download className="size-4" /> Export CSV
            </button>
          ) : (
            <a
              href="/api/admin/leads/export"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-fg-muted transition hover:border-brand hover:text-brand"
            >
              <Download className="size-4" /> Export CSV
            </a>
          )}
          {mode === 'supabase' && (
            <button
              type="button"
              onClick={importSeed}
              disabled={importing}
              title="Adds leads from the bundled seed batch that are not already in the CRM. Existing leads are left untouched."
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-fg-muted transition hover:border-brand hover:text-brand disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${importing ? 'animate-spin' : ''}`} /> Import batch
            </button>
          )}
          <a
            href={LEADS_SHEET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-fg-muted transition hover:border-brand hover:text-brand"
          >
            <ExternalLink className="size-4" /> Google Sheet
          </a>
        </div>
      </div>

      <StorageNotice mode={mode} />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto" aria-label="Dismiss error">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Users} label="Total leads" value={stats.total} onClick={() => setStatus('all')} active={status === 'all'} />
        <StatCard icon={Send} label="Queued" value={stats.byStatus.queued} onClick={() => setStatus('queued')} active={status === 'queued'} />
        <StatCard icon={MessageCircle} label="Contacted" value={stats.contacted} onClick={() => setStatus('contacted')} active={status === 'contacted'} />
        <StatCard icon={CalendarClock} label="Follow-ups due" value={stats.dueToday} />
        <StatCard icon={Trophy} label="Won" value={stats.won} onClick={() => setStatus('won')} active={status === 'won'} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search business, area, phone or notes…"
            className="h-10 w-full rounded-full border border-line bg-elevated pl-9 pr-4 text-sm outline-none transition focus:border-brand"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as 'all' | LeadStatus)}
          className="h-10 rounded-full border border-line bg-elevated px-3 text-sm"
        >
          <option value="all">All statuses</option>
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          value={tier}
          onChange={(event) => setTier(event.target.value)}
          className="h-10 rounded-full border border-line bg-elevated px-3 text-sm"
        >
          <option value="all">All tiers</option>
          {tiers.map((value) => (
            <option key={value} value={value}>
              Tier {value}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-elevated">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line bg-muted/50 text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">Business</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Last contact</th>
                <th className="px-4 py-3 font-semibold">Follow-up</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((lead) => (
                <tr key={lead.id} className="border-b border-line/70 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <button onClick={() => openLead(lead)} className="text-left font-semibold hover:text-brand">
                      {lead.name}
                    </button>
                    <p className="text-xs text-fg-subtle">
                      {lead.business_type} · {lead.area}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fg-muted">{lead.phone}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-semibold">{lead.lead_score}</span>
                    <span className="mx-1 text-fg-subtle">·</span>
                    <span className="text-xs font-semibold text-fg-muted">{lead.lead_tier}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Change status for ${lead.name}`}
                      value={lead.status}
                      disabled={busyId === lead.id}
                      onChange={(event) => changeStatus(lead, event.target.value as LeadStatus)}
                      className={`h-8 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold transition disabled:opacity-60 ${statusTone(lead.status)}`}
                    >
                      {LEAD_STATUSES.map((value) => (
                        <option key={value} value={value} className="bg-elevated text-fg">
                          {STATUS_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">{lead.last_contacted || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">{lead.next_followup || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {lead.phone && (
                        <a
                          href={waLink(lead)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="grid size-8 place-items-center rounded-lg border border-line text-[#25d366] transition hover:border-[#25d366]"
                          aria-label={`Open WhatsApp chat with ${lead.name}`}
                        >
                          <WhatsappIcon className="size-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openLead(lead)}
                        className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold text-fg-muted transition hover:border-brand hover:text-brand"
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-fg-muted">
                    No leads match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > visible && (
          <div className="border-t border-line px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => setVisible((value) => value + 25)}
              className="text-sm font-semibold text-brand hover:underline"
            >
              Show more ({filtered.length - visible} remaining)
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-subtle">
        <span>
          Showing {shown.length} of {filtered.length} filtered leads
        </span>
        <a href="/admin/docs" className="hover:text-brand">
          Read the outreach playbook →
        </a>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button className="absolute inset-0 bg-black/40" onClick={closeDrawer} aria-label="Close details" />
          <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-elevated shadow-float">
            <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-elevated px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <p className="text-xs text-fg-subtle">
                  {selected.business_type} · {selected.area}
                </p>
              </div>
              <button onClick={closeDrawer} className="rounded-lg border border-line p-2 text-fg-muted hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div className="flex flex-wrap gap-2 text-xs">
                <a
                  href={`tel:${selected.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-fg-muted hover:border-brand hover:text-brand"
                >
                  {selected.phone}
                </a>
                {selected.phone && (
                  <a
                    href={waLink(selected)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-[#1da851] hover:border-[#25d366]"
                  >
                    <WhatsappIcon className="size-3.5" /> WhatsApp
                  </a>
                )}
                {selected.email && (
                  <a
                    href={`mailto:${selected.email}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-fg-muted hover:border-brand hover:text-brand"
                  >
                    {selected.email}
                  </a>
                )}
                {selected.google_maps_url && (
                  <a
                    href={selected.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-semibold text-fg-muted hover:border-brand hover:text-brand"
                  >
                    <ExternalLink className="size-3.5" /> Maps
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Metric label="Score" value={`${selected.lead_score} / ${selected.lead_tier}`} />
                <Metric label="Scenario" value={selected.scenario || '—'} />
                <Metric label="Rating" value={selected.rating ? `${selected.rating}★` : '—'} />
                <Metric label="Reviews" value={selected.reviews ? String(selected.reviews) : '—'} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft({ ...draft, status: event.target.value as LeadStatus })}
                    className="h-10 w-full rounded-xl border border-line bg-elevated px-3 text-sm"
                  >
                    {LEAD_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Next follow-up">
                  <input
                    type="date"
                    value={draft.next_followup || ''}
                    onChange={(event) => setDraft({ ...draft, next_followup: event.target.value || null })}
                    className="h-10 w-full rounded-xl border border-line bg-elevated px-3 text-sm"
                  />
                </Field>
              </div>

              <Field label="Message sent / to send">
                <textarea
                  value={draft.message}
                  onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                  rows={7}
                  className="w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand"
                />
              </Field>
              <div className="-mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyMessage(draft.message)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-fg-muted hover:border-brand hover:text-brand"
                >
                  <Copy className="size-3.5" /> Copy message
                </button>
                {draft.message !== selected.message && (
                  <span className="inline-flex h-9 items-center text-xs text-amber-600">Unsaved edits</span>
                )}
              </div>

              <Field label="Notes">
                <textarea
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  rows={4}
                  placeholder="Contact person, reply summary, next step…"
                  className="w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand"
                />
              </Field>

              <label className="flex items-start gap-3 rounded-xl border border-line bg-muted/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.do_not_contact}
                  onChange={(event) => setDraft({ ...draft, do_not_contact: event.target.checked })}
                  className="mt-0.5 size-4 rounded border-line"
                />
                <span>
                  <span className="font-semibold">Do not contact</span>
                  <span className="block text-xs text-fg-subtle">
                    Stops this lead appearing in the outreach queue. Use after any opt-out request.
                  </span>
                </span>
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <div className="sticky bottom-0 mt-auto flex gap-2 border-t border-line bg-elevated px-5 py-4">
              <button
                type="button"
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-cta text-sm font-semibold text-on-cta transition hover:bg-cta-hover disabled:opacity-60"
              >
                {saving ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex h-10 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-fg-muted hover:text-fg"
              >
                Close
              </button>
            </div>
          </aside>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-float">
          <Check className="size-4" /> {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  onClick,
  active,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`card flex items-center gap-3 p-4 text-left transition ${
        active ? 'border-brand ring-1 ring-brand/30' : onClick ? 'hover:border-brand/50' : ''
      }`}
    >
      <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-5" />
      </span>
      <span>
        <span className="block text-2xl font-bold leading-tight">{value}</span>
        <span className="block text-xs text-fg-subtle">{label}</span>
      </span>
    </Tag>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-muted/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-0.5 truncate font-semibold capitalize">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function StorageNotice({ mode }: { mode: StorageMode }) {
  if (mode === 'supabase') {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-fg-subtle">
        <span className="size-1.5 rounded-full bg-emerald-500" /> Synced to Supabase.
      </p>
    );
  }
  if (mode === 'file') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          Local file storage (<code>.data/leads.json</code>). Changes work in development but won&apos;t persist on
          Vercel — add Supabase env vars to go live.
        </span>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        No database connected. Status changes and notes are saved{' '}
        <strong>in this browser only</strong> (export the CSV to keep a copy). Add <code>SUPABASE_URL</code> and{' '}
        <code>SUPABASE_SERVICE_ROLE_KEY</code> to sync across devices.
      </span>
    </div>
  );
}
