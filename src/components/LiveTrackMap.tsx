'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { METERS_PER_PIXEL_Z0, project, SHARPEN_KERNEL, useMapSettings, viewTiles } from '@/lib/satelliteImagery';
import type { TrackOutline } from '@/lib/trackOutlines';

// A Live Racing map: the track's outline with its focus areas and start/finish line, and a dot for each car at its
// live LapDistPct. Live telemetry has no track positions, so each car is placed on the outline by how far round the
// lap it is. Between the page's updates (once a second) each dot keeps moving at the car's last speed, and eases
// to where the next update puts it. An exact outline (Lat/Lon) is drawn over satellite imagery, the same sharpened
// tiles as Lap Compare's maps, as see-through as imageryOpacity says.

export type MapCar = {
  // Unique on the map, e.g. "driver:12" or "car:12345:7"
  id: string;
  label: string;
  color: string;
  // LapDistPct (0-1) and speed (m/s) at sampledAt (performance.now() time); null pct: not on track
  pct: number | null;
  speed: number;
  // The car's pace round the lap in laps per second, used instead of speed when given (the field's other cars,
  // whose speed iRacing doesn't send)
  rate?: number | null;
  sampledAt: number;
  moving: boolean;
  highlight: boolean;
  // Another car in the session: drawn smaller, under the RacingCoach.app drivers, labeled with its car number
  fieldCar?: boolean;
  // Shown on hover
  title?: string;
  // Pit road or off track: drawn faded
  dim?: boolean;
};

type Area = { name: string; start: number; end: number };

// Stop predicting this long after the last update (a dropped connection shouldn't send the dot round the lap)
const MAX_PREDICT_S = 2;
// How quickly a dot eases to where it should be (per second)
const EASE_RATE = 8;
// Further than this off (share of the lap) it jumps instead, e.g. after a reset or a tow
const SNAP_DISTANCE = 0.05;

// Where a Lat/Lon outline's plane sits in Web Mercator: (x0, y0) in zoom-0 pixels at the plane's origin, and k
// meters per zoom-0 pixel there, so the satellite tiles line up with it exactly
type Mercator = { x0: number; y0: number; k: number };

// The outline in meters east and north, north up. A Lat/Lon one is Web Mercator scaled to meters at the track's
// latitude (true to within a fraction of a percent across a circuit), with where it sits for the imagery.
function planePoints(outline: TrackOutline): { points: [number, number][]; mercator: Mercator | null } {
  if (outline.kind === 'meters') return { points: outline.points, mercator: null };
  const lat0 = outline.points.reduce((sum, p) => sum + p[0], 0) / outline.points.length;
  const projected = outline.points.map(project);
  const x0 = projected.reduce((sum, p) => sum + p[0], 0) / projected.length;
  const y0 = projected.reduce((sum, p) => sum + p[1], 0) / projected.length;
  const k = METERS_PER_PIXEL_Z0 * Math.cos((lat0 * Math.PI) / 180);
  return { points: projected.map(([x, y]) => [(x - x0) * k, -(y - y0) * k]), mercator: { x0, y0, k } };
}

// A stand-in oval for a track without an outline
function placeholderPoints(): [number, number][] {
  return Array.from({ length: 360 }, (_, i) => {
    const a = (i / 360) * Math.PI * 2;
    return [Math.sin(a) * 800, Math.cos(a) * 450];
  });
}

function pointAt(points: [number, number][], pct: number): [number, number] {
  const f = ((((pct % 1) + 1) % 1) * points.length);
  const i = Math.floor(f) % points.length;
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const t = f - Math.floor(f);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function lapLength(points: [number, number][]): number {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

// From a to b the short way round the lap (-0.5 to 0.5)
const wrapDelta = (a: number, b: number) => ((((b - a) % 1) + 1.5) % 1) - 0.5;

// SVG path of the outline between two shares of the lap (round the start/finish line when end < start)
function pathBetween(points: [number, number][], start: number, end: number): string {
  const n = points.length;
  const from = Math.floor(start * n);
  const to = Math.ceil((end < start ? end + 1 : end) * n);
  const parts: string[] = [];
  for (let i = from; i <= to; i++) {
    const [x, y] = points[((i % n) + n) % n];
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${(-y).toFixed(1)}`);
  }
  return parts.join(' ');
}

export default function LiveTrackMap({
  outline,
  areas,
  cars,
  startFinishLabel,
  lengthMeters,
  imageryOpacity,
}: {
  outline: TrackOutline | null;
  areas: Area[];
  cars: MapCar[];
  startFinishLabel: string;
  // iRacing's length of the track, which turns speeds into shares of the lap (the outline's own length without it)
  lengthMeters: number | null;
  // The satellite imagery's opacity (0-1, 0 hides it), under an exact outline
  imageryOpacity: number;
}) {
  const { points, mercator } = useMemo(
    () => (outline ? planePoints(outline) : { points: placeholderPoints(), mercator: null }),
    [outline]
  );
  const view = useMemo(() => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => -p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const pad = size * 0.08;
    const [x, y, w, h] = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2];
    return { box: `${x} ${y} ${w} ${h}`, x, y, w, h, size };
  }, [points]);
  const trackPath = useMemo(() => `${pathBetween(points, 0, 0.9999)} Z`, [points]);
  const length = lengthMeters ?? (outline ? lapLength(points) : 0);

  // Each car's shown position, eased towards its predicted one every frame
  const carsRef = useRef(cars);
  const lengthRef = useRef(length);
  useEffect(() => {
    carsRef.current = cars;
    lengthRef.current = length;
  }, [cars, length]);
  const [shown, setShown] = useState<Record<string, number>>({});
  useEffect(() => {
    const positions = new Map<string, number>();
    let last = 0;
    let id = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
      last = now;
      const seen = new Set<string>();
      for (const car of carsRef.current) {
        if (car.pct == null) continue;
        seen.add(car.id);
        const elapsed = Math.min(Math.max((now - car.sampledAt) / 1000, 0), MAX_PREDICT_S);
        const lapLength = lengthRef.current;
        const rate = car.rate ?? (lapLength > 0 ? car.speed / lapLength : 0);
        const target = car.moving ? (car.pct + rate * elapsed) % 1 : car.pct;
        const previous = positions.get(car.id);
        const delta = previous == null ? 0 : wrapDelta(previous, target);
        positions.set(
          car.id,
          previous == null || Math.abs(delta) > SNAP_DISTANCE ? target : (previous + delta * Math.min(1, dt * EASE_RATE) + 1) % 1
        );
      }
      for (const carId of positions.keys()) if (!seen.has(carId)) positions.delete(carId);
      setShown(Object.fromEntries(positions));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // The imagery: the tiles covering all the SVG shows (wider or taller than the viewBox when its shape differs), at
  // the zoom its size on screen needs, placed in the outline's meters
  const settings = useMapSettings();
  const sharpenId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) =>
      setPixels({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const imagery = useMemo(() => {
    if (!mercator || !settings?.available || imageryOpacity <= 0 || !pixels || pixels.width < 1 || pixels.height < 1) return null;
    const perMeter = Math.min(pixels.width / view.w, pixels.height / view.h);
    const [cx, cy] = [view.x + view.w / 2, view.y + view.h / 2];
    const [left, top] = [cx - pixels.width / 2 / perMeter, cy - pixels.height / 2 / perMeter];
    const { zoom, size, tiles } = viewTiles(mercator.x0 + cx / mercator.k, mercator.y0 + cy / mercator.k, perMeter * mercator.k,
      pixels.width, pixels.height);
    // Half a pixel over, so no seams show between tiles
    const tileMeters = (size + 0.5) / perMeter;
    return tiles.map((tile) => ({
      key: `${zoom}-${tile.x}-${tile.y}`,
      href: `/api/map-tiles/${zoom}/${tile.x}/${tile.y}`,
      x: left + tile.left / perMeter,
      y: top + tile.top / perMeter,
      size: tileMeters,
    }));
  }, [mercator, settings, imageryOpacity, pixels, view]);

  const dots = cars.flatMap((car) => (shown[car.id] == null ? [] : [{ car, at: pointAt(points, shown[car.id]) }]));

  const s = view.size;
  // The start/finish line, across the track at its first point
  const [sx, sy] = points[0];
  const [nx, ny] = points[1 % points.length];
  const heading = Math.atan2(ny - sy, nx - sx);
  const across = s * 0.03;
  const [ax, ay] = [-Math.sin(heading) * across, Math.cos(heading) * across];

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} viewBox={view.box} className="w-full h-full" role="img" aria-label={cars.map((c) => c.label).join(', ')}>
        {imagery && (
          <>
            <filter id={sharpenId} colorInterpolationFilters="sRGB">
              <feConvolveMatrix order="3" kernelMatrix={SHARPEN_KERNEL} edgeMode="duplicate" preserveAlpha="true" />
            </filter>
            {/* One layer, so the filter sharpens across tile seams rather than tile by tile */}
            <g filter={`url(#${sharpenId})`} opacity={imageryOpacity}>
              {imagery.map((tile) => (
                <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.size} height={tile.size}
                  preserveAspectRatio="none" onError={(event) => (event.currentTarget.style.visibility = 'hidden')} />
              ))}
            </g>
          </>
        )}
        <path d={trackPath} fill="none" className="stroke-border" strokeWidth={14} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          strokeDasharray={outline ? undefined : '2 10'} />
        <path d={trackPath} fill="none" className="stroke-muted-foreground" strokeWidth={4} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          opacity={outline ? 0.9 : 0.3} strokeDasharray={outline ? undefined : '2 10'} />
        {outline &&
          areas.map((area) => {
            const [lx, ly] = pointAt(points, area.end < area.start ? ((area.start + area.end + 1) / 2) % 1 : (area.start + area.end) / 2);
            return (
              <g key={`${area.name}-${area.start}`}>
                <path d={pathBetween(points, area.start, area.end)} fill="none" className="stroke-primary" strokeWidth={4}
                  strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.75}>
                  <title>{area.name}</title>
                </path>
                <text x={lx} y={-ly} dx={s * 0.02} dy={-s * 0.02} fontSize={s * 0.026} className="fill-muted-foreground stroke-background"
                  strokeWidth={s * 0.005} paintOrder="stroke">
                  {area.name}
                </text>
              </g>
            );
          })}
        {outline && (
          <line x1={sx - ax} y1={-(sy - ay)} x2={sx + ax} y2={-(sy + ay)} className="stroke-foreground" strokeWidth={3}
            vectorEffect="non-scaling-stroke">
            <title>{startFinishLabel}</title>
          </line>
        )}
        {dots
          .sort((a, b) => Number(!a.car.fieldCar) - Number(!b.car.fieldCar) || Number(a.car.highlight) - Number(b.car.highlight))
          .map(({ car, at: [x, y] }) =>
            car.fieldCar ? (
              <g key={car.id} opacity={car.dim ? 0.45 : 1}>
                {car.title && <title>{car.title}</title>}
                <circle cx={x} cy={-y} r={s * 0.014} fill={car.color} stroke="black" strokeOpacity={0.6} strokeWidth={1}
                  vectorEffect="non-scaling-stroke" />
                <text x={x} y={-y} dy={s * 0.0065} fontSize={s * 0.017} fontWeight={700} textAnchor="middle" fill="black">
                  {car.label}
                </text>
              </g>
            ) : (
              <g key={car.id} opacity={car.dim ? 0.6 : 1}>
                {car.title && <title>{car.title}</title>}
                <circle cx={x} cy={-y} r={s * (car.highlight ? 0.022 : 0.018)} fill={car.color} stroke="white" strokeWidth={2}
                  vectorEffect="non-scaling-stroke" />
                <text x={x} y={-y} dx={s * 0.03} dy={s * 0.01} fontSize={s * 0.032} fontWeight={600} className="fill-foreground stroke-background"
                  strokeWidth={s * 0.006} paintOrder="stroke">
                  {car.label}
                </text>
              </g>
            )
          )}
      </svg>
      {imagery && settings?.attribution && (
        <p className="absolute bottom-0 right-0 px-1.5 py-0.5 text-[10px] text-white/80 bg-black/45 rounded-tl">{settings.attribution}</p>
      )}
    </div>
  );
}
