import { describe, expect, it } from 'vitest';
import { formatHour, localHourToPkt, sendAdvice, utcOffsetMinutes, zoneFor } from '@/lib/send-times';

// Wed 11 Nov 2026, 17:00 UTC = 22:00 PKT, 12:00 New York (EST, UTC-5), 09:00 Los Angeles.
const at = new Date('2026-11-11T17:00:00Z');

describe('send times', () => {
  it('knows zone offsets, including daylight saving', () => {
    expect(utcOffsetMinutes('Asia/Karachi', at)).toBe(300);
    expect(utcOffsetMinutes('America/New_York', at)).toBe(-300);
    expect(utcOffsetMinutes('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(-240);
  });

  it('converts recipient-local hours to Pakistan time', () => {
    expect(localHourToPkt(10, 'America/New_York', at)).toBe(20); // 10 AM New York = 8 PM PKT in winter
    expect(localHourToPkt(10, 'Europe/London', at)).toBe(15);
    expect(localHourToPkt(10, 'Asia/Dubai', at)).toBe(11);
    expect(formatHour(20)).toBe('8 PM');
    expect(formatHour(9.5)).toBe('9:30 AM');
    expect(formatHour(0)).toBe('12 AM');
  });

  it('picks the PKT window that reaches most contacts in prime time', () => {
    const advice = sendAdvice({ 'America/New_York': 30, 'America/Chicago': 10 }, at);
    // NY prime 10-12 & 14-17 → 20-22 & 0-3 PKT; Chicago → 21-23 & 1-4 PKT. Both overlap 21-22 and 1-3.
    expect(advice.best).toMatchObject({ reach: 40, total: 40 });
    expect(['9 PM–10 PM PKT', '1 AM–3 AM PKT']).toContain(advice.best?.label);
    // 12 PM is lunch: awake but outside the 10–12 prime window.
    expect(advice.zones[0]).toMatchObject({ timezone: 'America/New_York', count: 30, status: 'ok', localNow: '12 PM' });
    expect(sendAdvice({ 'America/New_York': 1 }, new Date('2026-11-11T15:30:00Z')).zones[0].status).toBe('prime'); // 10:30 AM
  });

  it('reports who is in prime time right now and handles empty audiences', () => {
    expect(sendAdvice({ 'America/Los_Angeles': 5 }, at).nowReach).toBe(0); // 9 AM there: awake, not prime
    expect(sendAdvice({ 'America/Los_Angeles': 5 }, at).zones[0].status).toBe('ok');
    expect(sendAdvice({}, at)).toEqual({ zones: [], best: null, nowReach: 0 });
  });

  it('falls back to a country zone', () => {
    expect(zoneFor({ timezone: '', country: 'GB' })).toBe('Europe/London');
    expect(zoneFor({ timezone: 'America/Denver', country: 'US' })).toBe('America/Denver');
    expect(zoneFor({}, 'AE')).toBe('Asia/Dubai');
  });
});
