'use client';

import { useMemo } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, LapLegend, niceLimit, Readout, signedValue, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import TelemetryEventMarkers, { MeasurementBracket } from '@/components/TelemetryEventMarkers';
import { gapLabel, positionLabel } from '@/lib/lapCharts';

const PCT_TICKS = [0, 25, 50, 75, 100];
const BRACKET_AT = 70; // % up the chart

// The Target and Compare laps' throttle through the focus area, marking where each lifts, picks the power back up
// and reaches full throttle, and the distance between the pickups.
export default function ThrottleTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const labels = dictionary.charts.telemetry;
  const { axis, base, compare, grid, events, settings, cursorIndex } = useTelemetry();
  const [target, other] = grid.throttles;
  const deltas = useMemo(() => other.map((value, i) => value - target[i]), [target, other]);
  const range = useMemo(() => niceLimit(Math.max(10, ...deltas.filter(Number.isFinite).map(Math.abs))), [deltas]);

  const [targetValue, compareValue] = cursorIndex === null ? [NaN, NaN] : [target[cursorIndex], other[cursorIndex]];
  const percent = (value: number) => (Number.isFinite(value) ? `${value.toFixed(0)}%` : '–');
  // Rounded as shown, so the difference matches the two values beside it
  const shownDelta = Math.round(compareValue) - Math.round(targetValue);
  const pp = Number.isFinite(shownDelta) ? `${signedValue(shownDelta, locale)} ${labels.percentPoints}` : '–';
  const [targetPickup, comparePickup] = [events.target.throttlePickup, events.compare.throttlePickup];
  const gap = targetPickup !== null && comparePickup !== null ? comparePickup - targetPickup : null;
  const at = (pct: number | null) => (pct === null ? '' : positionLabel(pct, axis));

  return (
    <TelemetryChart
      id={id}
      title={dictionary.charts.throttle}
      unit="%"
      width={width}
      height={250}
      yMin={0}
      yMax={105}
      yTicks={PCT_TICKS}
      formatTick={(tick) => `${tick}%`}
      legend={<LapLegend />}
      series={[
        { id: 'target', values: target, color: TARGET_COLOR, area: true, visible: settings.showTarget },
        { id: 'compare', values: other, color: COMPARE_COLOR, area: true, visible: settings.showCompare, width: 1.4 },
      ]}
      diff={{ a: target, b: other }}
      delta={{ values: deltas, range, unit: labels.percentPoints }}
      ariaLabel={`${dictionary.charts.throttle}. ${base.title}: ${base.summary} ${compare.title}: ${compare.summary}`}
      readout={
        <>
          <Readout label={labels.target} value={percent(targetValue)} tone="target" />
          <Readout label={labels.compare} value={percent(compareValue)} tone="compare" />
          <Readout label="Δ" value={pp} />
          {gap !== null && <Readout label={labels.comparePickup} value={`${gapLabel(gap, axis)} ${gap >= 0 ? labels.later : labels.earlier}`} tone="neg" />}
        </>
      }
      overlay={(s) => (
        <>
          <TelemetryEventMarkers
            s={s}
            visible={settings.showEvents}
            markers={[
              { pct: events.target.throttleLift, label: labels.markerLift, color: TARGET_COLOR, dashed: true },
              { pct: events.compare.throttleLift, label: labels.markerLift, color: COMPARE_COLOR, dashed: true },
              { pct: targetPickup, label: fmt(labels.markerPickup, { lap: labels.targetInitial, position: at(targetPickup) }), color: TARGET_COLOR },
              { pct: comparePickup, label: fmt(labels.markerPickup, { lap: labels.compareInitial, position: at(comparePickup) }), color: COMPARE_COLOR },
              { pct: events.target.fullThrottle, label: fmt(labels.markerFull, { lap: labels.targetInitial }), color: TARGET_COLOR, dashed: true },
              { pct: events.compare.fullThrottle, label: fmt(labels.markerFull, { lap: labels.compareInitial }), color: COMPARE_COLOR, dashed: true },
            ]}
          />
          {settings.showEvents && targetPickup !== null && comparePickup !== null && (
            <MeasurementBracket s={s} from={targetPickup} to={comparePickup} y={s.y(BRACKET_AT)} label={fmt(labels.bracketPickup, { gap: gapLabel(comparePickup - targetPickup, axis) })} />
          )}
        </>
      )}
    />
  );
}
