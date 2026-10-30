'use client';

import { memo } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { TireCorner } from '@/lib/lapData';
import { deltaColor, formatDelta, heatColor, shownDelta, type TireComparison, type TireEdge } from '@/lib/tireTempComparison';

export type CarViewMode = 'target' | 'compare' | 'delta';

const W = 340;
const H = 680;
// Tire positions; a left tire's inner tread faces the car's center, and a right tire's too
const TIRES: Record<TireCorner, { x: number; y: number; side: 'L' | 'R' }> = {
  LF: { x: 58, y: 142, side: 'L' },
  RF: { x: 240, y: 142, side: 'R' },
  LR: { x: 54, y: 470, side: 'L' },
  RR: { x: 244, y: 470, side: 'R' },
};
const CORNERS = Object.keys(TIRES) as TireCorner[];
const TIRE_W = 42;
const TIRE_H = 90;
// A tire edge with nothing to show in this view
const NO_DATA_FILL = 'var(--secondary)';

function edgeFill(mode: CarViewMode, { target, compare, deltas }: TireComparison, edge: TireEdge) {
  if (mode === 'delta') {
    const delta = deltas[edge];
    return delta === null ? NO_DATA_FILL : deltaColor(delta);
  }
  const value = (mode === 'target' ? target : compare).segments[edge];
  return value === null ? NO_DATA_FILL : heatColor(value);
}

// The car from above, with each tire's inner, middle and outer tread colored by the view: the Target or Compare lap's
// temperature, or the difference on one scale for all four. The body never changes, and memo keeps it from redrawing
// unless a tire's values do; only the tires' fills follow the cursor. Hovering or clicking a tire highlights its gauge.
const GT3CarTopView = memo(function GT3CarTopView({
  comparisons,
  mode,
  showBadges,
  hovered,
  selected,
  onTireHover,
  onTireSelect,
}: {
  comparisons: Record<TireCorner, TireComparison>;
  mode: CarViewMode;
  showBadges: boolean;
  hovered: TireCorner | null;
  selected: TireCorner | null;
  onTireHover: (corner: TireCorner | null) => void;
  onTireSelect: (corner: TireCorner) => void;
}) {
  const { t, locale } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[340px]" role="group" aria-label={labels.carLabel}>
      <defs>
        <linearGradient id="gt3-body" x1="0" x2="1">
          <stop offset="0" stopColor="var(--car-body)" />
          <stop offset="0.5" stopColor="var(--car-body-hi)" />
          <stop offset="1" stopColor="var(--car-body)" />
        </linearGradient>
        <linearGradient id="gt3-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--car-glass)" />
          <stop offset="1" stopColor="var(--background)" />
        </linearGradient>
        <filter id="gt3-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <path
          id="gt3-half"
          d="M170 18 C140 18 118 24 104 40 L96 62 C92 80 92 100 90 120
             C78 128 74 150 74 190 C74 226 82 244 96 254
             L100 300 L98 420 C88 432 80 456 78 500
             C78 548 84 576 96 600 L104 636 L170 636 Z"
        />
      </defs>

      {/* Leader lines towards the gauges */}
      {CORNERS.map((corner) => {
        const tire = TIRES[corner];
        const cy = tire.y + TIRE_H / 2;
        const x1 = tire.side === 'L' ? 0 : W;
        const x2 = tire.side === 'L' ? tire.x - 4 : tire.x + TIRE_W + 4;
        return (
          <g key={corner} opacity={hovered === corner || selected === corner ? 1 : 0.45}>
            <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={`var(--tire-${corner.toLowerCase()})`} strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x2} cy={cy} r={2.5} fill={`var(--tire-${corner.toLowerCase()})`} />
          </g>
        );
      })}

      {/* Body */}
      <g>
        <use href="#gt3-half" fill="url(#gt3-body)" stroke="var(--border)" strokeWidth={1.2} />
        <use href="#gt3-half" transform={`translate(${W} 0) scale(-1 1)`} fill="url(#gt3-body)" stroke="var(--border)" strokeWidth={1.2} />
        {/* Front splitter */}
        <path d="M108 30 Q170 8 232 30 L238 40 Q170 22 102 40 Z" fill="var(--background)" stroke="var(--border)" />
        {/* Hood vents */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x={128} y={92 + i * 9} width={30} height={3} rx={1.5} fill="var(--background)" />
            <rect x={182} y={92 + i * 9} width={30} height={3} rx={1.5} fill="var(--background)" />
          </g>
        ))}
        {/* Brand stripe */}
        <rect x={164} y={24} width={12} height={180} fill="var(--primary)" opacity={0.85} />
        <rect x={164} y={420} width={12} height={170} fill="var(--primary)" opacity={0.85} />
        {/* Windshield, roof, rear glass */}
        <path d="M118 228 Q170 206 222 228 L214 280 Q170 268 126 280 Z" fill="url(#gt3-glass)" stroke="var(--border)" />
        <rect x={126} y={282} width={88} height={110} rx={10} fill="var(--car-body-hi)" stroke="var(--border)" />
        <rect x={150} y={300} width={40} height={18} rx={3} fill="var(--background)" opacity={0.7} />
        <path d="M128 396 L212 396 L206 440 Q170 448 134 440 Z" fill="url(#gt3-glass)" stroke="var(--border)" />
        {/* Mirrors */}
        <path d="M100 252 L82 246 L80 260 L100 264 Z" fill="var(--car-body-hi)" stroke="var(--border)" />
        <path d="M240 252 L258 246 L260 260 L240 264 Z" fill="var(--car-body-hi)" stroke="var(--border)" />
        {/* Side intakes */}
        <path d="M100 414 Q112 404 118 420 L116 452 Q106 446 100 440 Z" fill="var(--background)" />
        <path d="M240 414 Q228 404 222 420 L224 452 Q234 446 240 440 Z" fill="var(--background)" />
        {/* Engine cover louvres */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={136} y={466 + i * 12} width={68} height={4} rx={2} fill="var(--background)" opacity={0.75} />
        ))}
        {/* Rear wing */}
        <rect x={64} y={612} width={212} height={22} rx={3} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={1} />
        <rect x={64} y={612} width={212} height={4} fill="var(--primary)" />
        <rect x={58} y={604} width={8} height={38} rx={2} fill="var(--car-body-hi)" stroke="var(--border)" />
        <rect x={274} y={604} width={8} height={38} rx={2} fill="var(--car-body-hi)" stroke="var(--border)" />
        <rect x={140} y={596} width={6} height={18} fill="var(--border)" />
        <rect x={194} y={596} width={6} height={18} fill="var(--border)" />
        {/* Diffuser */}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={118 + i * 20} y={640} width={4} height={14} fill="var(--border)" />
        ))}
      </g>

      {/* Tires */}
      {CORNERS.map((corner) => {
        const tire = TIRES[corner];
        const comparison = comparisons[corner];
        const active = hovered === corner || selected === corner;
        const order: TireEdge[] = tire.side === 'L' ? ['outer', 'middle', 'inner'] : ['inner', 'middle', 'outer'];
        const { avg: targetAvg } = comparison.target;
        const { avg: compareAvg } = comparison.compare;
        const delta = comparison.deltas.avg;
        const color = delta === null ? 'var(--muted-foreground)' : deltaColor(delta);
        const edgeWidth = TIRE_W / 3;
        const tireColor = `var(--tire-${corner.toLowerCase()})`;
        return (
          <g
            key={corner}
            id={`tire-${corner.toLowerCase()}`}
            data-tire={corner}
            role="button"
            tabIndex={0}
            aria-pressed={selected === corner}
            aria-label={t.charts.tireCorners[corner]}
            className="cursor-pointer focus:outline-none"
            onMouseEnter={() => onTireHover(corner)}
            onMouseLeave={() => onTireHover(null)}
            onFocus={() => onTireHover(corner)}
            onBlur={() => onTireHover(null)}
            onClick={() => onTireSelect(corner)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onTireSelect(corner);
            }}
          >
            {active && (
              <rect x={tire.x - 4} y={tire.y - 4} width={TIRE_W + 8} height={TIRE_H + 8} rx={10} fill={edgeFill(mode, comparison, 'middle')} filter="url(#gt3-glow)" opacity={0.7} />
            )}
            <rect x={tire.x} y={tire.y} width={TIRE_W} height={TIRE_H} rx={8} fill="var(--background)" />
            <clipPath id={`clip-${corner}`}>
              <rect x={tire.x} y={tire.y} width={TIRE_W} height={TIRE_H} rx={8} />
            </clipPath>
            <g clipPath={`url(#clip-${corner})`}>
              {order.map((edge, i) => (
                <rect
                  key={edge}
                  data-edge={edge}
                  x={tire.x + i * edgeWidth}
                  y={tire.y}
                  width={edgeWidth}
                  height={TIRE_H}
                  fill={edgeFill(mode, comparison, edge)}
                  style={{ transition: 'fill 150ms ease' }}
                />
              ))}
              {Array.from({ length: 9 }).map((_, i) => (
                <line key={i} x1={tire.x} x2={tire.x + TIRE_W} y1={tire.y + 6 + i * 10} y2={tire.y + 10 + i * 10} stroke="var(--background)" strokeOpacity={0.25} />
              ))}
            </g>
            <rect x={tire.x} y={tire.y} width={TIRE_W} height={TIRE_H} rx={8} fill="none" stroke={active ? 'var(--foreground)' : tireColor} strokeWidth={active ? 2 : 1.2} />
            <text x={tire.x + TIRE_W / 2} y={tire.y - 8} textAnchor="middle" fontSize={11} fontFamily="var(--font-display)" letterSpacing="0.12em" fill={tireColor}>
              {corner}
            </text>
            {showBadges && (
              <g transform={`translate(${tire.side === 'L' ? tire.x + TIRE_W + 8 : tire.x - 62} ${tire.y + TIRE_H / 2 - 11})`}>
                <rect width={54} height={22} rx={3} fill="var(--card)" stroke={color} />
                <text x={27} y={15} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} className="tabular-nums">
                  {delta === null || targetAvg === null || compareAvg === null ? labels.na : formatDelta(shownDelta(compareAvg, targetAvg, units), locale)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
});

export default GT3CarTopView;
