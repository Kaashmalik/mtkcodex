/**
 * MTK Hunter: types and pure helpers shared by the server and the admin UI.
 * No server-only imports here.
 */

export type OpportunitySource =
  | 'himalayas'
  | 'remoteok'
  | 'remotive'
  | 'arbeitnow'
  | 'jobicy'
  | 'weworkremotely'
  | 'hn'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'manual';

export const SOURCE_LABELS: Record<OpportunitySource, string> = {
  himalayas: 'Himalayas',
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  jobicy: 'Jobicy',
  weworkremotely: 'We Work Remotely',
  hn: 'HN Who is hiring',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  manual: 'Added by hand',
};

export type OpportunityStatus =
  | 'new'
  | 'shortlisted'
  | 'drafted'
  | 'sent'
  | 'replied'
  | 'interview'
  | 'won'
  | 'lost'
  | 'skipped'
  | 'expired';

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'new',
  'shortlisted',
  'drafted',
  'sent',
  'replied',
  'interview',
  'won',
  'lost',
  'skipped',
  'expired',
];

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  drafted: 'Drafted',
  sent: 'Sent / applied',
  replied: 'Replied',
  interview: 'Interview',
  won: 'Won',
  lost: 'Lost',
  skipped: 'Skipped',
  expired: 'Expired',
};

/** Statuses that mean "already sent", so the feed won't offer a first proposal again. */
export const SENT_STATUSES: OpportunityStatus[] = ['sent', 'replied', 'interview', 'won', 'lost'];

export type ProposalKind = 'proposal' | 'followup';

export type Proposal = {
  kind: ProposalKind;
  subject: string;
  body: string;
  /** Shorter version for "why do you want to work here" / cover-letter boxes. */
  cover: string;
  model: string;
  created_at: string;
};

export type Opportunity = {
  id: string;
  source: OpportunitySource;
  external_id: string;
  dedupe_key: string;
  title: string;
  company: string;
  company_slug: string;
  company_domain: string;
  company_logo: string;
  url: string;
  apply_url: string;
  apply_email: string;
  location: string;
  location_ok: boolean;
  remote: boolean;
  employment_type: string;
  salary: string;
  tags: string[];
  description: string;
  posted_at: string | null;
  fetched_at: string;
  last_seen_at: string;
  status: OpportunityStatus;
  keyword_score: number;
  matched_skills: string[];
  score: number | null;
  score_reason: string;
  red_flags: string[];
  matched_projects: string[];
  proposal: Proposal | null;
  sent_at: string | null;
  sent_via: '' | 'email' | 'apply_link';
  sent_to: string;
  followups: number;
  followup_at: string | null;
  lead_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

/** What a source connector returns before scoring and storage. */
export type RawOpportunity = Pick<Opportunity, 'source' | 'external_id' | 'title' | 'company' | 'url' | 'description'> &
  Partial<
    Pick<
      Opportunity,
      | 'company_domain'
      | 'company_logo'
      | 'apply_url'
      | 'apply_email'
      | 'location'
      | 'location_ok'
      | 'remote'
      | 'employment_type'
      | 'salary'
      | 'tags'
      | 'posted_at'
    >
  >;

/* ---------------------------------------------------------------------------
 * Text clean-up
 * ------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** HTML (or entity-escaped HTML, as Greenhouse sends) → readable plain text. */
export function stripHtml(html: string): string {
  let text = html;
  // Greenhouse double-escapes: decode once first so the tags become real tags.
  if (/&lt;\/?[a-z]/i.test(text)) text = decodeEntities(text);
  text = text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Repairs UTF-8 that was decoded as Latin-1 upstream ("â€”" → "—"), as Remote OK sends. */
export function fixMojibake(text: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(text) || /[^\u0000-ÿ]/.test(text)) return text;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, (c) => c.charCodeAt(0)));
  } catch {
    return text;
  }
}

export function clean(text: unknown, max = 20_000): string {
  return typeof text === 'string' ? fixMojibake(text).trim().slice(0, max) : '';
}

/** Emails in a post, including "jobs at acme dot com" and "jobs [at] acme.com" styles. */
export function extractEmails(text: string): string[] {
  const normalised = text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9-]+(\s*[[({<]?\s*dot\s*[\])}>]?\s*|\.)[a-z]{2,})/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/(@[a-z0-9-]+(?:\.[a-z0-9-]+)*)\s+dot\s+([a-z]{2,})/gi, '$1.$2');
  const found = normalised.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi) || [];
  const unique = [...new Set(found.map((email) => email.toLowerCase().replace(/\.$/, '')))];
  return unique.filter((email) => !/\.(png|jpe?g|gif|svg|webp)$/.test(email) && !email.endsWith('example.com'));
}

export function firstUrl(text: string): string {
  return text.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0].replace(/[.,;:]+$/, '') || '';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited|plc|bv|ag|sa)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Same job cross-posted on several boards collapses to one key. */
export function dedupeKey(company: string, title: string): string {
  const role = title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(remote|worldwide|anywhere|f\/m\/d|m\/f\/d|w\/m\/d)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${slugify(company)}|${role}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Job-board hosts are never the company's own domain. */
const BOARD_HOSTS = /(^|\.)(remoteok\.com|remotive\.com|himalayas\.app|arbeitnow\.com|jobicy\.com|weworkremotely\.com|greenhouse\.io|lever\.co|ashbyhq\.com|ycombinator\.com|linkedin\.com|workable\.com|bamboohr\.com|smartrecruiters\.com|wellfound\.com|notion\.site)$/;

export function companyDomainFrom(...urls: string[]): string {
  for (const url of urls) {
    const domain = domainOf(url);
    if (domain && !BOARD_HOSTS.test(domain)) return domain;
  }
  return '';
}

/* ---------------------------------------------------------------------------
 * Freshness, ids and company signals
 * ------------------------------------------------------------------------- */

export function opportunityId(source: OpportunitySource, externalId: string): string {
  const safe = externalId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  return `${source}:${safe}`;
}

export function ageDays(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}

export function isFresh(iso: string | null | undefined, maxDays: number, now = Date.now()): boolean {
  const age = ageDays(iso, now);
  return age === null || age <= maxDays;
}

export type CompanySignal = {
  slug: string;
  company: string;
  open: number;
  /** Posted in the last 14 days: a hiring-growth signal. */
  recent: number;
  sources: OpportunitySource[];
};

/** Open roles per company across every board we track, plus how many are new. */
export function companySignals(opportunities: Opportunity[], now = Date.now()): Map<string, CompanySignal> {
  const map = new Map<string, CompanySignal>();
  for (const opp of opportunities) {
    if (opp.status === 'expired' || !opp.company_slug) continue;
    const entry = map.get(opp.company_slug) || { slug: opp.company_slug, company: opp.company, open: 0, recent: 0, sources: [] };
    entry.open += 1;
    const age = ageDays(opp.posted_at, now);
    if (age !== null && age <= 14) entry.recent += 1;
    if (!entry.sources.includes(opp.source)) entry.sources.push(opp.source);
    map.set(opp.company_slug, entry);
  }
  return map;
}

/** The score shown and sorted on: the AI score when there is one, else the keyword score. */
export function effectiveScore(opp: Pick<Opportunity, 'score' | 'keyword_score'>): number {
  return opp.score ?? opp.keyword_score;
}

export function scoreTone(score: number): string {
  if (score >= 75) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
  if (score >= 30) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'bg-muted text-fg-subtle';
}
