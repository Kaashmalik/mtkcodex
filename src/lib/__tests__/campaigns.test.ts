import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderSms, smsSegments } from '@/lib/campaign-message';
import { computeStats, inAudience, startOfUsDay, validateCampaign, type Campaign, type Recipient } from '@/lib/campaigns';
import { autoMapContacts, parseContactFile, rowToContact, validateConsent, type ConsentInfo } from '@/lib/contact-import';
import { blankLead } from '@/lib/leads';
import { isInternational, leadCountry, type Lead } from '@/lib/lead-types';
import { isSmsOptOut, verifyTwilioSignature } from '@/lib/sms';
import { inSendWindow, normalizeUsPhone, stateCode } from '@/lib/us-contacts';

const consent: ConsentInfo = { source: 'Opted in on the audit sign-up form', channels: ['sms'], batch: 'texas-2026' };

function contact(over: Partial<Lead> = {}): Lead {
  return {
    ...blankLead({ name: 'Jordan Smith', phone: '+15125550123', city: 'Austin', region: 'TX', country: 'US', timezone: 'America/Chicago' }, 'import'),
    consent_channels: ['sms'],
    import_batch: 'texas-2026',
    ...over,
  };
}

const smsCampaign: Pick<Campaign, 'channel' | 'audience'> = { channel: 'sms', audience: {} };

describe('US numbers and places', () => {
  it('normalises common US formats and rejects the rest', () => {
    expect(normalizeUsPhone('(512) 555-0123')).toBe('+15125550123');
    expect(normalizeUsPhone('1-512-555-0123')).toBe('+15125550123');
    expect(normalizeUsPhone('+1 512.555.0123')).toBe('+15125550123');
    expect(normalizeUsPhone('0300 1234567')).toBe('');
    expect(normalizeUsPhone('112-555-0123')).toBe('');
    expect(normalizeUsPhone('555-0123')).toBe('');
  });

  it('reads state names and codes', () => {
    expect(stateCode('Texas')).toBe('TX');
    expect(stateCode('n.y.')).toBe('NY');
    expect(stateCode('Ontario')).toBe('');
  });

  it('only sends inside local hours, and in every zone when the zone is unknown', () => {
    const noonUtc = new Date('2026-11-11T17:00:00Z'); // 11:00 Chicago, 09:00 LA, 12:00 NY
    expect(inSendWindow('America/Chicago', 9, 20, noonUtc)).toBe(true);
    expect(inSendWindow('America/Los_Angeles', 10, 20, noonUtc)).toBe(false);
    const lateUtc = new Date('2026-11-12T03:00:00Z'); // 22:00 NY, 19:00 LA
    expect(inSendWindow('', 9, 20, lateUtc)).toBe(false);
    expect(inSendWindow('', 9, 20, noonUtc)).toBe(true);
  });
});

describe('contact files', () => {
  it('reads nested JSON wrapped under a key', () => {
    const rows = parseContactFile(JSON.stringify({ customers: [{ contact: { phone: '512-555-0123' }, address: { city: 'Austin', state: 'Texas' } }] }), 'c.json');
    expect(rows).toEqual([{ 'contact.phone': '512-555-0123', 'address.city': 'Austin', 'address.state': 'Texas' }]);
    expect(autoMapContacts(Object.keys(rows[0]))).toMatchObject({ phone: 'contact.phone', city: 'address.city', state: 'address.state' });
  });

  it('reads JSON Lines and CSV', () => {
    expect(parseContactFile('{"phone":"5125550123"}\n{"phone":"2125550123"}')).toHaveLength(2);
    expect(parseContactFile('phone,city\n5125550123,Austin', 'list.csv')).toEqual([{ phone: '5125550123', city: 'Austin' }]);
    expect(() => parseContactFile('{not json')).toThrow();
  });

  it('builds a consented contact with a fallback name and its time zone', () => {
    const result = rowToContact({ phone: '512 555 0123', city: 'Austin', state: 'TX' }, { phone: 'phone', city: 'city', state: 'state' }, consent);
    expect(result.lead).toMatchObject({
      phone: '+15125550123',
      name: 'Contact (512) 555-0123 · Austin, TX',
      region: 'TX',
      timezone: 'America/Chicago',
      consent_channels: ['sms'],
      import_batch: 'texas-2026',
    });
    expect(rowToContact({ phone: '123' }, { phone: 'phone' }, consent).error).toBeTruthy();
  });

  it('requires a real consent record', () => {
    expect(validateConsent({ ...consent, confirmed: true })).toBeNull();
    expect(validateConsent({ ...consent, confirmed: false })).toMatch(/Confirm/);
    expect(validateConsent({ ...consent, source: 'yes', confirmed: true })).toMatch(/where the consent/);
    expect(validateConsent({ ...consent, channels: [], confirmed: true })).toMatch(/channel/);
  });
});

describe('messages', () => {
  it('adds the sender name and STOP line US carriers require', () => {
    const sms = renderSms('Hi {name}, websites for {city} businesses: {link}', { name: 'Jordan Smith', city: 'Austin' }, 'https://x.test/go/abc');
    expect(sms).toBe('MTK Codex: Hi Jordan, websites for Austin businesses: https://x.test/go/abc Reply STOP to opt out.');
    expect(renderSms('MTK Codex here {name}. Text STOP to end. {link}', { name: 'Contact (512) 555-0123', city: '' }, 'L')).toBe(
      'MTK Codex here there. Text STOP to end. L',
    );
  });

  it('counts SMS segments', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ segments: 1, unicode: false });
    expect(smsSegments('a'.repeat(161))).toEqual({ segments: 2, unicode: false });
    expect(smsSegments('Hi 👋')).toMatchObject({ unicode: true, segments: 1 });
  });

  it('recognises STOP words', () => {
    expect(isSmsOptOut('STOP')).toBe(true);
    expect(isSmsOptOut(' unsubscribe. ')).toBe(true);
    expect(isSmsOptOut('please stop by tomorrow')).toBe(false);
  });

  it('validates campaigns', () => {
    const base = { name: 'Austin', channel: 'sms' as const, message: 'Hi {name}, see our work: {link}' };
    expect(validateCampaign(base)).toBeNull();
    expect(validateCampaign({ ...base, message: 'Hi {name}, call us today please' })).toMatch(/\{link\}/);
    expect(validateCampaign({ ...base, window_start: 6 })).toMatch(/8:00/);
    expect(validateCampaign({ ...base, channel: 'whatsapp' })).toMatch(/template/);
  });
});

describe('audience', () => {
  it('needs consent for the channel and respects opt-outs and filters', () => {
    expect(inAudience(contact(), smsCampaign)).toBe(true);
    expect(inAudience(contact({ consent_channels: ['whatsapp'] }), smsCampaign)).toBe(false);
    expect(inAudience(contact({ do_not_contact: true }), smsCampaign)).toBe(false);
    expect(inAudience(contact({ phone: '+923001234567' }), smsCampaign)).toBe(false);
    expect(inAudience(contact(), { channel: 'sms', audience: { states: ['CA'] } })).toBe(false);
    expect(inAudience(contact(), { channel: 'sms', audience: { batch: 'texas-2026', city: 'aus' } })).toBe(true);
  });

  it('counts sent, clicks, replies and opt-outs', () => {
    const lead = contact({ id: 'l1', last_inbound_at: '2026-11-11T18:00:00Z' });
    const rec = (over: Partial<Recipient>): Recipient => ({
      campaign_id: 'c',
      lead_id: 'l1',
      token: 't',
      status: 'sent',
      error: '',
      external_id: '',
      sent_at: '2026-11-11T17:00:00Z',
      delivered_at: null,
      clicked_at: null,
      clicks: 0,
      created_at: '',
      ...over,
    });
    const stats = computeStats([rec({ status: 'delivered', clicked_at: '2026-11-11T17:05:00Z' }), rec({ lead_id: 'x', status: 'queued', sent_at: null })], new Map([['l1', lead]]), 2, new Date('2026-11-11T20:00:00Z'));
    expect(stats).toMatchObject({ audience: 2, sent: 1, delivered: 1, queued: 1, clicked: 1, replied: 1, sentToday: 1 });
  });

  it('starts the daily count at midnight US Eastern', () => {
    expect(startOfUsDay(new Date('2026-11-11T20:00:00Z'))).toBe('2026-11-11T05:00:00.000Z');
    expect(startOfUsDay(new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-11T05:00:00.000Z');
  });
});

describe('Twilio webhook signature', () => {
  it('accepts a correctly signed request and rejects tampering', () => {
    const url = 'https://mtkcodex.tech/api/sms/webhook';
    const params = { From: '+15125550123', Body: 'STOP', MessageSid: 'SM1' };
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k as keyof typeof params], url);
    const signature = createHmac('sha1', 'token').update(data).digest('base64');
    expect(verifyTwilioSignature(url, params, signature, 'token')).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, Body: 'HI' }, signature, 'token')).toBe(false);
    expect(verifyTwilioSignature(url, params, null, 'token')).toBe(false);
  });
});

describe('Pakistan vs international leads', () => {
  it('uses the saved country, else the phone prefix', () => {
    expect(leadCountry({ country: 'us', phone: '' })).toBe('US');
    expect(leadCountry({ country: '', phone: '+971501234567' })).toBe('AE');
    expect(isInternational({ country: '', phone: '+923001234567' })).toBe(false);
    expect(isInternational({ country: '', phone: '+15125550123' })).toBe(true);
    expect(isInternational({ country: '', phone: '' })).toBe(false);
  });
});
