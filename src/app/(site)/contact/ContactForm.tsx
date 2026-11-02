'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { services } from '@/data/services';
import { products } from '@/data/products';
import { site } from '@/data/site';

const intents: Record<string, string> = {
  demo: 'Book a product demo',
  quote: 'Get a quote for a custom project',
  call: 'Book a call with the founder',
};

const inputCls =
  'w-full rounded-xl border border-line bg-bg px-4 py-3 text-sm outline-none transition placeholder:text-fg-subtle focus:border-brand focus:ring-4 focus:ring-brand/15';

export default function ContactForm() {
  const params = useSearchParams();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const presetService = params.get('service') ?? '';
  const presetProduct = params.get('product') ?? '';
  const presetIntent = params.get('intent') ?? '';
  const defaultTopic = presetProduct ? `product:${presetProduct}` : presetService ? `service:${presetService}` : presetIntent === 'demo' ? 'demo' : '';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (data.company_website) return; // honeypot (also checked on the server)
    setState('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setState('sent');
        form.reset();
        return;
      }
      if (res.status === 501) {
        // No email provider configured: hand off to the visitor's mail client.
        const body = `Name: ${data.name}\nEmail: ${data.email}\nCompany: ${data.company || '-'}\nTopic: ${data.topic || '-'}\nBudget: ${data.budget || '-'}\n\n${data.message}`;
        window.location.href = `mailto:${site.email}?subject=${encodeURIComponent(`New enquiry from ${data.name}`)}&body=${encodeURIComponent(body)}`;
        setState('sent');
        return;
      }
      setState('error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="card flex flex-col items-center p-10 text-center">
        <CheckCircle2 className="size-14 text-accent" />
        <h2 className="mt-4 text-2xl font-bold">Thank you — we&apos;ve got it.</h2>
        <p className="mt-2 max-w-sm text-fg-muted">We&apos;ll get back to you within 12 hours with next steps.</p>
        <button type="button" onClick={() => setState('idle')} className="mt-6 text-sm font-semibold text-brand">
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-5 p-6 sm:p-8">
      {intents[presetIntent] && (
        <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm font-medium text-brand">{intents[presetIntent]}</p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Full name *</span>
          <input name="name" required autoComplete="name" className={inputCls} placeholder="Your name" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Work email *</span>
          <input name="email" type="email" required autoComplete="email" className={inputCls} placeholder="you@company.com" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Company</span>
          <input name="company" autoComplete="organization" className={inputCls} placeholder="Company name" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Phone / WhatsApp</span>
          <input name="phone" type="tel" autoComplete="tel" className={inputCls} placeholder="+92 ..." />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">What can we help with?</span>
        <select name="topic" defaultValue={defaultTopic} className={inputCls}>
          <option value="">Choose a topic</option>
          <option value="demo">Product demo</option>
          <optgroup label="Services">
            {services.map((s) => (
              <option key={s.id} value={`service:${s.id}`}>
                {s.title}
              </option>
            ))}
          </optgroup>
          <optgroup label="Products">
            {products.map((p) => (
              <option key={p.slug} value={`product:${p.slug}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Estimated budget</span>
        <select name="budget" defaultValue="" className={inputCls}>
          <option value="">Not sure yet</option>
          <option>Under $1,000</option>
          <option>$1,000 – $5,000</option>
          <option>$5,000 – $15,000</option>
          <option>$15,000+</option>
          <option>Monthly subscription</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Project details *</span>
        <textarea name="message" required rows={5} className={inputCls} placeholder="Tell us about your goals, current system and timeline…" />
      </label>
      <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state === 'error' && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          Something went wrong. Please email us directly at {site.email}.
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cta font-semibold text-on-cta transition hover:bg-cta-hover disabled:opacity-70"
      >
        {state === 'sending' ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-4" />}
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </button>
      <p className="text-center text-xs text-fg-subtle">We reply within 12 hours. Your details are never shared.</p>
    </form>
  );
}
