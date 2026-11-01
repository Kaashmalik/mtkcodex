import { NextResponse } from 'next/server';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function POST(req: Request) {
  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const field = (k: string, max = 200) => String(data[k] ?? '').trim().slice(0, max);
  const name = field('name');
  const email = field('email');
  const message = field('message', 5000);

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Name, valid email and message are required' }, { status: 422 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Client falls back to mailto when no provider is configured.
    return NextResponse.json({ error: 'Email delivery not configured' }, { status: 501 });
  }

  const rows = ['name', 'email', 'company', 'phone', 'topic', 'budget']
    .map((k) => `<tr><td><b>${k}</b></td><td>${escape(field(k))}</td></tr>`)
    .join('');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MTK Codex Website <onboarding@resend.dev>',
      to: [process.env.CONTACT_TO_EMAIL || 'kaash0542@gmail.com'],
      reply_to: email,
      subject: `New enquiry from ${name}`,
      html: `<table>${rows}</table><p>${escape(message).replace(/\n/g, '<br>')}</p>`,
    }),
  });

  if (!res.ok) return NextResponse.json({ error: 'Delivery failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
