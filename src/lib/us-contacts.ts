/**
 * US contact helpers: phone numbers to E.164, states to time zones, and
 * whether "now" is inside a contact's local sending window. Pure functions.
 */

/**
 * NANP number → `+1XXXXXXXXXX`. Accepts "(212) 555-0123", "212.555.0123",
 * "1-212-555-0123", "+1 212 555 0123". Returns '' for anything else.
 */
export function normalizeUsPhone(raw: string | null | undefined): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return '';
  // Area code and exchange can't start with 0 or 1; 555-01xx is the fiction range but still valid format.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return '';
  return `+1${digits}`;
}

/** "+12125550123" → "(212) 555-0123" for display and fallback names. */
export function formatUsPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

const STATES: Record<string, [name: string, tz: string]> = {
  AL: ['Alabama', 'America/Chicago'],
  AK: ['Alaska', 'America/Anchorage'],
  AZ: ['Arizona', 'America/Phoenix'],
  AR: ['Arkansas', 'America/Chicago'],
  CA: ['California', 'America/Los_Angeles'],
  CO: ['Colorado', 'America/Denver'],
  CT: ['Connecticut', 'America/New_York'],
  DE: ['Delaware', 'America/New_York'],
  DC: ['District of Columbia', 'America/New_York'],
  FL: ['Florida', 'America/New_York'],
  GA: ['Georgia', 'America/New_York'],
  HI: ['Hawaii', 'Pacific/Honolulu'],
  ID: ['Idaho', 'America/Boise'],
  IL: ['Illinois', 'America/Chicago'],
  IN: ['Indiana', 'America/Indiana/Indianapolis'],
  IA: ['Iowa', 'America/Chicago'],
  KS: ['Kansas', 'America/Chicago'],
  KY: ['Kentucky', 'America/New_York'],
  LA: ['Louisiana', 'America/Chicago'],
  ME: ['Maine', 'America/New_York'],
  MD: ['Maryland', 'America/New_York'],
  MA: ['Massachusetts', 'America/New_York'],
  MI: ['Michigan', 'America/Detroit'],
  MN: ['Minnesota', 'America/Chicago'],
  MS: ['Mississippi', 'America/Chicago'],
  MO: ['Missouri', 'America/Chicago'],
  MT: ['Montana', 'America/Denver'],
  NE: ['Nebraska', 'America/Chicago'],
  NV: ['Nevada', 'America/Los_Angeles'],
  NH: ['New Hampshire', 'America/New_York'],
  NJ: ['New Jersey', 'America/New_York'],
  NM: ['New Mexico', 'America/Denver'],
  NY: ['New York', 'America/New_York'],
  NC: ['North Carolina', 'America/New_York'],
  ND: ['North Dakota', 'America/Chicago'],
  OH: ['Ohio', 'America/New_York'],
  OK: ['Oklahoma', 'America/Chicago'],
  OR: ['Oregon', 'America/Los_Angeles'],
  PA: ['Pennsylvania', 'America/New_York'],
  RI: ['Rhode Island', 'America/New_York'],
  SC: ['South Carolina', 'America/New_York'],
  SD: ['South Dakota', 'America/Chicago'],
  TN: ['Tennessee', 'America/Chicago'],
  TX: ['Texas', 'America/Chicago'],
  UT: ['Utah', 'America/Denver'],
  VT: ['Vermont', 'America/New_York'],
  VA: ['Virginia', 'America/New_York'],
  WA: ['Washington', 'America/Los_Angeles'],
  WV: ['West Virginia', 'America/New_York'],
  WI: ['Wisconsin', 'America/Chicago'],
  WY: ['Wyoming', 'America/Denver'],
  PR: ['Puerto Rico', 'America/Puerto_Rico'],
};

const BY_NAME = new Map(Object.entries(STATES).map(([code, [name]]) => [name.toLowerCase(), code]));

/** "new york", "NY", "N.Y." → "NY". '' when unknown. */
export function stateCode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\./g, '').toUpperCase();
  if (STATES[compact]) return compact;
  return BY_NAME.get(raw.toLowerCase()) || '';
}

export function stateName(code: string): string {
  return STATES[code]?.[0] || code;
}

export const US_STATE_CODES = Object.keys(STATES);

/** Time zone for a state code; '' when unknown. */
export function stateTimezone(code: string): string {
  return STATES[code]?.[1] || '';
}

/** Local hour (0-23) in a time zone. */
export function localHour(timezone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(hour) % 24;
}

/**
 * Whether `now` is inside [start, end) local time for this contact. With no
 * known zone, the window must hold in every mainland zone at once (Eastern
 * start, Pacific end), so nobody is messaged at night.
 */
export function inSendWindow(timezone: string, start: number, end: number, now: Date = new Date()): boolean {
  if (timezone) {
    const hour = localHour(timezone, now);
    return hour >= start && hour < end;
  }
  const east = localHour('America/New_York', now);
  const west = localHour('America/Los_Angeles', now);
  return west >= start && east < end;
}
