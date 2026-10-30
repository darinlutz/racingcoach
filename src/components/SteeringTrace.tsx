'use client';

import { useMemo } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, LapLegend, Readout, signedValue, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';

const HEIGHT = 170;
// The vertical axis runs from -limit to +limit, the smallest of these (degrees) that fits both laps
const LIMITS = [15, 30, 45, 60, 90, 120, 180, 270, 360, 540, 720, 900];
// Stretches where the laps' steering differs by more than this (degrees) are tinted
const TINT_DIFFERENCE = 8;

// iRacing's steering angle is positive to the left: 30 -> "30° L", -30 -> "30° R"
export function steeringLabel(deg: number, t: Dictionary['charts']) {
  const rounded = Math.round(deg);
  return rounded === 0 ? '0°' : fmt(rounded > 0 ? t.steeringLeft : t.steeringRight, { n: Math.abs(rounded) });
}

// The Target and Compare laps' steering wheel angle through one focus area on one chart. Right turns are up and
// left turns down (the grid's steering has right positive, unlike iRacing's), with stretches where the laps differ tinted.
export default function SteeringTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, locale } = useLanguage();
  const t = dictionary.charts;
  const labels = t.telemetry;
  const { grid, settings, cursorIndex } = useTelemetry();
  const { pcts } = grid;
  const [target, other] = grid.steerings;
  const deltas = useMemo(() => other.map((value, i) => value - target[i]), [target, other]);
  // Runs of grid points, not a rectangle per point
  const tinted = useMemo(() => {
    const runs: [number, number][] = [];
    deltas.forEach((delta, i) => {
      if (Math.abs(delta) <= TINT_DIFFERENCE) return;
      const last = runs[runs.length - 1];
      if (last && last[1] === i - 1) last[1] = i;
      else runs.push([i, i]);
    });
    return runs;
  }, [deltas]);

  const largest = Math.max(...target.map(Math.abs).filter(Number.isFinite), ...other.map(Math.abs).filter(Number.isFinite), 1);
  const limit = LIMITS.find((l) => l >= largest) ?? Math.ceil(largest / 180) * 180;
  const deltaLimit = LIMITS.find((l) => l >= Math.max(...deltas.map(Math.abs).filter(Number.isFinite), 1)) ?? limit;

  const [targetValue, compareValue] = cursorIndex === null ? [NaN, NaN] : [target[cursorIndex], other[cursorIndex]];
  const angle = (right: number) => (Number.isFinite(right) ? steeringLabel(-right, t) : '–');
  // Rounded as shown, so the difference matches the two values beside it
  const delta = Math.round(compareValue) - Math.round(targetValue);

  // Text version of the chart: each lap's largest angle each way
  const summary = [
    { label: dictionary.lapCompare.base, angles: target },
    { label: dictionary.lapCompare.compare, angles: other },
  ]
    .map(({ label, angles }) => {
      const right = Math.max(0, ...angles.filter(Number.isFinite));
      const left = Math.min(0, ...angles.filter(Number.isFinite));
      const parts = [left <= -1 && fmt(t.upToLeft, { n: Math.round(-left) }), right >= 1 && fmt(t.upToRight, { n: Math.round(right) })].filter(Boolean);
      return parts.length > 0 ? fmt(t.lapUpTo, { lap: label, angles: parts.join(t.and) }) : fmt(t.lapStraight, { lap: label });
    })
    .join('; ');

  return (
    <TelemetryChart
      id={id}
      title={t.slipCharts.steering}
      unit={labels.steeringUnit}
      width={width}
      height={HEIGHT}
      yMin={-limit}
      yMax={limit}
      yTicks={[-limit, -limit / 2, 0, limit / 2, limit]}
      formatTick={(tick) => steeringLabel(-tick, t)}
      axisSideLabels={{ top: labels.rightUp, bottom: labels.leftDown }}
      legend={<LapLegend />}
      zeroLine={{ color: 'var(--muted-foreground)', width: 1 }}
      series={[
        { id: 'target', values: target, color: TARGET_COLOR, visible: settings.showTarget },
        { id: 'compare', values: other, color: COMPARE_COLOR, visible: settings.showCompare, width: 1.4 },
      ]}
      diff={{ a: target, b: other }}
      delta={{ values: deltas, range: deltaLimit, unit: '°' }}
      ariaLabel={fmt(t.steeringAria, { summary })}
      caption={`${summary}. ${t.steeringCaption}`}
      background={(s) =>
        settings.showDiff ? (
          <g>
            {tinted.map(([first, last]) => (
              <rect key={first} x={s.x(pcts[first])} y={s.plotTop} width={Math.max(1, s.x(pcts[last]) - s.x(pcts[first]))} height={s.plotBottom - s.plotTop} fill="var(--tele-neg)" opacity={0.08} />
            ))}
          </g>
        ) : null
      }
      readout={
        <>
          <Readout label={labels.target} value={angle(targetValue)} tone="target" />
          <Readout label={labels.compare} value={angle(compareValue)} tone="compare" />
          <Readout label="Δ" value={!Number.isFinite(delta) ? '–' : delta === 0 ? '0°' : `${signedValue(Math.abs(delta), locale)}° ${delta > 0 ? labels.right : labels.left}`} />
        </>
      }
    />
  );
}
