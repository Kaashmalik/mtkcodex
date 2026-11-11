import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { CONTACT_FIELDS, rowToContact, validateConsent, type ConsentInfo, type ContactMapping } from '@/lib/contact-import';
import { hunterFailure, readJsonBody } from '@/lib/hunter-http';
import type { ImportedLead, RawRow } from '@/lib/lead-import';
import { LeadError, importLeads } from '@/lib/leads';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** Rows per request; the dialog sends big files in chunks. */
const MAX_ROWS = 1000;

/**
 * Imports consented contacts. Matches existing contacts by phone, refreshes
 * their consent record and location, and adds new ones. The consent source,
 * date, channels and batch are stored on every contact.
 */
export async function POST(req: Request) {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  try {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw new LeadError('No rows to import', 422);
    if (rows.length > MAX_ROWS) throw new LeadError(`Send at most ${MAX_ROWS} rows per request`, 413);

    const rawConsent = (body.consent || {}) as Record<string, unknown>;
    const consent = {
      source: typeof rawConsent.source === 'string' ? rawConsent.source.trim() : '',
      date: typeof rawConsent.date === 'string' && rawConsent.date ? rawConsent.date : undefined,
      channels: (Array.isArray(rawConsent.channels) ? rawConsent.channels : []).filter((c): c is 'sms' | 'whatsapp' => c === 'sms' || c === 'whatsapp'),
      batch: typeof rawConsent.batch === 'string' ? rawConsent.batch.trim() : '',
      confirmed: rawConsent.confirmed === true,
    };
    const invalidConsent = validateConsent(consent);
    if (invalidConsent) throw new LeadError(invalidConsent, 422);

    const mapping: ContactMapping = {};
    const rawMapping = (body.mapping || {}) as Record<string, unknown>;
    for (const field of Object.keys(CONTACT_FIELDS) as (keyof typeof CONTACT_FIELDS)[]) {
      if (typeof rawMapping[field] === 'string' && rawMapping[field]) mapping[field] = rawMapping[field] as string;
    }
    if (!mapping.phone) throw new LeadError('Choose which column holds the phone number', 422);

    const leads: ImportedLead[] = [];
    let invalid = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        invalid++;
        continue;
      }
      const cells = Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, v == null ? '' : String(v)])) as RawRow;
      const result = rowToContact(cells, mapping, consent as ConsentInfo);
      if (result.lead) leads.push(result.lead);
      else invalid++;
    }
    const result = await importLeads(leads, 'merge');
    return NextResponse.json({ ...result, invalid });
  } catch (error) {
    return hunterFailure(error, 'Import failed');
  }
}
