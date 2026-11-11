import {
  clean,
  companyDomainFrom,
  extractEmails,
  firstUrl,
  stripHtml,
  type OpportunitySource,
  type RawOpportunity,
} from '@/lib/opportunity-types';

/**
 * Connectors for free, public job feeds. None needs a key.
 *
 *   OPP_QUERIES        comma list searched on Himalayas (default below)
 *   OPP_COUNTRY        country you work from (default Pakistan)
 *   OPP_WATCHLIST      companies whose own job boards are checked directly:
 *                      "greenhouse:vercel, ashby:linear, lever:<slug>"
 *   HIMALAYAS_API_KEY  optional, raises Himalayas rate limits
 *
 * Terms: Remote OK and Remotive ask that listings link back to them and name
 * them as the source; the admin shows the source and links to the listing.
 */

const UA = 'MTKCodexHunter/1.0 (+https://mtkcodex.tech)';
const TIMEOUT_MS = 8_000;

const DEFAULT_QUERIES = ['next.js', 'react', 'full stack', 'typescript', 'node.js', 'saas', 'automation', 'web scraping'];

export function hunterQueries(): string[] {
  const list = (process.env.OPP_QUERIES || '').split(',').map((q) => q.trim()).filter(Boolean);
  return list.length ? list.slice(0, 12) : DEFAULT_QUERIES;
}

/** Where you work from; boards that filter by hiring country use it. */
export function hunterCountry(): string {
  return (process.env.OPP_COUNTRY || 'Pakistan').trim();
}

export type WatchEntry ={ ats: 'greenhouse' | 'lever' | 'ashby'; slug: string };

export function parseWatchlist(value = process.env.OPP_WATCHLIST || ''): WatchEntry[] {
  return value
    .split(',')
    .map((item) => item.trim().match(/^(greenhouse|lever|ashby)\s*:\s*([a-z0-9._-]+)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ ats: match[1].toLowerCase() as WatchEntry['ats'], slug: match[2] }))
    .slice(0, 40);
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const isoFromSeconds = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null);
const isoFrom = (v: unknown) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** Remotive sends local timestamps without a zone; they are UTC. */
const isoFromNaive = (v: unknown) => (typeof v === 'string' ? isoFrom(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : null);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => clean(v, 60)).filter(Boolean) : [];

/** Countries a remote post is open to; Pakistan, "worldwide" or no restriction all pass. */
export function locationAllows(restrictions: string[] | string): boolean {
  const list = (Array.isArray(restrictions) ? restrictions : [restrictions]).map((r) => r.toLowerCase().trim()).filter(Boolean);
  if (!list.length) return true;
  return list.some((r) => /pakistan|worldwide|anywhere|global|asia|emea|apac|international|any (location|country)/.test(r));
}

/* ---------------------------------------------------------------------------
 * Boards
 * ------------------------------------------------------------------------- */

type HimalayasJob = {
  guid?: string;
  title?: string;
  companyName?: string;
  companySlug?: string;
  companyLogo?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
  salaryPeriod?: string;
  locationRestrictions?: string[];
  categories?: string[];
  description?: string;
  excerpt?: string;
  pubDate?: number;
  applicationLink?: string;
};

function salaryRange(min: unknown, max: unknown, currency = 'USD', period = ''): string {
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const lo = typeof min === 'number' && min > 0 ? min : 0;
  const hi = typeof max === 'number' && max > 0 ? max : 0;
  if (!lo && !hi) return '';
  const range = lo && hi && lo !== hi ? `${fmt(lo)}–${fmt(hi)}` : fmt(hi || lo);
  return `${currency} ${range}${period ? ` / ${period.replace(/ly$/, '')}` : ''}`.trim();
}

async function himalayas(): Promise<RawOpportunity[]> {
  const key = (process.env.HIMALAYAS_API_KEY || '').trim();
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  // Himalayas filters by hiring country itself, so every result is open to you.
  const country = encodeURIComponent(hunterCountry());
  const pages = await Promise.allSettled(
    hunterQueries().map((q) =>
      getJson<{ jobs?: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent&country=${country}`, headers),
    ),
  );
  const jobs = pages.flatMap((page) => (page.status === 'fulfilled' ? page.value.jobs || [] : []));
  if (!jobs.length && pages.every((page) => page.status === 'rejected')) {
    throw new Error((pages[0] as PromiseRejectedResult | undefined)?.reason?.message || 'no response');
  }
  return jobs
    .filter((job) => job.guid && job.title)
    .map((job) => {
      const restrictions = strings(job.locationRestrictions);
      const url = clean(job.applicationLink || job.guid, 600);
      return {
        source: 'himalayas' as const,
        external_id: clean(job.guid, 300),
        title: clean(job.title, 200),
        company: clean(job.companyName, 120),
        company_logo: clean(job.companyLogo, 600),
        url: clean(job.guid, 600),
        apply_url: url,
        location: restrictions.length > 6 ? `${restrictions.slice(0, 6).join(', ')} +${restrictions.length - 6}` : restrictions.join(', ') || 'Worldwide',
        location_ok: true,
        employment_type: clean(job.employmentType, 40),
        salary: salaryRange(job.minSalary, job.maxSalary, job.currency, job.salaryPeriod),
        tags: strings(job.categories).map((c) => c.replace(/-/g, ' ')).slice(0, 8),
        description: stripHtml(clean(job.description || job.excerpt)),
        posted_at: isoFromSeconds(job.pubDate),
      };
    });
}

type RemoteOkJob = {
  id?: string | number;
  epoch?: number;
  company?: string;
  company_logo?: string;
  logo?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
};

async function remoteok(): Promise<RawOpportunity[]> {
  const rows = await getJson<RemoteOkJob[]>('https://remoteok.com/api');
  return rows
    .filter((job) => job.id && job.position)
    .map((job) => {
      const description = stripHtml(clean(job.description))
        // Their anti-spam keyword note is kept: the proposal writer follows it.
        .replace(/\s+/g, ' ');
      return {
        source: 'remoteok' as const,
        external_id: String(job.id),
        title: clean(job.position, 200),
        company: clean(job.company, 120),
        company_logo: clean(job.company_logo || job.logo, 600),
        url: clean(job.url, 600),
        apply_url: clean(job.apply_url, 600),
        location: clean(job.location, 120) || 'Remote',
        location_ok: locationAllows(clean(job.location, 120)),
        salary: salaryRange(job.salary_min, job.salary_max),
        tags: strings(job.tags).slice(0, 8),
        description,
        posted_at: isoFromSeconds(job.epoch),
      };
    });
}

type RemotiveJob = {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  company_logo?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

async function remotive(): Promise<RawOpportunity[]> {
  const data = await getJson<{ jobs?: RemotiveJob[] }>('https://remotive.com/api/remote-jobs?category=software-dev&limit=150');
  return (data.jobs || [])
    .filter((job) => job.id && job.title)
    .map((job) => ({
      source: 'remotive' as const,
      external_id: String(job.id),
      title: clean(job.title, 200),
      company: clean(job.company_name, 120),
      company_logo: clean(job.company_logo, 600),
      url: clean(job.url, 600),
      location: clean(job.candidate_required_location, 120) || 'Worldwide',
      location_ok: locationAllows(clean(job.candidate_required_location, 200).split(/,\s*/)),
      employment_type: clean(job.job_type, 40).replace(/_/g, ' '),
      salary: clean(job.salary, 80),
      tags: strings(job.tags).slice(0, 8),
      description: stripHtml(clean(job.description)),
      posted_at: isoFromNaive(job.publication_date),
    }));
}

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

async function arbeitnow(): Promise<RawOpportunity[]> {
  const data = await getJson<{ data?: ArbeitnowJob[] }>('https://www.arbeitnow.com/api/job-board-api');
  return (data.data || [])
    .filter((job) => job.slug && job.title && job.remote)
    .map((job) => ({
      source: 'arbeitnow' as const,
      external_id: clean(job.slug, 200),
      title: clean(job.title, 200),
      company: clean(job.company_name, 120),
      url: clean(job.url, 600),
      location: `Remote · ${clean(job.location, 80) || 'Europe'}`,
      employment_type: strings(job.job_types).join(', '),
      tags: strings(job.tags).slice(0, 8),
      description: stripHtml(clean(job.description)),
      posted_at: isoFromSeconds(job.created_at),
    }));
}

type HnItem = { id: number; text?: string | null; author?: string; created_at_i?: number; children?: HnItem[] };

/** "Company | Role | REMOTE | Salary | link" — the convention most posts follow. */
export function parseHnPost(text: string): { company: string; title: string; location: string; salary: string } {
  const firstLine = text.split('\n')[0] || '';
  const parts = firstLine.split(/\s+\|\s+|\s+\|\||\|\s+/).map((p) => p.trim()).filter(Boolean);
  const company = (parts[0] || '').replace(/\(.*?\)/g, '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 120);
  const role =
    parts.slice(1).find((p) => /engineer|developer|dev\b|architect|lead|cto|programmer|full[- ]?stack|frontend|backend|founding/i.test(p)) ||
    parts[1] ||
    'Engineering role';
  const location = parts.find((p) => /remote|onsite|on-site|hybrid/i.test(p)) || '';
  const salary = parts.find((p) => /[$€£]\s?\d|\d+k\b/i.test(p)) || '';
  return { company: company || 'HN company', title: role.slice(0, 200), location: location.slice(0, 120), salary: salary.slice(0, 80) };
}

/** People sometimes post "Who wants to be hired" style profiles in the hiring thread. */
export function isSeekerPost(text: string): boolean {
  const plain = stripHtml(text).slice(0, 600);
  return /^\s*(location|seeking work)\s*:/i.test(plain) || (/willing to relocate\s*:/i.test(plain) && /r[ée]sum[ée]\s*(\/\s*cv)?\s*:/i.test(plain));
}

async function hackerNews(): Promise<RawOpportunity[]> {
  const search = await getJson<{ hits?: { objectID: string; title?: string }[] }>(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5',
  );
  const story = (search.hits || []).find((hit) => /who is hiring/i.test(hit.title || ''));
  if (!story) return [];
  const item = await getJson<HnItem>(`https://hn.algolia.com/api/v1/items/${story.objectID}`);
  return (item.children || [])
    .filter((post) => post.text && /\bremote\b/i.test(post.text) && !isSeekerPost(post.text))
    .map((post) => {
      const html = post.text || '';
      const text = stripHtml(html.replace(/<p>/gi, '\n'));
      const { company, title, location, salary } = parseHnPost(text);
      const link = firstUrl(text);
      const emails = extractEmails(text);
      return {
        source: 'hn' as const,
        external_id: String(post.id),
        title,
        company,
        url: `https://news.ycombinator.com/item?id=${post.id}`,
        apply_url: link,
        apply_email: emails[0] || '',
        company_domain: companyDomainFrom(link, emails[0] ? `https://${emails[0].split('@')[1]}` : ''),
        location: location || 'Remote',
        location_ok: !/\bremote\s*\((us|usa|u\.s\.|united states|canada|eu|uk|europe)[^)]*only\)/i.test(text),
        salary,
        tags: [],
        description: text.slice(0, 8000),
        posted_at: isoFromSeconds(post.created_at_i),
      };
    });
}

/* ---------------------------------------------------------------------------
 * Watchlist: a company's own ATS board (freshest data there is)
 * ------------------------------------------------------------------------- */

const REMOTE = /\bremote|anywhere|worldwide|distributed\b/i;

async function greenhouse(slug: string): Promise<RawOpportunity[]> {
  const data = await getJson<{
    jobs?: { id: number; title: string; absolute_url: string; location?: { name?: string }; updated_at?: string; first_published?: string; content?: string; company_name?: string }[];
  }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
  return (data.jobs || [])
    .filter((job) => REMOTE.test(job.location?.name || ''))
    .map((job) => ({
      source: 'greenhouse' as const,
      external_id: `${slug}-${job.id}`,
      title: clean(job.title, 200),
      company: clean(job.company_name, 120) || slug,
      url: clean(job.absolute_url, 600),
      location: clean(job.location?.name, 120),
      location_ok: locationAllows(clean(job.location?.name, 120)),
      tags: [],
      description: stripHtml(clean(job.content)),
      posted_at: isoFrom(job.first_published || job.updated_at),
    }));
}

async function lever(slug: string): Promise<RawOpportunity[]> {
  const rows = await getJson<
    {
      id: string;
      text: string;
      hostedUrl: string;
      applyUrl?: string;
      createdAt?: number;
      workplaceType?: string;
      categories?: { location?: string; commitment?: string; team?: string };
      descriptionPlain?: string;
      additionalPlain?: string;
    }[]
  >(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  return rows
    .filter((job) => job.workplaceType === 'remote' || REMOTE.test(job.categories?.location || ''))
    .map((job) => ({
      source: 'lever' as const,
      external_id: `${slug}-${job.id}`,
      title: clean(job.text, 200),
      company: slug,
      url: clean(job.hostedUrl, 600),
      apply_url: clean(job.applyUrl, 600),
      location: clean(job.categories?.location, 120) || 'Remote',
      location_ok: locationAllows(clean(job.categories?.location, 120)),
      employment_type: clean(job.categories?.commitment, 40),
      tags: [job.categories?.team].filter((t): t is string => Boolean(t)),
      description: clean(`${job.descriptionPlain || ''}\n\n${job.additionalPlain || ''}`),
      posted_at: typeof job.createdAt === 'number' ? new Date(job.createdAt).toISOString() : null,
    }));
}

async function ashby(slug: string): Promise<RawOpportunity[]> {
  const data = await getJson<{
    jobs?: {
      id: string;
      title: string;
      location?: string;
      isRemote?: boolean;
      isListed?: boolean;
      workplaceType?: string;
      employmentType?: string;
      jobUrl: string;
      applyUrl?: string;
      publishedAt?: string;
      descriptionPlain?: string;
      team?: string;
    }[];
  }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
  return (data.jobs || [])
    .filter((job) => job.isListed !== false && (job.isRemote || job.workplaceType === 'Remote'))
    .map((job) => ({
      source: 'ashby' as const,
      external_id: `${slug}-${job.id}`,
      title: clean(job.title, 200),
      company: slug,
      url: clean(job.jobUrl, 600),
      apply_url: clean(job.applyUrl, 600),
      location: clean(job.location, 120) || 'Remote',
      location_ok: locationAllows(clean(job.location, 120)),
      employment_type: clean(job.employmentType, 40),
      tags: [job.team].filter((t): t is string => Boolean(t)),
      description: clean(job.descriptionPlain),
      posted_at: isoFrom(job.publishedAt),
    }));
}

async function watchlist(): Promise<RawOpportunity[]> {
  const entries = parseWatchlist();
  const runners = { greenhouse, lever, ashby };
  const results = await Promise.allSettled(entries.map((entry) => runners[entry.ats](entry.slug)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.error(`hunter: watchlist ${entries[i].ats}:${entries[i].slug} failed`, result.reason);
  });
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

/* ---------------------------------------------------------------------------
 * Run every source
 * ------------------------------------------------------------------------- */

export type SourceReport = { source: OpportunitySource | 'watchlist'; fetched: number; error?: string };

const SOURCES: { name: SourceReport['source']; run: () => Promise<RawOpportunity[]> }[] = [
  { name: 'himalayas', run: himalayas },
  { name: 'remoteok', run: remoteok },
  { name: 'remotive', run: remotive },
  { name: 'arbeitnow', run: arbeitnow },
  { name: 'hn', run: hackerNews },
  { name: 'watchlist', run: watchlist },
];

export async function fetchAllSources(): Promise<{ items: RawOpportunity[]; reports: SourceReport[] }> {
  const active = SOURCES.filter((s) => s.name !== 'watchlist' || parseWatchlist().length);
  const results = await Promise.allSettled(active.map((s) => s.run()));
  const reports: SourceReport[] = [];
  const items: RawOpportunity[] = [];
  results.forEach((result, i) => {
    const name = active[i].name;
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      reports.push({ source: name, fetched: result.value.length });
    } else {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`hunter: ${name} failed`, error);
      reports.push({ source: name, fetched: 0, error });
    }
  });
  return { items, reports };
}
