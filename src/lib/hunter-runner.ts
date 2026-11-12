import { resolveMx } from 'node:dns/promises';
import { emailConfigured } from '@/lib/email';
import { writeProposal } from '@/lib/hunter-ai';
import {
  autoSendBlockers,
  bumpDaily,
  lastRefreshAt,
  loadAutomation,
  loadDaily,
  logRun,
  nextStep,
  recentContacts,
  type AutomationSettings,
  type HunterStep,
  type RunEntry,
} from '@/lib/hunter-automation';
import { LeadError } from '@/lib/leads';
import { llmConfigured } from '@/lib/llm';
import { notifyOwner } from '@/lib/notify';
import {
  hunterSettings,
  listOpportunities,
  refreshOpportunities,
  scoreNext,
  sendOpportunity,
  updateOpportunity,
} from '@/lib/opportunities';
import type { Opportunity } from '@/lib/opportunity-types';

/**
 * Runs MTK Hunter one bounded step at a time (fetch, score, draft or send),
 * so every request fits the host's function time limit. The hourly scheduled
 * function and the admin "Run now" button both call `runStep` in a loop.
 */

const REFRESH_EVERY_HOURS = 6;

/** Posts worth an automatic draft: strong, open to you, not yet drafted. Best first, direct emails ahead. */
export function draftQueue(opps: Opportunity[], settings: AutomationSettings): Opportunity[] {
  return opps
    .filter(
      (o) =>
        ['new', 'shortlisted'].includes(o.status) &&
        !o.proposal &&
        o.score !== null &&
        o.score >= settings.draftMinScore &&
        o.location_ok,
    )
    .sort((a, b) => Number(Boolean(b.apply_email)) - Number(Boolean(a.apply_email)) || (b.score ?? 0) - (a.score ?? 0));
}

export function autoQueue(opps: Opportunity[], settings: AutomationSettings, now = Date.now()): Opportunity[] {
  const ctx = { settings, ...recentContacts(opps, now) };
  return opps.filter((o) => autoSendBlockers(o, ctx).length === 0).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

const mxCache = new Map<string, boolean>();

/** Whether the address's domain can receive mail at all (catches typos and dead domains). */
export async function domainReceivesMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain) as boolean;
  const ok = await Promise.race([
    resolveMx(domain).then((records) => records.length > 0),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 4_000)), // DNS slow: don't block on it
  ]).catch(() => false);
  mxCache.set(domain, ok);
  return ok;
}

async function draftOne(opp: Opportunity): Promise<string> {
  const proposal = await writeProposal(opp, { tone: 'warm', length: 'short' });
  await updateOpportunity(opp.id, { proposal, status: 'drafted' });
  const daily = await bumpDaily('drafted');
  if (daily.drafted === 1) {
    await notifyOwner({
      title: 'Hunter: drafts are ready',
      body: `First draft today: ${opp.title} at ${opp.company}. More follow through the day.`,
      url: '/admin/opportunities',
      tag: 'hunter-drafts',
    }).catch(() => undefined);
  }
  return `Drafted ${opp.title} at ${opp.company}`;
}

async function autoSendOne(opp: Opportunity): Promise<string> {
  if (!opp.proposal) throw new Error('No draft');
  if (!(await domainReceivesMail(opp.apply_email))) {
    // Leave it for review and say why, instead of bouncing an email.
    await updateOpportunity(opp.id, { red_flags: [...opp.red_flags, 'Email domain cannot receive mail'] });
    return `Held ${opp.company}: ${opp.apply_email} cannot receive mail`;
  }
  await sendOpportunity({
    id: opp.id,
    via: 'email',
    to: opp.apply_email,
    subject: opp.proposal.subject,
    body: opp.proposal.body,
    cover: opp.proposal.cover,
  });
  await updateOpportunity(opp.id, { notes: `${opp.notes ? `${opp.notes}\n` : ''}Sent automatically (auto mode) ${new Date().toISOString().slice(0, 16)} UTC` });
  const daily = await bumpDaily('autoSent');
  await notifyOwner({
    title: `Hunter sent a proposal · ${opp.company}`,
    body: `${opp.title} (score ${opp.score}). ${daily.autoSent} sent automatically today.`,
    url: '/admin/opportunities',
    tag: 'hunter-sent',
  }).catch(() => undefined);
  return `Sent ${opp.title} to ${opp.apply_email}`;
}

export type StepResult = { step: HunterStep; summary: string; error?: string };

export async function runStep(trigger: RunEntry['trigger'], done: HunterStep[] = []): Promise<StepResult> {
  const [settings, daily, refreshedAt, opps] = await Promise.all([loadAutomation(), loadDaily(), lastRefreshAt(), listOpportunities()]);
  const ai = llmConfigured();
  const { minScore } = hunterSettings();
  const drafts = draftQueue(opps, settings);
  const autos = settings.mode === 'auto' ? autoQueue(opps, settings) : [];

  const step = nextStep({
    now: Date.now(),
    lastRefreshAt: refreshedAt,
    refreshEveryHours: REFRESH_EVERY_HOURS,
    ai,
    email: emailConfigured(),
    unscored: opps.filter((o) => o.status === 'new' && o.score === null && (o.keyword_score >= minScore || o.source === 'manual')).length,
    settings,
    draftedToday: daily.drafted,
    draftCandidates: drafts.length,
    autoSentToday: daily.autoSent,
    autoCandidates: autos.length,
    done,
  });

  let result: StepResult;
  try {
    if (step === 'refresh') {
      const r = await refreshOpportunities();
      const failed = r.sources.filter((s) => s.error).map((s) => s.source);
      result = { step, summary: `${r.inserted} new jobs from ${r.sources.length - failed.length}/${r.sources.length} boards${failed.length ? ` (down: ${failed.join(', ')})` : ''}` };
    } else if (step === 'score') {
      const r = await scoreNext();
      result = { step, summary: `AI scored ${r.scored}, ${r.remaining} waiting` };
    } else if (step === 'draft') {
      result = { step, summary: await draftOne(drafts[0]) };
    } else if (step === 'send') {
      result = { step, summary: await autoSendOne(autos[0]) };
    } else {
      return { step, summary: settings.paused ? 'Paused' : 'Nothing to do' };
    }
  } catch (error) {
    const message = error instanceof LeadError || error instanceof Error ? error.message : String(error);
    result = { step, summary: `${step} failed`, error: message.slice(0, 300) };
  }
  await logRun({ at: new Date().toISOString(), trigger, ...result }).catch(() => undefined);
  return result;
}

/** Review mode's "Send selected": sends each reviewed draft by email, one after another. */
export async function sendSelected(ids: string[]): Promise<{ sent: string[]; failed: { id: string; error: string }[] }> {
  const opps = new Map((await listOpportunities()).map((o) => [o.id, o]));
  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids.slice(0, 25)) {
    const opp = opps.get(id);
    try {
      if (!opp) throw new LeadError('Not found', 404);
      if (!opp.proposal) throw new LeadError('No draft yet');
      const to = opp.sent_to || opp.apply_email;
      if (!to) throw new LeadError('No email: use "Copy & open apply page"');
      if (!(await domainReceivesMail(to))) throw new LeadError(`${to} cannot receive mail`);
      await sendOpportunity({ id, via: 'email', to, subject: opp.proposal.subject, body: opp.proposal.body, cover: opp.proposal.cover });
      sent.push(id);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : 'Failed' });
      // The daily cap stops the whole batch.
      if (error instanceof LeadError && error.status === 429) break;
    }
  }
  return { sent, failed };
}
