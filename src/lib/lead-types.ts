export type LeadStatus = 'new' | 'queued' | 'contacted' | 'replied' | 'interested' | 'won' | 'lost' | 'skipped';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'queued',
  'contacted',
  'replied',
  'interested',
  'won',
  'lost',
  'skipped',
];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  queued: 'Queued',
  contacted: 'Contacted',
  replied: 'Replied',
  interested: 'Interested',
  won: 'Won',
  lost: 'Lost',
  skipped: 'Not on WhatsApp',
};

export type Lead = {
  id: string;
  name: string;
  business_type: string;
  area: string;
  phone: string;
  email: string;
  website: string;
  lead_score: number;
  lead_tier: string;
  scenario: string;
  rating: number | null;
  reviews: number | null;
  google_maps_url: string;
  recommended_pitch: string;
  message: string;
  status: LeadStatus;
  channel: string;
  notes: string;
  last_contacted: string | null;
  next_followup: string | null;
  do_not_contact: boolean;
  created_at: string;
  updated_at: string;
};

export function leadStats(leads: Lead[]) {
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0])) as Record<LeadStatus, number>;
  for (const lead of leads) byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: leads.length,
    byStatus,
    dueToday: leads.filter(
      (lead) => lead.next_followup && lead.next_followup <= today && lead.status !== 'won' && lead.status !== 'lost',
    ).length,
    queued: leads.filter((lead) => lead.status === 'queued' && !lead.do_not_contact).length,
    won: byStatus.won || 0,
    contacted: leads.filter((lead) => ['contacted', 'replied', 'interested', 'won', 'lost'].includes(lead.status)).length,
  };
}

export function waLink(lead: Pick<Lead, 'phone' | 'message'>): string {
  const digits = lead.phone.replace(/\D/g, '');
  const text = lead.message?.trim() ? `?text=${encodeURIComponent(lead.message)}` : '';
  return `https://wa.me/${digits}${text}`;
}

const CSV_COLUMNS: { key: keyof Lead; label: string }[] = [
  { key: 'id', label: 'lead_id' },
  { key: 'name', label: 'name' },
  { key: 'business_type', label: 'business_type' },
  { key: 'area', label: 'area' },
  { key: 'phone', label: 'phone_e164' },
  { key: 'email', label: 'email' },
  { key: 'website', label: 'website' },
  { key: 'lead_score', label: 'lead_score' },
  { key: 'lead_tier', label: 'lead_tier' },
  { key: 'scenario', label: 'scenario' },
  { key: 'rating', label: 'google_rating' },
  { key: 'reviews', label: 'google_review_count' },
  { key: 'status', label: 'status' },
  { key: 'channel', label: 'channel' },
  { key: 'last_contacted', label: 'last_contacted' },
  { key: 'next_followup', label: 'next_followup' },
  { key: 'do_not_contact', label: 'do_not_contact' },
  { key: 'notes', label: 'notes' },
  { key: 'message', label: 'message' },
  { key: 'google_maps_url', label: 'google_maps_url' },
  { key: 'created_at', label: 'created_at' },
  { key: 'updated_at', label: 'updated_at' },
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = CSV_COLUMNS.map((column) => column.label).join(',');
  const rows = leads.map((lead) => CSV_COLUMNS.map((column) => csvCell(lead[column.key])).join(','));
  return `\ufeff${[header, ...rows].join('\r\n')}\r\n`;
}

export function statusTone(status: LeadStatus): string {
  switch (status) {
    case 'won':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'interested':
    case 'replied':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'contacted':
    case 'queued':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'lost':
      return 'border-line bg-muted text-fg-subtle';
    case 'skipped':
      return 'border-line bg-muted text-fg-muted';
    default:
      return 'border-brand/30 bg-brand-soft text-brand';
  }
}
