import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTOMATION,
  autoSendBlockers,
  nextStep,
  normalizeAutomation,
  qualityIssues,
  recentContacts,
  type StepInputs,
} from '@/lib/hunter-automation';
import { autoQueue, draftQueue } from '@/lib/hunter-runner';
import { toOpportunity } from '@/lib/opportunities';
import { parseRssItems, retryable } from '@/lib/opportunity-sources';
import type { Opportunity } from '@/lib/opportunity-types';

const goodBody =
  'Acme is rebuilding its onboarding on Next.js, and I have shipped exactly that. ' +
  'At MTK Dairy I built a multi-tenant Next.js and Supabase platform that tracks thousands of records a day, ' +
  'with role-based access, offline-friendly forms and Stripe billing. For Acme I would start by profiling the ' +
  'current signup funnel, then move the slowest steps to server components so the first screen loads fast. ' +
  'Happy to walk you through the code on a short call this week.';

function drafted(over: Partial<Opportunity> = {}): Opportunity {
  const base = toOpportunity({
    source: 'hn',
    external_id: over.id || 'x',
    title: 'Senior Next.js Engineer',
    company: 'Acme',
    url: 'https://news.ycombinator.com/item?id=1',
    apply_email: 'jobs@acme.io',
    description: 'Remote. Next.js, React, TypeScript, Supabase.',
    posted_at: new Date().toISOString(),
  });
  return {
    ...base,
    status: 'drafted',
    score: 88,
    proposal: { kind: 'proposal', subject: 'Next.js onboarding for Acme', body: goodBody, cover: '', model: 'm', created_at: new Date().toISOString() },
    ...over,
  };
}

const ctx = (opps: Opportunity[] = []) => ({ settings: { ...DEFAULT_AUTOMATION, mode: 'auto' as const }, ...recentContacts(opps) });

describe('automation settings', () => {
  it('clamps numbers and keeps unreviewed sends at score 60 or more', () => {
    const s = normalizeAutomation({ mode: 'auto', draftPerDay: 500, autoMinScore: 10, autoSendPerDay: -3, paused: 'yes' });
    expect(s).toMatchObject({ mode: 'auto', draftPerDay: 30, autoMinScore: 60, autoSendPerDay: 0, paused: false });
    expect(normalizeAutomation(null)).toEqual(DEFAULT_AUTOMATION);
    expect(normalizeAutomation({ mode: 'yolo' }).mode).toBe('review');
  });
});

describe('draft quality', () => {
  it('passes a specific draft and catches placeholders, AI tells and missing company', () => {
    expect(qualityIssues({ subject: 'Next.js onboarding for Acme', body: goodBody }, { company: 'Acme Inc' })).toEqual([]);
    expect(qualityIssues({ subject: 'Hi', body: `${goodBody} Regards, [Your Name]` }, { company: 'Acme' })).toEqual(
      expect.arrayContaining(['Draft has a placeholder', 'Subject length looks off']),
    );
    expect(qualityIssues({ subject: 'Application', body: `As an AI language model, ${goodBody}` }, { company: 'Acme' })).toContain(
      'Draft reads like AI boilerplate',
    );
    expect(qualityIssues({ subject: 'Next.js role', body: goodBody.replace(/Acme/g, 'your team') }, { company: 'Acme' })).toContain(
      'Draft never mentions Acme',
    );
  });
});

describe('auto-send guard rails', () => {
  it('clears a strong, clean draft with a published email', () => {
    expect(autoSendBlockers(drafted(), ctx())).toEqual([]);
  });

  it('holds anything risky for review', () => {
    expect(autoSendBlockers(drafted({ score: 70 }), ctx())).toContain('Score 70 is under 80');
    expect(autoSendBlockers(drafted({ apply_email: '' }), ctx())).toContain('No hiring email in the post');
    expect(autoSendBlockers(drafted({ location_ok: false }), ctx())).toContain('May exclude your country');
    expect(autoSendBlockers(drafted({ red_flags: ['Unpaid test task'] }), ctx())[0]).toBe('Warning: Unpaid test task');
    expect(autoSendBlockers(drafted({ status: 'new', proposal: null }), ctx())).toContain('No AI draft yet');
  });

  it('never pitches the same company or address twice in 30 days', () => {
    const earlier = drafted({ id: 'old', status: 'sent', sent_at: new Date().toISOString(), sent_to: 'cto@acme.io' });
    const blockers = autoSendBlockers(drafted({ id: 'new', apply_email: 'cto@acme.io' }), ctx([earlier]));
    expect(blockers).toEqual(expect.arrayContaining(['Contacted this company in the last 30 days', 'Emailed this address in the last 30 days']));
    const old = drafted({ id: 'old', status: 'sent', sent_at: '2020-01-01T00:00:00Z', sent_to: 'cto@acme.io' });
    expect(autoSendBlockers(drafted({ id: 'new' }), ctx([old]))).toEqual([]);
  });

  it('queues drafts best-first with direct emails ahead, and auto-sends only cleared drafts', () => {
    const s = { ...DEFAULT_AUTOMATION, mode: 'auto' as const };
    const a = { ...drafted({ id: 'a' }), status: 'new' as const, proposal: null, score: 90, apply_email: '' };
    const b = { ...drafted({ id: 'b' }), status: 'new' as const, proposal: null, score: 75 };
    const low = { ...drafted({ id: 'c' }), status: 'new' as const, proposal: null, score: 50 };
    expect(draftQueue([a, b, low], s).map((o) => o.id)).toEqual(['b', 'a']);
    expect(autoQueue([drafted({ id: 'ok' }), drafted({ id: 'weak', score: 61 })], s).map((o) => o.id)).toEqual(['ok']);
  });
});

describe('step order', () => {
  const base: StepInputs = {
    now: Date.parse('2026-11-11T10:00:00Z'),
    lastRefreshAt: '2026-11-11T09:00:00Z',
    refreshEveryHours: 6,
    ai: true,
    email: true,
    unscored: 0,
    settings: { ...DEFAULT_AUTOMATION, mode: 'auto' },
    draftedToday: 0,
    draftCandidates: 0,
    autoSentToday: 0,
    autoCandidates: 0,
    done: [],
  };

  it('fetches when stale, then scores, drafts and sends', () => {
    expect(nextStep({ ...base, lastRefreshAt: null })).toBe('refresh');
    expect(nextStep({ ...base, lastRefreshAt: null, done: ['refresh'] })).toBe('idle');
    expect(nextStep({ ...base, unscored: 4 })).toBe('score');
    expect(nextStep({ ...base, draftCandidates: 2 })).toBe('draft');
    expect(nextStep({ ...base, autoCandidates: 1 })).toBe('send');
  });

  it('respects caps, pause, review mode and one send per run', () => {
    expect(nextStep({ ...base, draftCandidates: 2, draftedToday: 8 })).toBe('idle');
    expect(nextStep({ ...base, autoCandidates: 1, autoSentToday: 5 })).toBe('idle');
    expect(nextStep({ ...base, autoCandidates: 1, done: ['send'] })).toBe('idle');
    expect(nextStep({ ...base, autoCandidates: 1, settings: { ...base.settings, mode: 'review' } })).toBe('idle');
    expect(nextStep({ ...base, draftCandidates: 2, settings: { ...base.settings, paused: true } })).toBe('idle');
    expect(nextStep({ ...base, unscored: 3, done: ['score', 'score', 'score'] })).toBe('idle');
    expect(nextStep({ ...base, autoCandidates: 1, email: false })).toBe('idle');
  });
});

describe('sources plumbing', () => {
  it('reads RSS items with CDATA', () => {
    const xml =
      '<rss><channel><item><title><![CDATA[Acme: Senior React Developer]]></title><link>https://weworkremotely.com/remote-jobs/acme-1</link>' +
      '<region>Anywhere in the World</region><pubDate>Tue, 10 Nov 2026 10:00:00 +0000</pubDate></item></channel></rss>';
    expect(parseRssItems(xml)).toEqual([
      {
        title: 'Acme: Senior React Developer',
        link: 'https://weworkremotely.com/remote-jobs/acme-1',
        region: 'Anywhere in the World',
        pubdate: 'Tue, 10 Nov 2026 10:00:00 +0000',
      },
    ]);
  });

  it('retries network errors but not ordinary 4xx answers', () => {
    expect(retryable(new TypeError('fetch failed'))).toBe(true);
  });
});
