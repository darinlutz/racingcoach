'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { PitLimiterView } from '@/lib/lighting/pitLimiterView';

// The Live Racing page's pit limiter light (pitLimiterView in src/lib/lighting/pitLimiterView.ts): lit blue, like a
// steering wheel's limiter light, while it's on; grey when off; grey with words saying why when the simulator doesn't
// say or the telemetry stopped, so a stale blue is never shown. Updates with the page's live polling.
export default function PitLimiterIndicator({ view }: { view: PitLimiterView }) {
  const { t } = useLanguage();
  const p = t.liveRacing.pitLimiter;
  const label = { active: p.active, off: p.off, unavailable: p.unavailable, stale: p.stale }[view];
  const tip = view === 'unavailable' ? p.unavailableTip : view === 'stale' ? p.staleTip : p.title;
  const lit = view === 'active';
  return (
    <div
      role="status"
      aria-live="polite"
      title={tip}
      data-pit-limiter={view}
      className={`flex items-center justify-center gap-2.5 rounded-md border px-3 py-2 font-display text-sm font-bold tracking-wider transition-colors duration-150 ${
        lit
          ? 'border-blue-300 bg-blue-600 text-white shadow-[0_0_18px_rgba(37,99,235,0.65)]'
          : 'border-border bg-muted/40 text-muted-foreground'
      }`}
    >
      <span
        aria-hidden
        className={`size-2.5 rounded-full ${lit ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]' : view === 'stale' ? 'bg-muted-foreground/40' : 'bg-muted-foreground'}`}
      />
      {label}
    </div>
  );
}
