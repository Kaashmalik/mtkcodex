'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Copy,
  ExternalLink,
  Mail,
  MessageSquareReply,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { timeAgo } from '@/lib/lead-types';
import {
  OPPORTUNITY_STATUS_LABELS,
  SENT_STATUSES,
  SOURCE_LABELS,
  ageDays,
  companySignals,
  effectiveScore,
  scoreTone,
  type CompanySignal,
  type Opportunity,
  type OpportunityStatus,
  type Proposal,
} from '@/lib/opportunity-types';
import { hunterApi, type AutomationSnapshot, type ProposalRequest } from '@/components/admin/client-api';
import HunterAutomation from '@/components/admin/HunterAutomation';
import {
  ErrorBanner,
  Field,
  Modal,
  Notice,
  StatCard,
  Toast,
  buttonClass,
  inputClass,
  primaryButtonClass,
  textareaClass,
  useNotice,
} from '@/components/admin/ui';

export type HunterConfig = {
  readOnly: boolean;
  ai: boolean;
  email: boolean;
  models: { fast: string; writer: string };
  sentToday: number;
  dailyLimit: number;
  minScore: number;
  queries: string[];
  watchlist: string[];
  projects: { slug: string; name: string }[];
};

type Tab = 'ready' | 'matches' | 'followups' | 'sent' | 'replied' | 'closed';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ready', label: 'Ready to send' },
  { id: 'matches', label: 'Matches' },
  { id: 'followups', label: 'Follow-ups due' },
  { id: 'sent', label: 'Sent' },
  { id: 'replied', label: 'Replies' },
  { id: 'closed', label: 'Skipped & lost' },
];

const OPEN: OpportunityStatus[] = ['new', 'shortlisted', 'drafted'];
const REPLIED: OpportunityStatus[] = ['replied', 'interview', 'won'];

/** In the Matches list: still open, and a good enough score (jobs you added by hand always show). */
const isMatch = (o: Opportunity, minScore: number) => OPEN.includes(o.status) && (o.source === 'manual' || effectiveScore(o) >= minScore);

/** A drafted proposal waiting for your review. */
const isReady = (o: Opportunity) => o.status === 'drafted' && Boolean(o.proposal);

/** Can go out with "Send selected": has a draft and an address to send it to. */
const batchSendable = (o: Opportunity) => isReady(o) && Boolean(o.apply_email || o.sent_to);

const followupDue = (o: Opportunity, now: number) => o.status === 'sent' && Boolean(o.followup_at) && Date.parse(o.followup_at as string) <= now;

const shortModel = (model: string) => model.split('/').pop() || model;

/** MTK Hunter: fresh remote jobs scored against your profile, with AI proposals you review and send. */
export default function OpportunityBoard({ initial, automation, config }: { initial: Opportunity[]; automation: AutomationSnapshot; config: HunterConfig }) {
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => (initial.some(isReady) ? 'ready' : 'matches'));
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [openToMe, setOpenToMe] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<'' | 'refresh' | 'score' | 'batch'>('');
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [sentToday, setSentToday] = useState(config.sentToday);
  const { toast, setToast, error, setError, fail } = useNotice();
  const [now] = useState(() => Date.now());

  const signals = useMemo(() => companySignals(items, now), [items, now]);

  const replace = useCallback((updated: Opportunity) => {
    setItems((rows) => (rows.some((r) => r.id === updated.id) ? rows.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...rows]));
  }, []);

  const stats = useMemo(() => {
    const sent = items.filter((o) => SENT_STATUSES.includes(o.status));
    const replies = items.filter((o) => REPLIED.includes(o.status));
    const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
    return {
      best: items.filter((o) => OPEN.includes(o.status) && effectiveScore(o) >= 70).length,
      unscored: items.filter((o) => o.status === 'new' && o.score === null && (o.keyword_score >= config.minScore || o.source === 'manual')).length,
      sentWeek: sent.filter((o) => o.sent_at && o.sent_at >= weekAgo).length,
      replies: replies.length,
      replyRate: sent.length ? Math.round((replies.length / sent.length) * 100) : 0,
      due: items.filter((o) => followupDue(o, now)).length,
    };
  }, [items, now, config.minScore]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((o) => {
        if (tab === 'ready' && !isReady(o)) return false;
        if (tab === 'matches' && !isMatch(o, config.minScore)) return false;
        if (tab === 'followups' && !followupDue(o, now)) return false;
        if (tab === 'sent' && o.status !== 'sent') return false;
        if (tab === 'replied' && !REPLIED.includes(o.status)) return false;
        if (tab === 'closed' && !['skipped', 'lost'].includes(o.status)) return false;
        if (openToMe && tab === 'matches' && !o.location_ok) return false;
        if (source && o.source !== source) return false;
        if (q && !`${o.title} ${o.company} ${o.tags.join(' ')} ${o.matched_skills.join(' ')}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        tab === 'matches' || tab === 'ready'
          ? effectiveScore(b) - effectiveScore(a) || (b.posted_at || '').localeCompare(a.posted_at || '')
          : (b.sent_at || b.updated_at).localeCompare(a.sent_at || a.updated_at),
      )
      .slice(0, 300);
  }, [items, tab, query, source, openToMe, now, config.minScore]);

  const tabCount = (id: Tab) =>
    ({
      ready: items.filter(isReady).length,
      matches: items.filter((o) => isMatch(o, config.minScore) && (!openToMe || o.location_ok)).length,
      followups: stats.due,
      sent: items.filter((o) => o.status === 'sent').length,
      replied: stats.replies,
      closed: items.filter((o) => ['skipped', 'lost'].includes(o.status)).length,
    })[id];

  const toggleChecked = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sendable = visible.filter(batchSendable);
  const selectedIds = sendable.filter((o) => checked.has(o.id)).map((o) => o.id);

  async function sendBatch() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Send ${selectedIds.length} reviewed proposal${selectedIds.length > 1 ? 's' : ''} by email now?`)) return;
    setBusy('batch');
    setError('');
    try {
      const { sent, failed } = await hunterApi.sendBatch(selectedIds);
      setItems(await hunterApi.list());
      setChecked(new Set());
      setSentToday((n) => n + sent.length);
      setToast(`Sent ${sent.length}${failed.length ? ` · ${failed.length} held back` : ''}. Replies land in the Inbox.`);
      if (failed.length) setError(failed.map((f) => `${items.find((o) => o.id === f.id)?.company || f.id}: ${f.error}`).join(' · '));
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  }

  async function refresh() {
    setBusy('refresh');
    setError('');
    try {
      const report = await hunterApi.refresh();
      setItems(await hunterApi.list());
      const failed = report.sources.filter((s) => s.error).map((s) => s.source);
      setToast(`${report.inserted} new jobs · ${report.fresh} fresh checked${failed.length ? ` · ${failed.join(', ')} unavailable` : ''}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  }

  async function score() {
    setBusy('score');
    setError('');
    try {
      let total = 0;
      // A few batches per click; each request stays short for the host's time limit.
      for (let i = 0; i < 4; i += 1) {
        const { scored, remaining } = await hunterApi.score();
        total += scored;
        if (!remaining || !scored) break;
      }
      setItems(await hunterApi.list());
      setToast(total ? `AI scored ${total} jobs` : 'Nothing left to score');
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  }

  async function setStatus(opp: Opportunity, status: OpportunityStatus) {
    try {
      replace(await hunterApi.patch(opp.id, { status }));
      setToast(`${opp.company} → ${OPPORTUNITY_STATUS_LABELS[status]}`);
    } catch (err) {
      fail(err);
    }
  }

  const selected = items.find((o) => o.id === selectedId) || null;
  const sources = [...new Set(items.map((o) => o.source))];

  return (
    <div>
      <p className="eyebrow">MTK Hunter</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Remote jobs &amp; clients</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Fresh posts from job boards, scored against your projects. Review the AI draft, then send in one click.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setAdding(true)} disabled={config.readOnly}>
            <Plus className="size-4" /> Add a job
          </button>
          <button className={buttonClass} onClick={score} disabled={!config.ai || config.readOnly || busy !== ''}>
            <Sparkles className={`size-4 ${busy === 'score' ? 'animate-pulse' : ''}`} />
            {busy === 'score' ? 'Scoring…' : `AI score${stats.unscored ? ` (${stats.unscored})` : ''}`}
          </button>
          <button className={primaryButtonClass} onClick={refresh} disabled={config.readOnly || busy !== ''}>
            <RefreshCw className={`size-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
            {busy === 'refresh' ? 'Fetching…' : 'Fetch fresh jobs'}
          </button>
        </div>
      </div>

      {config.readOnly && <Notice>Connect the database (Supabase) and run migration 0005 to store jobs and proposals.</Notice>}
      {!config.ai && (
        <Notice>
          AI is off. Add <code>LLM_API_KEY</code> (your River key) to score jobs and write proposals. Keyword matching still works.
        </Notice>
      )}
      {!config.email && (
        <Notice tone="sky">
          Email sending is off (<code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code>). You can still copy proposals and apply on company pages.
        </Notice>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Target} label="Strong matches (70+)" value={stats.best} onClick={() => setTab('matches')} active={tab === 'matches'} />
        <StatCard icon={Send} label="Sent this week" value={stats.sentWeek} hint={`${sentToday}/${config.dailyLimit} emails today`} onClick={() => setTab('sent')} active={tab === 'sent'} />
        <StatCard icon={MessageSquareReply} label="Replies" value={stats.replies} hint={`${stats.replyRate}% reply rate`} onClick={() => setTab('replied')} active={tab === 'replied'} />
        <StatCard icon={CalendarClock} label="Follow-ups due" value={stats.due} onClick={() => setTab('followups')} active={tab === 'followups'} />
      </div>

      <HunterAutomation
        initial={automation}
        ai={config.ai}
        email={config.email}
        readOnly={config.readOnly}
        onRan={async () => setItems(await hunterApi.list())}
        notify={setToast}
        fail={fail}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-full border border-line p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {t.label} <span className="opacity-70">{tabCount(t.id)}</span>
            </button>
          ))}
        </div>
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input className={`${inputClass} pl-9`} placeholder="Search title, company, skill" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className={`${inputClass} w-auto`} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        {tab === 'matches' && (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" checked={openToMe} onChange={(e) => setOpenToMe(e.target.checked)} />
            Open to my country
          </label>
        )}
      </div>

      {tab === 'ready' && visible.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-muted/30 px-4 py-3 text-sm">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={sendable.length > 0 && selectedIds.length === sendable.length}
              onChange={(e) => setChecked(e.target.checked ? new Set(sendable.map((o) => o.id)) : new Set())}
              disabled={!sendable.length}
            />
            Select all with an email ({sendable.length})
          </label>
          <span className="text-xs text-fg-subtle">Drafts without an email: open them and use &quot;Copy &amp; open apply page&quot;.</span>
          <button
            className={`${primaryButtonClass} ml-auto`}
            onClick={sendBatch}
            disabled={!selectedIds.length || !config.email || busy !== '' || config.readOnly}
          >
            <Send className="size-4" /> {busy === 'batch' ? 'Sending…' : `Send selected (${selectedIds.length})`}
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {visible.map((opp) => (
          <li key={opp.id} className="flex items-start gap-2">
            {tab === 'ready' && (
              <input
                type="checkbox"
                className="mt-5 shrink-0"
                checked={checked.has(opp.id)}
                onChange={() => toggleChecked(opp.id)}
                disabled={!batchSendable(opp)}
                aria-label={`Select ${opp.title}`}
                title={batchSendable(opp) ? 'Select for batch send' : 'No email: apply on their page'}
              />
            )}
            <div className="min-w-0 flex-1">
              <OpportunityRow opp={opp} signal={signals.get(opp.company_slug)} now={now} onOpen={() => setSelectedId(opp.id)} onSkip={() => setStatus(opp, 'skipped')} />
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <div className="card mt-4 p-8 text-center text-sm text-fg-muted">
          {items.length ? 'Nothing here with these filters.' : 'No jobs yet. Press "Fetch fresh jobs" to pull the latest remote posts.'}
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-fg-subtle">
        Sources: Himalayas, Remote OK, Remotive, Arbeitnow and HN &quot;Who is hiring&quot;{config.watchlist.length ? `, plus ${config.watchlist.join(', ')}` : ''}.
        Listings link back to their source. Searches: {config.queries.join(', ')}. Models: {shortModel(config.models.fast)} (scoring) ·{' '}
        {shortModel(config.models.writer)} (proposals).
      </p>

      {selected && (
        <OpportunityModal
          key={selected.id}
          opp={selected}
          signal={signals.get(selected.company_slug)}
          related={items.filter((o) => o.company_slug === selected.company_slug && o.id !== selected.id && o.status !== 'expired')}
          config={config}
          sentToday={sentToday}
          now={now}
          onClose={() => setSelectedId(null)}
          onChange={replace}
          onSent={(viaEmail) => viaEmail && setSentToday((n) => n + 1)}
          notify={setToast}
          fail={fail}
        />
      )}
      {adding && (
        <AddJobDialog
          onClose={() => setAdding(false)}
          onAdded={(opp) => {
            replace(opp);
            setAdding(false);
            setSelectedId(opp.id);
          }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * List row
 * ------------------------------------------------------------------------- */

function ScoreBadge({ opp }: { opp: Opportunity }) {
  const value = effectiveScore(opp);
  return (
    <span
      className={`grid size-12 shrink-0 place-items-center rounded-xl text-center leading-none ${scoreTone(value)}`}
      title={opp.score === null ? 'Keyword match (not AI-scored yet)' : 'AI match score'}
    >
      <span>
        <span className="block text-lg font-bold">{value}</span>
        <span className="block text-[9px] font-semibold uppercase tracking-wide opacity-80">{opp.score === null ? 'kw' : 'AI'}</span>
      </span>
    </span>
  );
}

function GrowthPill({ signal }: { signal?: CompanySignal }) {
  if (!signal || signal.open < 2) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
      <TrendingUp className="size-3" /> {signal.open} open roles{signal.recent ? ` · ${signal.recent} new` : ''}
    </span>
  );
}

function OpportunityRow({
  opp,
  signal,
  now,
  onOpen,
  onSkip,
}: {
  opp: Opportunity;
  signal?: CompanySignal;
  now: number;
  onOpen: () => void;
  onSkip: () => void;
}) {
  const age = ageDays(opp.posted_at, now);
  return (
    <div className="card flex items-start gap-3 p-3 transition hover:border-brand/50">
      <ScoreBadge opp={opp} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate font-semibold">{opp.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span className="font-semibold text-fg">{opp.company}</span>
          <span>· {SOURCE_LABELS[opp.source]}</span>
          {age !== null && <span>· {age === 0 ? 'today' : `${age}d ago`}</span>}
          <span className="truncate">· {opp.location}</span>
          {opp.salary && <span>· {opp.salary}</span>}
          {opp.apply_email && (
            <span className="inline-flex items-center gap-1 text-brand">
              <Mail className="size-3" /> direct email
            </span>
          )}
          <GrowthPill signal={signal} />
        </p>
        {opp.score_reason && <p className="mt-1 line-clamp-1 text-xs text-fg-subtle">{opp.score_reason}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {opp.status !== 'new' && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">{OPPORTUNITY_STATUS_LABELS[opp.status]}</span>
          )}
          {opp.red_flags.slice(0, 2).map((flag) => (
            <span key={flag} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
              {flag}
            </span>
          ))}
          {opp.matched_skills.slice(0, 5).map((skill) => (
            <span key={skill} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-fg-subtle">
              {skill}
            </span>
          ))}
        </div>
      </button>
      {['new', 'shortlisted'].includes(opp.status) && (
        <button onClick={onSkip} className="rounded-lg p-2 text-fg-subtle hover:text-fg" aria-label={`Skip ${opp.title}`} title="Skip">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Review & send
 * ------------------------------------------------------------------------- */

function OpportunityModal({
  opp,
  signal,
  related,
  config,
  sentToday,
  now,
  onClose,
  onChange,
  onSent,
  notify,
  fail,
}: {
  opp: Opportunity;
  signal?: CompanySignal;
  related: Opportunity[];
  config: HunterConfig;
  sentToday: number;
  now: number;
  onClose: () => void;
  onChange: (opp: Opportunity) => void;
  onSent: (viaEmail: boolean) => void;
  notify: (message: string) => void;
  fail: (error: unknown) => void;
}) {
  const followupMode = SENT_STATUSES.includes(opp.status);
  const [draft, setDraft] = useState<Pick<Proposal, 'subject' | 'body' | 'cover'>>(() =>
    followupMode ? { subject: opp.proposal?.subject ? `Re: ${opp.proposal.subject}` : '', body: '', cover: '' } : {
      subject: opp.proposal?.subject || '',
      body: opp.proposal?.body || '',
      cover: opp.proposal?.cover || '',
    },
  );
  const [to, setTo] = useState(opp.sent_to || opp.apply_email);
  const [request, setRequest] = useState<ProposalRequest>({ tone: 'warm', length: 'short' });
  const [working, setWorking] = useState<'' | 'write' | 'send'>('');
  const [showPost, setShowPost] = useState(false);
  const [dirty, setDirty] = useState(false);

  const applyUrl = opp.apply_url || opp.url;
  const canEmail = config.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const ready = draft.body.trim().length >= 40;

  const edit = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  async function write() {
    setWorking('write');
    try {
      const { proposal, opportunity } = await hunterApi.propose(opp.id, { ...request, kind: followupMode ? 'followup' : 'proposal' });
      setDraft({ subject: followupMode && !/^re:/i.test(proposal.subject) ? `Re: ${opp.proposal?.subject || proposal.subject}` : proposal.subject, body: proposal.body, cover: proposal.cover });
      setDirty(false);
      onChange(opportunity);
      notify(`Draft ready · ${shortModel(proposal.model)}`);
    } catch (err) {
      fail(err);
    } finally {
      setWorking('');
    }
  }

  async function saveDraft() {
    if (!dirty || followupMode) return;
    try {
      onChange(await hunterApi.patch(opp.id, { proposal: draft }));
      setDirty(false);
    } catch (err) {
      fail(err);
    }
  }

  async function sendEmail() {
    setWorking('send');
    try {
      const updated = await hunterApi.send(opp.id, {
        via: 'email',
        to: to.trim(),
        subject: draft.subject,
        body: draft.body,
        cover: draft.cover,
        kind: followupMode ? 'followup' : 'proposal',
      });
      onChange(updated);
      onSent(true);
      notify(followupMode ? `Follow-up sent to ${to}` : `Proposal sent to ${to}. Replies land in the Inbox.`);
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setWorking('');
    }
  }

  async function applyOnPage() {
    // Open first, inside the click, so the browser doesn't block the new tab.
    window.open(applyUrl, '_blank', 'noopener,noreferrer');
    setWorking('send');
    try {
      await navigator.clipboard.writeText(draft.body).catch(() => undefined);
      const updated = await hunterApi.send(opp.id, { via: 'apply_link', subject: draft.subject, body: draft.body, cover: draft.cover });
      onChange(updated);
      onSent(false);
      notify('Proposal copied. Paste it into the application form.');
    } catch (err) {
      fail(err);
    } finally {
      setWorking('');
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} copied`);
    } catch (err) {
      fail(err);
    }
  }

  async function status(next: OpportunityStatus) {
    try {
      onChange(await hunterApi.patch(opp.id, { status: next }));
      notify(OPPORTUNITY_STATUS_LABELS[next]);
      if (['skipped', 'lost'].includes(next)) onClose();
    } catch (err) {
      fail(err);
    }
  }

  const age = ageDays(opp.posted_at, now);

  return (
    <Modal title={opp.title} onClose={onClose} wide>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Job & company */}
        <section className="space-y-4 border-b border-line p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-start gap-3">
            <ScoreBadge opp={opp} />
            <div className="min-w-0">
              <p className="font-semibold">{opp.company}</p>
              <p className="text-xs text-fg-muted">
                {SOURCE_LABELS[opp.source]}
                {age !== null && ` · posted ${age === 0 ? 'today' : `${age} days ago`}`} · {opp.location}
                {opp.salary && ` · ${opp.salary}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {opp.url && (
                  <a href={opp.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    Listing on {SOURCE_LABELS[opp.source]} <ExternalLink className="size-3" />
                  </a>
                )}
                {opp.company_domain && (
                  <a href={`https://${opp.company_domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {opp.company_domain} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {(opp.score_reason || opp.red_flags.length > 0) && (
            <div className="rounded-xl border border-line bg-muted/40 p-3 text-xs leading-relaxed">
              {opp.score_reason && <p>{opp.score_reason}</p>}
              {opp.red_flags.length > 0 && <p className="mt-1 text-amber-700 dark:text-amber-400">⚠ {opp.red_flags.join(' · ')}</p>}
              {opp.matched_projects.length > 0 && (
                <p className="mt-1 text-fg-subtle">
                  Cite: {opp.matched_projects.map((slug) => config.projects.find((p) => p.slug === slug)?.name || slug).join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-line p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
              <Building2 className="size-4" /> Company signals
            </p>
            <p className="mt-1 text-sm">
              {signal ? `${signal.open} open role${signal.open === 1 ? '' : 's'} tracked` : '1 open role tracked'}
              {signal?.recent ? `, ${signal.recent} posted in the last 2 weeks` : ''}
              {signal && signal.sources.length > 1 ? ` across ${signal.sources.length} boards` : ''}.
            </p>
            {related.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                {related.slice(0, 5).map((r) => (
                  <li key={r.id} className="truncate">
                    • {r.title} <span className="text-fg-subtle">({OPPORTUNITY_STATUS_LABELS[r.status]})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <button onClick={() => setShowPost((v) => !v)} className="text-xs font-semibold text-brand">
              {showPost ? 'Hide job post' : 'Read the full job post'}
            </button>
            <div className={`mt-2 whitespace-pre-line text-xs leading-relaxed text-fg-muted ${showPost ? '' : 'line-clamp-6'}`}>{opp.description}</div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {opp.status === 'new' && (
              <button className={buttonClass} onClick={() => status('shortlisted')}>
                Shortlist
              </button>
            )}
            {followupMode ? (
              (['replied', 'interview', 'won', 'lost'] as OpportunityStatus[])
                .filter((s) => s !== opp.status)
                .map((s) => (
                  <button key={s} className={buttonClass} onClick={() => status(s)}>
                    Mark {OPPORTUNITY_STATUS_LABELS[s].toLowerCase()}
                  </button>
                ))
            ) : (
              <button className={buttonClass} onClick={() => status('skipped')}>
                Skip
              </button>
            )}
          </div>
        </section>

        {/* Proposal */}
        <section className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">{followupMode ? 'Follow-up' : 'Proposal'}</h3>
            {followupMode && opp.sent_at && (
              <span className="text-xs text-fg-subtle">
                Sent {timeAgo(opp.sent_at)} via {opp.sent_via === 'email' ? opp.sent_to : 'apply page'}
                {opp.followups ? ` · ${opp.followups} follow-up${opp.followups > 1 ? 's' : ''}` : ''}
              </span>
            )}
          </div>

          {followupMode && opp.proposal && (
            <details className="rounded-xl border border-line p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-fg-muted">What you sent: {opp.proposal.subject}</summary>
              <p className="mt-2 whitespace-pre-line text-fg-muted">{opp.proposal.body}</p>
            </details>
          )}

          {(!followupMode || opp.sent_via === 'email') && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {!followupMode && (
                  <>
                    <select className={inputClass} value={request.tone} onChange={(e) => setRequest((r) => ({ ...r, tone: e.target.value as ProposalRequest['tone'] }))} aria-label="Tone">
                      <option value="warm">Warm</option>
                      <option value="direct">Direct</option>
                      <option value="formal">Formal</option>
                    </select>
                    <select className={inputClass} value={request.length} onChange={(e) => setRequest((r) => ({ ...r, length: e.target.value as ProposalRequest['length'] }))} aria-label="Length">
                      <option value="short">Short (90–140 words)</option>
                      <option value="medium">Medium (150–220 words)</option>
                    </select>
                  </>
                )}
                <input
                  className={`${inputClass} col-span-2`}
                  placeholder="Extra direction (optional), e.g. mention I can start Monday"
                  value={request.instructions || ''}
                  onChange={(e) => setRequest((r) => ({ ...r, instructions: e.target.value }))}
                />
              </div>
              <button className={`${buttonClass} w-full`} onClick={write} disabled={!config.ai || working !== ''}>
                <Sparkles className={`size-4 ${working === 'write' ? 'animate-pulse' : ''}`} />
                {working === 'write' ? 'Writing…' : draft.body ? 'Rewrite with AI' : followupMode ? 'Write follow-up with AI' : 'Write proposal with AI'}
              </button>

              <Field label="Subject">
                <input className={inputClass} value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} onBlur={saveDraft} />
              </Field>
              <Field label="Message" hint="Your signature is added at the end. Edit anything before sending.">
                <textarea className={`${textareaClass} min-h-[16rem]`} value={draft.body} onChange={(e) => edit({ body: e.target.value })} onBlur={saveDraft} />
              </Field>
              {!followupMode && (
                <Field label="Short cover note (for application forms)">
                  <textarea className={`${textareaClass} min-h-[5rem]`} value={draft.cover} onChange={(e) => edit({ cover: e.target.value })} onBlur={saveDraft} />
                </Field>
              )}

              <div className="space-y-2 rounded-xl border border-line bg-muted/30 p-3">
                <Field label="Send to" hint={opp.apply_email ? 'Hiring email found in the post.' : 'No email in the post. Add one, or apply on their page.'}>
                  <input className={inputClass} type="email" placeholder="hiring@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button className={`${primaryButtonClass} flex-1`} onClick={sendEmail} disabled={!canEmail || !ready || working !== '' || config.readOnly}>
                    <Send className="size-4" /> {working === 'send' ? 'Sending…' : followupMode ? 'Send follow-up' : 'Send email'}
                  </button>
                  {!followupMode && applyUrl && (
                    <button className={`${buttonClass} flex-1`} onClick={applyOnPage} disabled={!ready || working !== '' || config.readOnly}>
                      <ExternalLink className="size-4" /> Copy &amp; open apply page
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <button className="inline-flex items-center gap-1 text-fg-muted hover:text-brand" onClick={() => copy(draft.body, 'Message')} disabled={!ready}>
                    <Copy className="size-3" /> Copy message
                  </button>
                  {draft.cover && (
                    <button className="inline-flex items-center gap-1 text-fg-muted hover:text-brand" onClick={() => copy(draft.cover, 'Cover note')}>
                      <Copy className="size-3" /> Copy cover note
                    </button>
                  )}
                  <span className="ml-auto text-fg-subtle">
                    {sentToday}/{config.dailyLimit} emails today
                  </span>
                </div>
              </div>
            </>
          )}
          {followupMode && opp.sent_via !== 'email' && (
            <p className="text-sm text-fg-muted">You applied on their page. Mark the outcome on the left when you hear back.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Add by hand
 * ------------------------------------------------------------------------- */

function AddJobDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (opp: Opportunity) => void }) {
  const [form, setForm] = useState({ title: '', company: '', url: '', apply_email: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      onAdded(await hunterApi.add(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a job" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5">
        <p className="text-xs text-fg-muted">
          For posts from Upwork, LinkedIn, referrals or anywhere else. Paste the post, get a match score and a tailored proposal, then submit on that site
          yourself.
        </p>
        <Field label="Job title">
          <input className={inputClass} value={form.title} onChange={set('title')} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company / client">
            <input className={inputClass} value={form.company} onChange={set('company')} />
          </Field>
          <Field label="Hiring email (optional)">
            <input className={inputClass} type="email" value={form.apply_email} onChange={set('apply_email')} />
          </Field>
        </div>
        <Field label="Link (optional)">
          <input className={inputClass} type="url" placeholder="https://" value={form.url} onChange={set('url')} />
        </Field>
        <Field label="Job description">
          <textarea className={`${textareaClass} min-h-[10rem]`} value={form.description} onChange={set('description')} required />
        </Field>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryButtonClass} disabled={saving}>
            <Plus className="size-4" /> {saving ? 'Adding…' : 'Add job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
