import { emailConfigured } from '@/lib/email';
import { mutateTable, readTable } from '@/lib/file-store';
import { scoreOpportunities } from '@/lib/hunter-ai';
import { markRefreshed, recordHealth } from '@/lib/hunter-automation';
import { keywordMatch } from '@/lib/hunter-profile';
import { sendFromDashboard } from '@/lib/inbox';
import { llmConfigured } from '@/lib/llm';
import { LeadError, createLead, findLeadByEmail, storageMode } from '@/lib/leads';
import { fetchAllSources, type SourceReport } from '@/lib/opportunity-sources';
import { inList, supabase } from '@/lib/supabase';
import {
  companyDomainFrom,
  dedupeKey,
  isFresh,
  opportunityId,
  slugify,
  type Opportunity,
  type OpportunityStatus,
  type Proposal,
  type RawOpportunity,
} from '@/lib/opportunity-types';

/**
 * MTK Hunter storage and pipeline: fetch → keyword score → dedupe → store →
 * AI score → draft → review → send. Same storage modes as the CRM.
 *
 *   OPP_MAX_AGE_DAYS      ignore posts older than this (default 21)
 *   OPP_MIN_SCORE         keyword score needed before the AI looks at a post (default 20)
 *   OPP_SCORE_BATCH       posts per AI scoring call (default 8)
 *   OPP_DAILY_SEND_LIMIT  proposal emails per day (default 20)
 *   OPP_EMAIL_FROM        sender for proposals, e.g. "Muhammad Kashif <kashif@mtkcodex.tech>" (default EMAIL_FROM)
 */

const READONLY_ERROR = 'No database connected. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use MTK Hunter.';

const num = (key: string, fallback: number) => {
  const n = Number((process.env[key] || '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const hunterSettings = () => ({
  maxAgeDays: num('OPP_MAX_AGE_DAYS', 21),
  minScore: num('OPP_MIN_SCORE', 20),
  scoreBatch: Math.min(15, num('OPP_SCORE_BATCH', 8)),
  dailySendLimit: num('OPP_DAILY_SEND_LIMIT', 20),
});

const FIRST_FOLLOWUP_DAYS = 4;
const NEXT_FOLLOWUP_DAYS = 6;
const MAX_FOLLOWUPS = 2;
/** Not seen in a feed for this long → the post was taken down. */
const GONE_AFTER_DAYS = 3;

const daysFromNow = (days: number, from = Date.now()) => new Date(from + days * 86_400_000).toISOString();

/* ---------------------------------------------------------------------------
 * Reads and writes
 * ------------------------------------------------------------------------- */

async function selectAll<T>(pathAndQuery: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase<T[]>(`${pathAndQuery}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function listOpportunities(): Promise<Opportunity[]> {
  const mode = storageMode();
  if (mode === 'readonly') return [];
  if (mode === 'supabase') {
    return selectAll<Opportunity>('opportunities?select=*&status=neq.expired&order=posted_at.desc.nullslast,id.asc');
  }
  return (await readTable<Opportunity>('opportunities')).filter((o) => o.status !== 'expired');
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  if (storageMode() === 'supabase') {
    const rows = await supabase<Opportunity[]>(`opportunities?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows[0] || null;
  }
  return (await readTable<Opportunity>('opportunities')).find((o) => o.id === id) || null;
}

export async function updateOpportunity(id: string, changes: Partial<Opportunity>): Promise<Opportunity> {
  const mode = storageMode();
  if (mode === 'readonly') throw new LeadError(READONLY_ERROR, 503);
  if (mode === 'supabase') {
    const rows = await supabase<Opportunity[]>(`opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(changes),
    });
    if (!rows[0]) throw new LeadError('Opportunity not found', 404);
    return rows[0];
  }
  return mutateTable<Opportunity, Opportunity>('opportunities', (rows) => {
    const row = rows.find((o) => o.id === id);
    if (!row) throw new LeadError('Opportunity not found', 404);
    Object.assign(row, changes, { updated_at: new Date().toISOString() });
    return row;
  });
}

async function insertOpportunities(rows: Opportunity[]): Promise<void> {
  if (!rows.length) return;
  if (storageMode() === 'supabase') {
    for (let i = 0; i < rows.length; i += 200) {
      await supabase('opportunities?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 200)),
      });
    }
    return;
  }
  await mutateTable<Opportunity, void>('opportunities', (existing) => {
    const ids = new Set(existing.map((o) => o.id));
    for (const row of rows) if (!ids.has(row.id)) existing.push(row);
  });
}

/* ---------------------------------------------------------------------------
 * Building rows
 * ------------------------------------------------------------------------- */

export function toOpportunity(raw: RawOpportunity, now = new Date().toISOString()): Opportunity {
  const tags = raw.tags || [];
  const match = keywordMatch({ title: raw.title, description: raw.description, tags, location: raw.location });
  const company = raw.company || 'Unknown company';
  return {
    id: opportunityId(raw.source, raw.external_id || raw.url),
    source: raw.source,
    external_id: raw.external_id,
    dedupe_key: dedupeKey(company, raw.title),
    title: raw.title,
    company,
    company_slug: slugify(company),
    company_domain: raw.company_domain || companyDomainFrom(raw.apply_url || '', raw.url),
    company_logo: raw.company_logo || '',
    url: raw.url,
    apply_url: raw.apply_url || '',
    apply_email: raw.apply_email || '',
    location: raw.location || 'Remote',
    location_ok: (raw.location_ok ?? true) && !match.locationLocked,
    remote: raw.remote ?? true,
    employment_type: raw.employment_type || '',
    salary: raw.salary || '',
    tags,
    description: raw.description.slice(0, 20_000),
    posted_at: raw.posted_at ?? null,
    fetched_at: now,
    last_seen_at: now,
    status: match.offTarget ? 'skipped' : 'new',
    keyword_score: match.score,
    matched_skills: match.matched,
    score: null,
    score_reason: '',
    red_flags: match.locationLocked ? ['Post may exclude your country'] : [],
    matched_projects: [],
    proposal: null,
    sent_at: null,
    sent_via: '',
    sent_to: '',
    followups: 0,
    followup_at: null,
    lead_id: null,
    notes: '',
    created_at: now,
    updated_at: now,
  };
}

/** One row per job: drops repeats within a fetch, keeping the copy with a direct email or the best score. */
export function dedupeBatch(rows: Opportunity[]): Opportunity[] {
  const byKey = new Map<string, Opportunity>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    const current = byKey.get(row.dedupe_key);
    const better =
      !current ||
      (Boolean(row.apply_email) && !current.apply_email) ||
      (Boolean(row.apply_email) === Boolean(current.apply_email) && row.keyword_score > current.keyword_score);
    if (better) byKey.set(row.dedupe_key, row);
  }
  return [...byKey.values()];
}

/* ---------------------------------------------------------------------------
 * Pipeline
 * ------------------------------------------------------------------------- */

export type RefreshReport = {
  fetched: number;
  fresh: number;
  inserted: number;
  seenAgain: number;
  expired: number;
  sources: SourceReport[];
};

async function touchSeen(ids: string[], now: string) {
  if (!ids.length) return;
  if (storageMode() === 'supabase') {
    for (let i = 0; i < ids.length; i += 100) {
      await supabase(`opportunities?id=${inList(ids.slice(i, i + 100))}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen_at: now }),
      });
    }
    return;
  }
  const set = new Set(ids);
  await mutateTable<Opportunity, void>('opportunities', (rows) => {
    for (const row of rows) if (set.has(row.id)) row.last_seen_at = now;
  });
}

/** Untouched posts that are too old or were taken down. Anything you acted on is kept. */
async function expireStale(maxAgeDays: number): Promise<number> {
  const postedBefore = daysFromNow(-maxAgeDays);
  const goneBefore = daysFromNow(-GONE_AFTER_DAYS);
  if (storageMode() === 'supabase') {
    const rows = await supabase<{ id: string }[]>(
      `opportunities?status=in.(new,skipped)&source=neq.manual&or=${encodeURIComponent(`(posted_at.lt.${postedBefore},last_seen_at.lt.${goneBefore})`)}&select=id`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'expired' }) },
    );
    return rows.length;
  }
  return mutateTable<Opportunity, number>('opportunities', (rows) => {
    let n = 0;
    for (const row of rows) {
      if (!['new', 'skipped'].includes(row.status) || row.source === 'manual') continue;
      if ((row.posted_at && row.posted_at < postedBefore) || row.last_seen_at < goneBefore) {
        row.status = 'expired';
        n += 1;
      }
    }
    return n;
  });
}

export async function refreshOpportunities(): Promise<RefreshReport> {
  if (storageMode() === 'readonly') throw new LeadError(READONLY_ERROR, 503);
  const { maxAgeDays } = hunterSettings();
  const now = new Date().toISOString();
  const { items, reports } = await fetchAllSources();
  await recordHealth(reports).catch((error) => console.error('hunter: health not saved', error instanceof Error ? error.message : error));
  if (reports.every((r) => r.error)) throw new Error(`Every job board failed: ${reports.map((r) => `${r.source} (${r.error})`).join(', ')}`);
  await markRefreshed();
  const fresh = dedupeBatch(items.filter((raw) => raw.title && isFresh(raw.posted_at, maxAgeDays)).map((raw) => toOpportunity(raw, now)));

  // Known rows (any status, including expired) are never re-inserted: a skip stays a skip.
  const existing =
    storageMode() === 'supabase'
      ? await selectAll<{ id: string; dedupe_key: string }>('opportunities?select=id,dedupe_key&order=id.asc')
      : (await readTable<Opportunity>('opportunities')).map(({ id, dedupe_key }) => ({ id, dedupe_key }));
  const knownIds = new Set(existing.map((row) => row.id));
  const knownKeys = new Set(existing.map((row) => row.dedupe_key));

  const seen = fresh.filter((row) => knownIds.has(row.id)).map((row) => row.id);
  const inserted = fresh.filter((row) => !knownIds.has(row.id) && !knownKeys.has(row.dedupe_key));
  await insertOpportunities(inserted);
  await touchSeen(seen, now);
  const expired = await expireStale(maxAgeDays);

  return { fetched: items.length, fresh: fresh.length, inserted: inserted.length, seenAgain: seen.length, expired, sources: reports };
}

/** AI-scores the next batch of promising, unscored posts. Returns how many were scored. */
export async function scoreNext(limit = hunterSettings().scoreBatch): Promise<{ scored: number; remaining: number }> {
  if (!llmConfigured()) throw new LeadError('AI is not configured. Add LLM_API_KEY.', 503);
  const { minScore } = hunterSettings();
  const all = await listOpportunities();
  const queue = all
    .filter((o) => o.status === 'new' && o.score === null && (o.keyword_score >= minScore || o.source === 'manual'))
    .sort((a, b) => b.keyword_score - a.keyword_score);
  const batch = queue.slice(0, limit);
  if (!batch.length) return { scored: 0, remaining: 0 };

  const results = new Map((await scoreOpportunities(batch)).map((r) => [r.id, r]));
  for (const opp of batch) {
    const result = results.get(opp.id);
    // A post the model skipped keeps its keyword score, so it isn't retried forever.
    await updateOpportunity(
      opp.id,
      result
        ? {
            score: result.score,
            score_reason: result.reason,
            red_flags: [...new Set([...opp.red_flags, ...result.red_flags])].slice(0, 6),
            matched_projects: result.projects,
          }
        : { score: opp.keyword_score, score_reason: 'Scored by keywords only.' },
    );
  }
  return { scored: batch.length, remaining: Math.max(0, queue.length - batch.length) };
}

/** Marks sent opportunities as replied once their lead has written back (via the Inbox). */
export async function syncReplies(opps: Opportunity[]): Promise<Opportunity[]> {
  const waiting = opps.filter((o) => o.status === 'sent' && o.lead_id && o.sent_at);
  if (!waiting.length || storageMode() === 'readonly') return opps;
  const ids = [...new Set(waiting.map((o) => o.lead_id as string))];
  const leads =
    storageMode() === 'supabase'
      ? await supabase<{ id: string; last_inbound_at: string | null }[]>(`leads?id=${inList(ids)}&select=id,last_inbound_at`)
      : (await readTable<{ id: string; last_inbound_at: string | null }>('leads')).filter((l) => ids.includes(l.id));
  const lastIn = new Map(leads.map((l) => [l.id, l.last_inbound_at]));
  const updated = new Map<string, Opportunity>();
  for (const opp of waiting) {
    const inbound = lastIn.get(opp.lead_id as string);
    if (inbound && opp.sent_at && inbound > opp.sent_at) {
      updated.set(opp.id, await updateOpportunity(opp.id, { status: 'replied', followup_at: null }));
    }
  }
  return updated.size ? opps.map((o) => updated.get(o.id) || o) : opps;
}

/* ---------------------------------------------------------------------------
 * Adding by hand (Upwork, LinkedIn, a referral…)
 * ------------------------------------------------------------------------- */

export async function addManualOpportunity(input: {
  title: string;
  company?: string;
  url?: string;
  apply_email?: string;
  description: string;
}): Promise<Opportunity> {
  if (storageMode() === 'readonly') throw new LeadError(READONLY_ERROR, 503);
  const title = input.title.trim().slice(0, 200);
  const description = input.description.trim().slice(0, 20_000);
  if (!title) throw new LeadError('Add the job title');
  if (description.length < 30) throw new LeadError('Paste the job description (at least a few lines)');
  const email = (input.apply_email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LeadError('Hiring email is not valid');
  const url = (input.url || '').trim().slice(0, 600);
  if (url && !/^https?:\/\//i.test(url)) throw new LeadError('Link must start with http:// or https://');
  const row = toOpportunity({
    source: 'manual',
    external_id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    company: (input.company || '').trim().slice(0, 120),
    url,
    apply_email: email,
    description,
    posted_at: new Date().toISOString(),
  });
  row.status = 'new';
  await insertOpportunities([row]);
  return row;
}

/* ---------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------- */

function startOfTodayPKT(now = new Date()): string {
  const pkt = new Date(now.getTime() + 5 * 3_600_000);
  pkt.setUTCHours(0, 0, 0, 0);
  return new Date(pkt.getTime() - 5 * 3_600_000).toISOString();
}

export async function emailsSentToday(): Promise<number> {
  const since = startOfTodayPKT();
  if (storageMode() === 'supabase') {
    const rows = await supabase<{ id: string }[]>(
      `lead_activities?kind=eq.message_out&created_at=gte.${encodeURIComponent(since)}&meta->>source=eq.hunter&select=id&limit=1000`,
    );
    return rows.length;
  }
  return (await readTable<Opportunity>('opportunities')).filter((o) => o.sent_via === 'email' && o.sent_at && o.sent_at >= since).length;
}

export type SendRequest = {
  id: string;
  via: 'email' | 'apply_link';
  to?: string;
  subject: string;
  body: string;
  cover?: string;
  kind?: Proposal['kind'];
};

export async function sendOpportunity(input: SendRequest): Promise<Opportunity> {
  if (storageMode() === 'readonly') throw new LeadError(READONLY_ERROR, 503);
  const opp = await getOpportunity(input.id);
  if (!opp) throw new LeadError('Opportunity not found', 404);
  const kind = input.kind || 'proposal';
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (body.length < 40) throw new LeadError('The proposal is empty or too short.');
  if (kind === 'proposal' && ['sent', 'replied', 'interview', 'won', 'lost'].includes(opp.status)) {
    throw new LeadError('Already sent. Use "Follow up" instead.', 409);
  }

  const now = new Date().toISOString();
  const proposal: Proposal = {
    kind,
    subject,
    body,
    cover: (input.cover || '').trim().slice(0, 1200),
    model: opp.proposal?.model || 'edited',
    created_at: opp.proposal?.created_at || now,
  };
  const changes: Partial<Opportunity> = {};

  if (input.via === 'email') {
    if (!emailConfigured()) throw new LeadError('Email sending is not configured (RESEND_API_KEY and EMAIL_FROM).', 503);
    const to = (input.to || opp.sent_to || opp.apply_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new LeadError('Add a valid email address to send to.');
    if (!subject) throw new LeadError('Add a subject line.');
    const { dailySendLimit } = hunterSettings();
    if ((await emailsSentToday()) >= dailySendLimit) {
      throw new LeadError(`Daily limit reached (${dailySendLimit} proposal emails). It protects your sender reputation; raise OPP_DAILY_SEND_LIMIT if needed.`, 429);
    }

    let lead = await findLeadByEmail(to);
    if (lead?.do_not_contact) throw new LeadError(`${lead.name} asked not to be contacted.`, 409);
    if (!lead) {
      lead = await createLead(
        {
          name: opp.company || to,
          email: to,
          website: opp.company_domain ? `https://${opp.company_domain}` : '',
          business_type: 'Hiring company',
          channel: 'email',
          preferred_channel: 'email',
          tags: ['hunter', opp.source],
          notes: `${opp.title}\n${opp.url}`,
        },
        'opportunity',
        `From MTK Hunter: ${opp.title}`,
      );
    }
    // Same path as an Inbox reply: per-lead reply address, timeline entry, status → contacted.
    await sendFromDashboard({ key: `email:${to}`, subject, text: body, source: 'hunter', from: (process.env.OPP_EMAIL_FROM || '').trim() || undefined });
    Object.assign(changes, { sent_to: to, lead_id: lead.id });
  }

  if (kind === 'followup') {
    const followups = opp.followups + 1;
    Object.assign(changes, { followups, followup_at: followups < MAX_FOLLOWUPS ? daysFromNow(NEXT_FOLLOWUP_DAYS) : null });
  } else {
    Object.assign(changes, {
      status: 'sent' satisfies OpportunityStatus,
      sent_at: now,
      sent_via: input.via,
      proposal,
      followup_at: input.via === 'email' ? daysFromNow(FIRST_FOLLOWUP_DAYS) : null,
    });
  }
  return updateOpportunity(opp.id, changes);
}
