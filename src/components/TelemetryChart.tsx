'use client';

import { memo, type ReactNode } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useChartPointer, useTelemetry } from '@/components/TelemetryCursor';
import { CHART_MARGIN as M, positionLabel, xTicks } from '@/lib/lapCharts';

export const TARGET_COLOR = 'var(--lap-target)';
export const COMPARE_COLOR = 'var(--lap-compare)';
const DELTA_STRIP_HEIGHT = 44;
const CURSOR_BADGE_WIDTH = 64;

export type ChartSeries = {
  id: string;
  values: number[];
  color: string;
  width?: number;
  area?: boolean;
  visible?: boolean;
  step?: boolean; // Holds its value to the next point instead of a slope, for something like the gear
};

// What background and overlay draw with
export type Scales = {
  x: (pct: number) => number;
  y: (value: number) => number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  inView: (pct: number) => boolean;
};

// One line between two points of the grid, breaking at gaps. Memoized with TraceLine, so moving the crosshair
// doesn't redraw every line of every chart
export function linePath(pcts: number[], values: number[], from: number, to: number, x: (pct: number) => number, y: (value: number) => number, step = false) {
  let path = '';
  let pen = 'M';
  for (let i = from; i <= to; i++) {
    if (!Number.isFinite(values[i])) {
      pen = 'M';
      continue;
    }
    const [px, py] = [x(pcts[i]).toFixed(1), y(values[i]).toFixed(1)];
    path += step && pen === 'L' ? `H${px}V${py}` : `${pen}${px},${py}`;
    pen = 'L';
  }
  return path;
}

type LineProps = {
  pcts: number[];
  values: number[];
  from: number;
  to: number;
  d0: number;
  span: number;
  left: number;
  plotW: number;
  top: number;
  plotH: number;
  yMin: number;
  yMax: number;
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  areaOpacity?: number;
  baseValue?: number;
  step?: boolean;
};

const TraceLine = memo(function TraceLine({ pcts, values, from, to, d0, span, left, plotW, top, plotH, yMin, yMax, stroke, strokeWidth, opacity, areaOpacity, baseValue, step }: LineProps) {
  const x = (pct: number) => left + ((pct - d0) / span) * plotW;
  const y = (value: number) => top + (1 - (value - yMin) / (yMax - yMin)) * plotH;
  const line = linePath(pcts, values, from, to, x, y, step);
  return (
    <g>
      {areaOpacity !== undefined && baseValue !== undefined && line && (
        <path d={`${line}L${x(pcts[to]).toFixed(1)},${y(baseValue).toFixed(1)}L${x(pcts[from]).toFixed(1)},${y(baseValue).toFixed(1)}Z`} fill={stroke} opacity={areaOpacity} />
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" opacity={opacity} />
    </g>
  );
});

// One of Lap Compare's telemetry charts in its panel, sharing the crosshair, zoom and settings of the
// others (TelemetryCursor): a title and legend, live readouts, then the plot of series over the grid's lap
// positions. diff shades between two series, diverging fills one series above and below zero, and delta adds a
// strip of Compare minus Target under the plot when the toolbar's Δ Overlay is on. id must be unique on the page
// (the clip paths are named after it). width is what it has to fit in, its border included; embedded leaves out
// the border and rounding, for a chart inside a Panel.
export default function TelemetryChart({
  id,
  title,
  unit,
  width: outerWidth,
  embedded = false,
  height,
  yMin,
  yMax,
  yTicks,
  formatTick,
  series = [],
  diff,
  diverging,
  zeroLine,
  delta,
  background,
  overlay,
  readout,
  legend,
  axisSideLabels,
  ariaLabel,
  caption,
}: {
  id: string;
  title: string;
  unit?: string;
  width: number;
  embedded?: boolean;
  height: number;
  yMin: number;
  yMax: number;
  yTicks: number[];
  formatTick: (value: number) => string;
  series?: ChartSeries[];
  diff?: { a: number[]; b: number[] };
  diverging?: { values: number[]; line?: boolean; positive?: string; negative?: string };
  zeroLine?: { color: string; width?: number };
  delta?: { values: number[]; range: number; unit: string };
  background?: (s: Scales) => ReactNode;
  overlay?: (s: Scales) => ReactNode;
  readout?: ReactNode;
  legend?: ReactNode;
  axisSideLabels?: { top: string; bottom: string };
  ariaLabel: string;
  caption?: ReactNode;
}) {
  const { t: dictionary } = useLanguage();
  const { axis, grid, settings, cursorPct, cursorIndex, locked } = useTelemetry();
  const { svgProps, plotProps } = useChartPointer();
  const { pcts } = grid;
  const width = embedded ? outerWidth : outerWidth - 2; // The panel's border

  const deltaOn = Boolean(delta) && settings.deltaOverlay;
  const deltaH = deltaOn ? DELTA_STRIP_HEIGHT : 0;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = height - M.top - M.bottom - deltaH;
  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const x = (pct: number) => M.left + ((pct - d0) / span) * plotW;
  const y = (value: number) => M.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;
  const scales: Scales = {
    x,
    y,
    plotLeft: M.left,
    plotRight: M.left + plotW,
    plotTop: M.top,
    plotBottom: M.top + plotH,
    inView: (pct) => pct >= d0 && pct <= d1,
  };

  // The grid's points in view, and one either side so the lines reach the plot's edges
  const fullFrom = pcts[0];
  const step = (pcts[pcts.length - 1] - fullFrom) / (pcts.length - 1);
  const from = Math.max(0, Math.floor((d0 - fullFrom) / step) - 1);
  const to = Math.min(pcts.length - 1, Math.ceil((d1 - fullFrom) / step) + 1);
  const lineProps = { pcts, from, to, d0, span, left: M.left, plotW, top: M.top, plotH, yMin, yMax };

  // One shape per stretch where both have values, so a gap in either isn't shaded across
  const between = (a: number[], b: number[]) => {
    let shapes = '';
    let top = '';
    let bottom = '';
    for (let i = from; i <= to + 1; i++) {
      if (i <= to && Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        top += `${top ? 'L' : 'M'}${x(pcts[i]).toFixed(1)},${y(a[i]).toFixed(1)}`;
        bottom = `L${x(pcts[i]).toFixed(1)},${y(b[i]).toFixed(1)}${bottom}`;
      } else if (top) {
        shapes += `${top}${bottom}Z`;
        top = '';
        bottom = '';
      }
    }
    return shapes;
  };
  const zeroArea = (values: number[]) => {
    const line = linePath(pcts, values, from, to, x, y);
    return line ? `${line}L${x(pcts[to]).toFixed(1)},${y(0).toFixed(1)}L${x(pcts[from]).toFixed(1)},${y(0).toFixed(1)}Z` : '';
  };

  const shown = series.filter((s) => s.visible !== false);
  const cursorInView = cursorPct !== null && settings.showCursor && cursorPct >= d0 && cursorPct <= d1;
  const cursorX = cursorInView ? x(cursorPct) : 0;
  const badgeX = Math.min(Math.max(cursorX, M.left + CURSOR_BADGE_WIDTH / 2), M.left + plotW - CURSOR_BADGE_WIDTH / 2);
  const zeroY = y(0);

  const stripTop = M.top + plotH + 8;
  const stripH = deltaH - 12;
  const stripY = (value: number) => {
    const range = delta?.range ?? 1;
    return stripTop + stripH / 2 - (Math.max(-range, Math.min(range, value)) / range) * (stripH / 2);
  };

  return (
    <section className={embedded ? 'bg-card' : 'rounded-md border border-border bg-card'}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-3 py-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h4>
          {unit && <span className="tele-label">{unit}</span>}
          {legend}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{readout}</div>
      </header>
      <svg
        width={width}
        height={height}
        {...svgProps}
        role="img"
        aria-label={ariaLabel}
        className="block select-none rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <defs>
          <clipPath id={`${id}-plot`}>
            <rect x={M.left} y={M.top - 2} width={plotW} height={plotH + 4} />
          </clipPath>
          <clipPath id={`${id}-above`}>
            <rect x={M.left} y={M.top} width={plotW} height={Math.max(0, zeroY - M.top)} />
          </clipPath>
          <clipPath id={`${id}-below`}>
            <rect x={M.left} y={zeroY} width={plotW} height={Math.max(0, M.top + plotH - zeroY)} />
          </clipPath>
          <clipPath id={`${id}-strip`}>
            <rect x={M.left} y={stripTop} width={plotW} height={Math.max(0, stripH)} />
          </clipPath>
        </defs>

        <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="var(--background)" opacity={0.55} />
        <g clipPath={`url(#${id}-plot)`}>{background?.(scales)}</g>

        {yTicks.map((tick) => (
          <g key={tick}>
            {settings.showGrid && (
              <line x1={M.left} x2={M.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} strokeDasharray={tick === 0 ? undefined : '2 4'} opacity={0.8} />
            )}
            <text x={M.left - 6} y={y(tick) + 3} textAnchor="end" className="tele-num" fontSize={10} fill="var(--muted-foreground)">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {axisSideLabels && (
          <>
            <text x={M.left + 6} y={M.top + 11} fontSize={9} className="font-display" letterSpacing="0.1em" fill="var(--muted-foreground)">
              {axisSideLabels.top}
            </text>
            <text x={M.left + 6} y={M.top + plotH - 5} fontSize={9} className="font-display" letterSpacing="0.1em" fill="var(--muted-foreground)">
              {axisSideLabels.bottom}
            </text>
          </>
        )}
        {settings.showGrid &&
          xTicks(axis).map((tick) => (
            <line key={tick} x1={x(tick)} x2={x(tick)} y1={M.top} y2={M.top + plotH} stroke="var(--border)" strokeDasharray="2 4" opacity={0.5} />
          ))}

        <g clipPath={`url(#${id}-plot)`}>
          {diff && settings.showDiff && settings.showTarget && settings.showCompare && (
            <path d={between(diff.a, diff.b)} fill="var(--foreground)" opacity={0.14} />
          )}
          {diverging && settings.showDiff && (
            <>
              <path d={zeroArea(diverging.values)} fill={diverging.positive ?? 'var(--tele-pos)'} opacity={diverging.positive ? 1 : 0.28} clipPath={`url(#${id}-above)`} />
              <path d={zeroArea(diverging.values)} fill={diverging.negative ?? 'var(--tele-neg)'} opacity={diverging.negative ? 1 : 0.28} clipPath={`url(#${id}-below)`} />
            </>
          )}
          {zeroLine && <line x1={M.left} x2={M.left + plotW} y1={zeroY} y2={zeroY} stroke={zeroLine.color} strokeWidth={zeroLine.width ?? 1.25} />}
          {shown.map((s) => (
            <TraceLine
              key={s.id}
              {...lineProps}
              values={s.values}
              stroke={s.color}
              strokeWidth={s.width ?? 1.6}
              areaOpacity={s.area ? 0.07 : undefined}
              baseValue={s.area ? yMin : undefined}
              step={s.step}
            />
          ))}
          {diverging && diverging.line !== false && <TraceLine {...lineProps} values={diverging.values} stroke="var(--foreground)" strokeWidth={1.2} opacity={0.85} />}
        </g>

        {overlay?.(scales)}

        <line x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--border)" />
        {!deltaOn &&
          xTicks(axis).map((tick) => (
            <text key={tick} x={x(tick)} y={height - 6} textAnchor="middle" className="tele-num" fontSize={9.5} fill="var(--muted-foreground)">
              {positionLabel(tick, axis)}
            </text>
          ))}

        {deltaOn && delta && (
          <g>
            <rect x={M.left} y={stripTop} width={plotW} height={stripH} fill="var(--secondary)" />
            <line x1={M.left} x2={M.left + plotW} y1={stripY(0)} y2={stripY(0)} stroke="var(--border)" />
            <text x={M.left - 6} y={stripY(0) + 3} textAnchor="end" fontSize={9} className="font-display" fill="var(--muted-foreground)">
              Δ
            </text>
            <path d={linePath(pcts, delta.values, from, to, x, stripY)} fill="none" stroke="var(--foreground)" strokeWidth={1} clipPath={`url(#${id}-strip)`} />
            <text x={M.left + plotW - 4} y={stripTop + 10} textAnchor="end" fontSize={9} className="tele-num" fill="var(--muted-foreground)">
              ±{delta.range} {delta.unit} · {dictionary.charts.pedalDelta}
            </text>
          </g>
        )}

        {cursorInView && cursorIndex !== null && (
          <g pointerEvents="none">
            <line x1={cursorX} x2={cursorX} y1={M.top} y2={height - M.bottom + (deltaOn ? 14 : 0)} stroke="var(--foreground)" strokeWidth={1} opacity={locked ? 0.95 : 0.6} strokeDasharray={locked ? undefined : '3 3'} />
            {shown.map((s) =>
              Number.isFinite(s.values[cursorIndex]) ? (
                <circle key={s.id} cx={cursorX} cy={y(s.values[cursorIndex])} r={3.2} fill="var(--background)" stroke={s.color} strokeWidth={1.6} />
              ) : null
            )}
            {diverging && diverging.line !== false && Number.isFinite(diverging.values[cursorIndex]) && (
              <circle cx={cursorX} cy={y(diverging.values[cursorIndex])} r={3.2} fill="var(--background)" stroke="var(--foreground)" strokeWidth={1.6} />
            )}
            <rect x={badgeX - CURSOR_BADGE_WIDTH / 2} y={M.top + plotH + 2} width={CURSOR_BADGE_WIDTH} height={14} rx={2} fill="var(--foreground)" />
            <text x={badgeX} y={M.top + plotH + 12} textAnchor="middle" fontSize={9.5} className="tele-num" fill="var(--background)">
              {positionLabel(cursorPct as number, axis)}
            </text>
          </g>
        )}

        {/* The hit target is the whole plot, not the thin lines */}
        <rect x={M.left} y={M.top} width={plotW} height={height - M.top - M.bottom} {...plotProps} />
      </svg>
      {caption && <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{caption}</p>}
    </section>
  );
}

// A small labelled value in a chart's header
export function Readout({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'target' | 'compare' | 'pos' | 'neg' | 'plain' }) {
  const color = { target: 'text-lap-target', compare: 'text-lap-compare', pos: 'text-tele-pos', neg: 'text-tele-neg', plain: 'text-foreground' }[tone];
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tele-label">{label}</span>
      <span className={`tele-num text-xs font-semibold ${color}`}>{value}</span>
    </span>
  );
}

// Which line is which lap, leaving out a lap the toolbar has hidden
export function LapLegend() {
  const { t } = useLanguage();
  const { settings } = useTelemetry();
  const labels = t.charts.telemetry;
  return (
    <span className="ml-2 flex items-center gap-3">
      {settings.showTarget && (
        <span className="tele-label flex items-center gap-1">
          <i className="inline-block h-0.5 w-4 bg-lap-target" /> {labels.target}
        </span>
      )}
      {settings.showCompare && (
        <span className="tele-label flex items-center gap-1">
          <i className="inline-block h-0.5 w-4 bg-lap-compare" /> {labels.compare}
        </span>
      )}
    </span>
  );
}

// +3 / −3 / ±0, in the locale's digits
export function signedValue(value: number, locale: string, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  const number = Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${number}`;
}

// The smallest of 1/2/5 x 10^n that's at least this large, for a chart's limit
export function niceLimit(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1e-6)));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((limit) => limit >= value) ?? value;
}
