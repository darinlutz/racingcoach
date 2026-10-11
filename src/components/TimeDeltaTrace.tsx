'use client';

import { type KeyboardEvent, type PointerEvent } from 'react';

import type { PedalTraceLap } from '@/components/PedalTraces';
import { CHART_MARGIN as MARGIN, clamp, nearestIndex, positionLabel, xTicks, type Axis } from '@/lib/lapCharts';
import { timeAtPosition } from '@/lib/lapData';

const HEIGHT = 180;
// Shading where the Compare lap loses time (above zero) and gains it (below zero)
const LOSS_FILL = 'rgba(255, 64, 64, 0.22)';
const GAIN_FILL = 'rgba(38, 167, 100, 0.25)';
const LOSS_TEXT = 'text-red-300';
const GAIN_TEXT = 'text-green-300';

// +0.123 s / -0.045 s
function formatDelta(seconds: number) {
  const rounded = Math.round(seconds * 1000) / 1000;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(3)} s`;
}

// Round seconds ticks covering lo..hi and 0: steps of 1/2/5 x 10^n
function yTicks(lo: number, hi: number) {
  const raw = Math.max(hi - lo, 0.01) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

// The Compare lap's time gained or lost against the Base lap through one focus area: at each position,
// how much longer the Compare lap has taken since the area's start than the Base lap. Above zero the
// Compare lap is behind, below zero ahead; the end value is the area's difference in the table. Shares
// the pedal traces' horizontal axis and crosshair.
export default function TimeDeltaTrace({
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
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  // Both laps' time at the same positions, about one per pixel
  const count = Math.max(2, Math.min(600, Math.round(innerW)));
  const pcts = Array.from({ length: count }, (_, i) => d0 + (i / (count - 1)) * span);
  const [baseStart, compareStart] = [timeAtPosition(base.trace, d0), timeAtPosition(compare.trace, d0)];
  const deltas = pcts.map(
    (p) => timeAtPosition(compare.trace, p) - compareStart - (timeAtPosition(base.trace, p) - baseStart)
  );

  const ticks = yTicks(Math.min(0, ...deltas), Math.max(0, ...deltas));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (seconds: number) => MARGIN.top + ((hi - clamp(seconds, lo, hi)) / (hi - lo)) * innerH;
  const zeroY = y(0);

  const line = pcts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p).toFixed(1)},${y(deltas[i]).toFixed(1)}`).join('');
  const area = `${line}L${x(d1).toFixed(1)},${zeroY.toFixed(1)}L${x(d0).toFixed(1)},${zeroY.toFixed(1)}Z`;

  const final = deltas[deltas.length - 1];
  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));
  const hoverDelta = hoverPct === null ? null : deltas[nearestIndex(pcts, hoverPct)];

  // Text version of the chart: where the gap ends, and its largest swing each way
  const most = Math.max(...deltas);
  const least = Math.min(...deltas);
  const summary = [
    `Compare lap ends the area ${formatDelta(final)}`,
    most > 0.0005 && `most behind ${formatDelta(most)}`,
    least < -0.0005 && `most ahead ${formatDelta(least)}`,
  ]
    .filter(Boolean)
    .join(', ');

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
        <span className="text-sm font-semibold text-foreground">Time gained/lost</span>
        <span>Compare lap vs Base lap</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: LOSS_FILL }} /> Compare behind
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: GAIN_FILL }} /> Compare ahead
        </span>
      </div>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={`Time gained or lost. ${summary}`}
        onKeyDown={onKeyDown}
        onFocus={() => onHover(hoverPct ?? d0)}
        onBlur={() => onHover(null)}
        className="block text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
      >
        <defs>
          <clipPath id={`${id}-behind`}>
            <rect x={MARGIN.left} y={0} width={innerW} height={zeroY} />
          </clipPath>
          <clipPath id={`${id}-ahead`}>
            <rect x={MARGIN.left} y={zeroY} width={innerW} height={HEIGHT - zeroY} />
          </clipPath>
        </defs>

        {/* Recessive hairline grid; the zero line (laps level) a little stronger */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? 'currentColor' : 'var(--border)'}
              strokeOpacity={tick === 0 ? 0.5 : 1}
              strokeWidth={1}
            />
            <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">
              {tick === 0 ? '0' : `${tick > 0 ? '+' : '−'}${Number(Math.abs(tick).toPrecision(3))}`}
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis.lengthFeet)}
          </text>
        ))}

        <path d={area} fill={LOSS_FILL} clipPath={`url(#${id}-behind)`} />
        <path d={area} fill={GAIN_FILL} clipPath={`url(#${id}-ahead)`} />
        <path d={line} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* The area's result, at the end of the line */}
        <text
          x={MARGIN.left + innerW + 6}
          y={y(final)}
          dy="0.32em"
          fontSize={11}
          className={`tabular-nums ${final > 0 ? 'fill-red-300' : final < 0 ? 'fill-green-300' : 'fill-current'}`}
        >
          {formatDelta(final).replace(' s', '')}
        </text>

        {hoverX !== null && (
          <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="currentColor" strokeWidth={1} />
        )}

        {/* The hit target is the whole plot, not the 2px line */}
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

      {hoverDelta !== null && hoverX !== null && hoverPct !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 px-3 py-2 rounded-lg border border-border bg-card shadow-lg text-xs"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(hoverPct, axis.lengthFeet)}</p>
          <p className="flex items-center gap-2">
            <span className={`font-semibold tabular-nums ${hoverDelta > 0 ? LOSS_TEXT : hoverDelta < 0 ? GAIN_TEXT : 'text-foreground'}`}>
              {formatDelta(hoverDelta)}
            </span>
            <span className="text-muted-foreground">
              {Math.abs(hoverDelta) < 0.0005 ? 'level' : hoverDelta > 0 ? 'Compare behind' : 'Compare ahead'}
            </span>
          </p>
        </div>
      )}

      <figcaption className="mt-1 text-xs text-muted-foreground">
        {summary}. Above zero the Compare lap has taken longer since the start of the area; below zero it&apos;s ahead.
      </figcaption>
    </figure>
  );
}
