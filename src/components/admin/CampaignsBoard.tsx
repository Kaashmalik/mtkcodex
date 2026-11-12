'use client';

import { useMemo, useState } from 'react';
import { Megaphone, MessageCircle, MousePointerClick, Pause, Pencil, Play, Plus, Send, Upload, Users } from 'lucide-react';
import { renderSms, smsSegments, fillTemplate } from '@/lib/campaign-message';
import { CONTACT_FIELDS, autoMapContacts, parseContactFile, rowToContact, type ContactField, type ContactMapping } from '@/lib/contact-import';
import type { RawRow } from '@/lib/lead-import';
import { US_STATE_CODES, formatUsPhone } from '@/lib/us-contacts';
import type { Campaign } from '@/lib/campaigns';
import { campaignsApi, type BatchRow, type CampaignRow } from '@/components/admin/client-api';
import SendTimeAdvisor from '@/components/admin/SendTimeAdvisor';
import {
  ErrorBanner,
  Field,
  Modal,
  Notice,
  StatCard,
  Toast,
  buttonClass,
  inputClass,
  primaryButtonClass,
  textareaClass,
  useNotice,
} from '@/components/admin/ui';

export type CampaignsConfig = { readOnly: boolean; sms: boolean; whatsapp: boolean; smsWebhook: string; siteUrl: string };

const STATUS_TONE: Record<Campaign['status'], string> = {
  draft: 'bg-muted text-fg-subtle',
  running: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  done: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

/** Campaigns to consented contacts: import, write, start, and watch the numbers. */
export default function CampaignsBoard({
  initial,
  config,
}: {
  initial: { campaigns: CampaignRow[]; batches: BatchRow[]; zones: Record<string, number> };
  config: CampaignsConfig;
}) {
  const [data, setData] = useState(initial);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);
  const [running, setRunning] = useState(false);
  const { toast, setToast, error, setError, fail } = useNotice();

  const totals = useMemo(() => {
    const sum = (key: 'sent' | 'clicked' | 'replied' | 'optedOut') => data.campaigns.reduce((acc, c) => acc + c.stats[key], 0);
    return {
      contacts: data.batches.reduce((acc, b) => acc + b.contacts, 0),
      sent: sum('sent'),
      clicked: sum('clicked'),
      replied: sum('replied'),
      optedOut: sum('optedOut'),
    };
  }, [data]);

  async function reload() {
    setData(await campaignsApi.overview());
  }

  async function setStatus(campaign: CampaignRow, status: Campaign['status']) {
    if (status === 'running') {
      const ok = window.confirm(
        `Start "${campaign.name}"?\n\nIt will message up to ${campaign.stats.audience} consented contacts by ${campaign.channel === 'sms' ? 'SMS' : 'WhatsApp'}, at most ${campaign.daily_limit} a day, between ${campaign.window_start}:00 and ${campaign.window_end}:00 in each contact's local time.`,
      );
      if (!ok) return;
    }
    try {
      await campaignsApi.update(campaign.id, { status });
      await reload();
      setToast(status === 'running' ? 'Campaign started: the first batch goes out within 15 minutes' : `Campaign ${status}`);
    } catch (err) {
      fail(err);
    }
  }

  async function runNow() {
    setRunning(true);
    setError('');
    try {
      const { reports } = await campaignsApi.run();
      await reload();
      if (!reports.length) setToast('No running campaigns');
      else setToast(reports.map((r) => `${r.campaign}: ${r.sent} sent${r.waiting ? `, ${r.waiting} waiting for local hours` : ''}${r.note ? ` (${r.note})` : ''}`).join(' · '));
    } catch (err) {
      fail(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <p className="eyebrow">Campaigns</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">SMS &amp; WhatsApp campaigns</h1>
          <p className="mt-1 text-sm text-fg-muted">Message consented contacts about your services, with a personal link to your site.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setImporting(true)} disabled={config.readOnly}>
            <Upload className="size-4" /> Import contacts
          </button>
          <button className={buttonClass} onClick={runNow} disabled={running || config.readOnly}>
            <Send className={`size-4 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Sending…' : 'Send next batch now'}
          </button>
          <button className={primaryButtonClass} onClick={() => setEditing('new')} disabled={config.readOnly}>
            <Plus className="size-4" /> New campaign
          </button>
        </div>
      </div>

      {config.readOnly && <Notice>Connect the database (Supabase) and run migration 0006 to import contacts and run campaigns.</Notice>}
      {!config.sms && (
        <Notice tone="sky">
          SMS is off. Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and <code>TWILIO_MESSAGING_SERVICE_SID</code>, register an A2P 10DLC
          campaign in Twilio, and set the incoming webhook to <code>{config.smsWebhook}</code>.
        </Notice>
      )}
      {!config.whatsapp && <Notice tone="sky">WhatsApp is off. Connect the WhatsApp Cloud API (Settings) and get a marketing template approved by Meta.</Notice>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Consented contacts" value={totals.contacts} hint={`${data.batches.length} import batch${data.batches.length === 1 ? '' : 'es'}`} />
        <StatCard icon={Send} label="Messages sent" value={totals.sent} />
        <StatCard icon={MousePointerClick} label="Link clicks" value={totals.clicked} hint={`${pct(totals.clicked, totals.sent)} click rate`} />
        <StatCard icon={MessageCircle} label="Replies" value={totals.replied} hint={`${totals.optedOut} opted out`} />
      </div>

      <SendTimeAdvisor zoneCounts={data.zones} />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <h2 className="mt-8 text-lg font-bold">Campaigns</h2>
      <ul className="mt-3 space-y-3">
        {data.campaigns.map((c) => (
          <li key={c.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <Megaphone className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="text-xs text-fg-muted">
                  {c.channel === 'sms' ? 'SMS' : `WhatsApp · ${c.wa_template}`} · {c.audience.batch || 'all batches'}
                  {c.audience.states?.length ? ` · ${c.audience.states.join(', ')}` : ''}
                  {c.audience.city ? ` · ${c.audience.city}` : ''} · {c.daily_limit}/day · {c.window_start}:00–{c.window_end}:00 local
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_TONE[c.status]}`}>{c.status}</span>
              {c.status !== 'running' && c.status !== 'done' && (
                <button className={primaryButtonClass} onClick={() => setStatus(c, 'running')} disabled={config.readOnly}>
                  <Play className="size-4" /> {c.status === 'paused' ? 'Resume' : 'Start'}
                </button>
              )}
              {c.status === 'running' && (
                <button className={buttonClass} onClick={() => setStatus(c, 'paused')}>
                  <Pause className="size-4" /> Pause
                </button>
              )}
              <button className={buttonClass} onClick={() => setEditing(c)} disabled={c.status === 'running'} title={c.status === 'running' ? 'Pause to edit' : 'Edit'}>
                <Pencil className="size-4" /> Edit
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-8">
              {(
                [
                  ['Audience', c.stats.audience],
                  ['Queued', c.stats.queued],
                  ['Sent', c.stats.sent],
                  ['Delivered', c.stats.delivered],
                  ['Clicked', c.stats.clicked],
                  ['Replied', c.stats.replied],
                  ['Opted out', c.stats.optedOut],
                  ['Failed', c.stats.failed],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-muted/40 px-2 py-1.5">
                  <p className="text-base font-bold">{value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">
              {c.stats.sentToday} sent today · click rate {pct(c.stats.clicked, c.stats.sent)} · reply rate {pct(c.stats.replied, c.stats.sent)}
            </p>
          </li>
        ))}
      </ul>
      {!data.campaigns.length && (
        <div className="card mt-3 p-8 text-center text-sm text-fg-muted">
          {data.batches.length ? 'No campaigns yet. Press "New campaign".' : 'Start by importing your consented contacts (JSON or CSV).'}
        </div>
      )}

      {data.batches.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Contact batches</h2>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-subtle">
                <tr>
                  <th className="px-4 py-2">Batch</th>
                  <th className="px-4 py-2">Contacts</th>
                  <th className="px-4 py-2">SMS consent</th>
                  <th className="px-4 py-2">WhatsApp consent</th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map((b) => (
                  <tr key={b.batch} className="border-t border-line">
                    <td className="px-4 py-2 font-semibold">{b.batch}</td>
                    <td className="px-4 py-2">{b.contacts}</td>
                    <td className="px-4 py-2">{b.sms}</td>
                    <td className="px-4 py-2">{b.whatsapp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importing && (
        <ContactImportDialog
          onClose={() => setImporting(false)}
          onDone={async (summary) => {
            setImporting(false);
            await reload();
            setToast(summary);
          }}
        />
      )}
      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          batches={data.batches}
          config={config}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            setToast('Campaign saved');
          }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Import
 * ------------------------------------------------------------------------- */

const FIELD_LABELS: Record<ContactField, string> = {
  phone: 'Phone (required)',
  name: 'Full name',
  first_name: 'First name',
  last_name: 'Last name',
  company: 'Company',
  email: 'Email',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  tags: 'Tags',
};

const CHUNK = 1000;

function ContactImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (summary: string) => void }) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<ContactMapping>({});
  const [batch, setBatch] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [channels, setChannels] = useState<('sms' | 'whatsapp')[]>(['sms']);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const headers = rows.length ? Object.keys(rows.reduce((acc, r) => Object.assign(acc, r), {} as RawRow)) : [];
  const consent = { source, date, channels, batch: batch || 'import' };
  const preview = useMemo(() => {
    let valid = 0;
    const sample: { phone: string; name: string; place: string }[] = [];
    for (const row of rows) {
      const result = rowToContact(row, mapping, consent);
      if (!result.lead) continue;
      valid += 1;
      if (sample.length < 5) sample.push({ phone: formatUsPhone(result.lead.phone), name: result.lead.name, place: [result.lead.city, result.lead.region].filter(Boolean).join(', ') });
    }
    return { valid, invalid: rows.length - valid, sample };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const parsed = parseContactFile(await file.text(), file.name);
      if (!parsed.length) throw new Error('No contacts found in this file.');
      setRows(parsed);
      setFileName(file.name);
      setMapping(autoMapContacts(Object.keys(parsed.reduce((acc, r) => Object.assign(acc, r), {} as RawRow))));
      setBatch(`${file.name.replace(/\.[a-z]+$/i, '')} ${new Date().toISOString().slice(0, 10)}`.slice(0, 80));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    }
  }

  async function runImport() {
    setError('');
    const totals = { inserted: 0, updated: 0, skipped: 0, duplicates: 0, invalid: 0 };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);
        const result = await campaignsApi.importRows(rows.slice(i, i + CHUNK), mapping, { ...consent, confirmed });
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result[key] || 0;
      }
      onDone(`Imported ${totals.inserted} new, updated ${totals.updated}, ${totals.invalid} without a valid US number`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setProgress('');
    }
  }

  const toggle = (c: 'sms' | 'whatsapp') => setChannels((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const ready = rows.length > 0 && mapping.phone && preview.valid > 0 && confirmed && source.trim().length >= 10 && channels.length > 0;

  return (
    <Modal title="Import consented contacts" onClose={onClose} wide>
      <div className="space-y-4 p-5">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center hover:border-brand">
          <Upload className="size-6 text-brand" />
          <span className="font-semibold">{fileName || 'Choose a JSON or CSV file'}</span>
          <span className="text-xs text-fg-muted">Arrays, nested objects, {'{ "customers": [...] }'} and JSON Lines all work. US numbers only.</span>
          <input type="file" accept=".json,.jsonl,.csv,.tsv,.txt,application/json,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {rows.length > 0 && (
          <>
            <div>
              <p className="text-sm font-semibold">Match your fields</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(CONTACT_FIELDS) as ContactField[]).map((field) => (
                  <Field key={field} label={FIELD_LABELS[field]}>
                    <select className={inputClass} value={mapping[field] || ''} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}>
                      <option value="">—</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-muted/30 p-3 text-xs">
              <p className="font-semibold">
                {preview.valid} of {rows.length} have a valid US number{preview.invalid ? ` · ${preview.invalid} will be skipped` : ''}
              </p>
              <ul className="mt-2 space-y-0.5 text-fg-muted">
                {preview.sample.map((s, i) => (
                  <li key={i}>
                    {s.phone} · {s.name}
                    {s.place ? ` · ${s.place}` : ''}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3 rounded-xl border border-line p-4">
              <p className="text-sm font-semibold">Consent record (stored on every contact)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Batch name">
                  <input className={inputClass} value={batch} onChange={(e) => setBatch(e.target.value)} />
                </Field>
                <Field label="Consent date (optional)">
                  <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Where and how did they agree?" hint="e.g. 'Opted in via the signup form at example.com/offer, checkbox for SMS marketing, 2026'">
                <textarea className={`${textareaClass} min-h-[4rem]`} value={source} onChange={(e) => setSource(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={channels.includes('sms')} onChange={() => toggle('sms')} /> Agreed to SMS
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={channels.includes('whatsapp')} onChange={() => toggle('whatsapp')} /> Agreed to WhatsApp
                </label>
              </div>
              <label className="flex items-start gap-2 text-xs leading-relaxed">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  I confirm these contacts gave prior express written consent to receive marketing messages from MTK Codex on the channels ticked, and I
                  can show that consent if asked.
                </span>
              </label>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          {progress && <span className="mr-auto text-xs text-fg-muted">{progress}</span>}
          <button className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryButtonClass} onClick={runImport} disabled={!ready || Boolean(progress)}>
            <Upload className="size-4" /> Import {preview.valid || ''} contacts
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Editor
 * ------------------------------------------------------------------------- */

const SAMPLE = { name: 'Jordan Smith', city: 'Austin' };

function CampaignEditor({
  campaign,
  batches,
  config,
  onClose,
  onSaved,
}: {
  campaign: CampaignRow | null;
  batches: BatchRow[];
  config: CampaignsConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    name: campaign?.name || '',
    channel: campaign?.channel || ('sms' as Campaign['channel']),
    message:
      campaign?.message ||
      'Hi {name}, MTK Codex here. We build websites, CRMs and automations that bring small businesses in {city} more customers. See our work and get a free quote: {link}',
    wa_template: campaign?.wa_template || '',
    wa_language: campaign?.wa_language || 'en',
    wa_params: (campaign?.wa_params || ['{name}', '{link}']).join('\n'),
    landing_url: campaign?.landing_url || `${config.siteUrl}/services`,
    batch: campaign?.audience.batch || '',
    states: (campaign?.audience.states || []).join(', '),
    city: campaign?.audience.city || '',
    daily_limit: campaign?.daily_limit ?? 200,
    window_start: campaign?.window_start ?? 9,
    window_end: campaign?.window_end ?? 20,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const sampleLink = `${config.siteUrl}/go/a1b2c3d4e5`;
  const smsPreview = renderSms(form.message, SAMPLE, sampleLink);
  const segments = smsSegments(smsPreview);
  const states = form.states
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => US_STATE_CODES.includes(s));

  async function save() {
    setSaving(true);
    setError('');
    const input: Partial<Campaign> = {
      name: form.name,
      channel: form.channel,
      message: form.message,
      wa_template: form.wa_template,
      wa_language: form.wa_language,
      wa_params: form.wa_params.split('\n').map((p) => p.trim()).filter(Boolean),
      landing_url: form.landing_url,
      audience: { batch: form.batch || undefined, states, city: form.city || undefined },
      daily_limit: Number(form.daily_limit),
      window_start: Number(form.window_start),
      window_end: Number(form.window_end),
    };
    try {
      if (campaign) await campaignsApi.update(campaign.id, input);
      else await campaignsApi.create(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={campaign ? `Edit ${campaign.name}` : 'New campaign'} onClose={onClose} wide>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="space-y-3">
          <Field label="Campaign name">
            <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Austin small businesses — website offer" />
          </Field>
          <div className="flex gap-2">
            {(['sms', 'whatsapp'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => set('channel', ch)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${form.channel === ch ? 'border-brand bg-brand-soft text-brand' : 'border-line text-fg-muted'}`}
              >
                {ch === 'sms' ? 'SMS (Twilio)' : 'WhatsApp template'}
              </button>
            ))}
          </div>

          {form.channel === 'sms' ? (
            <Field label="Message" hint="Use {name}, {city} and {link}. 'MTK Codex:' and 'Reply STOP to opt out.' are added if missing.">
              <textarea className={`${textareaClass} min-h-[7rem]`} value={form.message} onChange={(e) => set('message', e.target.value)} />
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label="Approved template name">
                  <input className={inputClass} value={form.wa_template} onChange={(e) => set('wa_template', e.target.value)} placeholder="services_intro" />
                </Field>
                <Field label="Language">
                  <input className={inputClass} value={form.wa_language} onChange={(e) => set('wa_language', e.target.value)} />
                </Field>
              </div>
              <Field label="Template variables, one per line" hint="Fill {{1}}, {{2}}… in order. Use {name}, {city}, {link}. Templates must be approved by Meta first.">
                <textarea className={`${textareaClass} min-h-[5rem]`} value={form.wa_params} onChange={(e) => set('wa_params', e.target.value)} />
              </Field>
            </>
          )}

          <Field label="Landing page (where {link} goes)">
            <input className={inputClass} value={form.landing_url} onChange={(e) => set('landing_url', e.target.value)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Batch">
              <select className={inputClass} value={form.batch} onChange={(e) => set('batch', e.target.value)}>
                <option value="">All batches</option>
                {batches.map((b) => (
                  <option key={b.batch} value={b.batch}>
                    {b.batch} ({b.contacts})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="States (optional)" hint={states.length ? states.join(', ') : 'e.g. TX, CA'}>
              <input className={inputClass} value={form.states} onChange={(e) => set('states', e.target.value)} />
            </Field>
            <Field label="City contains (optional)">
              <input className={inputClass} value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Per day (max)">
              <input className={inputClass} type="number" min={1} max={2000} value={form.daily_limit} onChange={(e) => set('daily_limit', Number(e.target.value))} />
            </Field>
            <Field label="From (local hour)">
              <input className={inputClass} type="number" min={8} max={20} value={form.window_start} onChange={(e) => set('window_start', Number(e.target.value))} />
            </Field>
            <Field label="Until (local hour)">
              <input className={inputClass} type="number" min={9} max={21} value={form.window_end} onChange={(e) => set('window_end', Number(e.target.value))} />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold">Preview</p>
          <div className="rounded-2xl bg-muted/60 p-4">
            <div className="ml-auto max-w-[17rem] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
              {form.channel === 'sms'
                ? smsPreview
                : `[${form.wa_template || 'template'}] ${form.wa_params
                    .split('\n')
                    .filter(Boolean)
                    .map((p) => fillTemplate(p, SAMPLE, sampleLink))
                    .join(' · ')}`}
            </div>
          </div>
          {form.channel === 'sms' && (
            <p className={`text-xs ${segments.segments > 2 ? 'text-amber-700 dark:text-amber-400' : 'text-fg-subtle'}`}>
              {smsPreview.length} characters · {segments.segments} SMS segment{segments.segments > 1 ? 's' : ''}
              {segments.unicode ? ' (emoji or special characters make each segment shorter)' : ''} · billed per segment
            </p>
          )}
          <ul className="list-disc space-y-1 pl-4 text-xs text-fg-muted">
            <li>Only contacts who consented to this channel and haven&apos;t opted out are messaged.</li>
            <li>Each contact gets a personal link; clicks show on their timeline.</li>
            <li>Replies: WhatsApp in the Inbox; SMS replies alert you and mark the lead replied. STOP opts out for good.</li>
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
        {error && <span className="mr-auto text-sm text-red-500">{error}</span>}
        <button className={buttonClass} onClick={onClose}>
          Cancel
        </button>
        <button className={primaryButtonClass} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save campaign'}
        </button>
      </div>
    </Modal>
  );
}
