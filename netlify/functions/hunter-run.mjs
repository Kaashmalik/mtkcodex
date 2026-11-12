// MTK Hunter hourly run (Netlify Scheduled Function, free plan).
// Each call to the site does one small step (fetch every 6 h, AI score, draft,
// and in auto mode one send), so every request stays inside the time limit.
// Hourly runs spread work and auto-sends across the day; a failed run is
// simply retried next hour. Needs CRON_SECRET in the site's environment.

const BUDGET_MS = 24_000; // scheduled functions get ~30 s in total
const MAX_STEPS = 8;

const hunterRun = async () => {
  const base = (process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!base || !secret) {
    console.error('hunter: URL or CRON_SECRET missing');
    return;
  }

  const started = Date.now();
  const done = [];
  for (let i = 0; i < MAX_STEPS && Date.now() - started < BUDGET_MS; i += 1) {
    try {
      const res = await fetch(`${base}/api/cron/hunter?done=${done.join(',')}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(Math.max(1_000, BUDGET_MS - (Date.now() - started))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error || ''}`);
      console.log(`hunter: ${data.step} — ${data.summary}${data.error ? ` (${data.error})` : ''}`);
      if (!data.step || data.step === 'idle') break;
      done.push(data.step);
    } catch (error) {
      console.error('hunter:', error instanceof Error ? error.message : error);
      break;
    }
  }
};

export default hunterRun;

// Every hour at :07 (off the top of the hour, when shared runners are busiest).
export const config = { schedule: '7 * * * *' };
