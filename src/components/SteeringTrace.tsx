'use client';

import { type KeyboardEvent, type PointerEvent } from 'react';

import type { PedalTraceLap } from '@/components/PedalTraces';
import {
  BASE_LAP_COLOR,
  CHART_MARGIN as MARGIN,
  clamp,
  COMPARE_LAP_COLOR,
  nearestIndex,
  positionLabel,
  xTicks,
  type Axis,
} from '@/lib/lapCharts';

const HEIGHT = 200;
// The vertical axis runs from -limit to +limit, the smallest of these (degrees) that fits both laps
const LIMITS = [15, 30, 45, 60, 90, 120, 180, 270, 360, 540, 720, 900];
// End labels closer than this (px) would collide, so the legend carries identity instead
const MIN_LABEL_GAP = 14;

const degrees = (radians: number) => (radians * 180) / Math.PI;

// iRacing's steering angle is positive to the left: 30 -> "30° L", -30 -> "30° R"
function steeringLabel(deg: number) {
  const rounded = Math.round(deg);
  return rounded === 0 ? '0°' : `${Math.abs(rounded)}° ${rounded > 0 ? 'L' : 'R'}`;
}

function LineKey({ color }: { color: string }) {
  return <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

// The Base (blue) and Compare (red) laps' steering wheel angle through one focus area on one chart,
// sharing the pedal traces' horizontal axis and crosshair. Left turns are up, right turns down.
export default function SteeringTrace({
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
  const laps = [
    { key: 'base', label: 'Base', lap: base, color: BASE_LAP_COLOR, angles: base.trace.steerings.map(degrees) },
    { key: 'compare', label: 'Compare', lap: compare, color: COMPARE_LAP_COLOR, angles: compare.trace.steerings.map(degrees) },
  ];

  const largest = Math.max(...laps.flatMap(({ angles }) => angles.map(Math.abs)), 1);
  const limit = LIMITS.find((l) => l >= largest) ?? Math.ceil(largest / 180) * 180;
  const yTicks = [-limit, -limit / 2, 0, limit / 2, limit];

  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (deg: number) => MARGIN.top + ((limit - clamp(deg, -limit, limit)) / (2 * limit)) * innerH;
  const path = (pcts: number[], angles: number[]) =>
    pcts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p).toFixed(1)},${y(angles[i]).toFixed(1)}`).join('');

  const endYs = laps.map(({ angles }) => y(angles[angles.length - 1]));
  const showEndLabels = Math.abs(endYs[0] - endYs[1]) >= MIN_LABEL_GAP;

  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));
  const hoverAngles =
    hoverPct === null ? null : laps.map(({ lap, angles }) => angles[nearestIndex(lap.trace.pcts, hoverPct)]);

  // Text version of the chart: each lap's largest angle each way
  const summary = laps
    .map(({ label, angles }) => {
      const left = Math.max(0, ...angles);
      const right = Math.min(0, ...angles);
      const parts = [left >= 1 && `${Math.round(left)}° left`, right <= -1 && `${Math.round(-right)}° right`].filter(Boolean);
      return `${label} lap: ${parts.length > 0 ? `up to ${parts.join(' and ')}` : 'straight'}`;
    })
    .join('; ');

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
        <span className="text-sm font-semibold text-foreground">Steering</span>
        {laps.map(({ key, lap, color }) => (
          <span key={key} className="flex items-center gap-1.5">
            <LineKey color={color} /> {lap.title}
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={`Steering wheel angle. ${summary}`}
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

        {/* Recessive hairline grid; the straight-ahead line a little stronger */}
        {yTicks.map((tick) => (
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
              {steeringLabel(tick)}
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis.lengthFeet)}
          </text>
        ))}

        <g clipPath={`url(#${id}-plot)`} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          {laps.map(({ key, lap, color, angles }) => (
            <path key={key} d={path(lap.trace.pcts, angles)} stroke={color} />
          ))}
        </g>

        {/* Direct end labels when they don't collide; the legend always carries identity */}
        {showEndLabels && (
          <g fontSize={11} fill="currentColor">
            {laps.map(({ key, label }, i) => (
              <text key={key} x={MARGIN.left + innerW + 6} y={endYs[i]} dy="0.32em">
                {label}
              </text>
            ))}
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

      {hoverAngles !== null && hoverX !== null && hoverPct !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 px-3 py-2 rounded-lg border border-border bg-card shadow-lg text-xs"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(hoverPct, axis.lengthFeet)}</p>
          {laps.map(({ key, label, color }, i) => (
            <p key={key} className="flex items-center gap-2">
              <LineKey color={color} />
              <span className="font-semibold text-foreground tabular-nums">{steeringLabel(hoverAngles[i])}</span>
              <span className="text-muted-foreground">{label}</span>
            </p>
          ))}
        </div>
      )}

      <figcaption className="mt-1 text-xs text-muted-foreground">{summary}. Left turns are up, right turns down.</figcaption>
    </figure>
  );
}
