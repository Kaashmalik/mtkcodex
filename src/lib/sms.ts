import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * SMS through Twilio. US marketing SMS needs a registered A2P 10DLC campaign
 * (or a verified toll-free number) on the Twilio account.
 *
 *   TWILIO_ACCOUNT_SID            AC…
 *   TWILIO_AUTH_TOKEN             also signs webhooks
 *   TWILIO_MESSAGING_SERVICE_SID  MG… (preferred: handles number pools and STOP), or
 *   TWILIO_FROM                   a single sending number in E.164
 *
 * Webhook (inbound replies + delivery status): <site>/api/sms/webhook
 */

const env = (key: string) => (process.env[key] || '').trim();

export function smsConfigured(): boolean {
  return Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_MESSAGING_SERVICE_SID') || env('TWILIO_FROM')));
}

export function smsWebhookUrl(): string {
  return `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://mtkcodex.tech').replace(/\/+$/, '')}/api/sms/webhook`;
}

export class SmsError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

/** Twilio codes meaning "never send to this number again" (opted out, landline, invalid). */
export const PERMANENT_SMS_ERRORS = new Set([21610, 21614, 21211, 21612, 21408, 30004, 30005, 30006]);

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  if (!smsConfigured()) throw new SmsError('SMS is not configured (Twilio).', null);
  const sid = env('TWILIO_ACCOUNT_SID');
  const form = new URLSearchParams({ To: to, Body: body, StatusCallback: smsWebhookUrl() });
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
  else form.set('From', env('TWILIO_FROM'));
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !data.sid) throw new SmsError(`SMS: ${data.message || `HTTP ${res.status}`}`, data.code ?? null);
  return { sid: data.sid };
}

/**
 * Twilio webhook signature: base64 HMAC-SHA1 of the full URL followed by
 * every POST param (sorted by name) as name+value, keyed by the auth token.
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null, token = env('TWILIO_AUTH_TOKEN')): boolean {
  if (!token || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, name) => acc + name + params[name], url);
  const expected = createHmac('sha1', token).update(data, 'utf8').digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The carrier-standard opt-out words (CTIA). */
export function isSmsOptOut(text: string): boolean {
  return /^\s*(stop|stopall|stop all|unsubscribe|cancel|end|quit|revoke|optout|opt out|opt-out)\s*[.!]*\s*$/i.test(text);
}
