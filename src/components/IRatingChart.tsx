'use client';

import { useEffect, useRef, useState } from 'react';

import RaceRangePicker from '@/components/RaceRangePicker';
import { SECTOR_COLORS, niceTicks } from '@/components/SectorChart';
import type { IRatingPoint, IRatingSeries } from '@/lib/raceTrends';

const HEIGHT = 320;
const MARGIN = { top: 12, right: 16, bottom: 36, left: 52 };
const INK_MUTED = '#92959a'; // muted-foreground
const GRID = '#252629'; // just above card
const AXIS = '#3b3d40'; // just above border

export const time = (iso: string) => new Date(iso).getTime();
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// Date ticks between two times, thinned so the labels fit: first of each month, or individual days
// when the span is too short to cross two month starts (e.g. only the last 20 races)
export function dateTicks(start: number, end: number, maxTicks: number): { t: number; label: string }[] {
  const months: Date[] = [];
  const d = new Date(start);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < start) d.setMonth(d.getMonth() + 1);
  for (; d.getTime() <= end; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  if (months.length >= 2) {
    const step = Math.max(1, Math.ceil(months.length / Math.max(1, maxTicks)));
    return months
      .filter((_, i) => i % step === 0)
      .map((m) => ({ t: m.getTime(), label: m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }));
  }

  const days: Date[] = [];
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() < start) day.setDate(day.getDate() + 1);
  for (; day.getTime() <= end; day.setDate(day.getDate() + 1)) days.push(new Date(day));
  const step = Math.max(1, Math.ceil(days.length / Math.max(1, maxTicks)));
  return days
    .filter((_, i) => i % step === 0)
    .map((m) => ({ t: m.getTime(), label: m.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }));
}

type Hovered = { series: IRatingSeries; color: string; point: IRatingPoint };

// iRating after each rated race over time, one line per license category
export default function IRatingChart({
  trend,
  range,
  onRangeChange,
}: {
  trend: IRatingSeries[];
  range: number;
  onRangeChange: (range: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The latest `range` rated races across every category
  const raceTimes = trend.flatMap((s) => s.points.map((p) => time(p.startTime))).sort((a, b) => b - a);
  const cutoff = range && raceTimes.length > range ? raceTimes[range - 1] : -Infinity;
  const lines = trend
    .map((s) => ({ ...s, points: s.points.filter((p) => time(p.startTime) >= cutoff) }))
    .filter((s) => s.points.length > 0)
    .slice(0, SECTOR_COLORS.length)
    .map((s, i) => ({ series: s, color: SECTOR_COLORS[i] }));
  if (lines.length === 0) return null;

  const allPoints = lines.flatMap(({ series, color }) => series.points.map((point) => ({ series, color, point })));
  const ratings = allPoints.flatMap(({ point }) => [point.iRating, point.oldIRating]);
  const pad = (Math.max(...ratings) - Math.min(...ratings) || 100) * 0.05;
  const ticks = niceTicks(Math.min(...ratings) - pad, Math.max(...ratings) + pad);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const times = allPoints.map(({ point }) => time(point.startTime));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (tMax === tMin ? plotWidth / 2 : ((t - tMin) / (tMax - tMin)) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;
  const xTicks = dateTicks(tMin, tMax, Math.floor(plotWidth / 70));

  // The race nearest the pointer, across every line
  const handlePointer = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + MARGIN.left;
    const py = e.clientY - rect.top + MARGIN.top;
    let nearest = allPoints[0];
    let best = Infinity;
    for (const candidate of allPoints) {
      const dx = x(time(candidate.point.startTime)) - px;
      const dy = (y(candidate.point.iRating) - py) / 4; // the x distance matters most
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    setHovered(nearest);
  };

  const hoverX = hovered ? x(time(hovered.point.startTime)) : 0;
  const tooltipOnLeft = hoverX > width / 2;
  const tableRows = [...allPoints].sort((a, b) => time(b.point.startTime) - time(a.point.startTime));

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-foreground">
          iRating <span className="font-normal text-muted-foreground">after each rated race</span>
        </p>
        <RaceRangePicker value={range} onChange={onRangeChange} />
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-muted-foreground">
        {lines.map(({ series, color }) => {
          const last = series.points[series.points.length - 1];
          return (
            <li key={series.category} className="flex items-center gap-1.5">
              <span className="inline-block w-3 rounded" style={{ backgroundColor: color, height: 2 }} />
              {series.category}{' '}
              <span className="text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                ({series.points[0].oldIRating} → {last.iRating}, {signed(last.iRating - series.points[0].oldIRating)})
              </span>
            </li>
          );
        })}
      </ul>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Line chart of iRating over time for ${lines.map((l) => l.series.category).join(' and ')}`}
            className="block"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {/* Gridlines and y-axis labels */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_MUTED}>
                  {tick.toLocaleString('en-US')}
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

            {/* iRating lines; a single race shows as a dot */}
            {lines.map(({ series, color }) =>
              series.points.length === 1 ? (
                <circle
                  key={series.category}
                  cx={x(time(series.points[0].startTime))}
                  cy={y(series.points[0].iRating)}
                  r={3}
                  fill={color}
                />
              ) : (
                <polyline
                  key={series.category}
                  points={series.points.map((p) => `${x(time(p.startTime))},${y(p.iRating)}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )
            )}

            {/* Hovered race marker, ringed in white so it stands out from the line */}
            {hovered && (
              <circle cx={hoverX} cy={y(hovered.point.iRating)} r={4} fill={hovered.color} stroke="#151618" strokeWidth={2} />
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
              onPointerLeave={() => setHovered(null)}
            />
          </svg>
        )}

        {/* Tooltip */}
        {hovered && (
          <div
            className="pointer-events-none absolute top-2 z-10 bg-card border border-border rounded-lg shadow-md px-3 py-2 text-xs text-foreground whitespace-nowrap"
            style={tooltipOnLeft ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
          >
            <p className="font-semibold mb-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: hovered.color }} />
              {formatDate(hovered.point.startTime)}
            </p>
            <p className="text-muted-foreground">{hovered.point.series}</p>
            <p className="text-muted-foreground">{hovered.point.track}</p>
            <p className="mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
              iRating {hovered.point.oldIRating} → <span className="font-semibold">{hovered.point.iRating}</span>{' '}
              <span className="text-muted-foreground">({signed(hovered.point.iRating - hovered.point.oldIRating)})</span>
            </p>
            {hovered.point.finishPosition !== null && <p className="text-muted-foreground">Finished P{hovered.point.finishPosition}</p>}
          </div>
        )}
      </div>

      {/* Table view of the same values */}
      <button
        type="button"
        onClick={() => setShowTable(!showTable)}
        className="mt-2 text-xs font-semibold text-primary hover:underline"
      >
        {showTable ? 'Hide values' : 'Show values'}
      </button>
      {showTable && (
        <div className="mt-2 max-h-96 overflow-auto border border-border rounded-lg">
          <table className="w-full text-xs text-foreground whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                {lines.length > 1 && <th className="px-3 py-2 font-medium">Category</th>}
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">Track</th>
                <th className="px-3 py-2 font-medium text-right">Finish</th>
                <th className="px-3 py-2 font-medium text-right">iRating</th>
                <th className="px-3 py-2 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ series, point }) => (
                <tr key={point.eventId} className="border-t border-border">
                  <td className="px-3 py-1.5">{formatDate(point.startTime)}</td>
                  {lines.length > 1 && <td className="px-3 py-1.5">{series.category}</td>}
                  <td className="px-3 py-1.5">{point.series}</td>
                  <td className="px-3 py-1.5">{point.track}</td>
                  <td className="px-3 py-1.5 text-right">{point.finishPosition === null ? '—' : `P${point.finishPosition}`}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{point.iRating}</td>
                  <td className="px-3 py-1.5 text-right">{signed(point.iRating - point.oldIRating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
