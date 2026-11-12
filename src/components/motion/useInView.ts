'use client';

import { useEffect, useRef, useState } from 'react';

/** True once the element has scrolled into view (fires once). */
export function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, inView] as const;
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  // A visitor can override the OS preference from the navbar (saved in localStorage
  // and applied to <html data-motion="on"> by the boot script in the root layout).
  if (document.documentElement.dataset.motion === 'on') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
