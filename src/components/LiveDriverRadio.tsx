'use client';

import { Radio } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import type { LiveDriver } from '@/lib/liveRacing';

// The Live Racing page's Driver Radio panel: what the focused driver said over the radio in the last few minutes
// (src/lib/driverRadio.ts) and the Race Engineer's answers (src/lib/raceEngineer.ts), newest first, and the Play
// driver radio checkbox (LiveRacing.tsx plays each new message
// in the site's Driver Radio voice).
export default function LiveDriverRadio({
  radio,
  play,
  onPlayChange,
  error,
}: {
  radio: LiveDriver['radio'];
  play: boolean;
  onPlayChange: (on: boolean) => void;
  error: string;
}) {
  const { t, fmt } = useLanguage();
  const ago = (ms: number) =>
    ms < 10_000
      ? t.liveRacing.radioJustNow
      : ms < 60_000
        ? fmt(t.liveRacing.radioSecondsAgo, { n: Math.round(ms / 1000) })
        : fmt(t.liveRacing.radioMinutesAgo, { n: Math.round(ms / 60_000) });
  return (
    <div className="px-4 py-3">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Radio className="size-4 text-primary" aria-hidden />
        {t.liveRacing.radioTitle}
      </p>
      {radio.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t.liveRacing.radioEmpty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
          {[...radio].reverse().map((message) => (
            <li key={message.seq} className={`text-sm ${message.from === 'engineer' ? 'pl-4 text-primary' : 'text-foreground'}`}>
              <span className="mr-2 text-xs text-muted-foreground tabular-nums">{ago(message.agoMs)}</span>
              {message.from === 'engineer' && <span className="mr-1 text-xs font-semibold uppercase">{t.liveRacing.radioEngineer}</span>}
              “{message.text}”
            </li>
          ))}
        </ul>
      )}
      <label className="mt-2 inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input type="checkbox" checked={play} onChange={(e) => onPlayChange(e.target.checked)} />
        {t.liveRacing.playRadio}
      </label>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
