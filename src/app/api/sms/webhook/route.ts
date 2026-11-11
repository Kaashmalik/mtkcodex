import { applySmsStatus, recordInboundSms } from '@/lib/campaigns';
import { smsConfigured, smsWebhookUrl, verifyTwilioSignature } from '@/lib/sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * Twilio: inbound SMS (replies, STOP) and delivery status callbacks. Set this
 * URL as the Messaging Service's incoming-message webhook. The signature is
 * checked against the public URL Twilio was given.
 */
export async function POST(req: Request) {
  if (!smsConfigured()) return new Response('Not configured', { status: 404 });
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') params[key] = value;

  if (!verifyTwilioSignature(smsWebhookUrl(), params, req.headers.get('x-twilio-signature'))) {
    return new Response('Invalid signature', { status: 403 });
  }

  try {
    if (params.MessageStatus && params.MessageSid && !params.Body) {
      await applySmsStatus(params.MessageSid, params.MessageStatus, params.ErrorCode);
    } else if (params.From && typeof params.Body === 'string') {
      await recordInboundSms(params.From, params.Body);
    }
  } catch (error) {
    console.error('sms webhook:', error instanceof Error ? error.message : error);
  }
  // Empty TwiML: no auto-reply (Twilio sends the carrier STOP confirmation itself).
  return new Response(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
