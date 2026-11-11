'use client';

import { useState } from 'react';
import { Bot, Pause, Play, ShieldCheck, Zap } from 'lucide-react';
import { timeAgo } from '@/lib/lead-types';
import { SOURCE_LABELS, type OpportunitySource } from '@/lib/opportunity-types';
import type { AutomationSettings, HunterStep, SourceHealth } from '@/lib/hunter-automation';
import { hunterApi, type AutomationSnapshot } from '@/components/admin/client-api';
import { buttonClass, inputClass, primaryButtonClass } from '@/components/admin/ui';

const sourceLabel = (source: string) => SOURCE_LABELS[source as OpportunitySource] || (source === 'watchlist' ? 'Watchlist' : source);

function healthTone(h: SourceHealth): string {
  if (!h.fails) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (h.fails < 3) return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'bg-red-500/10 text-red-500';
}

/** Mode switch, daily numbers, source health and the run log for MTK Hunter. */
export default function HunterAutomation({
  initial,
  ai,
  email,
  readOnly,
  onRan,
  notify,
  fail,
}: {
  initial: AutomationSnapshot;
  ai: boolean;
  email: boolean;
  readOnly: boolean;
  onRan: () => Promise<void>;
  notify: (message: string) => void;
  fail: (error: unknown) => void;
}) {
  const [snap, setSnap] = useState(initial);
  const [form, setForm] = useState(initial.settings);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState('');
  const [showRuns, setShowRuns] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(snap.settings);
  const s = snap.settings;

  async function save(patch: Partial<AutomationSettings> = {}) {
    const next = { ...form, ...patch };
    if (patch.mode === 'auto' && s.mode !== 'auto') {
      const ok = window.confirm(
        `Auto mode sends up to ${next.autoSendPerDay} proposals a day without your review.\n\nOnly drafts that pass every check are sent: score ${next.autoMinScore}+, no warnings, open to your country, a hiring email published in the post, no contact with that company in 30 days, and a clean draft. Everything else waits for you.\n\nTurn on auto mode?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const updated = await hunterApi.saveAutomation(next);
      setSnap(updated);
      setForm(updated.settings);
      notify(updated.settings.paused ? 'Hunter paused' : updated.settings.mode === 'auto' ? 'Auto mode on' : 'Review mode on');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    const done: HunterStep[] = [];
    try {
      for (let i = 0; i < 12; i += 1) {
        setRunning(i ? `Step ${i + 1}…` : 'Starting…');
        const result = await hunterApi.runStep(done);
        if (result.error) notify(`${result.summary}: ${result.error}`);
        if (result.step === 'idle') break;
        setRunning(result.summary);
        done.push(result.step);
      }
      setSnap(await hunterApi.automation());
      await onRan();
      notify(done.length ? `Done: ${done.join(' → ')}` : 'Nothing to do right now');
    } catch (err) {
      fail(err);
    } finally {
      setRunning('');
    }
  }

  const health = Object.entries(snap.health);
  const num = (key: keyof AutomationSettings, min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      className={`${inputClass} h-9 w-20`}
      value={form[key] as number}
      onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
    />
  );

  return (
    <section className="card mt-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            Automation · {s.paused ? 'paused' : s.mode === 'auto' ? 'auto send' : 'review first'}
          </p>
          <p className="text-xs text-fg-muted">
            Runs every hour. Last fetch {snap.lastRefreshAt ? timeAgo(snap.lastRefreshAt) : 'never'} · today {snap.daily.drafted}/{s.draftPerDay} drafted
            {s.mode === 'auto' ? ` · ${snap.daily.autoSent}/${s.autoSendPerDay} auto-sent` : ''} · {snap.queues.draft} waiting for a draft
            {s.mode === 'auto' ? ` · ${snap.queues.auto} cleared to auto-send` : ''}
          </p>
        </div>
        <div className="flex rounded-full border border-line p-1" role="radiogroup" aria-label="Mode">
          {(['review', 'auto'] as const).map((mode) => (
            <button
              key={mode}
              role="radio"
              aria-checked={s.mode === mode}
              disabled={saving || readOnly}
              onClick={() => s.mode !== mode && save({ mode })}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                s.mode === mode ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {mode === 'review' ? <ShieldCheck className="size-3.5" /> : <Zap className="size-3.5" />}
              {mode === 'review' ? 'Review first' : 'Auto send'}
            </button>
          ))}
        </div>
        <button className={buttonClass} onClick={() => save({ paused: !s.paused })} disabled={saving || readOnly}>
          {s.paused ? <Play className="size-4" /> : <Pause className="size-4" />} {s.paused ? 'Resume' : 'Pause'}
        </button>
        <button className={primaryButtonClass} onClick={runNow} disabled={Boolean(running) || readOnly}>
          <Play className={`size-4 ${running ? 'animate-pulse' : ''}`} /> {running || 'Run now'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3 text-xs text-fg-muted">
        <label className="flex items-center gap-2">Drafts / day {num('draftPerDay', 0, 30)}</label>
        <label className="flex items-center gap-2">Draft from score {num('draftMinScore', 40, 100)}</label>
        <label className="flex items-center gap-2">Auto-sends / day {num('autoSendPerDay', 0, 20)}</label>
        <label className="flex items-center gap-2">Auto-send from score {num('autoMinScore', 60, 100)}</label>
        {dirty && (
          <button className={`${primaryButtonClass} h-9`} onClick={() => save()} disabled={saving}>
            Save
          </button>
        )}
      </div>

      {(!ai || !email) && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {!ai ? 'Drafting needs LLM_API_KEY. ' : ''}
          {!email ? 'Auto send needs Resend (RESEND_API_KEY, EMAIL_FROM).' : ''}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Boards</span>
        {health.length ? (
          health.map(([source, h]) => (
            <span
              key={source}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthTone(h)}`}
              title={h.fails ? `Failing ${h.fails}× · ${h.error}` : `OK ${h.ok_at ? timeAgo(h.ok_at) : ''} · ${h.last_count} jobs`}
            >
              {sourceLabel(source)} {h.fails ? '✕' : h.last_count}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-fg-subtle">No fetch yet</span>
        )}
        {snap.runs.length > 0 && (
          <button className="ml-auto text-[11px] font-semibold text-brand" onClick={() => setShowRuns((v) => !v)}>
            {showRuns ? 'Hide run log' : 'Run log'}
          </button>
        )}
      </div>

      {showRuns && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
          {snap.runs.slice(0, 12).map((run, i) => (
            <li key={`${run.at}-${i}`} className="flex gap-2">
              <span className="w-20 shrink-0 text-fg-subtle">{timeAgo(run.at)}</span>
              <span className="w-14 shrink-0 font-semibold">{run.step}</span>
              <span className={`min-w-0 ${run.error ? 'text-red-500' : 'text-fg-muted'}`}>
                {run.summary}
                {run.error ? ` — ${run.error}` : ''}
                {run.trigger === 'admin' ? ' · by you' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
