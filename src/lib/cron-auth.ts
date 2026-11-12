import { createHash, timingSafeEqual } from 'node:crypto';

/** Scheduled jobs call in with `Authorization: Bearer $CRON_SECRET` (16+ chars). */
export function cronAuthorised(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 16) return false;
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
