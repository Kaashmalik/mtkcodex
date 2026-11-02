import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'mtk_admin';
export const ADMIN_SESSION_HOURS = 8;

export type AdminSession = { email: string; exp: number };

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'kaash0542@gmail.com').trim().toLowerCase();
}

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || '';
}

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || '';
}

export function adminConfigured(): boolean {
  return Boolean(adminPassword() && sessionSecret());
}

/** Constant-time string compare that does not leak lengths. */
function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

export function checkCredentials(email: string, password: string): boolean {
  if (!adminConfigured()) return false;
  return safeEqual(email.trim().toLowerCase(), adminEmail()) && safeEqual(password, adminPassword());
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createSessionToken(email: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: now + ADMIN_SESSION_HOURS * 60 * 60 * 1000 } satisfies AdminSession),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): AdminSession | null {
  if (!token || !adminConfigured()) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminSession;
    if (!session.email || typeof session.exp !== 'number' || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_HOURS * 60 * 60,
  };
}

// Best-effort in-memory throttle. Serverless instances are ephemeral, so this
// stops casual bursts rather than a distributed attack (put a WAF in front for that).
const attempts = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginThrottled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export function clearLoginAttempts(ip: string) {
  attempts.delete(ip);
}
