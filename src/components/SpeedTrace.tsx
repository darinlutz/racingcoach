'use client';

import { useMemo } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, LapLegend, Readout, signedValue, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { useUnits } from '@/components/UnitsProvider';
import { SPEED_UNIT } from '@/lib/units';

const HEIGHT = 190;
const SPEED_STEP = 20; // between the speed ticks

// Compare minus Target speed through the focus area, filled above and below zero, or with the toolbar-like switch
// in its title both laps' speeds on one chart. The largest and average differences are of what's in view.
export default function SpeedTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const labels = dictionary.charts.telemetry;
  const speedUnit = SPEED_UNIT[useUnits()];
  const { axis, grid, settings, setSetting, cursorIndex } = useTelemetry();
  const mode = settings.speedMode;
  const [target, other] = grid.speeds;
  const deltas = useMemo(() => other.map((value, i) => value - target[i]), [target, other]);
  const finiteSpeeds = useMemo(() => [...target, ...other].filter(Number.isFinite), [target, other]);
  const finiteDeltas = useMemo(() => deltas.filter(Number.isFinite), [deltas]);
  if (finiteSpeeds.length === 0) return null;

  const [d0, d1] = axis.domain;
  const inView = deltas.filter((value, i) => Number.isFinite(value) && grid.pcts[i] >= d0 && grid.pcts[i] <= d1);
  const average = inView.reduce((sum, value) => sum + value, 0) / Math.max(1, inView.length);
  const largest = inView.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
  const lo = Math.max(0, Math.floor(Math.min(...finiteSpeeds) / 10) * 10 - 10);
  const hi = Math.ceil(Math.max(...finiteSpeeds) / 10) * 10;
  const limit = Math.ceil(Math.max(0, ...finiteDeltas.map(Math.abs)) / 2) * 2 + 2;

  const [targetValue, compareValue] = cursorIndex === null ? [NaN, NaN] : [target[cursorIndex], other[cursorIndex]];
  const speed = (value: number) => (Number.isFinite(value) ? `${Math.round(value).toLocaleString(locale)} ${speedUnit}` : '–');
  const delta = compareValue - targetValue;

  const toggle = (
    <span role="group" aria-label={labels.speed} className="ml-2 inline-flex overflow-hidden rounded border border-border">
      {(['overlay', 'delta'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setSetting('speedMode', value)}
          className={`px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-widest transition-colors ${
            mode === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === 'overlay' ? labels.overlay : labels.deltaMode}
        </button>
      ))}
    </span>
  );
  const readout = (
    <>
      <Readout label={labels.target} value={speed(targetValue)} tone="target" />
      <Readout label={labels.compare} value={speed(compareValue)} tone="compare" />
      <Readout label="Δ" value={Number.isFinite(delta) ? `${signedValue(delta, locale, 1)} ${speedUnit}` : '–'} tone={delta >= 0 ? 'pos' : 'neg'} />
      <Readout label={labels.maxDelta} value={signedValue(largest, locale, 1)} />
      <Readout label={labels.avgDelta} value={signedValue(average, locale, 1)} />
    </>
  );

  if (mode === 'overlay') {
    return (
      <TelemetryChart
        id={id}
        title={labels.speed}
        unit={speedUnit}
        width={width}
        height={HEIGHT}
        yMin={lo}
        yMax={hi}
        yTicks={Array.from({ length: Math.floor((hi - lo) / SPEED_STEP) + 1 }, (_, i) => lo + i * SPEED_STEP)}
        formatTick={(tick) => tick.toLocaleString(locale)}
        legend={
          <>
            <LapLegend />
            {toggle}
          </>
        }
        series={[
          { id: 'target', values: target, color: TARGET_COLOR, visible: settings.showTarget },
          { id: 'compare', values: other, color: COMPARE_COLOR, visible: settings.showCompare, width: 1.4 },
        ]}
        diff={{ a: target, b: other }}
        delta={{ values: deltas, range: limit, unit: speedUnit }}
        ariaLabel={fmt(labels.speedAria, { unit: speedUnit })}
        readout={readout}
      />
    );
  }
  return (
    <TelemetryChart
      id={id}
      title={labels.speedDelta}
      unit={`${dictionary.charts.pedalDelta} · ${speedUnit}`}
      width={width}
      height={HEIGHT}
      yMin={-limit}
      yMax={limit}
      yTicks={[-limit, -limit / 2, 0, limit / 2, limit]}
      formatTick={(tick) => signedValue(tick, locale)}
      legend={toggle}
      zeroLine={{ color: 'var(--muted-foreground)' }}
      diverging={{ values: deltas }}
      ariaLabel={fmt(labels.speedDeltaAria, { unit: speedUnit })}
      readout={readout}
    />
  );
}
