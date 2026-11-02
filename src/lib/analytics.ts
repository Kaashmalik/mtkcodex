import { createHmac } from 'node:crypto';
import type { AnalyticsSummary } from '@/lib/analytics-types';

/**
 * First-party, cookieless website analytics.
 *
 * We intentionally do not store cookies or anything on the visitor's device.
 * The visitor id is an HMAC of (day, IP, user agent, session secret), so it is
 * pseudonymous, cannot be reversed into an IP and rotates every day in
 * Asia/Karachi. The admin dashboard reads aggregates through a SQL function.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export function analyticsEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** YYYY-MM-DD in the owner's timezone (Asia/Karachi). */
export function localDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function visitorHash(ip: string, userAgent: string, day: string = localDay()): string {
  const secret = (process.env.ADMIN_SESSION_SECRET || 'mtk-analytics').trim();
  return createHmac('sha256', secret).update(`${day}|${ip}|${userAgent}`).digest('hex').slice(0, 24);
}

const BOT_RE =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|pinterest|slack|discord|telegram|whatsapp|headlesschrome|lighthouse|pagespeed|pingdom|uptime|monitor|curl|wget|axios|python-requests/i;

export function isBot(userAgent: string): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

export function deviceFromUserAgent(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/** Hostname only, so we never store full referrer URLs (which can contain query data). */
export function referrerHost(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '').slice(0, 120);
  } catch {
    return '';
  }
}

export type PageViewInput = {
  path: string;
  referrerHost: string;
  country: string;
  device: string;
  kind: 'view' | 'ping';
  visitorId: string;
};

export async function recordPageView(view: PageViewInput): Promise<void> {
  if (!analyticsEnabled()) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/page_views`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    // PostgREST uses the table's snake_case column names.
    body: JSON.stringify({
      path: view.path,
      referrer_host: view.referrerHost,
      country: view.country,
      device: view.device,
      kind: view.kind,
      visitor_id: view.visitorId,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary | null> {
  if (!analyticsEnabled()) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_summary`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as AnalyticsSummary;
}
