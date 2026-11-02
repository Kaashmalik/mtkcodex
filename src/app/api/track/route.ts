import { NextResponse } from 'next/server';
import {
  analyticsEnabled,
  deviceFromUserAgent,
  isBot,
  recordPageView,
  referrerHost,
  visitorHash,
} from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public beacon used by the marketing site. Deliberately quiet: it always
 * answers 204 so a tracking failure can never affect a visitor's page.
 */

const WINDOW_MS = 60_000;
const MAX_EVENTS = 90;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5_000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_EVENTS;
}

function cleanPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const path = value.split(/[?#]/)[0];
  if (!path.startsWith('/') || path.length > 300) return '';
  if (path.startsWith('//')) return '';
  if (path.startsWith('/admin') || path.startsWith('/api')) return '';
  return path;
}

export async function POST(req: Request) {
  if (!analyticsEnabled()) return new NextResponse(null, { status: 204 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const path = cleanPath(body.path);
  const kind = body.kind === 'ping' ? 'ping' : 'view';
  if (!path) return new NextResponse(null, { status: 204 });

  const userAgent = req.headers.get('user-agent') || '';
  if (isBot(userAgent)) return new NextResponse(null, { status: 204 });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  if (rateLimited(ip)) return new NextResponse(null, { status: 204 });

  try {
    await recordPageView({
      path,
      referrerHost: kind === 'view' ? referrerHost(typeof body.referrer === 'string' ? body.referrer : '') : '',
      country: (req.headers.get('x-vercel-ip-country') || '').toUpperCase().slice(0, 2),
      device: deviceFromUserAgent(userAgent),
      kind,
      visitorId: visitorHash(ip, userAgent),
    });
  } catch (error) {
    // Never surface tracking failures to the visitor; log for the server only.
    console.error('analytics: failed to record page view', error instanceof Error ? error.message : error);
  }

  return new NextResponse(null, { status: 204 });
}
