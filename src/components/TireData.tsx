'use client';

import { useState, type KeyboardEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { clamp, nearestIndex, positionLabel, xTicks, type Axis } from '@/lib/lapCharts';
import type { TireCorner, TireTemps } from '@/lib/lapData';
import { TEMPERATURE_UNIT, temperatureFromCelsius } from '@/lib/units';

type Tab = 'temp' | 'pressure' | 'rideHeights';
const TABS: Tab[] = ['temp', 'pressure', 'rideHeights'];

type Edge = keyof TireTemps;
const EDGES: Edge[] = ['outer', 'middle', 'inner'];

// Outer blue, middle teal, inner red, as tire temperature charts usually are; the Compare lap's lines are
// lighter versions of the same colors, dotted
const EDGE_COLORS: Record<Edge, { base: string; compare: string }> = {
  outer: { base: '#2f80ed', compare: '#8fbaf5' },
  middle: { base: '#14a3a3', compare: '#7fd6d6' },
  inner: { base: '#e5484d', compare: '#f59a9d' },
};
const DOTTED = '0 4'; // zero-length dashes with round caps draw dots

// Upper left, upper right, lower left, lower right
const CORNER_ORDER: TireCorner[] = ['LF', 'RF', 'LR', 'RR'];
const GRID_GAP = 16;
const HEIGHT = 200;
// Narrower than the full-width charts' CHART_MARGIN, as two charts share a row
const MARGIN = { top: 10, right: 16, bottom: 28, left: 40 };

function LineKey({ color, dotted = false }: { color: string; dotted?: boolean }) {
  return dotted ? (
    <span className="inline-block w-3 align-middle border-t-2 border-dotted" style={{ borderColor: color }} />
  ) : (
    <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />
  );
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? NaN : finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

// Round temperature ticks (in the user's units) across lo..hi: steps of 1/2/5 x 10^n, about 4 of them
function yTicks(lo: number, hi: number) {
  const raw = Math.max(hi - lo, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step - 1e-9; v += step) ticks.push(v);
  return ticks;
}

// One tire's outer, middle and inner carcass temperatures through the focus area: the Base lap in solid lines
// and the Compare lap in lighter dotted ones, sharing the crosshair with the charts above. Over the chart, in
// large type, how much hotter (+) or cooler (-) the Compare lap was than the Base lap at each edge, at the
// crosshair, or on average through the area when there's no crosshair; under that each lap's own temperatures.
function TireTempChart({
  id,
  corner,
  base,
  compare,
  axis,
  width,
  hoverPct,
  onHover,
}: {
  id: string;
  corner: TireCorner;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t: dictionary, locale } = useLanguage();
  const t = dictionary.charts;
  const units = useUnits();
  const unit = TEMPERATURE_UNIT[units];
  const toUnits = (celsius: number) => temperatureFromCelsius(celsius, units);
  const laps = [
    { key: 'base' as const, lap: base, temps: base.trace.tireTemps?.[corner] ?? null },
    { key: 'compare' as const, lap: compare, temps: compare.trace.tireTemps?.[corner] ?? null },
  ];

  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const all = laps.flatMap(({ temps }) => (temps ? EDGES.flatMap((edge) => temps[edge].filter(Number.isFinite).map(toUnits)) : []));
  const ticks = all.length > 0 ? yTicks(Math.min(...all), Math.max(...all)) : [];
  const [lo, hi] = ticks.length > 1 ? [ticks[0], ticks[ticks.length - 1]] : [0, 1];
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (value: number) => MARGIN.top + (1 - (value - lo) / (hi - lo)) * innerH;
  // Gaps where the lap file has no temperature break the line
  const path = (pcts: number[], values: number[]) => {
    let pen = 'M';
    return values
      .map((value, i) => {
        if (!Number.isFinite(value)) {
          pen = 'M';
          return '';
        }
        const segment = `${pen}${x(pcts[i]).toFixed(1)},${y(toUnits(value)).toFixed(1)}`;
        pen = 'L';
        return segment;
      })
      .join('');
  };

  // Each lap's outer, middle and inner temperatures in the user's units: at the crosshair, or the area's average
  const readings = laps.map(({ lap, temps }) =>
    EDGES.map((edge) => {
      if (!temps) return NaN;
      const celsius = hoverPct === null ? average(temps[edge]) : temps[edge][nearestIndex(lap.trace.pcts, hoverPct)];
      return Number.isFinite(celsius) ? toUnits(celsius) : NaN;
    })
  );
  const format = (value: number, signed = false) =>
    Number.isFinite(value)
      ? `${signed && value >= 0 ? '+' : ''}${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`
      : '—';
  // Rounded as shown, so the difference matches the two temperatures under it
  const round = (value: number) => Math.round(value * 10) / 10;
  const diffs = EDGES.map((_, i) => round(readings[1][i]) - round(readings[0][i]));
  const edgeLabel: Record<Edge, string> = { outer: t.tireOuter, middle: t.tireMiddle, inner: t.tireInner };

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

  const title = t.tireCorners[corner];
  const readingText = (i: number) =>
    EDGES.map((edge, j) => `${edgeLabel[edge]} ${format(readings[i][j])}`).join(', ');

  return (
    <figure className="relative min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-1">
        <span className="text-sm font-semibold text-foreground">
          {title} <span className="font-normal text-muted-foreground">{unit}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {hoverPct === null ? t.tireAreaAverage : positionLabel(hoverPct, axis)}
        </span>
      </div>

      {/* The difference, Compare minus Base, stands out; each lap's temperatures are under it */}
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-label={t.tireDiffLabel}>
        {EDGES.map((edge, i) => (
          <span key={edge} className="text-2xl font-bold tabular-nums" style={{ color: EDGE_COLORS[edge].base }}>
            {format(diffs[i], true)}
          </span>
        ))}
      </p>
      <p className="mb-1 text-[11px] text-muted-foreground">{t.tireDiffLabel}</p>
      <div className="mb-2 space-y-0.5 text-xs">
        {laps.map(({ key, lap }, i) => (
          <p key={key} className="flex flex-wrap items-center gap-x-2.5">
            <span className="font-semibold text-foreground">{lap.title}</span>
            {EDGES.map((edge, j) => (
              <span key={edge} className="flex items-center gap-1 tabular-nums" style={{ color: EDGE_COLORS[edge][key] }}>
                <LineKey color={EDGE_COLORS[edge][key]} dotted={key === 'compare'} />
                {edgeLabel[edge]} {format(readings[i][j])}
              </span>
            ))}
          </p>
        ))}
      </div>

      <svg
        width={width}
        height={HEIGHT}
        tabIndex={0}
        role="img"
        aria-label={`${title}. ${laps.map(({ lap }, i) => `${lap.title}: ${readingText(i)}`).join('. ')}`}
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
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">
              {tick.toLocaleString(locale)}
            </text>
          </g>
        ))}
        {xTicks(axis).map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
            {positionLabel(tick, axis)}
          </text>
        ))}

        {/* Base lap underneath, Compare lap's dots on top so they stay visible where the lines meet */}
        <g clipPath={`url(#${id}-plot)`} fill="none" strokeLinejoin="round" strokeLinecap="round">
          {laps.map(({ key, lap, temps }) =>
            temps ? (
              <g key={key} strokeDasharray={key === 'compare' ? DOTTED : undefined} strokeWidth={key === 'compare' ? 2.5 : 2}>
                {EDGES.map((edge) => (
                  <path key={edge} d={path(lap.trace.pcts, temps[edge])} stroke={EDGE_COLORS[edge][key]} />
                ))}
              </g>
            ) : null
          )}
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
    </figure>
  );
}

// Under Lap Compare's charts for a focus area: Tire Temp, Tire Pressure and Ride Heights tabs. Tire Temp has a
// chart per tire (left front and right front above, left rear and right rear below; one column on narrow
// screens) of both laps' carcass temperatures; the other two tabs aren't filled in yet. width is the container's.
export default function TireData({
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
  const { t: dictionary, fmt } = useLanguage();
  const t = dictionary.charts;
  const [tab, setTab] = useState<Tab>('temp');
  const hasTemps = Boolean(base.trace.tireTemps || compare.trace.tireTemps);
  // The panel's padding (p-4) on both sides, then two columns when there's room
  const innerWidth = width - 32;
  const twoColumns = innerWidth >= 640;
  const chartWidth = twoColumns ? (innerWidth - GRID_GAP) / 2 : innerWidth;
  const missing = [base, compare].filter((lap) => !lap.trace.tireTemps);

  return (
    <div className="rounded-lg border border-border bg-secondary/40">
      <div role="tablist" aria-label={t.tireDataLabel} className="flex flex-wrap gap-2 px-4 pt-3 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === key ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'
            }`}
          >
            {t.tireTabs[key]}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="p-4">
        {tab !== 'temp' ? (
          <p className="text-sm text-muted-foreground">{t.tireComingSoon}</p>
        ) : !hasTemps ? (
          <p className="text-sm text-muted-foreground">{t.tireNoTemps}</p>
        ) : (
          <>
            {missing.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {fmt(t.tireLapNoTemps, { lap: missing.map((lap) => lap.title).join(', ') })}
              </p>
            )}
            <div className={`grid gap-4 ${twoColumns ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {CORNER_ORDER.map((corner) => (
                <TireTempChart
                  key={corner}
                  id={`${id}-${corner}`}
                  corner={corner}
                  base={base}
                  compare={compare}
                  axis={axis}
                  width={chartWidth}
                  hoverPct={hoverPct}
                  onHover={onHover}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t.tireTempCaption}</p>
          </>
        )}
      </div>
    </div>
  );
}
