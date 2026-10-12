'use client';

import { useEffect, useRef, useState } from 'react';

import { dateTicks, formatDate, time } from '@/components/IRatingChart';
import { useLanguage } from '@/components/LanguageProvider';
import RaceRangePicker, { lastRaces } from '@/components/RaceRangePicker';
import { SECTOR_COLORS, niceTicks } from '@/components/SectorChart';
import type { IncidentPoint } from '@/lib/raceTrends';

const HEIGHT = 320;
const MARGIN = { top: 12, right: 16, bottom: 36, left: 52 };
const INK_MUTED = 'var(--muted-foreground)'; // muted-foreground
const GRID = 'var(--chart-grid)'; // just above card
const AXIS = 'var(--chart-axis)'; // just above border
const DOT = 'var(--chart-dot)'; // dim gray: single races stay in the background
const AVERAGE = SECTOR_COLORS[0];

// Races in the rolling average; one race is too noisy to show a trend
const WINDOW = 10;

// Incidents in each race over time, with a rolling average line through them
export default function IncidentsChart({
  points: allPoints,
  range,
  onRangeChange,
}: {
  points: IncidentPoint[];
  range: number;
  onRangeChange: (range: number) => void;
}) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const t = dictionary.raceCharts;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (allPoints.length === 0) return null;

  // Averages run over every race, so the line is already settled at the start of a shorter range
  const span = Math.min(WINDOW, allPoints.length);
  const allAverages = allPoints.map((_, i) => {
    const slice = allPoints.slice(Math.max(0, i - span + 1), i + 1);
    return slice.reduce((s, p) => s + p.incidents, 0) / slice.length;
  });
  const points = lastRaces(allPoints, range);
  const averages = lastRaces(allAverages, range);
  const total = points.reduce((s, p) => s + p.incidents, 0);

  const ticks = niceTicks(0, Math.max(...points.map((p) => p.incidents), 1));
  const yMax = ticks[ticks.length - 1];
  const times = points.map((p) => time(p.startTime));
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (tMax === tMin ? plotWidth / 2 : ((t - tMin) / (tMax - tMin)) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - (value / (yMax || 1)) * plotHeight;
  const xTicks = dateTicks(tMin, tMax, Math.floor(plotWidth / 70), locale);

  const handlePointer = (e: React.PointerEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left + MARGIN.left;
    let nearest = 0;
    times.forEach((t, i) => {
      if (Math.abs(x(t) - px) < Math.abs(x(times[nearest]) - px)) nearest = i;
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : x(times[hoverIndex]);
  const tooltipOnLeft = hoverX > width / 2;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-foreground">
          {t.incidentsTitle} <span className="font-normal text-muted-foreground">{t.perRace}</span>
          <span className="ml-2 font-normal text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmt(t.incidentsAvg, { avg: (total / points.length).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), n: points.length })}
          </span>
        </p>
        <RaceRangePicker value={range} onChange={onRangeChange} />
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: DOT }} />
          {t.oneRace}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-3 rounded" style={{ backgroundColor: AVERAGE, height: 2 }} />
          {fmt(t.nRaceAverage, { n: span })}
        </li>
      </ul>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={fmt(t.incidentsAria, { n: points.length, span })}
            className="block"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {/* Gridlines and y-axis labels */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_MUTED}>
                  {tick}x
                </text>
              </g>
            ))}
            {/* Baseline and month labels */}
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
              stroke={AXIS}
              strokeWidth={1}
            />
            {xTicks.map((tick) => (
              <text
                key={tick.t}
                x={x(tick.t)}
                y={MARGIN.top + plotHeight + 16}
                textAnchor="middle"
                fontSize={11}
                fill={INK_MUTED}
              >
                {tick.label}
              </text>
            ))}

            {/* Crosshair */}
            {hovered && (
              <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke={AXIS} strokeWidth={1} />
            )}

            {/* One dot per race */}
            {points.map((p, i) => (
              <circle key={p.eventId} cx={x(times[i])} cy={y(p.incidents)} r={2.5} fill={DOT} fillOpacity={0.6} />
            ))}

            {/* Rolling average */}
            <polyline
              points={averages.map((v, i) => `${x(times[i])},${y(v)}`).join(' ')}
              fill="none"
              stroke={AVERAGE}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Hovered race, ringed in white so it stands out */}
            {hovered && hoverIndex !== null && (
              <>
                <circle cx={hoverX} cy={y(hovered.incidents)} r={4} fill={INK_MUTED} stroke="var(--chart-halo)" strokeWidth={2} />
                <circle cx={hoverX} cy={y(averages[hoverIndex])} r={4} fill={AVERAGE} stroke="var(--chart-halo)" strokeWidth={2} />
              </>
            )}

            {/* Hit area for the pointer */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotWidth}
              height={plotHeight}
              fill="transparent"
              onPointerMove={handlePointer}
              onPointerDown={handlePointer}
              onPointerLeave={() => setHoverIndex(null)}
            />
          </svg>
        )}

        {/* Tooltip */}
        {hovered && hoverIndex !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 bg-card border border-border rounded-lg shadow-md px-3 py-2 text-xs text-foreground whitespace-nowrap"
            style={tooltipOnLeft ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
          >
            <p className="font-semibold mb-1">{formatDate(hovered.startTime, locale)}</p>
            <p className="text-muted-foreground">{hovered.series}</p>
            <p className="text-muted-foreground">{hovered.track}</p>
            <p className="mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="font-semibold">{hovered.incidents}x</span>{' '}
              <span className="text-muted-foreground">{fmt(t.inLaps, { n: hovered.lapsComplete })}</span>
            </p>
            <p className="text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmt(t.averageAt, { span, avg: averages[hoverIndex].toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
            </p>
          </div>
        )}
      </div>

      {/* Table view of the same values */}
      <button
        type="button"
        onClick={() => setShowTable(!showTable)}
        className="mt-2 text-xs font-semibold text-primary hover:underline"
      >
        {showTable ? t.hideValues : t.showValues}
      </button>
      {showTable && (
        <div className="mt-2 max-h-96 overflow-auto border border-border rounded-lg">
          <table className="w-full text-xs text-foreground whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.date}</th>
                <th className="px-3 py-2 font-medium">{t.series}</th>
                <th className="px-3 py-2 font-medium">{t.track}</th>
                <th className="px-3 py-2 font-medium text-right">{t.laps}</th>
                <th className="px-3 py-2 font-medium text-right">{t.incidents}</th>
                <th className="px-3 py-2 font-medium text-right">{fmt(t.nRaceAvg, { n: span })}</th>
              </tr>
            </thead>
            <tbody>
              {points
                .map((p, i) => ({ p, average: averages[i] }))
                .reverse()
                .map(({ p, average }) => (
                  <tr key={p.eventId} className="border-t border-border">
                    <td className="px-3 py-1.5">{formatDate(p.startTime, locale)}</td>
                    <td className="px-3 py-1.5">{p.series}</td>
                    <td className="px-3 py-1.5">{p.track}</td>
                    <td className="px-3 py-1.5 text-right">{p.lapsComplete}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{p.incidents}x</td>
                    <td className="px-3 py-1.5 text-right">{average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
