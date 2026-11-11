import { randomBytes } from 'node:crypto';
import { fillTemplate, renderSms } from '@/lib/campaign-message';
import { mutateTable, readTable } from '@/lib/file-store';
import { insertMessage } from '@/lib/message-store';
import { notifyOwner } from '@/lib/notify';
import { LeadError, addActivities, findLeadByPhone, listLeads, storageMode, writeLeadChanges } from '@/lib/leads';
import { CONTACTED_STATUSES, phoneDigits, type Lead } from '@/lib/lead-types';
import { PERMANENT_SMS_ERRORS, SmsError, isSmsOptOut, sendSms, smsConfigured } from '@/lib/sms';
import { supabase } from '@/lib/supabase';
import { zoneFor } from '@/lib/send-times';
import { inSendWindow } from '@/lib/us-contacts';
import { sendTemplate, whatsappConfigured } from '@/lib/whatsapp';

/**
 * Campaigns to consented contacts: SMS (Twilio) or WhatsApp templates, each
 * with a personal tracked link. Sending runs in small batches (every 15 min
 * from netlify/functions/campaigns-run.mjs), only inside each contact's local
 * window, up to a daily limit, and never to anyone without consent for that
 * channel or who replied STOP.
 */

export type CampaignChannel = 'sms' | 'whatsapp';
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done';
export type Audience = { batch?: string; states?: string[]; city?: string };

export type Campaign = {
  id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  message: string;
  wa_template: string;
  wa_language: string;
  wa_params: string[];
  landing_url: string;
  audience: Audience;
  daily_limit: number;
  window_start: number;
  window_end: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
};

export type RecipientStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped';

export type Recipient = {
  campaign_id: string;
  lead_id: string;
  token: string;
  status: RecipientStatus;
  error: string;
  external_id: string;
  sent_at: string | null;
  delivered_at: string | null;
  clicked_at: string | null;
  clicks: number;
  created_at: string;
};

export type CampaignStats = {
  audience: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  clicked: number;
  replied: number;
  optedOut: number;
  sentToday: number;
};

const READONLY_ERROR = 'No database connected. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run campaigns.';

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mtkcodex.tech').replace(/\/+$/, '');

/* ---------------------------------------------------------------------------
 * Pure helpers (tested)
 * ------------------------------------------------------------------------- */

export function trackingLink(token: string): string {
  return `${siteUrl()}/go/${token}`;
}

/** Who a campaign may message: consent for this channel, a usable number, not opted out, matching the filters. */
export function inAudience(lead: Lead, campaign: Pick<Campaign, 'channel' | 'audience'>): boolean {
  if (lead.do_not_contact || !lead.phone) return false;
  if (!(lead.consent_channels || []).includes(campaign.channel)) return false;
  if (campaign.channel === 'sms' && !lead.phone.startsWith('+1')) return false;
  const { batch, states, city } = campaign.audience || {};
  if (batch && lead.import_batch !== batch) return false;
  if (states?.length && !states.includes(lead.region || '')) return false;
  if (city && !(lead.city || '').toLowerCase().includes(city.toLowerCase())) return false;
  return true;
}

/**
 * Messages per 15-minute run, so the daily limit is spread evenly across the
 * sending hours instead of going out in one burst. Contacts in later time
 * zones open their window later, so a little headroom (×1.5) lets the day
 * still reach the limit.
 */
export function perRunLimit(campaign: Pick<Campaign, 'daily_limit' | 'window_start' | 'window_end'>): number {
  const runs = Math.max(1, (campaign.window_end - campaign.window_start) * 4);
  return Math.max(1, Math.ceil((campaign.daily_limit / runs) * 1.5));
}

/** Start of "today" in US Eastern time, for daily limits that match the recipients' day. */
export function startOfUsDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const offsetHours = Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour) - now.getTime()) / 3_600_000);
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetHours * 3_600_000).toISOString();
}

export function computeStats(recipients: Recipient[], leads: Map<string, Lead>, audience: number, now = new Date()): CampaignStats {
  const since = startOfUsDay(now);
  const stats: CampaignStats = { audience, queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0, clicked: 0, replied: 0, optedOut: 0, sentToday: 0 };
  for (const r of recipients) {
    stats[r.status] += 1;
    if (r.status === 'delivered') stats.sent += 1; // delivered counts as sent too
    if (r.clicked_at) stats.clicked += 1;
    if (r.sent_at && r.sent_at >= since) stats.sentToday += 1;
    const lead = leads.get(r.lead_id);
    if (lead && r.sent_at) {
      if (lead.last_inbound_at && lead.last_inbound_at > r.sent_at) stats.replied += 1;
      if (lead.do_not_contact) stats.optedOut += 1;
    }
  }
  return stats;
}

export function validateCampaign(input: Partial<Campaign>): string | null {
  if (!input.name?.trim()) return 'Give the campaign a name.';
  if (input.channel !== 'sms' && input.channel !== 'whatsapp') return 'Choose SMS or WhatsApp.';
  if (input.channel === 'sms') {
    if (!input.message || input.message.trim().length < 20) return 'Write the SMS message.';
    if (!/\{link\}/i.test(input.message)) return 'Add {link} to the message so people can visit your site.';
  }
  if (input.channel === 'whatsapp' && !input.wa_template?.trim()) return 'Enter the approved WhatsApp template name.';
  if (input.landing_url && !/^https?:\/\//i.test(input.landing_url)) return 'Landing page must start with https://';
  const start = input.window_start ?? 9;
  const end = input.window_end ?? 20;
  if (start < 8 || end > 21 || start >= end) return 'Sending hours must sit between 8:00 and 21:00 local time.';
  return null;
}

/* ---------------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------------- */

async function selectAll<T>(pathAndQuery: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase<T[]>(`${pathAndQuery}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const usingDb = () => storageMode() === 'supabase';

export async function listCampaigns(): Promise<Campaign[]> {
  if (storageMode() === 'readonly') return [];
  if (usingDb()) return selectAll<Campaign>('campaigns?select=*&order=created_at.desc');
  return (await readTable<Campaign>('campaigns')).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  if (usingDb()) return (await supabase<Campaign[]>(`campaigns?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null;
  return (await readTable<Campaign>('campaigns')).find((c) => c.id === id) || null;
}

async function writeCampaign(id: string, changes: Partial<Campaign>): Promise<Campaign> {
  if (usingDb()) {
    const rows = await supabase<Campaign[]>(`campaigns?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(changes),
    });
    if (!rows[0]) throw new LeadError('Campaign not found', 404);
    return rows[0];
  }
  return mutateTable<Campaign, Campaign>('campaigns', (rows) => {
    const row = rows.find((c) => c.id === id);
    if (!row) throw new LeadError('Campaign not found', 404);
    Object.assign(row, changes, { updated_at: new Date().toISOString() });
    return row;
  });
}

export async function listRecipients(campaignId?: string): Promise<Recipient[]> {
  if (storageMode() === 'readonly') return [];
  if (usingDb()) {
    return selectAll<Recipient>(`campaign_recipients?select=*${campaignId ? `&campaign_id=eq.${encodeURIComponent(campaignId)}` : ''}&order=created_at.asc,lead_id.asc`);
  }
  const all = await readTable<Recipient>('recipients');
  return campaignId ? all.filter((r) => r.campaign_id === campaignId) : all;
}

async function insertRecipients(rows: Recipient[]): Promise<void> {
  if (!rows.length) return;
  if (usingDb()) {
    for (let i = 0; i < rows.length; i += 500) {
      await supabase('campaign_recipients?on_conflict=campaign_id,lead_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
    }
    return;
  }
  await mutateTable<Recipient, void>('recipients', (all) => {
    const keys = new Set(all.map((r) => `${r.campaign_id}|${r.lead_id}`));
    for (const row of rows) if (!keys.has(`${row.campaign_id}|${row.lead_id}`)) all.push(row);
  });
}

async function updateRecipient(campaignId: string, leadId: string, changes: Partial<Recipient>): Promise<void> {
  if (usingDb()) {
    await supabase(`campaign_recipients?campaign_id=eq.${encodeURIComponent(campaignId)}&lead_id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(changes),
    });
    return;
  }
  await mutateTable<Recipient, void>('recipients', (all) => {
    const row = all.find((r) => r.campaign_id === campaignId && r.lead_id === leadId);
    if (row) Object.assign(row, changes);
  });
}

async function findRecipient(filter: { token?: string; externalId?: string }): Promise<Recipient | null> {
  if (usingDb()) {
    const query = filter.token ? `token=eq.${encodeURIComponent(filter.token)}` : `external_id=eq.${encodeURIComponent(filter.externalId || '')}`;
    return (await supabase<Recipient[]>(`campaign_recipients?${query}&select=*&limit=1`))[0] || null;
  }
  const all = await readTable<Recipient>('recipients');
  return all.find((r) => (filter.token ? r.token === filter.token : r.external_id === filter.externalId)) || null;
}

/* ---------------------------------------------------------------------------
 * Create, edit, start, pause
 * ------------------------------------------------------------------------- */

const pickNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function parseCampaignInput(body: Record<string, unknown>): Partial<Campaign> {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const out: Partial<Campaign> = {};
  if (body.name !== undefined) out.name = text(body.name, 120);
  if (body.channel === 'sms' || body.channel === 'whatsapp') out.channel = body.channel;
  if (body.message !== undefined) out.message = text(body.message, 1000);
  if (body.wa_template !== undefined) out.wa_template = text(body.wa_template, 120);
  if (body.wa_language !== undefined) out.wa_language = text(body.wa_language, 12) || 'en';
  if (Array.isArray(body.wa_params)) out.wa_params = body.wa_params.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 300)).slice(0, 10);
  if (body.landing_url !== undefined) out.landing_url = text(body.landing_url, 500);
  if (body.audience && typeof body.audience === 'object') {
    const a = body.audience as Record<string, unknown>;
    out.audience = {
      batch: text(a.batch, 80) || undefined,
      states: Array.isArray(a.states) ? a.states.filter((s): s is string => typeof s === 'string' && /^[A-Z]{2}$/.test(s)).slice(0, 60) : undefined,
      city: text(a.city, 80) || undefined,
    };
  }
  if (body.daily_limit !== undefined) out.daily_limit = pickNumber(body.daily_limit, 1, 2000, 200);
  if (body.window_start !== undefined) out.window_start = pickNumber(body.window_start, 0, 23, 9);
  if (body.window_end !== undefined) out.window_end = pickNumber(body.window_end, 1, 24, 20);
  return out;
}

export async function createCampaign(input: Partial<Campaign>): Promise<Campaign> {
  if (storageMode() === 'readonly') throw new LeadError(READONLY_ERROR, 503);
  const error = validateCampaign(input);
  if (error) throw new LeadError(error, 422);
  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: `cmp_${randomBytes(6).toString('hex')}`,
    name: input.name as string,
    channel: input.channel as CampaignChannel,
    status: 'draft',
    message: input.message || '',
    wa_template: input.wa_template || '',
    wa_language: input.wa_language || 'en',
    wa_params: input.wa_params || [],
    landing_url: input.landing_url || siteUrl(),
    audience: input.audience || {},
    daily_limit: input.daily_limit ?? 200,
    window_start: input.window_start ?? 9,
    window_end: input.window_end ?? 20,
    created_at: now,
    updated_at: now,
    started_at: null,
  };
  if (usingDb()) await supabase('campaigns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campaign) });
  else await mutateTable<Campaign, void>('campaigns', (rows) => void rows.push(campaign));
  return campaign;
}

export async function updateCampaign(id: string, input: Partial<Campaign>, status?: CampaignStatus): Promise<Campaign> {
  const current = await getCampaign(id);
  if (!current) throw new LeadError('Campaign not found', 404);
  const merged = { ...current, ...input };
  const error = validateCampaign(merged);
  if (error) throw new LeadError(error, 422);
  const changes: Partial<Campaign> = { ...input };
  if (status) {
    if (status === 'running') {
      if (current.channel === 'sms' && !smsConfigured()) throw new LeadError('Connect Twilio before starting an SMS campaign.', 503);
      if (current.channel === 'whatsapp' && !whatsappConfigured()) throw new LeadError('Connect the WhatsApp Cloud API before starting.', 503);
      changes.started_at = current.started_at || new Date().toISOString();
    }
    changes.status = status;
  }
  return writeCampaign(id, changes);
}

/** Adds every audience contact not yet in the campaign (new imports join running campaigns too). */
export async function enqueueAudience(campaign: Campaign, leads: Lead[], existing: Recipient[]): Promise<number> {
  const have = new Set(existing.map((r) => r.lead_id));
  const now = new Date().toISOString();
  const rows = leads
    .filter((lead) => !have.has(lead.id) && inAudience(lead, campaign))
    .map<Recipient>((lead) => ({
      campaign_id: campaign.id,
      lead_id: lead.id,
      token: randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).padEnd(10, '0'),
      status: 'queued',
      error: '',
      external_id: '',
      sent_at: null,
      delivered_at: null,
      clicked_at: null,
      clicks: 0,
      created_at: now,
    }));
  await insertRecipients(rows);
  return rows.length;
}

/* ---------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------- */

export type RunReport = { campaign: string; sent: number; failed: number; skipped: number; waiting: number; queued: number; note?: string };

async function sendOne(campaign: Campaign, lead: Lead, recipient: Recipient): Promise<void> {
  const link = trackingLink(recipient.token);
  const now = new Date().toISOString();
  let body: string;
  let externalId: string;
  if (campaign.channel === 'sms') {
    body = renderSms(campaign.message, lead, link);
    ({ sid: externalId } = await sendSms(lead.phone, body));
  } else {
    const params = campaign.wa_params.map((p) => fillTemplate(p, lead, link));
    const to = phoneDigits(lead.phone);
    ({ wamid: externalId } = await sendTemplate(to, campaign.wa_template, campaign.wa_language || 'en', params));
    body = `[template: ${campaign.wa_template}]${params.length ? ` ${params.join(' | ')}` : ''}`;
    // Stored in the thread so replies in the Inbox show what they're answering.
    await insertMessage({
      lead_id: lead.id,
      channel: 'whatsapp',
      thread_key: `wa:${to}`,
      direction: 'out',
      sender: 'agent',
      msg_type: 'template',
      body,
      external_id: externalId,
      status: 'sent',
    }).catch(() => null);
  }
  await updateRecipient(campaign.id, lead.id, { status: 'sent', sent_at: now, external_id: externalId, error: '' });
  const changes: Partial<Lead> = { last_outbound_at: now, last_contacted: now.slice(0, 10) };
  if (!CONTACTED_STATUSES.includes(lead.status)) changes.status = 'contacted';
  await writeLeadChanges(lead.id, changes);
  await addActivities([{ lead_id: lead.id, kind: 'message_out', summary: `${campaign.channel === 'sms' ? 'SMS' : 'WhatsApp'} campaign: ${campaign.name}`.slice(0, 200), meta: { channel: campaign.channel, campaign: campaign.id, source: 'campaign' } }]);
}

/** One pass over running campaigns, within a time budget. */
export async function runCampaigns(budgetMs = 18_000, now = new Date()): Promise<RunReport[]> {
  if (storageMode() === 'readonly') return [];
  const started = Date.now();
  const running = (await listCampaigns()).filter((c) => c.status === 'running');
  if (!running.length) return [];
  const { leads } = await listLeads();
  const byId = new Map(leads.map((l) => [l.id, l]));
  const reports: RunReport[] = [];

  for (const campaign of running) {
    const existing = await listRecipients(campaign.id);
    const added = await enqueueAudience(campaign, leads, existing);
    const recipients = added ? await listRecipients(campaign.id) : existing;
    const since = startOfUsDay(now);
    let sentToday = recipients.filter((r) => r.sent_at && r.sent_at >= since).length;
    const report: RunReport = { campaign: campaign.name, sent: 0, failed: 0, skipped: 0, waiting: 0, queued: 0 };
    const queue = recipients.filter((r) => r.status === 'queued');
    const perRun = perRunLimit(campaign);

    for (const recipient of queue) {
      if (sentToday >= campaign.daily_limit) {
        report.note = `Daily limit ${campaign.daily_limit} reached`;
        break;
      }
      if (report.sent >= perRun) {
        report.note = `Paced: ${perRun} per 15 minutes`;
        break;
      }
      if (Date.now() - started > budgetMs) {
        report.note = 'Time budget used; continues next run';
        break;
      }
      const lead = byId.get(recipient.lead_id);
      if (!lead || !inAudience(lead, campaign)) {
        await updateRecipient(campaign.id, recipient.lead_id, { status: 'skipped', error: lead?.do_not_contact ? 'Opted out' : 'No longer in audience' });
        report.skipped += 1;
        continue;
      }
      if (!inSendWindow(lead.timezone || '', campaign.window_start, campaign.window_end, now)) {
        report.waiting += 1;
        continue;
      }
      try {
        await sendOne(campaign, lead, recipient);
        report.sent += 1;
        sentToday += 1;
      } catch (error) {
        const code = error instanceof SmsError ? error.code : null;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await updateRecipient(campaign.id, lead.id, { status: 'failed', error: message });
        // 21610: the person texted STOP to this sender, so mark them do-not-contact everywhere.
        // Other permanent errors (landline, invalid number) just leave this recipient failed.
        if (code === 21610) await writeLeadChanges(lead.id, { do_not_contact: true });
        if (code !== null && PERMANENT_SMS_ERRORS.has(code)) report.note = report.note || `Some numbers can't receive SMS (Twilio ${code})`;
        report.failed += 1;
        // A provider outage would fail every send; stop this campaign for now.
        if (report.failed >= 5 && report.sent === 0) {
          report.note = `Stopped after 5 failures: ${message}`;
          break;
        }
      }
    }
    report.queued = queue.length - report.sent - report.failed - report.skipped;
    // Nothing was waiting and nobody new joined: everyone has been messaged.
    if (!added && queue.length === 0) {
      await writeCampaign(campaign.id, { status: 'done' });
      report.note = 'Finished: every contact messaged';
    }
    reports.push(report);
    if (Date.now() - started > budgetMs) break;
  }
  return reports;
}

/* ---------------------------------------------------------------------------
 * Clicks, delivery receipts, replies
 * ------------------------------------------------------------------------- */

/** Records a tracked-link click and returns where to send the visitor. */
export async function recordClick(token: string): Promise<string> {
  const fallback = siteUrl();
  if (!/^[A-Za-z0-9]{6,20}$/.test(token) || storageMode() === 'readonly') return fallback;
  const recipient = await findRecipient({ token }).catch(() => null);
  if (!recipient) return fallback;
  const campaign = await getCampaign(recipient.campaign_id).catch(() => null);
  const now = new Date().toISOString();
  await updateRecipient(recipient.campaign_id, recipient.lead_id, { clicks: recipient.clicks + 1, clicked_at: recipient.clicked_at || now }).catch(() => undefined);
  if (!recipient.clicked_at) {
    await addActivities([{ lead_id: recipient.lead_id, kind: 'note', summary: `Clicked the link in "${campaign?.name || 'campaign'}"`, meta: { campaign: recipient.campaign_id, auto: true } }]).catch(() => undefined);
  }
  let target: URL;
  try {
    target = new URL(campaign?.landing_url || fallback);
  } catch {
    target = new URL(fallback);
  }
  target.searchParams.set('utm_source', campaign?.channel || 'campaign');
  target.searchParams.set('utm_medium', 'message');
  target.searchParams.set('utm_campaign', (campaign?.name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60));
  target.searchParams.set('ref', token);
  return target.toString();
}

/** Twilio delivery status callback. */
export async function applySmsStatus(sid: string, status: string, errorCode: string | undefined): Promise<void> {
  const recipient = await findRecipient({ externalId: sid });
  if (!recipient) return;
  if (status === 'delivered') {
    await updateRecipient(recipient.campaign_id, recipient.lead_id, { status: 'delivered', delivered_at: new Date().toISOString() });
  } else if (status === 'failed' || status === 'undelivered') {
    await updateRecipient(recipient.campaign_id, recipient.lead_id, { status: 'failed', error: `Carrier: ${status}${errorCode ? ` (${errorCode})` : ''}` });
    if (errorCode === '21610') await writeLeadChanges(recipient.lead_id, { do_not_contact: true });
  }
}

/** Inbound SMS: STOP opts out for good; anything else is logged as a reply and alerts you. */
export async function recordInboundSms(from: string, body: string): Promise<void> {
  const lead = await findLeadByPhone(from);
  if (!lead) return;
  const now = new Date().toISOString();
  if (isSmsOptOut(body)) {
    await writeLeadChanges(lead.id, { do_not_contact: true });
    await addActivities([{ lead_id: lead.id, kind: 'opt_out', summary: `Opted out by SMS ("${body.trim().slice(0, 30)}")`, meta: { channel: 'sms', auto: true } }]);
    return;
  }
  const changes: Partial<Lead> = { last_inbound_at: now, unread_count: (lead.unread_count || 0) + 1 };
  if (['new', 'queued', 'contacted'].includes(lead.status)) changes.status = 'replied';
  await writeLeadChanges(lead.id, changes);
  await addActivities([{ lead_id: lead.id, kind: 'message_in', summary: `SMS: ${body.trim().slice(0, 180)}`, meta: { channel: 'sms' } }]);
  await notifyOwner({ title: `SMS reply · ${lead.name}`, body: body.slice(0, 200), url: `/admin?lead=${encodeURIComponent(lead.id)}`, tag: `sms:${lead.id}` }).catch(() => undefined);
}

/* ---------------------------------------------------------------------------
 * Overview for the admin
 * ------------------------------------------------------------------------- */

export async function campaignOverview(): Promise<{
  campaigns: (Campaign & { stats: CampaignStats })[];
  batches: { batch: string; contacts: number; sms: number; whatsapp: number }[];
  /** Consented, reachable contacts per time zone, for the best-time advisor. */
  zones: Record<string, number>;
}> {
  const [campaigns, recipients, { leads }] = await Promise.all([listCampaigns(), listRecipients(), listLeads()]);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const byCampaign = new Map<string, Recipient[]>();
  for (const r of recipients) byCampaign.set(r.campaign_id, [...(byCampaign.get(r.campaign_id) || []), r]);

  const batches = new Map<string, { batch: string; contacts: number; sms: number; whatsapp: number }>();
  const zones: Record<string, number> = {};
  for (const lead of leads) {
    if (!lead.import_batch) continue;
    const zone = lead.do_not_contact || !lead.consent_channels?.length ? '' : zoneFor(lead);
    if (zone) zones[zone] = (zones[zone] || 0) + 1;
    const b = batches.get(lead.import_batch) || { batch: lead.import_batch, contacts: 0, sms: 0, whatsapp: 0 };
    b.contacts += 1;
    if (!lead.do_not_contact && lead.consent_channels?.includes('sms')) b.sms += 1;
    if (!lead.do_not_contact && lead.consent_channels?.includes('whatsapp')) b.whatsapp += 1;
    batches.set(lead.import_batch, b);
  }

  return {
    campaigns: campaigns.map((c) => {
      const rs = byCampaign.get(c.id) || [];
      const inQueue = new Set(rs.map((r) => r.lead_id));
      const audience = inQueue.size + leads.filter((l) => !inQueue.has(l.id) && inAudience(l, c)).length;
      return { ...c, stats: computeStats(rs, byId, audience) };
    }),
    batches: [...batches.values()].sort((a, b) => b.contacts - a.contacts),
    zones,
  };
}

