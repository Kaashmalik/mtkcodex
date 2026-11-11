'use client';

import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { BEST_DAYS, sendAdvice } from '@/lib/send-times';
import { usePolling } from '@/components/admin/ui';

const STATUS: Record<'prime' | 'ok' | 'quiet', { label: string; tone: string }> = {
  prime: { label: 'Prime time now', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  ok: { label: 'Awake, not prime', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  quiet: { label: 'Night — don’t send', tone: 'bg-muted text-fg-subtle' },
};

/**
 * Best time to message an audience abroad, in Pakistan time, from the
 * contacts' time zones. Refreshes every minute.
 */
export default function SendTimeAdvisor({ zoneCounts, title = 'Best time to send (Pakistan time)' }: { zoneCounts: Record<string, number>; title?: string }) {
  const [now, setNow] = useState(() => Date.now());
  usePolling(() => setNow(Date.now()), 60_000);
  const advice = useMemo(() => sendAdvice(zoneCounts, new Date(now)), [zoneCounts, now]);

  if (!advice.zones.length) return null;
  const { best } = advice;
  const nowShare = best ? Math.round((advice.nowReach / best.total) * 100) : 0;

  return (
    <section className="card mt-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
          <Clock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          {best && (
            <p className="text-sm text-fg-muted">
              Send <strong className="text-fg">{best.label}</strong> on {BEST_DAYS} to land in prime reading hours for{' '}
              <strong className="text-fg">{Math.round((best.reach / best.total) * 100)}%</strong> of {best.total} contacts.
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            nowShare >= 50 ? STATUS.prime.tone : nowShare > 0 ? STATUS.ok.tone : STATUS.quiet.tone
          }`}
        >
          Right now: {nowShare}% in prime time
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-fg-subtle">
            <tr>
              <th className="py-1.5 pr-3">Time zone</th>
              <th className="py-1.5 pr-3">Contacts</th>
              <th className="py-1.5 pr-3">Their time now</th>
              <th className="py-1.5 pr-3">Late morning (in PKT)</th>
              <th className="py-1.5 pr-3">Afternoon (in PKT)</th>
            </tr>
          </thead>
          <tbody>
            {advice.zones.slice(0, 8).map((zone) => (
              <tr key={zone.timezone} className="border-t border-line">
                <td className="py-1.5 pr-3 font-semibold">{zone.label}</td>
                <td className="py-1.5 pr-3">{zone.count}</td>
                <td className="py-1.5 pr-3">
                  {zone.localNow}{' '}
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS[zone.status].tone}`}>{STATUS[zone.status].label}</span>
                </td>
                {zone.windows.map((w) => (
                  <td key={w.label} className="py-1.5 pr-3" title={`${w.local} their time`}>
                    {w.pkt}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
        Prime hours are 10 AM–12 PM and 2–5 PM in the recipient&apos;s time, {BEST_DAYS}. Avoid Mondays before noon, Friday afternoons and weekends. Tip: set a
        campaign&apos;s sending hours to 10–17 so batches only go out in prime time.
      </p>
    </section>
  );
}
