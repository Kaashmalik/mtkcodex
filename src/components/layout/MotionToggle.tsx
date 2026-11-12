'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Lets a visitor opt back into animations when their OS asks for reduced motion.
 * The choice is stored in localStorage and applied to <html data-motion="on"> by the
 * boot script in app/layout.tsx, so it survives reloads without a flash.
 *
 * Renders nothing for the ~99% of visitors whose OS does not request reduced motion.
 */
export default function MotionToggle() {
  const [reduced, setReduced] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(mq.matches);
      setEnabled(document.documentElement.dataset.motion === 'on');
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (!reduced) return null;

  const toggle = () => {
    const next = !enabled;
    if (next) document.documentElement.dataset.motion = 'on';
    else delete document.documentElement.dataset.motion;

    try {
      localStorage.setItem('motion', next ? 'on' : 'off');
    } catch {
      /* storage can be blocked; the attribute still works for this page load */
    }

    // Several sections read the preference once on mount, so reload to apply it
    // everywhere in one step. The choice is already persisted.
    window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? 'Turn animations off' : 'Turn animations on'}
      title={enabled ? 'Animations on — click to turn off' : 'Your system asks for reduced motion. Click to turn animations on.'}
      className={`grid size-10 place-items-center rounded-full border transition hover:border-brand hover:text-brand ${
        enabled ? 'border-brand text-brand' : 'border-line text-fg-muted'
      }`}
    >
      <Sparkles className="size-[18px]" />
    </button>
  );
}
