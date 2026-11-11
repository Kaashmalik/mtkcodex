/**
 * Best time to message contacts abroad, told in Pakistan time. Pure, so the
 * server and the admin widgets agree.
 *
 * Read rates are highest on weekdays (Tue–Thu best) in the recipient's late
 * morning and mid-afternoon, and lowest early morning, at lunch rush, in the
 * evening and at weekends. Messages outside 9:00–20:00 local are never sent.
 */

export const PKT = 'Asia/Karachi';

export type PrimeWindow = { start: number; end: number; label: string };

/** Recipient-local hours with the best open/read rates for SMS, WhatsApp and email. */
export const PRIME_WINDOWS: PrimeWindow[] = [
  { start: 10, end: 12, label: 'Late morning' },
  { start: 14, end: 17, label: 'Afternoon' },
];

export const BEST_DAYS = 'Tue–Thu';

/** A representative zone per country, for leads with a country but no zone. */
const COUNTRY_ZONES: Record<string, string> = {
  US: 'America/New_York',
  CA: 'America/Toronto',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar',
  KW: 'Asia/Kuwait',
  BH: 'Asia/Bahrain',
  OM: 'Asia/Muscat',
  IN: 'Asia/Kolkata',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg',
  TR: 'Europe/Istanbul',
  PK: PKT,
};

export function zoneFor(lead: { timezone?: string; country?: string; phone?: string }, country = ''): string {
  return lead.timezone || COUNTRY_ZONES[(lead.country || country || '').toUpperCase()] || '';
}

/** Minutes the zone is ahead of UTC at `at`. */
export function utcOffsetMinutes(timezone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  })
    .formatToParts(at)
    .reduce<Record<string, number>>((acc, p) => (p.type === 'literal' ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** A recipient-local hour expressed as an hour in Pakistan (may wrap past midnight). */
export function localHourToPkt(hour: number, timezone: string, at: Date = new Date()): number {
  const shift = (utcOffsetMinutes(PKT, at) - utcOffsetMinutes(timezone, at)) / 60;
  return (((hour + shift) % 24) + 24) % 24;
}

export function formatHour(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  const h12 = whole % 12 === 0 ? 12 : whole % 12;
  return `${h12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${whole < 12 ? 'AM' : 'PM'}`;
}

export function localHourNow(timezone: string, at: Date = new Date()): number {
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes() + utcOffsetMinutes(timezone, at);
  return ((((minutes / 60) % 24) + 24) % 24);
}

export type ZoneAdvice = {
  timezone: string;
  label: string;
  count: number;
  localNow: string;
  status: 'prime' | 'ok' | 'quiet';
  windows: { label: string; local: string; pkt: string }[];
};

export type SendAdvice = {
  zones: ZoneAdvice[];
  /** The PKT window that lands inside prime time for the most contacts. */
  best: { startPkt: number; endPkt: number; label: string; reach: number; total: number } | null;
  nowReach: number;
};

const zoneLabel = (timezone: string) => timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;

function inPrime(hour: number): boolean {
  return PRIME_WINDOWS.some((w) => hour >= w.start && hour < w.end);
}

/**
 * Advice for an audience given as zone → contact count. Contacts with no
 * known zone are left out of the maths (they're sent only when it's daytime
 * everywhere in the US anyway).
 */
export function sendAdvice(zoneCounts: Record<string, number>, at: Date = new Date()): SendAdvice {
  const entries = Object.entries(zoneCounts).filter(([tz, n]) => tz && n > 0);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  const zones: ZoneAdvice[] = entries
    .sort((a, b) => b[1] - a[1])
    .map(([timezone, count]) => {
      const hourNow = localHourNow(timezone, at);
      return {
        timezone,
        label: zoneLabel(timezone),
        count,
        localNow: formatHour(Math.floor(hourNow * 4) / 4),
        status: inPrime(hourNow) ? 'prime' : hourNow >= 9 && hourNow < 20 ? 'ok' : 'quiet',
        windows: PRIME_WINDOWS.map((w) => ({
          label: w.label,
          local: `${formatHour(w.start)}–${formatHour(w.end)}`,
          pkt: `${formatHour(localHourToPkt(w.start, timezone, at))}–${formatHour(localHourToPkt(w.end, timezone, at))}`,
        })),
      };
    });

  if (!total) return { zones, best: null, nowReach: 0 };

  // Score each half hour of the Pakistan day by how many contacts are in prime time then.
  const slots = Array.from({ length: 48 }, (_, i) => {
    const pkt = i / 2;
    let reach = 0;
    for (const [timezone, count] of entries) {
      const local = (((pkt - (utcOffsetMinutes(PKT, at) - utcOffsetMinutes(timezone, at)) / 60) % 24) + 24) % 24;
      if (inPrime(local)) reach += count;
    }
    return reach;
  });
  const peak = Math.max(...slots);
  // The longest run of slots at the peak (wrapping past midnight).
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 48; i += 1) {
    if (slots[i] !== peak || slots[(i + 47) % 48] === peak) continue;
    let length = 0;
    while (length < 48 && slots[(i + length) % 48] === peak) length += 1;
    if (length > bestLength) {
      bestLength = length;
      bestStart = i;
    }
  }
  if (bestStart < 0) bestStart = slots.indexOf(peak);
  const startPkt = bestStart / 2;
  const endPkt = ((bestStart + Math.max(1, bestLength)) % 48) / 2;
  const nowPkt = localHourNow(PKT, at);
  return {
    zones,
    best: { startPkt, endPkt, label: `${formatHour(startPkt)}–${formatHour(endPkt)} PKT`, reach: peak, total },
    nowReach: slots[Math.floor(nowPkt * 2) % 48],
  };
}
