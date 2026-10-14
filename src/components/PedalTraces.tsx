'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import DrivingLineDiffTrace from '@/components/DrivingLineDiffTrace';
import SteeringTrace from '@/components/SteeringTrace';
import { useLanguage } from '@/components/LanguageProvider';
import TimeDeltaTrace from '@/components/TimeDeltaTrace';
import TrackLineMap from '@/components/TrackLineMap';
import { useUnits } from '@/components/UnitsProvider';
import { CHART_MARGIN as MARGIN, clamp, nearestIndex, positionLabel, xTicks, type Axis } from '@/lib/lapCharts';
import type { AreaTrace } from '@/lib/lapData';
import { DISTANCE_UNIT, distanceFromFeet } from '@/lib/units';

// Brake red and throttle green, checked with the dataviz palette validator against the panel surface
// (#202124, dark): inside the lightness band, CVD separation ΔE 9.2 (deutan), contrast >= 3:1
const BRAKE_COLOR = '#c9302c';
const THROTTLE_COLOR = '#26a764';

const HEIGHT = 180;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
// End labels closer than this (px) would collide, so the legend carries identity instead
const MIN_LABEL_GAP = 14;

export type PedalTraceLap = {
  title: string; // e.g. "Base lap · 1:25.488"
  trace: AreaTrace;
  summary: string; // text version of the chart, e.g. "Brakes at 812 ft (max 80%), throttle at 1,299 ft"
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function LineKey({ color }: { color: string }) {
  return <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

function TraceChart({
  id,
  lap,
  axis,
  width,
  hoverPct,
  onHover,
}: {
  id: string;
  lap: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t } = useLanguage();
  const { pcts, brakes, throttles } = lap.trace;
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (value: number) => MARGIN.top + (1 - clamp(value, 0, 1)) * innerH;
  const path = (values: number[]) =>
    pcts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p).toFixed(1)},${y(values[i]).toFixed(1)}`).join('');

  const last = pcts.length - 1;
  const brakeEndY = y(brakes[last]);
  const throttleEndY = y(throttles[last]);
  const showEndLabels = Math.abs(brakeEndY - throttleEndY) >= MIN_LABEL_GAP;

  const hoverIndex = hoverPct === null ? null : nearestIndex(pcts, hoverPct);
  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));

  const positionFromPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return null;
    return clamp(d0 + ((event.clientX - box.left - MARGIN.left) / innerW) * span, d0, d1);
  };

  // Arrow keys move the crosshair a hundredth of the area at a time
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (span / 100);
    onHover(clamp((hoverPct ?? d0) + step, d0, d1));
  };

  return (
    <figure className="relative">
      <p className="text-sm font-semibold text-foreground mb-1">{lap.title}</p>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={`${lap.title}: ${lap.summary}`}
        onKeyDown={onKeyDown}
        onFocus={() => onHover(hoverPct ?? d0)}
        onBlur={() => onHover(null)}
        className="block text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
      >
        <defs>
          <clipPath id={`${id}-plot`}>
            <rect x={MARGIN.left} y={0} width={innerW} height={HEIGHT} />
          </clipPath>
        </defs>

        {/* Recessive hairline grid and axes */}
        {Y_TICKS.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis)}
          </text>
        ))}

        <g clipPath={`url(#${id}-plot)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          <path d={path(throttles)} stroke={THROTTLE_COLOR} />
          <path d={path(brakes)} stroke={BRAKE_COLOR} />
        </g>

        {/* Direct end labels when they don't collide; the legend always carries identity */}
        {showEndLabels && (
          <g fontSize={11} fill="currentColor">
            <text x={MARGIN.left + innerW + 6} y={brakeEndY} dy="0.32em">
              {t.charts.brake}
            </text>
            <text x={MARGIN.left + innerW + 6} y={throttleEndY} dy="0.32em">
              {t.charts.throttle}
            </text>
          </g>
        )}

        {hoverX !== null && (
          <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="currentColor" strokeWidth={1} />
        )}

        {/* The hit target is the whole plot, not the 2px lines */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={(event) => onHover(positionFromPointer(event))}
          onPointerLeave={() => onHover(null)}
        />
      </svg>

      {hoverIndex !== null && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-6 z-10 px-3 py-2 rounded-lg border border-border bg-card shadow-lg text-xs"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(pcts[hoverIndex], axis)}</p>
          <p className="flex items-center gap-2">
            <LineKey color={BRAKE_COLOR} />
            <span className="font-semibold text-foreground tabular-nums">{Math.round(brakes[hoverIndex] * 100)}%</span>
            <span className="text-muted-foreground">{t.charts.brake}</span>
          </p>
          <p className="flex items-center gap-2">
            <LineKey color={THROTTLE_COLOR} />
            <span className="font-semibold text-foreground tabular-nums">{Math.round(throttles[hoverIndex] * 100)}%</span>
            <span className="text-muted-foreground">{t.charts.throttle}</span>
          </p>
        </div>
      )}

      <figcaption className="mt-1 text-xs text-muted-foreground">{lap.summary}</figcaption>
    </figure>
  );
}

// Brake and throttle through one focus area for the Base and Compare laps, on the same horizontal axis,
// with a crosshair that follows the pointer (or arrow keys) on all the charts at once. Below them, the
// time the Compare lap gains or loses through the area (TimeDeltaTrace), both laps' steering angle on one
// chart (SteeringTrace), then their driving lines on a map (TrackLineMap) with the crosshair's position
// marked on each, and how far left or right of the Base lap's line the Compare lap was (DrivingLineDiffTrace).
// id must be unique on
// the page (the charts' clip paths are named after it). Charts only draw once the container has a width,
// so inside a closed <details> they draw when it's opened.
export default function PedalTraces({
  id,
  lengthFeet,
  base,
  compare,
}: {
  id: string;
  lengthFeet: number | null;
  base: PedalTraceLap;
  compare: PedalTraceLap;
}) {
  const { t, locale } = useLanguage();
  const units = useUnits();
  const [containerRef, width] = useWidth();
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const axis: Axis = {
    domain: base.trace.domain,
    length: lengthFeet ? distanceFromFeet(lengthFeet, units) : null,
    unit: DISTANCE_UNIT[units],
    locale,
  };

  return (
    <div ref={containerRef} className="space-y-4">
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <LineKey color={BRAKE_COLOR} /> {t.charts.brake}
        </span>
        <span className="flex items-center gap-1.5">
          <LineKey color={THROTTLE_COLOR} /> {t.charts.throttle}
        </span>
      </p>
      {width > 0 && (
        <>
          <TraceChart id={`${id}-base`} lap={base} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <TraceChart id={`${id}-compare`} lap={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <TimeDeltaTrace id={`${id}-delta`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <SteeringTrace id={`${id}-steering`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <TrackLineMap base={base} compare={compare} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <DrivingLineDiffTrace id={`${id}-line`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
        </>
      )}
    </div>
  );
}
