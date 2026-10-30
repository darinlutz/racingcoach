'use client';

import { memo, useMemo, type KeyboardEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { clamp, nearestIndex, positionLabel, xTicks, type Axis } from '@/lib/lapCharts';
import type { TireCorner } from '@/lib/lapData';
import { deltaColor, formatDelta, formatTireTemp, shownDelta, type TireCompareReason, type TireDeltaSeries } from '@/lib/tireTempComparison';
import { temperatureDeltaFromCelsius, temperatureFromCelsius } from '@/lib/units';

const VW = 440;
const VH = 190;
const PAD = { l: 32, r: 8, t: 8 };
const TOP_H = 92;
const GAP = 12;
const BOT_H = 56;

// Lines through the finite values, with a gap wherever a lap has none: never joined across it
function linePath(pcts: number[], values: number[], x: (pct: number) => number, y: (value: number) => number) {
  let pen = 'M';
  return values
    .map((value, i) => {
      if (!Number.isFinite(value)) {
        pen = 'M';
        return '';
      }
      const segment = `${pen}${x(pcts[i]).toFixed(1)} ${y(value).toFixed(1)}`;
      pen = 'L';
      return segment;
    })
    .join('');
}

// The area between the delta line and zero, one closed shape per unbroken run
function fillPath(pcts: number[], values: number[], x: (pct: number) => number, y: (value: number) => number, zeroY: number) {
  let path = '';
  let lastX: number | null = null;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) {
      if (lastX !== null) path += `L${lastX.toFixed(1)} ${zeroY.toFixed(1)}Z`;
      lastX = null;
      return;
    }
    const px = x(pcts[i]);
    if (lastX === null) path += `M${px.toFixed(1)} ${zeroY.toFixed(1)}`;
    path += `L${px.toFixed(1)} ${y(value).toFixed(1)}`;
    lastX = px;
  });
  if (lastX !== null) path += `L${(lastX as number).toFixed(1)} ${zeroY.toFixed(1)}Z`;
  return path;
}

// One tire through the focus area: both laps' temperature on a scale shared by the four tires, and under it the
// difference on a shared scale centered on zero. A pair of laps that can't be compared here gets the reason instead
// of a chart: a held pit reading has no trace to draw. The lines are worked out once per lap pair; only the
// crosshair moves.
const TireDeltaChart = memo(function TireDeltaChart({
  corner,
  series,
  reason,
  axis,
  tempRange,
  deltaRange,
  cursorPct,
  highlighted,
  onHover,
}: {
  corner: TireCorner;
  series: TireDeltaSeries | null;
  reason: TireCompareReason | null;
  axis: Axis;
  tempRange: [number, number];
  deltaRange: number;
  cursorPct: number | null;
  highlighted: boolean;
  onHover: (pct: number | null) => void;
}) {
  const { t, locale } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = VW - PAD.l - PAD.r;
  const botTop = PAD.t + TOP_H + GAP;

  const x = (pct: number) => PAD.l + ((pct - d0) / span) * innerW;
  const yTemp = (value: number) => PAD.t + (1 - (value - tempRange[0]) / (tempRange[1] - tempRange[0])) * TOP_H;
  const yDelta = (value: number) => botTop + BOT_H / 2 - (clamp(value, -deltaRange, deltaRange) / deltaRange) * (BOT_H / 2);
  const zeroY = botTop + BOT_H / 2;

  const paths = useMemo(() => {
    if (!series || reason) return null;
    const scaleX = (pct: number) => PAD.l + ((pct - d0) / (d1 - d0)) * (VW - PAD.l - PAD.r);
    const scaleTemp = (value: number) => PAD.t + (1 - (value - tempRange[0]) / (tempRange[1] - tempRange[0])) * TOP_H;
    const top = PAD.t + TOP_H + GAP;
    const scaleDelta = (value: number) => top + BOT_H / 2 - (clamp(value, -deltaRange, deltaRange) / deltaRange) * (BOT_H / 2);
    const zero = top + BOT_H / 2;
    return {
      target: linePath(series.pcts, series.target, scaleX, scaleTemp),
      compare: linePath(series.pcts, series.compare, scaleX, scaleTemp),
      delta: linePath(series.pcts, series.delta, scaleX, scaleDelta),
      hotter: fillPath(series.pcts, series.delta.map((d) => (Number.isFinite(d) ? Math.max(0, d) : NaN)), scaleX, scaleDelta, zero),
      cooler: fillPath(series.pcts, series.delta.map((d) => (Number.isFinite(d) ? Math.min(0, d) : NaN)), scaleX, scaleDelta, zero),
    };
  }, [series, reason, d0, d1, tempRange, deltaRange]);

  const tireColor = `var(--tire-${corner.toLowerCase()})`;
  const at = series && paths && cursorPct !== null ? nearestIndex(series.pcts, cursorPct) : null;
  const [targetAt, compareAt] = at === null || !series ? [NaN, NaN] : [series.target[at], series.compare[at]];
  const hasReadout = Number.isFinite(targetAt) && Number.isFinite(compareAt);

  const positionFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return clamp(d0 + ((((event.clientX - box.left) / box.width) * VW - PAD.l) / innerW) * span, d0, d1);
  };
  // Arrow keys move the crosshair a hundredth of the area at a time, like the charts above
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onHover(clamp((cursorPct ?? d0) + (event.key === 'ArrowRight' ? 1 : -1) * (span / 100), d0, d1));
  };

  return (
    <div
      data-chart={corner}
      className="rc-panel p-2.5"
      style={{ borderTopWidth: 2, borderTopColor: tireColor, boxShadow: highlighted ? '0 0 0 1px var(--foreground)' : undefined }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
          <span className="rc-num mr-1.5" style={{ color: tireColor }}>{corner}</span>
          {t.charts.tireCorners[corner]}
        </span>
        {hasReadout && (
          <span className="rc-num flex gap-2 text-[11px]">
            <span className="text-lap-target">{formatTireTemp(targetAt, units, locale)}</span>
            <span className="text-lap-compare">{formatTireTemp(compareAt, units, locale)}</span>
            <span className="font-bold" style={{ color: deltaColor(compareAt - targetAt) }}>
              {formatDelta(shownDelta(compareAt, targetAt, units), locale)}
            </span>
          </span>
        )}
      </div>

      {!paths ? (
        <p className="py-6 text-sm text-muted-foreground">{reason ? labels.reasons[reason] : labels.reasons.noData}</p>
      ) : (
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="w-full text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
          tabIndex={0}
          role="img"
          aria-label={`${t.charts.tireCorners[corner]}. ${labels.deltaLabel}`}
          onPointerMove={(event) => onHover(positionFromPointer(event))}
          onPointerLeave={() => onHover(null)}
          onKeyDown={onKeyDown}
        >
          {[0, 0.5, 1].map((f) => {
            const value = tempRange[0] + f * (tempRange[1] - tempRange[0]);
            return (
              <g key={f}>
                <line x1={PAD.l} x2={VW - PAD.r} y1={yTemp(value)} y2={yTemp(value)} stroke="var(--border)" strokeWidth={0.6} />
                <text x={PAD.l - 4} y={yTemp(value) + 3} textAnchor="end" fontSize={8} fill="currentColor" className="tabular-nums">
                  {Math.round(temperatureFromCelsius(value, units))}
                </text>
              </g>
            );
          })}
          <rect x={PAD.l} y={botTop} width={innerW} height={BOT_H} fill="var(--background)" opacity={0.5} />
          <text x={PAD.l - 4} y={yDelta(deltaRange) + 6} textAnchor="end" fontSize={8} fill="currentColor" className="tabular-nums">
            +{Math.round(temperatureDeltaFromCelsius(deltaRange, units))}
          </text>
          <text x={PAD.l - 4} y={zeroY + 3} textAnchor="end" fontSize={8} fill="var(--foreground)" className="tabular-nums">0</text>
          <text x={PAD.l - 4} y={yDelta(-deltaRange)} textAnchor="end" fontSize={8} fill="currentColor" className="tabular-nums">
            −{Math.round(temperatureDeltaFromCelsius(deltaRange, units))}
          </text>

          <path d={paths.target} fill="none" stroke="var(--lap-target)" strokeWidth={1.4} />
          <path d={paths.compare} fill="none" stroke="var(--lap-compare)" strokeWidth={1.4} />
          <path d={paths.hotter} fill="var(--delta-hot)" opacity={0.35} />
          <path d={paths.cooler} fill="var(--delta-cool)" opacity={0.35} />
          <path d={paths.delta} fill="none" stroke="var(--foreground)" strokeWidth={1} strokeOpacity={0.8} />
          <line x1={PAD.l} x2={VW - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--foreground)" strokeWidth={0.8} strokeOpacity={0.6} />

          {xTicks(axis).map((tick) => (
            <text key={tick} x={x(tick)} y={VH - 2} textAnchor={x(tick) > VW - 24 ? 'end' : 'middle'} fontSize={7} fill="currentColor" className="tabular-nums">
              {positionLabel(tick, axis)}
            </text>
          ))}

          {at !== null && series && (
            <g pointerEvents="none" data-cursor>
              <line x1={x(series.pcts[at])} x2={x(series.pcts[at])} y1={PAD.t} y2={botTop + BOT_H} stroke="var(--primary)" strokeWidth={1} />
              {hasReadout && (
                <>
                  <circle cx={x(series.pcts[at])} cy={yTemp(targetAt)} r={2.5} fill="var(--lap-target)" />
                  <circle cx={x(series.pcts[at])} cy={yTemp(compareAt)} r={2.5} fill="var(--lap-compare)" />
                  <circle cx={x(series.pcts[at])} cy={yDelta(compareAt - targetAt)} r={2.5} fill={deltaColor(compareAt - targetAt)} />
                </>
              )}
            </g>
          )}
        </svg>
      )}
    </div>
  );
});

export default TireDeltaChart;
