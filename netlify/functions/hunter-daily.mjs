// MTK Hunter daily run (Netlify Scheduled Function, free plan).
// Fetches fresh jobs, then AI-scores them in small batches. Each step is its own
// request to the site so every call stays inside the function time limit.
// Needs CRON_SECRET in the site's environment variables.

const MAX_SCORE_CALLS = 6;

const hunterDaily = async () => {
  const base = (process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!base || !secret) {
    console.error('hunter-daily: URL or CRON_SECRET missing');
    return;
  }
  const call = async (step) => {
    const res = await fetch(`${base}/api/cron/hunter?step=${step}`, { headers: { Authorization: `Bearer ${secret}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${step}: HTTP ${res.status} ${data.error || ''}`);
    return data;
  };

  const started = Date.now();
  try {
    const refresh = await call('refresh');
    console.log('hunter-daily: refresh', JSON.stringify({ inserted: refresh.inserted, fresh: refresh.fresh, expired: refresh.expired }));
    // Scheduled functions get about 30 seconds in total.
    for (let i = 0; i < MAX_SCORE_CALLS && Date.now() - started < 18_000; i += 1) {
      const score = await call('score');
      console.log('hunter-daily: score', JSON.stringify(score));
      if (!score.remaining) break;
    }
  } catch (error) {
    console.error('hunter-daily:', error instanceof Error ? error.message : error);
  }
};

export default hunterDaily;

// 03:00 UTC = 08:00 in Lahore: fresh matches are waiting when the day starts.
export const config = { schedule: '0 3 * * *' };
