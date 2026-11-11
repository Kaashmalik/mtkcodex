import { getState, setState } from '@/lib/app-state';
import { todayPKT } from '@/lib/lead-types';
import type { Opportunity, Proposal } from '@/lib/opportunity-types';

/**
 * MTK Hunter automation: settings you change in the admin, the guard rails
 * for auto-send, and the small run log / source health shown in the UI.
 * Pure helpers first (tested), storage after.
 */

export type HunterMode = 'review' | 'auto';

export type AutomationSettings = {
  /** review: drafts wait for your click. auto: drafts that pass every check are sent. */
  mode: HunterMode;
  /** Kill switch: keeps fetching and scoring, stops drafting and sending. */
  paused: boolean;
  /** AI drafts written per day for your top matches (both modes). */
  draftPerDay: number;
  /** Lowest match score that gets an automatic draft. */
  draftMinScore: number;
  /** Proposal emails sent without review per day (auto mode). */
  autoSendPerDay: number;
  /** Lowest match score that may be sent without review. */
  autoMinScore: number;
};

export const DEFAULT_AUTOMATION: AutomationSettings = {
  mode: 'review',
  paused: false,
  draftPerDay: 8,
  draftMinScore: 70,
  autoSendPerDay: 5,
  autoMinScore: 80,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeAutomation(input: unknown, base: AutomationSettings = DEFAULT_AUTOMATION): AutomationSettings {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    mode: v.mode === 'auto' || v.mode === 'review' ? v.mode : base.mode,
    paused: typeof v.paused === 'boolean' ? v.paused : base.paused,
    draftPerDay: clampInt(v.draftPerDay ?? base.draftPerDay, 0, 30, base.draftPerDay),
    draftMinScore: clampInt(v.draftMinScore ?? base.draftMinScore, 40, 100, base.draftMinScore),
    autoSendPerDay: clampInt(v.autoSendPerDay ?? base.autoSendPerDay, 0, 20, base.autoSendPerDay),
    // Never below 60: unreviewed sends must be genuinely strong fits.
    autoMinScore: clampInt(v.autoMinScore ?? base.autoMinScore, 60, 100, base.autoMinScore),
  };
}

/* ---------------------------------------------------------------------------
 * Guard rails
 * ------------------------------------------------------------------------- */

const PLACEHOLDER = /\[[^\]\n]{2,40}\]|\{\{|<\s*(name|company|your name)\s*>|\bINSERT\b|\bTODO\b|lorem ipsum/i;
const AI_TELLS = /\bas an ai\b|\blanguage model\b|\bI cannot\b|\bI'm unable to\b|\bhere is (a|the|your) (draft|proposal|email)\b/i;

/** Problems that make a draft unfit to send without a human look. */
export function qualityIssues(proposal: Pick<Proposal, 'subject' | 'body'>, opp: Pick<Opportunity, 'company'>): string[] {
  const issues: string[] = [];
  const words = proposal.body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60) issues.push('Draft is too short');
  if (words > 420) issues.push('Draft is too long');
  const subject = proposal.subject.trim();
  if (subject.length < 5 || subject.length > 90) issues.push('Subject length looks off');
  if (PLACEHOLDER.test(proposal.body) || PLACEHOLDER.test(subject)) issues.push('Draft has a placeholder');
  if (AI_TELLS.test(proposal.body)) issues.push('Draft reads like AI boilerplate');
  const company = opp.company.trim();
  const keyword = company
    .replace(/\b(inc|llc|ltd|gmbh|corp|co)\b\.?/gi, '')
    .trim()
    .split(/\s+/)[0];
  if (keyword && keyword.length > 2 && company !== 'Unknown company' && !new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${subject} ${proposal.body}`)) {
    issues.push(`Draft never mentions ${company}`);
  }
  return issues;
}

export type AutoContext = {
  settings: AutomationSettings;
  /** Company slugs and addresses contacted in the last 30 days. */
  recentCompanies: Set<string>;
  recentEmails: Set<string>;
};

/** Why this opportunity can't be sent without review. Empty means it can. */
export function autoSendBlockers(opp: Opportunity, ctx: AutoContext): string[] {
  const reasons: string[] = [];
  const email = opp.apply_email.trim().toLowerCase();
  if (opp.status !== 'drafted' || !opp.proposal || opp.proposal.kind !== 'proposal') reasons.push('No AI draft yet');
  if (opp.score === null) reasons.push('Not AI-scored');
  else if (opp.score < ctx.settings.autoMinScore) reasons.push(`Score ${opp.score} is under ${ctx.settings.autoMinScore}`);
  if (opp.red_flags.length) reasons.push(`Warning: ${opp.red_flags[0]}`);
  if (!opp.location_ok) reasons.push('May exclude your country');
  // Only an address the company published in the post; never a guessed one.
  if (!email) reasons.push('No hiring email in the post');
  if (opp.company_slug && ctx.recentCompanies.has(opp.company_slug)) reasons.push('Contacted this company in the last 30 days');
  if (email && ctx.recentEmails.has(email)) reasons.push('Emailed this address in the last 30 days');
  if (opp.proposal) reasons.push(...qualityIssues(opp.proposal, opp));
  return reasons;
}

/** Companies and addresses already contacted recently, so nobody gets two pitches. */
export function recentContacts(opps: Opportunity[], now = Date.now(), days = 30): { recentCompanies: Set<string>; recentEmails: Set<string> } {
  const since = new Date(now - days * 86_400_000).toISOString();
  const recentCompanies = new Set<string>();
  const recentEmails = new Set<string>();
  for (const opp of opps) {
    if (!opp.sent_at || opp.sent_at < since) continue;
    if (opp.company_slug) recentCompanies.add(opp.company_slug);
    if (opp.sent_to) recentEmails.add(opp.sent_to.toLowerCase());
  }
  return { recentCompanies, recentEmails };
}

/* ---------------------------------------------------------------------------
 * What to do next (one bounded unit of work per call)
 * ------------------------------------------------------------------------- */

export type HunterStep = 'refresh' | 'score' | 'draft' | 'send' | 'idle';

export type StepInputs = {
  now: number;
  lastRefreshAt: string | null;
  refreshEveryHours: number;
  ai: boolean;
  email: boolean;
  unscored: number;
  settings: AutomationSettings;
  draftedToday: number;
  draftCandidates: number;
  autoSentToday: number;
  autoCandidates: number;
  /** Steps already done in this run, so a run never loops on one failing step. */
  done: HunterStep[];
};

export function nextStep(s: StepInputs): HunterStep {
  const stale = !s.lastRefreshAt || s.now - Date.parse(s.lastRefreshAt) > s.refreshEveryHours * 3_600_000;
  if (stale && !s.done.includes('refresh')) return 'refresh';
  if (s.ai && s.unscored > 0 && s.done.filter((d) => d === 'score').length < 3) return 'score';
  if (s.settings.paused || !s.ai) return 'idle';
  if (s.draftedToday < s.settings.draftPerDay && s.draftCandidates > 0 && s.done.filter((d) => d === 'draft').length < 3) return 'draft';
  if (
    s.settings.mode === 'auto' &&
    s.email &&
    s.autoSentToday < s.settings.autoSendPerDay &&
    s.autoCandidates > 0 &&
    // One unreviewed send per run: hourly runs spread sends across the day.
    !s.done.includes('send')
  ) {
    return 'send';
  }
  return 'idle';
}

/* ---------------------------------------------------------------------------
 * Storage: settings, daily counters, run log, source health
 * ------------------------------------------------------------------------- */

const SETTINGS_KEY = 'hunter:settings';
const DAILY_KEY = 'hunter:daily';
const RUNS_KEY = 'hunter:runs';
const HEALTH_KEY = 'hunter:health';
const REFRESH_KEY = 'hunter:last_refresh';

export async function loadAutomation(): Promise<AutomationSettings> {
  return normalizeAutomation(await getState<unknown>(SETTINGS_KEY, null).catch(() => null));
}

export async function saveAutomation(input: unknown): Promise<AutomationSettings> {
  const settings = normalizeAutomation(input, await loadAutomation());
  await setState(SETTINGS_KEY, settings);
  return settings;
}

export type DailyCounters = { date: string; drafted: number; autoSent: number };

export async function loadDaily(): Promise<DailyCounters> {
  const today = todayPKT();
  const stored = await getState<DailyCounters | null>(DAILY_KEY, null).catch(() => null);
  return stored && stored.date === today ? stored : { date: today, drafted: 0, autoSent: 0 };
}

export async function bumpDaily(field: 'drafted' | 'autoSent', by = 1): Promise<DailyCounters> {
  const daily = await loadDaily();
  daily[field] += by;
  await setState(DAILY_KEY, daily);
  return daily;
}

export type RunEntry = { at: string; step: HunterStep; summary: string; error?: string; trigger: 'cron' | 'admin' };

export async function loadRuns(): Promise<RunEntry[]> {
  return (await getState<RunEntry[]>(RUNS_KEY, []).catch(() => [])) || [];
}

export async function logRun(entry: RunEntry): Promise<void> {
  const runs = await loadRuns();
  await setState(RUNS_KEY, [entry, ...runs].slice(0, 30));
}

export type SourceHealth = { ok_at: string | null; error_at: string | null; error: string; last_count: number; fails: number };

export async function loadHealth(): Promise<Record<string, SourceHealth>> {
  return (await getState<Record<string, SourceHealth>>(HEALTH_KEY, {}).catch(() => ({}))) || {};
}

export async function recordHealth(reports: { source: string; fetched: number; error?: string }[]): Promise<void> {
  const health = await loadHealth();
  const now = new Date().toISOString();
  for (const report of reports) {
    const prev = health[report.source] || { ok_at: null, error_at: null, error: '', last_count: 0, fails: 0 };
    health[report.source] = report.error
      ? { ...prev, error_at: now, error: report.error.slice(0, 200), fails: prev.fails + 1 }
      : { ...prev, ok_at: now, error: '', last_count: report.fetched, fails: 0 };
  }
  await setState(HEALTH_KEY, health);
}

export async function lastRefreshAt(): Promise<string | null> {
  return getState<string | null>(REFRESH_KEY, null).catch(() => null);
}

export async function markRefreshed(): Promise<void> {
  await setState(REFRESH_KEY, new Date().toISOString());
}
