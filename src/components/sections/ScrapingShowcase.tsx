'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { prefersReducedMotion } from '@/components/motion/useInView';

const sources = ['E-commerce stores', 'Marketplaces', 'Business directories', 'Real-estate portals', 'PDFs & documents'];
const outputs = ['Your CRM', 'Google Sheets', 'Live dashboard', 'Database / API', 'Alerts & email'];
const colors = ['#62d84e', '#2dd4bf', '#60a5fa', '#fbbf24', '#f472b6'];
const ys = [50, 115, 180, 245, 310];

const logLines = [
  '✓ 1,284 product prices refreshed · competitor-a.com',
  '✓ 312 new B2B leads extracted · business directory',
  '⟳ Layout change detected → selector auto-healed',
  '✓ 96 listings de-duplicated & geocoded',
  '✓ Price drop alert sent to #sales (−12%)',
  '✓ 2,040 rows synced to Google Sheets',
  '✓ 58 leads pushed to CRM pipeline',
  '⟳ Respecting robots.txt · throttled to 1 req/s',
];

// Bezier from a source/output row to the engine at (450,180).
const inPath = (y: number) => `M200,${y} C320,${y} 330,180 400,180`;
const outPath = (y: number) => `M500,180 C570,180 580,${y} 700,${y}`;

/** Animated data pipeline: sources → MTK scraper engine → destinations, with a live job log. */
export default function ScrapingShowcase() {
  const [log, setLog] = useState(logLines.slice(0, 4));
  const [records, setRecords] = useState(48210);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let k = 4;
    const t = setInterval(() => {
      setLog((l) => [logLines[k++ % logLines.length], ...l].slice(0, 4));
      setRecords((r) => r + Math.floor(40 + Math.random() * 160));
    }, 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <section id="scraping" className="night relative isolate scroll-mt-20 overflow-hidden py-24">
      <div className="aurora-1 glow -z-10 left-[-10%] top-[20%] size-[480px] bg-[#14a89a] opacity-25" />
      <div className="container-x">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:items-center">
          <div>
            <p className="eyebrow !text-lime">Web scraping & data extraction</p>
            <h2 className="mt-4 text-3xl font-bold leading-[1.1] sm:text-5xl">
              The web is your database. <span className="text-lime-grad">We make it usable.</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Prices, leads, listings, reviews and documents — collected on schedule, cleaned, de-duplicated and delivered straight into your CRM, sheets or
              dashboards. For any business, in any industry.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-white/80">
              {['Self-healing scrapers that survive layout changes', 'Scheduled runs with alerts and change detection', 'Proxy rotation, rate-limiting and CAPTCHA-aware flows', 'Clean exports: CSV, Excel, JSON, API, webhook'].map((t) => (
                <li key={t} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime" /> {t}
                </li>
              ))}
            </ul>
            <p className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" />
              Ethical by design: we collect publicly available data only, respect robots.txt and site terms, and follow data-protection law.
            </p>
            <Button href="/services/web-scraping" size="lg" arrow className="mt-8">
              Start a data project
            </Button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur sm:p-6">
            {/* Desktop: animated SVG pipeline */}
            <svg viewBox="0 0 900 360" className="hidden w-full md:block" role="img" aria-label="Data flowing from websites through the MTK scraper engine into business tools">
              {ys.map((y, i) => (
                <g key={`in${i}`}>
                  <path id={`in-${i}`} d={inPath(y)} fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
                  <path d={inPath(y)} fill="none" stroke={colors[i]} strokeOpacity="0.6" strokeWidth="1.5" className="flow-line" />
                  {[0, 1].map((n) => (
                    <circle key={n} r="4.5" fill={colors[i]}>
                      <animateMotion dur={`${2.2 + i * 0.25}s`} begin={`${n * 1.1 + i * 0.3}s`} repeatCount="indefinite">
                        <mpath href={`#in-${i}`} />
                      </animateMotion>
                    </circle>
                  ))}
                  <rect x="20" y={y - 20} width="180" height="40" rx="20" fill="#06293a" stroke={colors[i]} strokeOpacity="0.5" />
                  <circle cx="42" cy={y} r="5" fill={colors[i]} />
                  <text x="56" y={y + 5} fill="#e6f2ef" fontSize="14" fontWeight="600">
                    {sources[i]}
                  </text>
                </g>
              ))}
              {ys.map((y, i) => (
                <g key={`out${i}`}>
                  <path id={`out-${i}`} d={outPath(y)} fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
                  <path d={outPath(y)} fill="none" stroke="#62d84e" strokeOpacity="0.55" strokeWidth="1.5" className="flow-line" />
                  <rect x="6" y="-6" width="12" height="12" rx="3" fill="#62d84e">
                    <animateMotion dur={`${2 + i * 0.2}s`} begin={`${0.6 + i * 0.35}s`} repeatCount="indefinite">
                      <mpath href={`#out-${i}`} />
                    </animateMotion>
                  </rect>
                  <rect x="700" y={y - 20} width="180" height="40" rx="12" fill="#0b3a2a" stroke="#62d84e" strokeOpacity="0.5" />
                  <text x="790" y={y + 5} fill="#e6f2ef" fontSize="14" fontWeight="600" textAnchor="middle">
                    {outputs[i]}
                  </text>
                </g>
              ))}
              {/* engine */}
              <circle cx="450" cy="180" r="86" fill="none" stroke="#62d84e" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 8">
                <animateTransform attributeName="transform" type="rotate" from="0 450 180" to="360 450 180" dur="18s" repeatCount="indefinite" />
              </circle>
              <circle cx="450" cy="180" r="66" fill="#032d42" stroke="#62d84e" strokeWidth="2" />
              <circle cx="450" cy="180" r="66" fill="none" stroke="#2dd4bf" strokeWidth="3" strokeDasharray="60 355">
                <animateTransform attributeName="transform" type="rotate" from="0 450 180" to="360 450 180" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <text x="450" y="172" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="800">
                MTK Scraper
              </text>
              <text x="450" y="194" textAnchor="middle" fill="#62d84e" fontSize="12" fontWeight="700" letterSpacing="2">
                CLEAN · DEDUPE · ENRICH
              </text>
            </svg>

            {/* Mobile: stacked flow */}
            <div className="space-y-3 md:hidden">
              <div className="flex flex-wrap gap-2">
                {sources.map((s, i) => (
                  <span key={s} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: `${colors[i]}80` }}>
                    {s}
                  </span>
                ))}
              </div>
              <div className="relative h-10 overflow-hidden">
                <div className="absolute left-1/2 h-full w-px bg-white/15" />
                <span className="absolute left-1/2 size-2 -translate-x-1/2 animate-bounce rounded-full bg-lime" />
              </div>
              <div className="rounded-2xl border border-lime/50 bg-[#032d42] p-4 text-center font-bold">
                MTK Scraper <span className="block text-[10px] tracking-widest text-lime">CLEAN · DEDUPE · ENRICH</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {outputs.map((o) => (
                  <span key={o} className="rounded-lg border border-lime/40 bg-lime/10 px-3 py-1 text-xs">
                    {o}
                  </span>
                ))}
              </div>
            </div>

            {/* live job log */}
            <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
              <div className="rounded-2xl bg-black/30 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/50">Records today</p>
                <p className="font-display text-2xl font-bold tabular-nums text-lime">{records.toLocaleString('en-US')}</p>
                <p className="text-[10px] text-white/40">sample job</p>
              </div>
              <ul className="space-y-1 overflow-hidden rounded-2xl bg-black/30 p-3 font-mono text-[11px] text-white/75" aria-live="off">
                {log.map((l, i) => (
                  <li key={`${l}-${i}`} className={`truncate ${i === 0 ? 'word-in text-white' : 'opacity-60'}`}>
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
