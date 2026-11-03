'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

type ThinkingProgressProps = {
  // The coach is working on its answer
  active: boolean;
  // About how long the coach usually takes, which sets how fast the bar climbs
  expectedMs: number;
  className?: string;
};

// How long 100% stays up once the coach has answered
const DONE_MS = 1200;
// The highest the bar goes before the answer arrives
const MAX_WAITING = 95;

// "{x}% Complete" with a small bar while a coach writes its summary (Debrief Coach, Lap Compare). The routes answer
// in one piece, so it's an estimate from the time taken: it climbs quickly, then slower and slower toward 95%, and
// only reaches 100% when the answer is in.
export default function ThinkingProgress({ active, expectedMs, className = '' }: ThinkingProgressProps) {
  const { t, fmt } = useLanguage();
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      // Done: 100% for a moment, then gone (nothing when it never started)
      const done = setTimeout(() => setPercent((p) => (p === null ? null : 100)), 0);
      const hide = setTimeout(() => setPercent(null), DONE_MS);
      return () => {
        clearTimeout(done);
        clearTimeout(hide);
      };
    }
    const start = Date.now();
    // At the expected time it's at about 87%
    const tick = () =>
      setPercent(Math.floor(MAX_WAITING * (1 - Math.exp((-2.5 * (Date.now() - start)) / expectedMs))));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 200);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, expectedMs]);

  if (percent === null) return null;
  const label = fmt(t.common.percentComplete, { percent });
  return (
    <div className={`flex items-center gap-3 ${className}`} data-no-track>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-32 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-strong transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}
