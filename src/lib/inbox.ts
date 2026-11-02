import { randomUUID } from 'node:crypto';
import { mutateTable, readTable } from '@/lib/file-store';
import { inList, supabase } from '@/lib/supabase';
import {
  addActivities,
  blankLead,
  findLeadByPhone,
  getLead,
  LeadError,
  storageMode,
  writeLeadChanges,
  type NewActivity,
} from '@/lib/leads';
import {
  CONTACTED_STATUSES,
  STATUS_LABELS,
  phoneDigits,
  todayPKT,
  waWindowOpen,
  type Conversation,
  type Lead,
  type WaMessage,
} from '@/lib/lead-types';
import {
  defaultTemplate,
  isOptOut,
  sendTemplate,
  sendText,
  whatsappConfigured,
  type InboundMessage,
  type StatusUpdate,
} from '@/lib/whatsapp';

/**
 * Two-way WhatsApp inbox on top of the CRM. Inbound webhooks land here,
 * attach to the matching lead (or create one), and the dashboard replies
 * through the Cloud API.
 */

type NewMessage = Omit<WaMessage, 'id' | 'created_at'> & { created_at?: string };

/** Inserts a message; returns null when the wamid was already stored (webhook retry). */
async function insertMessage(message: NewMessage): Promise<WaMessage | null> {
  if (storageMode() === 'supabase') {
    const rows = await supabase<WaMessage[]>('wa_messages?on_conflict=wamid&select=*', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(message),
    });
    return rows[0] || null;
  }
  return mutateTable<WaMessage, WaMessage | null>('messages', (rows) => {
    if (message.wamid && rows.some((row) => row.wamid === message.wamid)) return null;
    const row: WaMessage = { id: randomUUID(), created_at: new Date().toISOString(), ...message };
    rows.push(row);
    return row;
  });
}

async function setMessageLead(id: WaMessage['id'], leadId: string) {
  if (storageMode() === 'supabase') {
    await supabase(`wa_messages?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ lead_id: leadId }) });
    return;
  }
  await mutateTable<WaMessage, void>('messages', (rows) => {
    const row = rows.find((item) => item.id === id);
    if (row) row.lead_id = leadId;
  });
}

const STATUS_ORDER = ['sent', 'delivered', 'read'] as const;

/** Delivery receipts only move forward (sent → delivered → read); failures always apply. */
export async function applyStatusUpdate(update: StatusUpdate): Promise<void> {
  if (!update.wamid || storageMode() === 'readonly') return;
  const earlier =
    update.status === 'failed'
      ? ['sent', 'delivered']
      : STATUS_ORDER.slice(0, STATUS_ORDER.indexOf(update.status as (typeof STATUS_ORDER)[number]));
  if (!earlier.length) return;
  const changes = { status: update.status, error: update.error };
  if (storageMode() === 'supabase') {
    await supabase(
      `wa_messages?wamid=eq.${encodeURIComponent(update.wamid)}&status=${encodeURIComponent(inList(earlier))}`,
      { method: 'PATCH', body: JSON.stringify(changes) },
    );
    return;
  }
  await mutateTable<WaMessage, void>('messages', (rows) => {
    const row = rows.find((item) => item.wamid === update.wamid);
    if (row && earlier.includes(row.status)) Object.assign(row, changes);
  });
}

/** Stores an inbound WhatsApp message and moves the lead forward. */
export async function recordInbound(message: InboundMessage): Promise<void> {
  if (storageMode() === 'readonly') return;
  let lead = await findLeadByPhone(message.from);

  const stored = await insertMessage({
    lead_id: lead?.id ?? null,
    wa_id: message.from,
    direction: 'in',
    msg_type: message.type,
    body: message.body,
    wamid: message.wamid,
    status: 'received',
    error: '',
    created_at: message.timestamp,
  });
  if (!stored) return; // duplicate delivery

  const activities: NewActivity[] = [];
  if (!lead) {
    lead = blankLead(
      {
        name: message.profileName || `+${message.from}`,
        phone: `+${message.from}`,
        status: 'replied',
        notes: `Started a WhatsApp chat on ${todayPKT()}.`,
      },
      'whatsapp',
    );
    lead.id = `wa:${message.from}`;
    if (storageMode() === 'supabase') {
      await supabase('leads?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(lead),
      });
    } else {
      const created = lead;
      await mutateTable<Lead, void>('leads', (rows) => {
        if (!rows.some((row) => row.id === created.id)) rows.unshift(created);
      });
    }
    activities.push({ lead_id: lead.id, kind: 'created', summary: 'New lead from an inbound WhatsApp chat' });
    await setMessageLead(stored.id, lead.id);
  }

  const changes: Partial<Lead> = {
    last_inbound_at: message.timestamp,
    unread_count: (lead.unread_count || 0) + 1,
  };
  if (['new', 'queued', 'contacted', 'skipped'].includes(lead.status) && lead.status !== 'replied') {
    changes.status = 'replied';
    activities.push({
      lead_id: lead.id,
      kind: 'status',
      summary: `Status: ${STATUS_LABELS[lead.status]} → ${STATUS_LABELS.replied} (customer replied)`,
      meta: { from: lead.status, to: 'replied', auto: true },
    });
  }
  activities.push({
    lead_id: lead.id,
    kind: 'message_in',
    summary: message.body.slice(0, 200) || `[${message.type}]`,
    meta: { channel: 'whatsapp', wamid: message.wamid },
  });
  if (isOptOut(message.body) && !lead.do_not_contact) {
    changes.do_not_contact = true;
    activities.push({ lead_id: lead.id, kind: 'opt_out', summary: 'Opted out by replying STOP', meta: { auto: true } });
  }

  await writeLeadChanges(lead.id, changes);
  await addActivities(activities);
}

export async function listMessages(waId: string, limit = 300): Promise<WaMessage[]> {
  const digits = waId.replace(/\D/g, '');
  if (!digits || storageMode() === 'readonly') return [];
  if (storageMode() === 'supabase') {
    const rows = await supabase<WaMessage[]>(
      `wa_messages?wa_id=eq.${digits}&select=*&order=created_at.desc&limit=${limit}`,
    );
    return rows.reverse();
  }
  const rows = await readTable<WaMessage>('messages');
  return rows
    .filter((row) => row.wa_id === digits)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-limit);
}

export async function listConversations(): Promise<Conversation[]> {
  const mode = storageMode();
  if (mode === 'readonly') return [];

  let recent: WaMessage[];
  if (mode === 'supabase') {
    recent = await supabase<WaMessage[]>(
      'wa_messages?select=id,wa_id,lead_id,direction,body,created_at&order=created_at.desc&limit=3000',
    );
  } else {
    recent = (await readTable<WaMessage>('messages')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const latest = new Map<string, WaMessage>();
  const leadIds = new Map<string, string>();
  for (const message of recent) {
    if (!latest.has(message.wa_id)) latest.set(message.wa_id, message);
    if (message.lead_id && !leadIds.has(message.wa_id)) leadIds.set(message.wa_id, message.lead_id);
  }

  const ids = [...new Set(leadIds.values())];
  let leads: Lead[] = [];
  if (ids.length && mode === 'supabase') {
    for (let i = 0; i < ids.length; i += 150) {
      leads.push(
        ...(await supabase<Lead[]>(
          `leads?id=${encodeURIComponent(inList(ids.slice(i, i + 150)))}&select=id,name,status,do_not_contact,unread_count,last_inbound_at`,
        )),
      );
    }
  } else if (ids.length) {
    const set = new Set(ids);
    leads = (await readTable<Lead>('leads')).filter((lead) => set.has(lead.id));
  }
  const byId = new Map(leads.map((lead) => [lead.id, lead]));

  return [...latest.values()].map((message) => {
    const lead = byId.get(leadIds.get(message.wa_id) || '');
    return {
      wa_id: message.wa_id,
      lead_id: lead?.id ?? null,
      name: lead?.name || `+${message.wa_id}`,
      last_body: message.body,
      last_direction: message.direction,
      last_at: message.created_at,
      last_inbound_at: lead?.last_inbound_at ?? null,
      unread: lead?.unread_count || 0,
      do_not_contact: Boolean(lead?.do_not_contact),
      status: lead?.status ?? null,
    };
  });
}

export async function markConversationRead(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (lead && (lead.unread_count || 0) > 0) await writeLeadChanges(leadId, { unread_count: 0 });
}

export type SendInput = { leadId: string; text?: string; template?: { name: string; language: string; params?: string[] } };

/** Sends a WhatsApp message from the dashboard and records it everywhere. */
export async function sendFromDashboard(input: SendInput): Promise<WaMessage> {
  if (!whatsappConfigured()) throw new LeadError('WhatsApp Cloud API is not configured.', 503);
  if (storageMode() === 'readonly') throw new LeadError('Connect the database before sending.', 503);
  const lead = await getLead(input.leadId);
  if (!lead) throw new LeadError('Lead not found', 404);
  if (lead.do_not_contact) throw new LeadError('This lead opted out (do-not-contact). Messaging is blocked.', 409);
  const to = phoneDigits(lead.phone);
  if (!to) throw new LeadError('This lead has no valid phone number.');

  let body: string;
  let msgType: string;
  let wamid: string;
  if (input.template?.name) {
    const params = (input.template.params || []).map((param) => param.slice(0, 300));
    ({ wamid } = await sendTemplate(to, input.template.name, input.template.language || defaultTemplate().language, params));
    body = `[template: ${input.template.name}]${params.length ? ` ${params.join(' | ')}` : ''}`;
    msgType = 'template';
  } else {
    const text = (input.text || '').trim().slice(0, 4096);
    if (!text) throw new LeadError('Message is empty.');
    if (!waWindowOpen(lead.last_inbound_at)) {
      throw new LeadError(
        'The 24-hour reply window is closed. WhatsApp only allows an approved template until the customer writes again.',
        409,
      );
    }
    ({ wamid } = await sendText(to, text));
    body = text;
    msgType = 'text';
  }

  const now = new Date().toISOString();
  const message = await insertMessage({
    lead_id: lead.id,
    wa_id: to,
    direction: 'out',
    msg_type: msgType,
    body,
    wamid,
    status: 'sent',
    error: '',
    created_at: now,
  });

  const changes: Partial<Lead> = { last_outbound_at: now, last_contacted: todayPKT(), unread_count: 0 };
  const activities: NewActivity[] = [
    { lead_id: lead.id, kind: 'message_out', summary: body.slice(0, 200), meta: { channel: 'whatsapp_api', wamid } },
  ];
  if (!CONTACTED_STATUSES.includes(lead.status)) {
    changes.status = 'contacted';
    activities.push({
      lead_id: lead.id,
      kind: 'status',
      summary: `Status: ${STATUS_LABELS[lead.status]} → ${STATUS_LABELS.contacted}`,
      meta: { from: lead.status, to: 'contacted', auto: true },
    });
  }
  await writeLeadChanges(lead.id, changes);
  await addActivities(activities);

  return message ?? { id: wamid, created_at: now, lead_id: lead.id, wa_id: to, direction: 'out', msg_type: msgType, body, wamid, status: 'sent', error: '' };
}
