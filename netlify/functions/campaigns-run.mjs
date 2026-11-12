// Campaign sender (Netlify Scheduled Function, free plan). Every 15 minutes it
// asks the site to send the next small batch; the site only sends inside each
// contact's local hours and under each campaign's daily limit.
// Needs CRON_SECRET in the site's environment.

const campaignsRun = async () => {
  const base = (process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!base || !secret) {
    console.error('campaigns: URL or CRON_SECRET missing');
    return;
  }
  try {
    const res = await fetch(`${base}/api/cron/campaigns`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(25_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error || ''}`);
    for (const r of data.reports || []) {
      console.log(`campaigns: ${r.campaign} — sent ${r.sent}, failed ${r.failed}, waiting ${r.waiting}${r.note ? ` (${r.note})` : ''}`);
    }
  } catch (error) {
    console.error('campaigns:', error instanceof Error ? error.message : error);
  }
};

export default campaignsRun;

export const config = { schedule: '*/15 * * * *' };
