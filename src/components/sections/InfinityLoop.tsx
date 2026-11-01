'use client';

import { useEffect, useState } from 'react';
import { Code2, Compass, PenTool, Rocket, TrendingUp, Workflow } from 'lucide-react';
import { prefersReducedMotion } from '@/components/motion/useInView';

// Stage positions are in SVG viewBox units (800 × 340) so labels stay pinned to the curve.
const stages = [
  { name: 'Discover', icon: Compass, x: 230, y: 78, side: 'build' },
  { name: 'Design', icon: PenTool, x: 92, y: 170, side: 'build' },
  { name: 'Build', icon: Code2, x: 230, y: 262, side: 'build' },
  { name: 'Launch', icon: Rocket, x: 570, y: 78, side: 'run' },
  { name: 'Automate', icon: Workflow, x: 708, y: 170, side: 'run' },
  { name: 'Scale', icon: TrendingUp, x: 570, y: 262, side: 'run' },
] as const;

const PATH =
  'M400,170 C470,70 690,60 700,170 C690,280 470,270 400,170 C330,70 110,60 100,170 C110,280 330,270 400,170 Z';

/** Animated ∞ loop: continuous Build ↔ Run lifecycle with packets travelling the curve. */
export default function InfinityLoop({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState(0);
  // Order the highlight follows as packets travel: right loop then left loop.
  const order = [3, 4, 5, 0, 1, 2];

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setActive((a) => (a + 1) % order.length), 1400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = order[active];

  return (
    <section className={`night relative isolate overflow-hidden ${compact ? 'py-16' : 'py-24'}`}>
      <div className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(rgba(98,216,78,0.18)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="container-x">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow !text-lime">The MTK Codex loop</p>
          <h2 className="mt-4 text-3xl font-bold leading-[1.1] sm:text-5xl">
            Build, run, improve — <span className="text-lime-grad">forever.</span>
          </h2>
          <p className="mt-5 text-lg text-white/70">
            Software is never finished. Our continuous delivery loop connects engineering with operations, so every release feeds automation, data and the
            next improvement.
          </p>
        </div>

        <div className="relative mx-auto mt-12 max-w-4xl">
          <svg viewBox="0 0 800 340" className="w-full overflow-visible" role="img" aria-label="Infinity loop of the delivery lifecycle">
            <defs>
              <linearGradient id="inf-grad" x1="0" x2="1">
                <stop offset="0" stopColor="#2dd4bf" />
                <stop offset="0.5" stopColor="#62d84e" />
                <stop offset="1" stopColor="#60a5fa" />
              </linearGradient>
              <filter id="inf-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <path id="inf-path" d={PATH} />
            </defs>

            <use href="#inf-path" fill="none" stroke="url(#inf-grad)" strokeOpacity="0.18" strokeWidth="34" strokeLinecap="round" />
            <use href="#inf-path" fill="none" stroke="url(#inf-grad)" strokeWidth="3" />
            <use href="#inf-path" className="flow-line" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.5" />

            {/* travelling packets */}
            {[0, 1.6, 3.2, 4.8, 6.4].map((delay, i) => (
              <circle key={i} r={i % 2 ? 5 : 7} fill={i % 2 ? '#60a5fa' : '#62d84e'} filter="url(#inf-glow)">
                <animateMotion dur="8s" repeatCount="indefinite" begin={`-${delay}s`} rotate="auto">
                  <mpath href="#inf-path" />
                </animateMotion>
              </circle>
            ))}

            {/* centre knot */}
            <circle cx="400" cy="170" r="30" fill="#032d42" stroke="#62d84e" strokeOpacity="0.6" strokeWidth="2" />
            <circle cx="400" cy="170" r="30" fill="none" stroke="#62d84e" strokeWidth="2" className="flow-line" />
            <text x="400" y="176" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800">
              MTK
            </text>
            <text x="250" y="174" textAnchor="middle" fill="#a6bfc6" fontSize="13" fontWeight="600" letterSpacing="3">
              BUILD
            </text>
            <text x="550" y="174" textAnchor="middle" fill="#a6bfc6" fontSize="13" fontWeight="600" letterSpacing="3">
              RUN
            </text>

            {/* stage nodes */}
            {stages.map((s, i) => {
              const on = i === current;
              const color = s.side === 'build' ? '#2dd4bf' : '#62d84e';
              return (
                <g key={s.name} style={{ transition: 'opacity .4s' }} opacity={on ? 1 : 0.75}>
                  <circle cx={s.x} cy={s.y} r={on ? 26 : 20} fill="#06293a" stroke={color} strokeWidth={on ? 3 : 1.5} style={{ transition: 'r .4s' }} />
                  {on && (
                    <circle cx={s.x} cy={s.y} r="26" fill="none" stroke={color} strokeWidth="2">
                      <animate attributeName="r" from="26" to="44" dur="1.4s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.8" to="0" dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <text
                    // Top/bottom stages label above/below; side stages label outward.
                    x={s.y === 170 ? s.x + (s.x < 400 ? -34 : 34) : s.x}
                    y={s.y < 170 ? s.y - 36 : s.y > 170 ? s.y + 50 : s.y + 5}
                    textAnchor={s.y === 170 ? (s.x < 400 ? 'end' : 'start') : 'middle'}
                    fill={on ? '#fff' : '#a6bfc6'}
                    fontSize="15"
                    fontWeight="700"
                    className="hidden sm:block"
                  >
                    {s.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Icons overlaid on the nodes (percent of the 800×340 viewBox) */}
          {stages.map((s, i) => (
            <span
              key={s.name}
              className="pointer-events-none absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left: `${(s.x / 800) * 100}%`, top: `${(s.y / 340) * 100}%`, color: i === current ? '#fff' : s.side === 'build' ? '#2dd4bf' : '#62d84e' }}
            >
              <s.icon className="size-3.5 sm:size-5" />
            </span>
          ))}
        </div>

        <ol className="mx-auto mt-10 grid max-w-4xl grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6 sm:text-sm">
          {order.map((idx, k) => {
            const s = stages[idx];
            return (
              <li
                key={s.name}
                className={`rounded-full border px-3 py-2 font-semibold transition ${k === active ? 'border-lime bg-lime/15 text-white' : 'border-white/10 text-white/55'}`}
              >
                {s.name}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
