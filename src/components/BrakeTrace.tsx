'use client';

import { useMemo } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, LapLegend, niceLimit, Readout, signedValue, TARGET_COLOR, type Scales } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import TelemetryEventMarkers, { MeasurementBracket } from '@/components/TelemetryEventMarkers';
import { gapLabel, positionLabel } from '@/lib/lapCharts';

const PCT_TICKS = [0, 25, 50, 75, 100];
// How far up the chart (%) the bracket can go, the first that's clear of both peaks' labels
const BRACKET_HEIGHTS = [82, 94, 60];
const BRACKET_CLEARANCE = 9;

// A lap's peak brake, labelled beside the top of its trace
function PeakLabel({ s, peak, color, text }: { s: Scales; peak: { pct: number; value: number }; color: string; text: string }) {
  if (!s.inView(peak.pct)) return null;
  const [x, y] = [s.x(peak.pct), s.y(peak.value * 100)];
  return (
    <g pointerEvents="none">
      <line x1={x + 6} x2={x + 40} y1={y} y2={y} stroke={color} strokeDasharray="2 2" />
      <text x={x + 44} y={y + 3} fontSize={9.5} className="tele-num" fill={color}>
        {text}
      </text>
    </g>
  );
}

// The Target and Compare laps' brake through the focus area, marking where each first brakes and fully releases its
// main braking zone, each peak, and the distance between the brakepoints.
export default function BrakeTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const labels = dictionary.charts.telemetry;
  const { axis, base, compare, grid, events, settings, cursorIndex } = useTelemetry();
  const [target, other] = grid.brakes;
  const deltas = useMemo(() => other.map((value, i) => value - target[i]), [target, other]);
  const range = useMemo(() => niceLimit(Math.max(10, ...deltas.filter(Number.isFinite).map(Math.abs))), [deltas]);

  const [targetValue, compareValue] = cursorIndex === null ? [NaN, NaN] : [target[cursorIndex], other[cursorIndex]];
  const percent = (value: number) => (Number.isFinite(value) ? `${value.toFixed(0)}%` : '–');
  // Rounded as shown, so the difference matches the two values beside it
  const shownDelta = Math.round(compareValue) - Math.round(targetValue);
  const pp = Number.isFinite(shownDelta) ? `${signedValue(shownDelta, locale)} ${labels.percentPoints}` : '–';
  const [targetBrake, compareBrake] = [events.target.brakePoint, events.compare.brakePoint];
  const [targetPeak, comparePeak] = [events.target.peakBrake, events.compare.peakBrake];
  const at = (pct: number | null) => (pct === null ? '' : positionLabel(pct, axis));
  const peaks = [targetPeak, comparePeak].flatMap((peak) => (peak ? [peak.value * 100] : []));
  const bracketAt = BRACKET_HEIGHTS.find((height) => peaks.every((peak) => Math.abs(peak - height) > BRACKET_CLEARANCE)) ?? BRACKET_HEIGHTS[0];

  return (
    <TelemetryChart
      id={id}
      title={labels.brakePressure}
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
      ariaLabel={`${labels.brakePressure}. ${base.title}: ${base.summary} ${compare.title}: ${compare.summary}`}
      readout={
        <>
          <Readout label={labels.target} value={percent(targetValue)} tone="target" />
          <Readout label={labels.compare} value={percent(compareValue)} tone="compare" />
          <Readout label="Δ" value={pp} />
          {targetPeak && <Readout label={fmt(labels.peakOf, { lap: labels.targetInitial })} value={percent(targetPeak.value * 100)} tone="target" />}
          {comparePeak && <Readout label={fmt(labels.peakOf, { lap: labels.compareInitial })} value={percent(comparePeak.value * 100)} tone="compare" />}
        </>
      }
      overlay={(s) => (
        <>
          <TelemetryEventMarkers
            s={s}
            visible={settings.showEvents}
            markers={[
              { pct: targetBrake, label: fmt(labels.markerBrake, { lap: labels.targetInitial, position: at(targetBrake) }), color: TARGET_COLOR },
              { pct: compareBrake, label: fmt(labels.markerBrake, { lap: labels.compareInitial, position: at(compareBrake) }), color: COMPARE_COLOR },
              { pct: events.target.brakeRelease, label: fmt(labels.markerRelease, { lap: labels.targetInitial }), color: TARGET_COLOR, dashed: true },
              { pct: events.compare.brakeRelease, label: fmt(labels.markerRelease, { lap: labels.compareInitial }), color: COMPARE_COLOR, dashed: true },
            ]}
          />
          {settings.showEvents && settings.showTarget && targetPeak && (
            <PeakLabel s={s} peak={targetPeak} color={TARGET_COLOR} text={fmt(labels.markerPeak, { n: (targetPeak.value * 100).toFixed(0) })} />
          )}
          {settings.showEvents && settings.showCompare && comparePeak && (
            <PeakLabel s={s} peak={comparePeak} color={COMPARE_COLOR} text={fmt(labels.markerPeak, { n: (comparePeak.value * 100).toFixed(0) })} />
          )}
          {settings.showEvents && targetBrake !== null && compareBrake !== null && (
            <MeasurementBracket
              s={s}
              from={targetBrake}
              to={compareBrake}
              y={s.y(bracketAt)}
              label={fmt(compareBrake >= targetBrake ? labels.bracketBrakeLater : labels.bracketBrakeEarlier, { gap: gapLabel(compareBrake - targetBrake, axis) })}
            />
          )}
        </>
      )}
    />
  );
}
