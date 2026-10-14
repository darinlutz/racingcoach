'use client';

import { type KeyboardEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { lineOffsets } from '@/lib/areaInputs';
import {
  BASE_LAP_COLOR,
  CHART_MARGIN as MARGIN,
  clamp,
  COMPARE_LAP_COLOR,
  positionLabel,
  xTicks,
  type Axis,
} from '@/lib/lapCharts';
import { DISTANCE_UNIT, distanceFromMeters } from '@/lib/units';

const HEIGHT = 200;
// Points along the area the Compare lap's distance from the Base line is measured at
const SAMPLES = 201;
// The vertical axis runs from -limit to +limit (feet or meters), the smallest of these that fits the Compare lap
const LIMITS = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500];
// The Compare lap within this much (feet or meters, as shown) of the Base line counts as on it
const SAME_LINE = 0.5;

function LineKey({ color }: { color: string }) {
  return <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

// How far left or right of the Base lap's line the Compare lap was through one focus area, sharing the pedal
// traces' horizontal axis and crosshair: the Base lap is the flat blue line at zero, the Compare lap the red
// line, left of the Base line up and right of it down (measured across the Base line's direction of travel,
// at the same lap position, by lineOffsets). Nothing is drawn when either lap has no track positions here;
// the map above already says so.
export default function DrivingLineDiffTrace({
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
  const { t: dictionary, fmt, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.charts;
  const offsetAt = lineOffsets(compare.trace, base.trace);
  if (!offsetAt) return null;

  const unit = DISTANCE_UNIT[units];
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  // lineOffsets measures along the Base lap's domain; the chart's axis is the same domain
  const [from, to] = base.trace.domain;
  const offsetAtPct = (pct: number) => distanceFromMeters(offsetAt(clamp((pct - from) / (to - from), 0, 1)), units);
  const pcts = Array.from({ length: SAMPLES }, (_, i) => from + (i / (SAMPLES - 1)) * (to - from));
  const offsets = pcts.map(offsetAtPct);

  const largest = Math.max(...offsets.map(Math.abs), 0);
  const limit = LIMITS.find((l) => l >= largest) ?? Math.ceil(largest / 100) * 100;
  const yTicks = [-limit, -limit / 2, 0, limit / 2, limit];

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (value: number) => MARGIN.top + ((limit - clamp(value, -limit, limit)) / (2 * limit)) * innerH;
  const comparePath = pcts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p).toFixed(1)},${y(offsets[i]).toFixed(1)}`).join('');

  // 1.5 -> "1.5 ft L", -1.5 -> "1.5 ft R", 0 -> "0 ft". fixed keeps the decimal on whole numbers ("2.0 ft L"),
  // for the crosshair's readout; tick labels drop it ("2 ft L")
  const sideLabel = (value: number, fixed = false) => {
    const shown = Number(Math.abs(value).toFixed(1));
    if (shown === 0) return `0 ${unit}`;
    const n = shown.toLocaleString(locale, { minimumFractionDigits: fixed ? 1 : 0, maximumFractionDigits: 1 });
    return fmt(value > 0 ? t.lineLeft : t.lineRight, { n, unit });
  };

  // Text version of the chart: the Compare lap's largest distance from the Base line, and where it was
  const widest = offsets.reduce((best, value, i) => (Math.abs(value) > Math.abs(offsets[best]) ? i : best), 0);
  const summary =
    Math.abs(offsets[widest]) < SAME_LINE
      ? fmt(t.lineDiffSame, { n: SAME_LINE.toLocaleString(locale), unit })
      : fmt(offsets[widest] > 0 ? t.lineDiffLeft : t.lineDiffRight, {
          n: Math.abs(offsets[widest]).toLocaleString(locale, { maximumFractionDigits: 1 }),
          unit,
          where: positionLabel(pcts[widest], axis),
        });

  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));
  const hoverOffset = hoverPct === null ? null : offsetAtPct(hoverPct);

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
      <div className="flex flex-wrap items-center gap-4 mb-1 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{t.lineDiffTitle}</span>
        <span className="flex items-center gap-1.5">
          <LineKey color={BASE_LAP_COLOR} /> {base.title}
        </span>
        <span className="flex items-center gap-1.5">
          <LineKey color={COMPARE_LAP_COLOR} /> {compare.title}
        </span>
      </div>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={fmt(t.lineDiffAria, { summary })}
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

        {/* Recessive hairline grid; the Base line at zero is drawn in blue below */}
        {yTicks.map((tick) => (
          <g key={tick}>
            {tick !== 0 && (
              <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
            )}
            <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">
              {sideLabel(tick)}
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis)}
          </text>
        ))}

        <g clipPath={`url(#${id}-plot)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(0)} y2={y(0)} stroke={BASE_LAP_COLOR} />
          <path d={comparePath} stroke={COMPARE_LAP_COLOR} />
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

      {hoverOffset !== null && hoverX !== null && hoverPct !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 px-3 py-2 rounded-lg border border-border bg-card shadow-lg text-xs"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(hoverPct, axis)}</p>
          <p className="flex items-center gap-2">
            <LineKey color={COMPARE_LAP_COLOR} />
            <span className="font-semibold text-foreground tabular-nums">
              {sideLabel(hoverOffset, true)}
            </span>
            <span className="text-muted-foreground">{t.lineOfBase}</span>
          </p>
        </div>
      )}

      <figcaption className="mt-1 text-xs text-muted-foreground">
        {summary}. {t.lineDiffCaption}
      </figcaption>
    </figure>
  );
}
