/**
 * Consented contact import (JSON or CSV) for campaigns. Pure functions shared
 * by the import dialog (preview) and the import API (validation).
 */

import { parseDelimited, type RawRow } from '@/lib/lead-import';
import type { ImportedLead } from '@/lib/lead-import';
import { formatUsPhone, normalizeUsPhone, stateCode, stateTimezone } from '@/lib/us-contacts';

export const CONTACT_FIELDS = {
  phone: ['phone', 'phone_number', 'phonenumber', 'mobile', 'cell', 'cell_phone', 'contact_no', 'contact_number', 'tel', 'telephone', 'number', 'whatsapp'],
  name: ['name', 'full_name', 'fullname', 'contact_name', 'customer_name'],
  first_name: ['first_name', 'firstname', 'first', 'given_name'],
  last_name: ['last_name', 'lastname', 'last', 'surname', 'family_name'],
  company: ['company', 'business', 'business_name', 'company_name', 'organization'],
  email: ['email', 'email_address', 'e-mail', 'mail'],
  city: ['city', 'town', 'locality', 'address_city', 'location_city'],
  state: ['state', 'state_code', 'region', 'province', 'address_state', 'location_state'],
  zip: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postcode'],
  tags: ['tags', 'labels', 'segment'],
} as const;

export type ContactField = keyof typeof CONTACT_FIELDS;
export type ContactMapping = Partial<Record<ContactField, string>>;

export type ConsentInfo = {
  /** Where and how they agreed, e.g. "Signed up on mtkcodex.tech/audit form". Required. */
  source: string;
  /** When they agreed (ISO date). Defaults to the import date. */
  date?: string;
  channels: ('sms' | 'whatsapp')[];
  batch: string;
};

const MAX_ROWS = 20_000;

/** Flattens nested objects to dot keys ({address: {city}} → "address.city"); arrays become "a; b". */
function flatten(value: unknown, prefix = '', out: RawRow = {}): RawRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (Array.isArray(value)) {
    out[prefix] = value.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))).join('; ');
  } else if (prefix) {
    out[prefix] = value == null ? '' : String(value).trim();
  }
  return out;
}

/** The list of records in a JSON file: a top-level array, or the first array under a key. */
function recordsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['data', 'contacts', 'customers', 'clients', 'leads', 'results', 'items', 'records', 'rows']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    const firstArray = Object.values(obj).find(Array.isArray);
    if (firstArray) return firstArray as unknown[];
  }
  return [];
}

/** JSON (array, nested, or JSON Lines) or CSV/TSV text → flat rows. */
export function parseContactFile(text: string, filename = ''): RawRow[] {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return [];
  if (/\.(csv|tsv|txt)$/i.test(filename) || !/^[[{]/.test(trimmed)) return parseDelimited(trimmed);
  let records: unknown[];
  try {
    records = recordsOf(JSON.parse(trimmed));
  } catch {
    // JSON Lines: one object per line.
    records = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!records.length) throw new Error('This file is not valid JSON or CSV.');
  }
  return records
    .slice(0, MAX_ROWS)
    .map((record) => (record && typeof record === 'object' ? flatten(record) : { phone: String(record ?? '') }))
    .filter((row) => Object.values(row).some(Boolean));
}

const key = (header: string) => header.trim().toLowerCase().replace(/[\s.-]+/g, '_');

export function autoMapContacts(headers: string[]): ContactMapping {
  // Match on the full key first, then on the last part of a nested key ("address.city" → city).
  const full = new Map(headers.map((h) => [key(h), h]));
  const tail = new Map(headers.map((h) => [key(h.split('.').pop() || h), h]));
  const mapping: ContactMapping = {};
  for (const [field, aliases] of Object.entries(CONTACT_FIELDS) as [ContactField, readonly string[]][]) {
    const hit = aliases.find((a) => full.has(a)) ?? aliases.find((a) => tail.has(a));
    if (hit) mapping[field] = full.get(hit) ?? tail.get(hit);
  }
  return mapping;
}

export type ContactRowResult = { lead: ImportedLead; error?: undefined } | { lead?: undefined; error: string };

export function rowToContact(row: RawRow, mapping: ContactMapping, consent: ConsentInfo, now = new Date()): ContactRowResult {
  const get = (field: ContactField) => {
    const column = mapping[field];
    return column ? (row[column] ?? '').trim() : '';
  };
  const phone = normalizeUsPhone(get('phone'));
  if (!phone) return { error: 'Not a valid US phone number' };

  const state = stateCode(get('state'));
  const city = get('city').slice(0, 80);
  const person = (get('name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ')).slice(0, 120);
  const company = get('company').slice(0, 120);
  const place = [city, state].filter(Boolean).join(', ');
  const name = person || company || `Contact ${formatUsPhone(phone)}${place ? ` · ${place}` : ''}`;
  const email = get('email').toLowerCase();
  const tags = get('tags')
    .split(/[;,|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const lead: ImportedLead = {
    name,
    phone,
    area: [place, get('zip')].filter(Boolean).join(' ').slice(0, 200),
    city,
    region: state,
    country: 'US',
    timezone: stateTimezone(state),
    business_type: company ? 'Business' : 'Consumer',
    channel: consent.channels.includes('whatsapp') ? 'whatsapp' : 'sms',
    preferred_channel: consent.channels.includes('whatsapp') ? 'whatsapp' : '',
    tags: [...new Set(['campaign', consent.batch.toLowerCase(), ...tags])].slice(0, 12),
    consent_source: consent.source.slice(0, 300),
    consent_at: consent.date ? new Date(consent.date).toISOString() : now.toISOString(),
    consent_channels: consent.channels,
    import_batch: consent.batch.slice(0, 80),
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) lead.email = email.slice(0, 200);
  if (company && person) lead.notes = `Company: ${company}`;
  return { lead };
}

export function validateConsent(consent: Partial<ConsentInfo> & { confirmed?: boolean }): string | null {
  if (!consent.confirmed) return 'Confirm that these contacts gave written consent to receive marketing messages.';
  if (!consent.source || consent.source.trim().length < 10) return 'Describe where the consent came from (form, event, purchase…).';
  if (!consent.channels?.length) return 'Choose at least one channel they agreed to (SMS or WhatsApp).';
  if (!consent.batch || !consent.batch.trim()) return 'Give this import a batch name.';
  if (consent.date && Number.isNaN(Date.parse(consent.date))) return 'Consent date is not a valid date.';
  return null;
}
