'use client';

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { positionLabel } from '@/lib/lapCharts';

const PLAY_RATES = [0.5, 1, 2, 4];
const STEP_SHARE = 1 / 100; // Of what's in view, per press of a step button
const SLIDER_STEPS = 1000;
const BUTTON = 'flex h-7 w-7 items-center justify-center rounded border border-border text-foreground hover:bg-secondary';

// Under the telemetry charts: step and play the crosshair through what's in view at the Target lap's real pace (this
// rate times it), a slider over the whole focus area, where the crosshair is, and locking it there.
export default function PlaybackControls() {
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const { axis, fullAxis, cursorPct, moveCursor, playing, setPlaying, playRate, setPlayRate, locked, setLocked } = useTelemetry();
  const [d0, d1] = axis.domain;
  const [from, to] = fullAxis.domain;
  const stepBy = (direction: 1 | -1) => moveCursor((cursorPct ?? d0) + direction * (d1 - d0) * STEP_SHARE);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
      <button type="button" aria-label={labels.stepBack} className={BUTTON} onClick={() => stepBy(-1)}>
        <SkipBack className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={playing ? t.charts.pause3d : t.charts.play3d} className={`${BUTTON} bg-secondary`} onClick={() => setPlaying(!playing)}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <button type="button" aria-label={labels.stepForward} className={BUTTON} onClick={() => stepBy(1)}>
        <SkipForward className="h-3.5 w-3.5" />
      </button>
      <span role="group" aria-label={t.charts.playRate} className="inline-flex overflow-hidden rounded border border-border">
        {PLAY_RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            aria-pressed={playRate === rate}
            onClick={() => setPlayRate(rate)}
            className={`tele-num px-2 py-1 text-[11px] ${playRate === rate ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {rate}×
          </button>
        ))}
      </span>
      <input
        type="range"
        aria-label={labels.trackPosition}
        min={from}
        max={to}
        step={(to - from) / SLIDER_STEPS}
        value={cursorPct ?? from}
        onChange={(event) => moveCursor(Number(event.target.value))}
        className="mx-2 h-1 min-w-24 flex-1 cursor-pointer accent-primary"
      />
      <span className="tele-num w-24 text-right text-xs text-foreground">{cursorPct === null ? '–' : positionLabel(cursorPct, axis)}</span>
      <button
        type="button"
        aria-pressed={locked}
        onClick={() => setLocked(!locked)}
        className={`rounded border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.1em] ${
          locked ? 'border-primary/60 bg-secondary text-foreground' : 'border-border text-muted-foreground'
        }`}
      >
        {locked ? `● ${labels.locked}` : `○ ${labels.free}`}
      </button>
    </div>
  );
}
