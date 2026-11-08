'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { project } from '@/lib/satelliteImagery';

// One focus area on the map: its stretch of the lap as [lat, lon] points, and the Compare lap's time there
// against the Target lap's (seconds, Compare minus Target)
export type DeltaMapArea = { name: string; positions: [number, number][]; secondsDiff: number; baseSeconds: number };

export type DeltaShade = 'muchSlower' | 'slower' | 'same' | 'faster' | 'muchFaster';

// The same rule as the Lap Compare table's Time cells (diffBackground): the difference as shown (to the
// millisecond), and "much" when it's more than 1% of the Target lap's time in the area
export function deltaShade(secondsDiff: number, baseSeconds: number): DeltaShade {
  const diff = Math.round(secondsDiff * 1000) / 1000;
  if (diff === 0) return 'same';
  const much = baseSeconds !== 0 && Math.abs(diff) / Math.abs(baseSeconds) > 0.01;
  if (diff > 0) return much ? 'muchSlower' : 'slower';
  return much ? 'muchFaster' : 'faster';
}

// The table's red (--primary, hue 25) and green (--positive, hue 160), dark for much and light for a bit
const SHADE_COLORS: Record<Exclude<DeltaShade, 'same'>, string> = {
  muchSlower: 'oklch(0.5 0.2 25)',
  slower: 'oklch(0.76 0.14 25)',
  faster: 'oklch(0.86 0.12 160)',
  muchFaster: 'oklch(0.55 0.15 160)',
};
const LEGEND: Exclude<DeltaShade, 'same'>[] = ['muchSlower', 'slower', 'faster', 'muchFaster'];

// The whole lap, north up, with each focus area drawn in red where the Compare lap was slower than the Target
// lap and green where it was faster, darker when it's much. outline is the whole lap's [lat, lon] points.
// Fills the height its parent gives it (Lap Compare puts it beside the table, as tall as the table).
// Clicking an area picks it for the charts below. fromTrackOutline: neither lap has track positions, so outline is
// the track's from Track Data (its iRacing outline) and each area is where it is on the lap, which the map says.
export default function LapDeltaMap({
  outline,
  areas,
  selectedArea,
  onSelectArea,
  fromTrackOutline = false,
  className = '',
}: {
  outline: [number, number][];
  areas: DeltaMapArea[];
  selectedArea: string;
  onSelectArea: (name: string) => void;
  fromTrackOutline?: boolean;
  className?: string;
}) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.lapCompare.deltaMap;

  const track = outline.map(project);
  return (
    <div className={`flex flex-col rounded-lg border border-border bg-card p-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="mr-auto text-sm font-semibold text-foreground">{t.title}</h3>
        {LEGEND.map((shade) => (
          <span key={shade} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-4 rounded-full" style={{ backgroundColor: SHADE_COLORS[shade] }} />
            {t[shade]}
          </span>
        ))}
      </div>
      {track.length < 2 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t.noPositions}</p>
      ) : (
        <TrackDrawing track={track} areas={areas} selectedArea={selectedArea} onSelectArea={onSelectArea} />
      )}
      {fromTrackOutline && track.length >= 2 && <p className="mt-1 text-xs text-muted-foreground">{t.fromTrackOutline}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{t.help}</p>
    </div>
  );
}

function TrackDrawing({
  track,
  areas,
  selectedArea,
  onSelectArea,
}: {
  track: [number, number][];
  areas: DeltaMapArea[];
  selectedArea: string;
  onSelectArea: (name: string) => void;
}) {
  const xs = track.map(([x]) => x);
  const ys = track.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-12);
  const pad = span * 0.06;
  const viewBox = [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad].join(' ');
  const path = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('');

  const drawn = areas
    .filter((area) => area.positions.length > 1)
    .map((area) => ({ ...area, d: path(area.positions.map(project)), shade: deltaShade(area.secondsDiff, area.baseSeconds) }));
  const [startX, startY] = track[0];

  return (
    // Its size comes from the parent, never its content, so it can't make the row taller than the table
    <div className="relative mt-2 min-h-40 flex-1">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={drawn.map((a) => `${a.name} ${a.secondsDiff >= 0 ? '+' : '−'}${Math.abs(a.secondsDiff).toFixed(3)} s`).join(', ')}
      >
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          {/* The whole lap in gray: what isn't in a focus area, or an area without a comparison, stays gray */}
          <path d={path(track)} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={7} vectorEffect="non-scaling-stroke" />
          {drawn.map((area) => {
            const selected = area.name === selectedArea;
            return (
              <g key={area.name} className="cursor-pointer" onClick={() => onSelectArea(area.name)}>
                <title>{`${area.name}: ${area.secondsDiff >= 0 ? '+' : '−'}${Math.abs(area.secondsDiff).toFixed(3)} s`}</title>
                {/* A wide invisible stroke, so a thin line is easy to click */}
                <path d={area.d} stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke" />
                <path
                  d={area.d}
                  stroke={selected ? 'var(--foreground)' : 'rgba(0, 0, 0, 0.55)'}
                  strokeWidth={selected ? 11 : 8}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={area.d}
                  stroke={area.shade === 'same' ? 'var(--muted-foreground)' : SHADE_COLORS[area.shade]}
                  strokeWidth={selected ? 7 : 5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </g>
        {/* Start/finish */}
        <circle cx={startX} cy={startY} r={span * 0.018} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
