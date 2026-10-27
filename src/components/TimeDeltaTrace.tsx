'use client';

import { type KeyboardEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
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
import { timeAtPosition } from '@/lib/lapData';
import { SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

const HEIGHT = 180;
// Shading where the Compare lap loses time (above zero) and gains it (below zero)
const LOSS_FILL = 'rgba(255, 64, 64, 0.22)';
const GAIN_FILL = 'rgba(38, 167, 100, 0.25)';
const LOSS_TEXT = 'text-red-300';
const GAIN_TEXT = 'text-green-300';

// +0.123 s / -0.045 s
function formatDelta(seconds: number, locale: string) {
  const rounded = Math.round(seconds * 1000) / 1000;
  const digits = Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${digits} s`;
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

// Round speed ticks covering lo..hi: steps of 1/2/5 x 10^n, about 4 of them
function speedTicks(lo: number, hi: number) {
  const raw = Math.max(hi - lo, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) ticks.push(v);
  return ticks;
}

// The Compare lap's time gained or lost against the Base lap through one focus area: at each position,
// how much longer the Compare lap has taken since the area's start than the Base lap. Above zero the
// Compare lap is behind, below zero ahead; the end value is the area's difference in the table. Behind it,
// each lap's speed on its own axis on the right (mph or kph): Base solid blue, Compare dotted red. Shares
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
  const { t: dictionary, fmt, locale } = useLanguage();
  const t = dictionary.charts;
  const units = useUnits();
  const speedUnit = SPEED_UNIT[units];
  const delta = (seconds: number) => formatDelta(seconds, locale);
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

  // Each lap's speed at the same positions, in the user's units, on its own scale
  const speedLaps = [
    { key: 'base', label: dictionary.lapCompare.base, lap: base, color: BASE_LAP_COLOR, dash: undefined },
    { key: 'compare', label: dictionary.lapCompare.compare, lap: compare, color: COMPARE_LAP_COLOR, dash: '1 4' },
  ].map((l) => ({
    ...l,
    speeds: pcts.map((p) => speedFromMetersPerSecond(l.lap.trace.speeds[nearestIndex(l.lap.trace.pcts, p)] ?? NaN, units)),
  }));
  const allSpeeds = speedLaps.flatMap((l) => l.speeds).filter(Number.isFinite);
  const hasSpeeds = allSpeeds.length > 0;
  const sTicks = hasSpeeds ? speedTicks(Math.min(...allSpeeds), Math.max(...allSpeeds)) : [];
  const [sLo, sHi] = [sTicks[0] ?? 0, sTicks[sTicks.length - 1] ?? 1];
  const sy = (speed: number) => MARGIN.top + ((sHi - clamp(speed, sLo, sHi)) / (sHi - sLo || 1)) * innerH;
  const speedLine = (speeds: number[]) =>
    speeds
      .map((s, i) => (Number.isFinite(s) ? `${i === 0 || !Number.isFinite(speeds[i - 1]) ? 'M' : 'L'}${x(pcts[i]).toFixed(1)},${sy(s).toFixed(1)}` : ''))
      .join('');

  const final = deltas[deltas.length - 1];
  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));
  const hoverIndex = hoverPct === null ? null : nearestIndex(pcts, hoverPct);
  const hoverDelta = hoverIndex === null ? null : deltas[hoverIndex];

  // Text version of the chart: where the gap ends, and its largest swing each way
  const most = Math.max(...deltas);
  const least = Math.min(...deltas);
  const summary = [
    fmt(t.endsArea, { delta: delta(final) }),
    most > 0.0005 && fmt(t.mostBehind, { delta: delta(most) }),
    least < -0.0005 && fmt(t.mostAhead, { delta: delta(least) }),
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
        <span className="text-sm font-semibold text-foreground">{t.timeTitle}</span>
        <span>{t.timeVs}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: LOSS_FILL }} /> {t.compareBehind}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: GAIN_FILL }} /> {t.compareAhead}
        </span>
        {hasSpeeds &&
          speedLaps.map(({ key, label, color, dash }) => (
            <span key={key} className="flex items-center gap-1.5">
              <svg width={14} height={4} aria-hidden="true">
                <line x1={1} x2={13} y1={2} y2={2} stroke={color} strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
              </svg>
              {fmt(t.lapSpeed, { lap: label, unit: speedUnit })}
            </span>
          ))}
      </div>
      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={fmt(t.timeAria, { summary })}
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
              {tick === 0 ? '0' : `${tick > 0 ? '+' : '−'}${Number(Math.abs(tick).toPrecision(3)).toLocaleString(locale)}`}
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis)}
          </text>
        ))}

        {/* The speed axis, on the right (its unit is in the legend) */}
        {sTicks.map((tick) => (
          <text key={tick} x={MARGIN.left + innerW + 6} y={sy(tick)} dy="0.32em" fontSize={11} fill="currentColor" className="tabular-nums">
            {tick.toLocaleString(locale)}
          </text>
        ))}

        <path d={area} fill={LOSS_FILL} clipPath={`url(#${id}-behind)`} />
        <path d={area} fill={GAIN_FILL} clipPath={`url(#${id}-ahead)`} />
        {speedLaps.map(({ key, color, dash, speeds }) => (
          <path
            key={key}
            d={speedLine(speeds)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray={dash}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <path d={line} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* The area's result, just inside the end of the line (the speed axis has the right margin) */}
        <text
          x={MARGIN.left + innerW - 4}
          y={y(final)}
          dy={final > 0 ? '1.1em' : '-0.5em'}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          className={`tabular-nums ${final > 0 ? 'fill-red-300' : final < 0 ? 'fill-green-300' : 'fill-current'}`}
        >
          {delta(final).replace(' s', '')}
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
          <p className="text-muted-foreground mb-1 tabular-nums">{positionLabel(hoverPct, axis)}</p>
          <p className="flex items-center gap-2">
            <span className={`font-semibold tabular-nums ${hoverDelta > 0 ? LOSS_TEXT : hoverDelta < 0 ? GAIN_TEXT : 'text-foreground'}`}>
              {delta(hoverDelta)}
            </span>
            <span className="text-muted-foreground">
              {Math.abs(hoverDelta) < 0.0005 ? t.level : hoverDelta > 0 ? t.compareBehind : t.compareAhead}
            </span>
          </p>
          {hasSpeeds &&
            hoverIndex !== null &&
            speedLaps.map(({ key, label, color, speeds }) =>
              Number.isFinite(speeds[hoverIndex]) ? (
                <p key={key} className="flex items-center gap-2 mt-0.5">
                  <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="font-semibold text-foreground tabular-nums">
                    {speeds[hoverIndex].toFixed(1)} {speedUnit}
                  </span>
                  <span className="text-muted-foreground">{label}</span>
                </p>
              ) : null
            )}
        </div>
      )}

      <figcaption className="mt-1 text-xs text-muted-foreground">
        {summary}. {t.timeCaption}
      </figcaption>
    </figure>
  );
}
