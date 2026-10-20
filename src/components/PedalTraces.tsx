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
// The Compare lap's lines: lighter versions of the same colors, dotted
const COMPARE_BRAKE_COLOR = '#f0807c';
const COMPARE_THROTTLE_COLOR = '#7ad9a4';
const DOTTED = '0 4'; // zero-length dashes with round caps draw dots

const HEIGHT = 220;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

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

function LineKey({ color, dotted = false }: { color: string; dotted?: boolean }) {
  return dotted ? (
    <span className="inline-block w-3 align-middle border-t-2 border-dotted" style={{ borderColor: color }} />
  ) : (
    <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />
  );
}

// Both laps' brake and throttle on one chart: the Base lap in solid lines, the Compare lap in
// lighter dotted ones
function TraceChart({
  id,
  base,
  compare,
  axis,
  width,
  hoverPct,
  onHover,
}: {
  id: string;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t } = useLanguage();
  const laps = [
    { key: 'base', lap: base, brakeColor: BRAKE_COLOR, throttleColor: THROTTLE_COLOR, dotted: false },
    { key: 'compare', lap: compare, brakeColor: COMPARE_BRAKE_COLOR, throttleColor: COMPARE_THROTTLE_COLOR, dotted: true },
  ];
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (value: number) => MARGIN.top + (1 - clamp(value, 0, 1)) * innerH;
  const path = (pcts: number[], values: number[]) =>
    pcts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p).toFixed(1)},${y(values[i]).toFixed(1)}`).join('');

  const hoverIndexes = hoverPct === null ? null : laps.map(({ lap }) => nearestIndex(lap.trace.pcts, hoverPct));
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
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-1 text-xs text-muted-foreground">
        {laps.map(({ key, lap, brakeColor, throttleColor, dotted }) => (
          <span key={key} className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{lap.title}</span>
            <span className="flex items-center gap-1.5">
              <LineKey color={brakeColor} dotted={dotted} /> {t.charts.brake}
            </span>
            <span className="flex items-center gap-1.5">
              <LineKey color={throttleColor} dotted={dotted} /> {t.charts.throttle}
            </span>
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={laps.map(({ lap }) => `${lap.title}: ${lap.summary}`).join(' ')}
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

        {/* Base lap underneath, Compare lap's dots on top so they stay visible where the lines meet */}
        <g clipPath={`url(#${id}-plot)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          {laps.map(({ key, lap, brakeColor, throttleColor, dotted }) => (
            <g key={key} strokeDasharray={dotted ? DOTTED : undefined} strokeWidth={dotted ? 2.5 : 2}>
              <path d={path(lap.trace.pcts, lap.trace.throttles)} stroke={throttleColor} />
              <path d={path(lap.trace.pcts, lap.trace.brakes)} stroke={brakeColor} />
            </g>
          ))}
        </g>

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

      {hoverIndexes !== null && hoverX !== null && hoverPct !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 px-3 py-2 rounded-lg border border-border bg-card shadow-lg text-xs"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(hoverPct, axis)}</p>
          {laps.map(({ key, lap, brakeColor, throttleColor, dotted }, i) => (
            <div key={key} className={i > 0 ? 'mt-1.5' : ''}>
              <p className="font-semibold text-foreground">{lap.title}</p>
              <p className="flex items-center gap-2">
                <LineKey color={brakeColor} dotted={dotted} />
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.round(lap.trace.brakes[hoverIndexes[i]] * 100)}%
                </span>
                <span className="text-muted-foreground">{t.charts.brake}</span>
              </p>
              <p className="flex items-center gap-2">
                <LineKey color={throttleColor} dotted={dotted} />
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.round(lap.trace.throttles[hoverIndexes[i]] * 100)}%
                </span>
                <span className="text-muted-foreground">{t.charts.throttle}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <figcaption className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {laps.map(({ key, lap }) => (
          <p key={key}>
            <span className="text-foreground">{lap.title}:</span> {lap.summary}
          </p>
        ))}
      </figcaption>
    </figure>
  );
}

// The time the Compare lap gains or loses through one focus area (TimeDeltaTrace), then brake and throttle
// for the Base (solid) and Compare (lighter, dotted) laps on one chart, with a crosshair that follows the
// pointer (or arrow keys) on all the charts at once. Below them, both laps' steering angle on one
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
  const { locale } = useLanguage();
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
      {width > 0 && (
        <>
          <TimeDeltaTrace id={`${id}-delta`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <TraceChart id={`${id}-pedals`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <SteeringTrace id={`${id}-steering`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <TrackLineMap base={base} compare={compare} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
          <DrivingLineDiffTrace id={`${id}-line`} base={base} compare={compare} axis={axis} width={width} hoverPct={hoverPct} onHover={setHoverPct} />
        </>
      )}
    </div>
  );
}
