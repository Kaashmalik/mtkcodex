import { promises as fs } from 'node:fs';
import path from 'node:path';
import seedData from '@/data/leads.seed.json';
import { LEAD_STATUSES, type Lead, type LeadStatus } from '@/lib/lead-types';

export type { Lead, LeadStatus } from '@/lib/lead-types';
export { LEAD_STATUSES, STATUS_LABELS, leadStats, waLink, leadsToCsv } from '@/lib/lead-types';

export type StorageMode = 'supabase' | 'file' | 'readonly';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const FILE_PATH = path.join(process.cwd(), '.data', 'leads.json');

const seedLeads = seedData as unknown as Lead[];

export function storageMode(): StorageMode {
  if (SUPABASE_URL && SUPABASE_KEY) return 'supabase';
  if (process.env.VERCEL) return 'readonly';
  return 'file';
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (LEAD_STATUSES as string[]).includes(value);
}

async function supabase<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function readFileStore(): Promise<Lead[]> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    return JSON.parse(raw) as Lead[];
  } catch {
    return seedLeads.map((lead) => ({ ...lead }));
  }
}

async function writeFileStore(leads: Lead[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  const tmp = `${FILE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(leads, null, 2), 'utf8');
  await fs.rename(tmp, FILE_PATH);
}

export async function listLeads(): Promise<{ leads: Lead[]; mode: StorageMode }> {
  const mode = storageMode();
  if (mode === 'supabase') {
    const leads = await supabase<Lead[]>('leads?select=*&order=created_at.desc.nullslast,lead_score.desc');
    return { leads, mode };
  }
  return { leads: await readFileStore(), mode };
}

export type LeadPatch = Partial<
  Pick<Lead, 'status' | 'notes' | 'next_followup' | 'last_contacted' | 'do_not_contact' | 'message'>
>;

export async function updateLead(id: string, patch: LeadPatch): Promise<Lead> {
  const mode = storageMode();
  if (mode === 'readonly') {
    throw new Error('Storage is read-only. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to save CRM changes.');
  }

  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) {
    if (!isLeadStatus(patch.status)) throw new Error('Invalid status');
    clean.status = patch.status;
  }
  if (patch.notes !== undefined) clean.notes = String(patch.notes).slice(0, 4000);
  if (patch.next_followup !== undefined) clean.next_followup = patch.next_followup || null;
  if (patch.last_contacted !== undefined) clean.last_contacted = patch.last_contacted || null;
  if (patch.do_not_contact !== undefined) clean.do_not_contact = Boolean(patch.do_not_contact);
  if (patch.message !== undefined) clean.message = String(patch.message).slice(0, 2000);

  // Marking a lead as contacted implies today's date unless one was supplied.
  if (clean.status === 'contacted' && patch.last_contacted === undefined) {
    clean.last_contacted = new Date().toISOString().slice(0, 10);
  }

  if (mode === 'supabase') {
    const rows = await supabase<Lead[]>(`leads?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(clean),
    });
    if (!rows[0]) throw new Error('Lead not found');
    return rows[0];
  }

  const leads = await readFileStore();
  const index = leads.findIndex((lead) => lead.id === id);
  if (index === -1) throw new Error('Lead not found');
  leads[index] = { ...leads[index], ...(clean as Partial<Lead>) };
  await writeFileStore(leads);
  return leads[index];
}

/** Copies the bundled seed batch into Supabase (idempotent). */
export async function importSeedLeads(): Promise<number> {
  if (storageMode() !== 'supabase') {
    throw new Error('Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  }
  const rows = await supabase<Lead[]>('leads?on_conflict=id&select=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(seedLeads),
  });
  return rows.length;
}
