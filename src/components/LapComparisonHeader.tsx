'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { signedValue } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { positionLabel } from '@/lib/lapCharts';

const ACCENTS = {
  target: { bar: 'bg-lap-target', text: 'text-lap-target' },
  compare: { bar: 'bg-lap-compare', text: 'text-lap-compare' },
  delta: { bar: 'bg-tele-neg', text: 'text-tele-neg' },
};

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: keyof typeof ACCENTS }) {
  return (
    <div className="relative min-w-[170px] flex-1 overflow-hidden rounded-md border border-border bg-card px-4 py-2.5 sm:flex-none">
      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENTS[accent].bar}`} />
      <div className="tele-label">{label}</div>
      <div className={`tele-num text-[28px] font-semibold leading-tight ${ACCENTS[accent].text}`}>{value}</div>
      <div className="tele-label !text-[10px] !tracking-[0.08em] opacity-80">{sub}</div>
    </div>
  );
}

// Over the telemetry charts: the focus area's place on the lap, the crosshair's, and the whole laps' times and difference
export default function LapComparisonHeader({ areaName }: { areaName: string }) {
  const { t, fmt, locale } = useLanguage();
  const labels = t.charts.telemetry;
  const { base, compare, fullAxis, cursorPct } = useTelemetry();
  const [from, to] = fullAxis.domain;
  return (
    <header className="flex flex-wrap items-stretch gap-3">
      <div className="mr-auto flex flex-col justify-center pr-4">
        <h3 className="font-display text-2xl font-bold uppercase tracking-[0.18em] text-foreground">{labels.title}</h3>
        <p className="tele-num text-xs text-muted-foreground">
          <span className="text-foreground">{areaName}</span> · {positionLabel(from, fullAxis)}–{positionLabel(to, fullAxis)}
          {cursorPct !== null && (
            <>
              {' · '}
              {fmt(labels.cursorAt, { position: positionLabel(cursorPct, fullAxis) })}
            </>
          )}
        </p>
      </div>
      <SummaryCard label={labels.targetLap} value={base.lapTime} accent="target" sub={labels.reference} />
      <SummaryCard label={labels.compareLap} value={compare.lapTime} accent="compare" sub={labels.evaluated} />
      <SummaryCard label={labels.lapDelta} value={`${signedValue(compare.lapSeconds - base.lapSeconds, locale, 3)} s`} accent="delta" sub={labels.lapDeltaSub} />
    </header>
  );
}
