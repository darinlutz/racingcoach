'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackOutline } from '@/lib/trackOutlines';

// A Live Racing map: the track's outline with its focus areas and start/finish line, and a dot for each car at its
// live LapDistPct. Live telemetry has no track positions, so each car is placed on the outline by how far round the
// lap it is. Between the page's updates (once a second) each dot keeps moving at the car's last speed, and eases
// to where the next update puts it.

export type MapCar = {
  id: number;
  label: string;
  color: string;
  // LapDistPct (0-1) and speed (m/s) at sampledAt (performance.now() time); null pct: not on track
  pct: number | null;
  speed: number;
  sampledAt: number;
  moving: boolean;
  highlight: boolean;
};

type Area = { name: string; start: number; end: number };

// Stop predicting this long after the last update (a dropped connection shouldn't send the dot round the lap)
const MAX_PREDICT_S = 2;
// How quickly a dot eases to where it should be (per second)
const EASE_RATE = 8;
// Further than this off (share of the lap) it jumps instead, e.g. after a reset or a tow
const SNAP_DISTANCE = 0.05;
const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON = 111_320;

// The outline in meters east and north, north up
function planePoints(outline: TrackOutline): [number, number][] {
  if (outline.kind === 'meters') return outline.points;
  const lat0 = outline.points.reduce((sum, p) => sum + p[0], 0) / outline.points.length;
  const lon0 = outline.points.reduce((sum, p) => sum + p[1], 0) / outline.points.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return outline.points.map(([lat, lon]) => [(lon - lon0) * cos * METERS_PER_DEGREE_LON, (lat - lat0) * METERS_PER_DEGREE_LAT]);
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
}: {
  outline: TrackOutline | null;
  areas: Area[];
  cars: MapCar[];
  startFinishLabel: string;
  // iRacing's length of the track, which turns speeds into shares of the lap (the outline's own length without it)
  lengthMeters: number | null;
}) {
  const points = useMemo(() => (outline ? planePoints(outline) : placeholderPoints()), [outline]);
  const view = useMemo(() => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => -p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const pad = size * 0.08;
    return { box: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`, size };
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
  const [shown, setShown] = useState<Record<number, number>>({});
  useEffect(() => {
    const positions = new Map<number, number>();
    let last = 0;
    let id = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
      last = now;
      const seen = new Set<number>();
      for (const car of carsRef.current) {
        if (car.pct == null) continue;
        seen.add(car.id);
        const elapsed = Math.min(Math.max((now - car.sampledAt) / 1000, 0), MAX_PREDICT_S);
        const lapLength = lengthRef.current;
        const target = car.moving && lapLength > 0 ? (car.pct + (car.speed * elapsed) / lapLength) % 1 : car.pct;
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
  const dots = cars.flatMap((car) => (shown[car.id] == null ? [] : [{ car, at: pointAt(points, shown[car.id]) }]));

  const s = view.size;
  // The start/finish line, across the track at its first point
  const [sx, sy] = points[0];
  const [nx, ny] = points[1 % points.length];
  const heading = Math.atan2(ny - sy, nx - sx);
  const across = s * 0.03;
  const [ax, ay] = [-Math.sin(heading) * across, Math.cos(heading) * across];

  return (
    <svg viewBox={view.box} className="w-full h-full" role="img" aria-label={cars.map((c) => c.label).join(', ')}>
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
              <text x={lx} y={-ly} dx={s * 0.02} dy={-s * 0.02} fontSize={s * 0.026} className="fill-muted-foreground">
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
        .sort((a, b) => Number(a.car.highlight) - Number(b.car.highlight))
        .map(({ car, at: [x, y] }) => (
          <g key={car.id}>
            <circle cx={x} cy={-y} r={s * (car.highlight ? 0.022 : 0.018)} fill={car.color} stroke="white" strokeWidth={2}
              vectorEffect="non-scaling-stroke" />
            <text x={x} y={-y} dx={s * 0.03} dy={s * 0.01} fontSize={s * 0.032} fontWeight={600} className="fill-foreground">
              {car.label}
            </text>
          </g>
        ))}
    </svg>
  );
}
