import { NextResponse } from 'next/server';
import { clientIp, rateLimited } from '@/lib/rate-limit';
import { addActivities, createLead, findLeadByEmail, findLeadByPhone, storageMode, updateLead } from '@/lib/leads';
import { normalizePhone } from '@/lib/lead-types';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 5 enquiries per 10 minutes per visitor is plenty for a real person. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

type Enquiry = { name: string; email: string; company: string; phone: string; topic: string; budget: string; message: string };

/** Website enquiries land in the CRM as starred leads so they are never missed. */
async function saveToCrm(enquiry: Enquiry): Promise<boolean> {
  if (storageMode() === 'readonly') return false;
  const summary = `Website enquiry${enquiry.topic ? ` (${enquiry.topic})` : ''}: ${enquiry.message.slice(0, 160)}`;
  const note = [
    `Website enquiry${enquiry.topic ? ` — ${enquiry.topic}` : ''}${enquiry.budget ? ` · budget ${enquiry.budget}` : ''}`,
    enquiry.message,
  ].join('\n');

  const phone = normalizePhone(enquiry.phone);
  const existing = (phone && (await findLeadByPhone(phone))) || (await findLeadByEmail(enquiry.email));
  if (existing) {
    await updateLead(existing.id, { append_note: note.slice(0, 1000), starred: true });
    await addActivities([{ lead_id: existing.id, kind: 'message_in', summary, meta: { channel: 'website' } }]);
    return true;
  }

  const lead = await createLead(
    {
      name: (enquiry.company || enquiry.name).slice(0, 200),
      phone,
      email: enquiry.email,
      notes: `Contact: ${enquiry.name}\n${note}`.slice(0, 4000),
      starred: true,
      tags: ['website'],
      channel: 'email',
      lead_tier: 'A',
    },
    'website',
    'New lead from the website contact form',
  );
  await addActivities([{ lead_id: lead.id, kind: 'message_in', summary, meta: { channel: 'website' } }]);
  return true;
}

export async function POST(req: Request) {
  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const field = (k: string, max = 200) => String(data[k] ?? '').trim().slice(0, max);

  // Honeypot: real visitors never see this field. Pretend success so bots move on.
  if (field('company_website')) return NextResponse.json({ ok: true });

  if (await rateLimited(`contact:${clientIp(req)}`, WINDOW_MS, MAX_PER_WINDOW)) {
    return NextResponse.json({ error: 'Too many messages. Please try again in a few minutes.' }, { status: 429 });
  }

  const enquiry: Enquiry = {
    name: field('name'),
    email: field('email'),
    company: field('company'),
    phone: field('phone', 40),
    topic: field('topic'),
    budget: field('budget'),
    message: field('message', 5000),
  };

  if (!enquiry.name || !enquiry.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email)) {
    return NextResponse.json({ error: 'Name, valid email and message are required' }, { status: 422 });
  }

  let savedToCrm = false;
  try {
    savedToCrm = await saveToCrm(enquiry);
  } catch (error) {
    console.error('contact: could not save enquiry to CRM', error instanceof Error ? error.message : error);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Without email the CRM copy is enough; with neither, the client falls back to mailto.
    return savedToCrm
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Email delivery not configured' }, { status: 501 });
  }

  const rows = (['name', 'email', 'company', 'phone', 'topic', 'budget'] as const)
    .map((k) => `<tr><td><b>${k}</b></td><td>${escape(enquiry[k])}</td></tr>`)
    .join('');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MTK Codex Website <onboarding@resend.dev>',
      to: [process.env.CONTACT_TO_EMAIL || 'kaash0542@gmail.com'],
      reply_to: enquiry.email,
      subject: `New enquiry from ${enquiry.name}`,
      html: `<table>${rows}</table><p>${escape(enquiry.message).replace(/\n/g, '<br>')}</p>`,
    }),
  });

  if (!res.ok && !savedToCrm) return NextResponse.json({ error: 'Delivery failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
