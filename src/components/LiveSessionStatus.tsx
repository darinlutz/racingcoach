'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// Above Live Racing's leaderboard: the lap the session is on (the leader's, out of the session's laps when it has a
// set number) and its time remaining, counting down between the collector's updates (iRacing's SessionTimeRemain,
// as it was sampledAt, performance.now()). A dash for an unlimited session or a collector before 1.53.0.

const TICK_MS = 250;

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export default function LiveSessionStatus({
  lap,
  totalLaps,
  timeRemain,
  sampledAt,
  counting,
}: {
  lap: number | null;
  totalLaps: number | null;
  timeRemain: number | null;
  sampledAt: number;
  // The clock is running (the driver's collector is online)
  counting: boolean;
}) {
  const { t, fmt } = useLanguage();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (timeRemain == null || !counting) return;
    const id = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [timeRemain, counting]);

  const remaining = timeRemain == null ? null : timeRemain - (counting ? Math.max(0, now - sampledAt) / 1000 : 0);
  const lapText = lap == null || lap <= 0 ? '—' : totalLaps ? fmt(t.liveRacing.sessionLapOf, { n: Math.min(lap, totalLaps), total: totalLaps }) : String(lap);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t.liveRacing.sessionLap}</p>
        <p className="text-2xl font-bold text-foreground tabular-nums leading-tight">{lapText}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t.liveRacing.timeRemaining}</p>
        <p className="text-2xl font-bold text-foreground tabular-nums leading-tight">
          {remaining == null ? '—' : formatRemaining(remaining)}
        </p>
      </div>
    </div>
  );
}
