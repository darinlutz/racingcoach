'use client';

import { useEffect, useRef, useState } from 'react';

import { formatDate } from '@/components/IRatingChart';
import { SECTOR_COLORS, niceTicks } from '@/components/SectorChart';
import type { RaceEvent } from '@/lib/raceTrends';

const HEIGHT = 320;
const MARGIN = { top: 12, right: 16, bottom: 36, left: 44 };
const INK_MUTED = '#92959a'; // muted-foreground
const GRID = '#252629'; // just above card
const AXIS = '#3b3d40'; // just above border
const START = SECTOR_COLORS[0];
const FINISH = SECTOR_COLORS[1];

// Grouped bars get unreadable past a few dozen races, so the chart shows the latest ones by default
const RANGES = [
  { value: 20, label: 'Last 20' },
  { value: 50, label: 'Last 50' },
  { value: 0, label: 'All' },
];

type Race = RaceEvent & { startPosition: number; finishPosition: number };

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// Start and finish position in each race, side by side; positions gained is start minus finish
export default function PositionsChart({ events }: { events: RaceEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState(RANGES[0].value);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const all = events.filter((e): e is Race => e.startPosition !== null && e.finishPosition !== null);
  if (all.length === 0) {
    return <p className="text-sm text-muted-foreground">None of these races have a start and finish position.</p>;
  }
  const races = range ? all.slice(-range) : all;
  const avgGained = races.reduce((s, r) => s + r.startPosition - r.finishPosition, 0) / races.length;

  const ticks = niceTicks(0, Math.max(...races.flatMap((r) => [r.startPosition, r.finishPosition])));
  const yMax = ticks[ticks.length - 1];
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = plotWidth / races.length;
  const barWidth = Math.max((band * 0.8) / 2, 0.5);
  const bandX = (i: number) => MARGIN.left + i * band;
  const y = (value: number) => MARGIN.top + plotHeight - (value / (yMax || 1)) * plotHeight;
  // Date under every Nth race so the labels don't overlap
  const labelEvery = Math.max(1, Math.ceil(races.length / Math.max(1, Math.floor(plotWidth / 70))));

  const handlePointer = (e: React.PointerEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHoverIndex(Math.min(races.length - 1, Math.max(0, Math.floor(px / band))));
  };

  const hovered = hoverIndex === null ? null : races[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : bandX(hoverIndex) + band / 2;
  const tooltipOnLeft = hoverX > width / 2;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-foreground">
          Start and finish position <span className="font-normal text-muted-foreground">per race</span>
          <span className="ml-2 font-normal text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
            ({signed(Number(avgGained.toFixed(1)))} avg positions over {races.length} races)
          </span>
        </p>
        <div className="flex gap-1" role="group" aria-label="Races shown">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                range === r.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: START }} />
          Start position
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FINISH }} />
          Finish position
        </li>
      </ul>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Start and finish position in each of ${races.length} races`}
            className="block"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {/* Gridlines and y-axis labels */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
                {tick > 0 && (
                  <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_MUTED}>
                    P{tick}
                  </text>
                )}
              </g>
            ))}

            {/* Hovered race's band */}
            {hoverIndex !== null && (
              <rect x={bandX(hoverIndex)} y={MARGIN.top} width={band} height={plotHeight} fill={GRID} />
            )}

            {/* Start and finish bars, side by side */}
            {races.map((r, i) => {
              const left = bandX(i) + band * 0.1;
              return (
                <g key={r.eventId}>
                  <rect x={left} y={y(r.startPosition)} width={barWidth} height={y(0) - y(r.startPosition)} fill={START} rx={1} />
                  <rect
                    x={left + barWidth}
                    y={y(r.finishPosition)}
                    width={barWidth}
                    height={y(0) - y(r.finishPosition)}
                    fill={FINISH}
                    rx={1}
                  />
                </g>
              );
            })}

            {/* Baseline and date labels */}
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
              stroke={AXIS}
              strokeWidth={1}
            />
            {races.map((r, i) =>
              (races.length - 1 - i) % labelEvery === 0 ? (
                <text
                  key={r.eventId}
                  x={bandX(i) + band / 2}
                  y={MARGIN.top + plotHeight + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill={INK_MUTED}
                >
                  {new Date(r.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </text>
              ) : null
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
        {hovered && (
          <div
            className="pointer-events-none absolute top-2 z-10 bg-card border border-border rounded-lg shadow-md px-3 py-2 text-xs text-foreground whitespace-nowrap"
            style={tooltipOnLeft ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
          >
            <p className="font-semibold mb-1">{formatDate(hovered.startTime)}</p>
            <p className="text-muted-foreground">{hovered.series}</p>
            <p className="text-muted-foreground">{hovered.track}</p>
            <p className="mt-1 flex items-center gap-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: START }} />
              Started <span className="font-semibold">P{hovered.startPosition}</span>
            </p>
            <p className="flex items-center gap-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: FINISH }} />
              Finished <span className="font-semibold">P{hovered.finishPosition}</span>
            </p>
            <p className="text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {signed(hovered.startPosition - hovered.finishPosition)} positions
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
        {showTable ? 'Hide values' : 'Show values'}
      </button>
      {showTable && (
        <div className="mt-2 max-h-96 overflow-auto border border-border rounded-lg">
          <table className="w-full text-xs text-foreground whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">Track</th>
                <th className="px-3 py-2 font-medium text-right">Start</th>
                <th className="px-3 py-2 font-medium text-right">Finish</th>
                <th className="px-3 py-2 font-medium text-right">Gained/Lost</th>
              </tr>
            </thead>
            <tbody>
              {[...races].reverse().map((r) => (
                <tr key={r.eventId} className="border-t border-border">
                  <td className="px-3 py-1.5">{formatDate(r.startTime)}</td>
                  <td className="px-3 py-1.5">{r.series}</td>
                  <td className="px-3 py-1.5">{r.track}</td>
                  <td className="px-3 py-1.5 text-right">P{r.startPosition}</td>
                  <td className="px-3 py-1.5 text-right">P{r.finishPosition}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{signed(r.startPosition - r.finishPosition)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
