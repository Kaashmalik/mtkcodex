'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import {
  LEAD_STATUSES,
  STATUS_LABELS,
  WA_SESSION_MS,
  customerActive,
  statusTone,
  timeAgo,
  waWindowOpen,
  type Conversation,
  type Lead,
  type LeadStatus,
  type WaMessage,
} from '@/lib/lead-types';
import { inboxApi, leadsApi } from '@/components/admin/client-api';
import { ErrorBanner, Toast, inputClass, usePolling, useNotice } from '@/components/admin/ui';

const DEFAULT_REPLIES = [
  'Thank you for your reply! Would a quick 10-minute call this week work for you?',
  'Great — could you share what you would like the website/system to do? I will send a fixed quote.',
  'Here is our work: https://mtkcodex.tech/products — happy to walk you through any of it.',
  'No problem at all. I will not message again. Wishing you a great week!',
];
const REPLIES_KEY = 'mtk-inbox-quick-replies-v1';

function loadReplies(): string[] {
  try {
    const raw = window.localStorage.getItem(REPLIES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? parsed : DEFAULT_REPLIES;
  } catch {
    return DEFAULT_REPLIES;
  }
}

function saveReplies(replies: string[]) {
  try {
    window.localStorage.setItem(REPLIES_KEY, JSON.stringify(replies));
  } catch {
    // Private mode: quick replies just won't persist.
  }
}

export default function Inbox({
  configured,
  initialConversations,
  defaultTemplate,
}: {
  configured: boolean;
  initialConversations: Conversation[];
  defaultTemplate: { name: string; language: string };
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [template, setTemplate] = useState({ name: defaultTemplate.name, language: defaultTemplate.language, params: '' });
  const [sending, setSending] = useState(false);
  const [replies, setReplies] = useState<string[]>(DEFAULT_REPLIES);
  const [now, setNow] = useState(() => Date.now());
  const { toast, setToast, error, setError, fail } = useNotice();
  const bottomRef = useRef<HTMLDivElement>(null);
  const unreadRef = useRef(initialConversations.reduce((sum, c) => sum + c.unread, 0));

  useEffect(() => setReplies(loadReplies()), []);

  // Deep link: /admin/inbox?wa=923001234567 opens (or starts) that chat.
  useEffect(() => {
    const wa = new URLSearchParams(window.location.search).get('wa');
    if (wa) setActive(wa.replace(/\D/g, ''));
  }, []);

  // Keep relative times and the 24h window countdown fresh.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Inbox · MTK Codex` : 'Inbox · MTK Codex';
  }, [totalUnread]);

  const refreshList = useCallback(async () => {
    try {
      const data = await inboxApi.conversations();
      setConversations(data.conversations);
      const unread = data.conversations.reduce((sum, c) => sum + c.unread, 0);
      if (unread > unreadRef.current && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        const newest = data.conversations.find((c) => c.unread > 0 && c.last_direction === 'in');
        new Notification('New WhatsApp reply', { body: newest ? `${newest.name}: ${newest.last_body.slice(0, 80)}` : 'Open the inbox' });
      }
      unreadRef.current = unread;
    } catch {
      // Transient; the next poll retries.
    }
  }, []);

  const loadThread = useCallback(
    async (waId: string, quiet = false) => {
      if (!quiet) setLoadingThread(true);
      try {
        const data = await inboxApi.thread(waId);
        setMessages(data.messages);
        setLead(data.lead);
        setConversations((list) => list.map((c) => (c.wa_id === waId ? { ...c, unread: 0 } : c)));
      } catch (err) {
        if (!quiet) fail(err);
      } finally {
        if (!quiet) setLoadingThread(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    if (!active) return;
    setMessages([]);
    setLead(null);
    setText('');
    void loadThread(active);
  }, [active, loadThread]);

  usePolling(refreshList, 8_000, configured);
  const pollThread = useCallback(() => {
    if (active) void loadThread(active, true);
  }, [active, loadThread]);
  usePolling(pollThread, 4_000, configured && Boolean(active));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, active]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations
      .filter((c) => (filter === 'unread' ? c.unread > 0 : true))
      .filter((c) => !needle || `${c.name} ${c.wa_id} ${c.last_body}`.toLowerCase().includes(needle))
      .sort((a, b) => b.last_at.localeCompare(a.last_at));
  }, [conversations, filter, query]);

  const windowOpen = waWindowOpen(lead?.last_inbound_at, now);
  const windowLeft = lead?.last_inbound_at ? WA_SESSION_MS - (now - new Date(lead.last_inbound_at).getTime()) : 0;
  const blocked = Boolean(lead?.do_not_contact);

  async function send(body: { text?: string; template?: { name: string; language: string; params?: string[] } }) {
    if (!lead) return;
    setSending(true);
    setError('');
    try {
      const message = await inboxApi.send(lead.id, body);
      setMessages((list) => [...list, message]);
      setText('');
      setToast(body.template ? 'Template sent' : 'Sent');
      void refreshList();
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(status: LeadStatus) {
    if (!lead) return;
    try {
      setLead(await leadsApi.patch(lead.id, { status }));
      setToast(`Status → ${STATUS_LABELS[status]}`);
    } catch (err) {
      fail(err);
    }
  }

  if (!configured) return <SetupGuide />;

  const activeConversation = conversations.find((c) => c.wa_id === active);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">WhatsApp</p>
          <h1 className="mt-2 text-3xl font-bold">Inbox</h1>
          <p className="mt-1 text-sm text-fg-muted">Replies to your outreach arrive here live. Answer from the dashboard.</p>
        </div>
        {'Notification' in globalThis && (
          <button
            type="button"
            onClick={async () => {
              const result = await Notification.requestPermission();
              setToast(result === 'granted' ? 'Desktop alerts on' : 'Alerts blocked in this browser');
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-fg-muted hover:border-brand hover:text-brand"
          >
            <Bell className="size-3.5" /> Desktop alerts
          </button>
        )}
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="mt-4 grid h-[calc(100dvh-14rem)] min-h-[520px] overflow-hidden rounded-2xl border border-line bg-elevated md:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <aside className={`flex min-h-0 flex-col border-r border-line ${active ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-2 border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="h-9 w-full rounded-full border border-line bg-bg pl-9 pr-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-1 text-xs">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-1 font-semibold ${filter === value ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg'}`}
                >
                  {value === 'all' ? `All (${conversations.length})` : `Unread (${totalUnread})`}
                </button>
              ))}
              <button onClick={refreshList} className="ml-auto text-fg-subtle hover:text-brand" aria-label="Refresh chats">
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((c) => (
              <li key={c.wa_id}>
                <button
                  onClick={() => setActive(c.wa_id)}
                  className={`flex w-full gap-3 border-b border-line/60 px-3 py-3 text-left transition hover:bg-muted/50 ${active === c.wa_id ? 'bg-brand-soft/50' : ''}`}
                >
                  <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-fg-muted">
                    {c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '#'}
                    {customerActive(c.last_inbound_at, now) && (
                      <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-elevated bg-emerald-500" title="Active now" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? 'font-bold' : 'font-semibold'}`}>{c.name}</span>
                      <span className="shrink-0 text-[10px] text-fg-subtle">{timeAgo(c.last_at, now)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.unread ? 'text-fg' : 'text-fg-subtle'}`}>
                        {c.last_direction === 'out' && 'You: '}
                        {c.last_body}
                      </span>
                      {c.unread > 0 && <span className="shrink-0 rounded-full bg-cta px-1.5 text-[10px] font-bold text-on-cta">{c.unread}</span>}
                      {c.do_not_contact && <Ban className="size-3 shrink-0 text-red-500" aria-label="Opted out" />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!visible.length && (
              <li className="p-6 text-center text-sm text-fg-muted">
                {conversations.length ? 'No chats match.' : 'No WhatsApp messages yet. Replies to your outreach will show up here.'}
              </li>
            )}
          </ul>
        </aside>

        {/* Thread */}
        <section className={`min-h-0 flex-col ${active ? 'flex' : 'hidden md:flex'}`}>
          {!active ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-fg-muted">
              <div>
                <MessageCircle className="mx-auto size-10 text-fg-subtle" />
                <p className="mt-2">Pick a chat to read and reply.</p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <button onClick={() => setActive(null)} className="md:hidden" aria-label="Back to chats">
                  <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{lead?.name || activeConversation?.name || `+${active}`}</p>
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                    <span className="font-mono">+{active}</span>
                    {customerActive(lead?.last_inbound_at, now) ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Active now
                      </span>
                    ) : lead?.last_inbound_at ? (
                      <span>Last message {timeAgo(lead.last_inbound_at, now)}</span>
                    ) : null}
                    {windowOpen ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Clock className="size-3" /> Reply window: {Math.max(1, Math.floor(windowLeft / 3_600_000))}h left
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Clock className="size-3" /> Window closed — template only
                      </span>
                    )}
                  </p>
                </div>
                {lead && (
                  <>
                    <select
                      aria-label="Lead status"
                      value={lead.status}
                      onChange={(e) => changeStatus(e.target.value as LeadStatus)}
                      className={`h-8 rounded-full border px-2.5 text-[11px] font-semibold ${statusTone(lead.status)}`}
                    >
                      {LEAD_STATUSES.map((value) => (
                        <option key={value} value={value} disabled={value === 'queued' && lead.do_not_contact} className="bg-elevated text-fg">
                          {STATUS_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <a
                      href={`/admin?lead=${encodeURIComponent(lead.id)}`}
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold text-fg-muted hover:border-brand hover:text-brand"
                    >
                      <ExternalLink className="size-3" /> Lead
                    </a>
                  </>
                )}
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 px-4 py-4">
                {loadingThread && <p className="text-center text-xs text-fg-subtle">Loading…</p>}
                {!loadingThread && !messages.length && (
                  <p className="mx-auto max-w-sm text-center text-xs text-fg-subtle">
                    No messages in this chat yet. Start it with an approved template below.
                  </p>
                )}
                {messages.map((m, index) => {
                  const showDay =
                    index === 0 || new Date(messages[index - 1].created_at).toDateString() !== new Date(m.created_at).toDateString();
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <p className="my-3 text-center text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                          {new Date(m.created_at).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      )}
                      <div className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                            m.direction === 'out' ? 'rounded-br-sm bg-[#d9fdd3] text-[#0b2a18] dark:bg-[#11503a] dark:text-white' : 'rounded-bl-sm bg-elevated'
                          }`}
                        >
                          {m.body}
                          <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60">
                            {new Date(m.created_at).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' })}
                            {m.direction === 'out' && <DeliveryTick status={m.status} />}
                          </span>
                          {m.status === 'failed' && <span className="block text-[10px] text-red-500">Failed: {m.error || 'not delivered'}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <footer className="border-t border-line p-3">
                {blocked ? (
                  <p className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-500">
                    <Ban className="size-4" /> This contact opted out. Messaging is blocked.
                  </p>
                ) : !lead ? (
                  <p className="text-xs text-fg-subtle">No CRM lead for this number yet.</p>
                ) : windowOpen ? (
                  <>
                    <QuickReplies replies={replies} onPick={setText} onChange={(next) => {
                        setReplies(next);
                        saveReplies(next);
                      }} current={text} />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (text.trim()) void send({ text });
                      }}
                      className="flex items-end gap-2"
                    >
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (text.trim()) void send({ text });
                          }
                        }}
                        rows={2}
                        placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
                        aria-label="Reply"
                        className="min-h-11 flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                      <button
                        type="submit"
                        disabled={sending || !text.trim()}
                        className="grid size-11 shrink-0 place-items-center rounded-full bg-[#25d366] text-white transition hover:brightness-105 disabled:opacity-50"
                        aria-label="Send"
                      >
                        {sending ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </button>
                    </form>
                  </>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const params = template.params.split('|').map((p) => p.trim()).filter(Boolean);
                      void send({ template: { name: template.name, language: template.language, params } });
                    }}
                    className="space-y-2"
                  >
                    <p className="flex items-start gap-1.5 text-[11px] text-fg-subtle">
                      <FileText className="mt-0.5 size-3 shrink-0" />
                      WhatsApp only allows a pre-approved template until the customer writes back. Their reply reopens free text for 24h.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_90px_1fr_auto]">
                      <input
                        value={template.name}
                        onChange={(e) => setTemplate({ ...template, name: e.target.value })}
                        placeholder="template_name"
                        aria-label="Template name"
                        className={inputClass}
                        required
                      />
                      <input
                        value={template.language}
                        onChange={(e) => setTemplate({ ...template, language: e.target.value })}
                        placeholder="en"
                        aria-label="Template language"
                        className={inputClass}
                        required
                      />
                      <input
                        value={template.params}
                        onChange={(e) => setTemplate({ ...template, params: e.target.value })}
                        placeholder="Variables, split with |"
                        aria-label="Template variables"
                        className={inputClass}
                      />
                      <button
                        type="submit"
                        disabled={sending || !template.name.trim()}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#25d366] px-4 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {sending ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />} Send template
                      </button>
                    </div>
                  </form>
                )}
              </footer>
            </>
          )}
        </section>
      </div>
      <Toast message={toast} />
    </div>
  );
}

function DeliveryTick({ status }: { status: WaMessage['status'] }) {
  if (status === 'read') return <CheckCheck className="size-3 text-sky-500" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck className="size-3" aria-label="Delivered" />;
  if (status === 'failed') return <X className="size-3 text-red-500" aria-label="Failed" />;
  return <Check className="size-3" aria-label="Sent" />;
}

function QuickReplies({
  replies,
  current,
  onPick,
  onChange,
}: {
  replies: string[];
  current: string;
  onPick: (text: string) => void;
  onChange: (replies: string[]) => void;
}) {
  return (
    <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
      {replies.map((reply, index) => (
        <span key={index} className="group inline-flex shrink-0 items-center rounded-full border border-line bg-bg text-[11px]">
          <button type="button" onClick={() => onPick(reply)} className="max-w-[220px] truncate px-2.5 py-1 text-fg-muted hover:text-brand" title={reply}>
            {reply}
          </button>
          <button
            type="button"
            onClick={() => onChange(replies.filter((_, i) => i !== index))}
            className="pr-2 text-fg-subtle opacity-0 hover:text-red-500 group-hover:opacity-100"
            aria-label="Remove quick reply"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {current.trim() && !replies.includes(current.trim()) && (
        <button
          type="button"
          onClick={() => onChange([...replies, current.trim()])}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] font-semibold text-brand"
        >
          <Plus className="size-3" /> Save as quick reply
        </button>
      )}
    </div>
  );
}

function SetupGuide() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">WhatsApp</p>
      <h1 className="mt-2 text-3xl font-bold">Connect the WhatsApp inbox</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        Two-way chat from the dashboard uses Meta&apos;s official <strong>WhatsApp Business Cloud API</strong>. Until it is
        connected, keep using the Outreach desk (wa.me links from your own phone) — nothing else changes.
      </p>
      <ol className="card mt-6 list-decimal space-y-3 p-6 pl-10 text-sm leading-relaxed">
        <li>
          In <a className="font-semibold text-brand" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers</a>, create a Business app and add the <em>WhatsApp</em> product.
        </li>
        <li>
          Register a phone number for the API. It must <strong>not</strong> be active in the WhatsApp phone app (use a second
          SIM or migrate the number).
        </li>
        <li>
          Create a <em>System User</em> in Business Settings with a permanent token (scopes <code>whatsapp_business_messaging</code>,{' '}
          <code>whatsapp_business_management</code>).
        </li>
        <li>
          Add to Vercel env: <code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_APP_SECRET</code>,{' '}
          <code>WHATSAPP_VERIFY_TOKEN</code> (any random string), optionally <code>WHATSAPP_TEMPLATE_NAME</code> /{' '}
          <code>WHATSAPP_TEMPLATE_LANG</code>. Redeploy.
        </li>
        <li>
          In the app&apos;s WhatsApp → Configuration, set the webhook URL to <code>https://mtkcodex.tech/api/whatsapp/webhook</code>,
          the same verify token, and subscribe to the <code>messages</code> field.
        </li>
        <li>Run <code>supabase/migrations/0004_crm_v2.sql</code> if you have not already.</li>
      </ol>
      <p className="mt-4 text-xs text-fg-subtle">Full guide: docs/CRM.md → “WhatsApp inbox”.</p>
    </div>
  );
}
