'use client';

import { useEffect, useRef, useState } from 'react';

import type { StintLap } from '@/lib/stintExport';

// Categorical colors in fixed order (sector 1 is always blue, sector 2 orange, ...). This order was
// checked for color-blind separation between neighboring series; don't cycle or reorder it.
export const SECTOR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

const HEIGHT = 300;
const MARGIN = { top: 12, right: 16, bottom: 36, left: 52 };
const INK_MUTED = '#64748b'; // slate-500
const GRID = '#e2e8f0'; // slate-200
const AXIS = '#cbd5e1'; // slate-300

type Mode = 'time' | 'gap';

// Round tick values for an axis; the first and last ticks extend past min..max so nothing is clipped
export function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  const last = Math.ceil(max / step - 1e-9) * step;
  for (let t = Math.floor(min / step + 1e-9) * step; t <= last + step * 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

// One line per sector across the stint's laps: actual sector times, or each sector's gap to its best
export default function SectorChart({ laps, sectorCount }: { laps: StintLap[]; sectorCount: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [mode, setMode] = useState<Mode>('time');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (sectorCount === 0 || laps.length === 0) return null;
  if (sectorCount > SECTOR_COLORS.length) {
    return (
      <p className="text-sm text-slate-600">
        The sector chart supports up to {SECTOR_COLORS.length} sectors; this track has {sectorCount}.
      </p>
    );
  }

  const sectors = Array.from({ length: sectorCount }, (_, i) => {
    const times = laps.map((lap) => lap.sectors[i] as number);
    const best = Math.min(...times);
    return { number: i + 1, color: SECTOR_COLORS[i], times, best, values: mode === 'time' ? times : times.map((t) => t - best) };
  });

  const allValues = sectors.flatMap((s) => s.values);
  const rawMin = mode === 'gap' ? 0 : Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const pad = (rawMax - rawMin || 1) * 0.05;
  const ticks = niceTicks(mode === 'gap' ? 0 : rawMin - pad, rawMax + pad);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const lapNumbers = laps.map((lap) => lap.lap);
  const firstLap = lapNumbers[0];
  const lastLap = lapNumbers[lapNumbers.length - 1];
  const x = (lap: number) => MARGIN.left + (lastLap === firstLap ? plotWidth / 2 : ((lap - firstLap) / (lastLap - firstLap)) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;

  // Lap-number ticks: every lap when they fit, otherwise every Nth
  const lapStep = Math.max(1, Math.ceil(lapNumbers.length / Math.max(1, Math.floor(plotWidth / 40))));
  const lapTicks = lapNumbers.filter((_, i) => i % lapStep === 0);

  const formatValue = (value: number) => (mode === 'time' ? `${value.toFixed(3)}s` : `+${value.toFixed(3)}s`);
  const formatTick = (value: number) => (mode === 'time' ? `${value}s` : `+${value}s`);

  const handlePointer = (e: React.PointerEvent<SVGRectElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left;
    const px = e.clientX - left + MARGIN.left;
    let nearest = 0;
    lapNumbers.forEach((lap, i) => {
      if (Math.abs(x(lap) - px) < Math.abs(x(lapNumbers[nearest]) - px)) nearest = i;
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex === null ? null : laps[hoverIndex];
  const tooltipLeft = hoverIndex === null ? 0 : x(lapNumbers[hoverIndex]);
  const tooltipOnLeft = tooltipLeft > width / 2;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-dark-blue">
          Sector times <span className="font-normal text-slate-500">by lap</span>
        </p>
        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold" role="group">
          {(
            [
              ['time', 'Sector time'],
              ['gap', 'Gap to best'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`px-3 py-1.5 transition-colors ${
                mode === value ? 'bg-powder-600 text-white' : 'bg-white text-dark-blue hover:text-powder-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-slate-600">
        {sectors.map((s) => (
          <li key={s.number} className="flex items-center gap-1.5">
            <span className="inline-block w-3 rounded" style={{ backgroundColor: s.color, height: 2 }} />
            Sector {s.number}
          </li>
        ))}
      </ul>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Line chart of ${sectorCount} sector ${mode === 'time' ? 'times' : 'gaps to best'} over laps ${firstLap} to ${lastLap}`}
            className="block"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {/* Gridlines and y-axis labels */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_MUTED}>
                  {formatTick(tick)}
                </text>
              </g>
            ))}
            {/* Baseline and x-axis labels */}
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
              stroke={AXIS}
              strokeWidth={1}
            />
            {lapTicks.map((lap) => (
              <text key={lap} x={x(lap)} y={MARGIN.top + plotHeight + 16} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                {lap}
              </text>
            ))}
            <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
              Lap
            </text>

            {/* Crosshair */}
            {hovered && (
              <line
                x1={tooltipLeft}
                x2={tooltipLeft}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
                stroke={AXIS}
                strokeWidth={1}
              />
            )}

            {/* Sector lines */}
            {sectors.map((s) => (
              <polyline
                key={s.number}
                points={s.values.map((v, i) => `${x(lapNumbers[i])},${y(v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Hovered lap markers, ringed in white so overlapping points stay distinct */}
            {hoverIndex !== null &&
              sectors.map((s) => (
                <circle
                  key={s.number}
                  cx={x(lapNumbers[hoverIndex])}
                  cy={y(s.values[hoverIndex])}
                  r={4}
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              ))}

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
            className="pointer-events-none absolute top-2 z-10 bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2 text-xs text-dark-blue whitespace-nowrap"
            style={tooltipOnLeft ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
          >
            <p className="font-semibold mb-1">Lap {hovered.lap}</p>
            {sectors.map((s) => (
              <p key={s.number} className="flex items-center gap-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-slate-600">S{s.number}</span>
                <span className="ml-auto pl-3">{s.times[hoverIndex].toFixed(3)}s</span>
                <span className="text-slate-500 w-14 text-right">
                  {s.times[hoverIndex] === s.best ? 'best' : `+${(s.times[hoverIndex] - s.best).toFixed(3)}`}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Table view of the same values */}
      <button
        type="button"
        onClick={() => setShowTable(!showTable)}
        className="mt-2 text-xs font-semibold text-powder-600 hover:underline"
      >
        {showTable ? 'Hide values' : 'Show values'}
      </button>
      {showTable && (
        <div className="mt-2 overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-dark-blue whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Lap</th>
                {sectors.map((s) => (
                  <th key={s.number} className="px-3 py-2 font-medium">
                    Sector {s.number}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {laps.map((lap, i) => (
                <tr key={`${lap.run}-${lap.lap}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{lap.lap}</td>
                  {sectors.map((s) => (
                    <td key={s.number} className={`px-3 py-1.5 ${s.times[i] === s.best ? 'font-semibold' : ''}`}>
                      {formatValue(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
