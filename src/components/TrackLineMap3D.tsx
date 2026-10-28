'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DeckGL from '@deck.gl/react';
import { COORDINATE_SYSTEM, WebMercatorViewport, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ColumnLayer, LineLayer, PathLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { BASE_LAP_COLOR as BASE_COLOR, COMPARE_LAP_COLOR as COMPARE_COLOR, nearestIndex } from '@/lib/lapCharts';
import { timeAtPosition } from '@/lib/lapData';
import { BRAKE_LIGHT_MESH, CAR_BODY_MESH, CAR_DETAIL_MESH, HEADLIGHT_MESH, WHEEL_MESH } from '@/lib/carModel3d';
import type { Mesh } from '@/lib/mesh3d';
import {
  buildRoadModel,
  poseAt,
  toLngLat,
  wheelsOf,
  type CarPose,
  type ModelLine,
  type Vec3,
} from '@/lib/lapModel3d';
import { DISTANCE_UNIT, SPEED_UNIT, distanceFromMeters, speedFromMetersPerSecond } from '@/lib/units';

// Same shading as the time delta chart: where the Compare lap is behind (red) or ahead (green)
const LOSS_COLOR: [number, number, number, number] = [255, 64, 64, 170];
const GAIN_COLOR: [number, number, number, number] = [38, 167, 100, 170];
const CASING_COLOR: [number, number, number, number] = [0, 0, 0, 140];
const EDGE_COLOR: [number, number, number, number] = [235, 235, 235, 200];
const GRID_COLOR: [number, number, number, number] = [255, 255, 255, 22];

const LINE_WIDTH = 0.6; // m, about a tire's width; the lines are often only 1-3 m apart
const CASING_WIDTH = 1.1; // m
const LINE_LIFT = 0.06; // m the lines are drawn above the road, so they aren't hidden in it
const WALL_RADIUS = 0.36; // m, so neighboring columns (STATION_SPACING apart) nearly touch
const WALL_MAX_HEIGHT = 12; // m, the wall's tallest point, at the area's largest time gap
const WALL_MIN_HEIGHT = 0.3; // m, so the wall can still be pointed at where the gap is 0
const GRID_SPACING = 10; // m between the ground grid's lines
const GRID_MARGIN = 20; // m of grid beyond the road

// How much taller than real the hills are drawn: elevation changes are small next to an area's length
const HEIGHT_SCALES = [1, 2, 3, 5];
const DEFAULT_HEIGHT_SCALE = 2;
const PLAY_RATES = [0.25, 0.5, 1];

const MATERIAL = { ambient: 0.45, diffuse: 0.65, shininess: 24, specularColor: [50, 50, 50] as [number, number, number] };
// Glossy paint
const PAINT = { ambient: 0.4, diffuse: 0.6, shininess: 64, specularColor: [140, 140, 140] as [number, number, number] };
const WHITE: Rgba = [255, 255, 255, 255];
const HEADLIGHT_COLOR: Rgba = [255, 247, 222, 255];
// Above this (0-1) the brake lights are on
const BRAKE_LIGHT_THRESHOLD = 0.02;
const BRAKE_LIGHT_ON: Rgba = [255, 36, 36, 255];
const BRAKE_LIGHT_OFF: Rgba = [105, 14, 14, 255];

// The car's meshes (carModel3d.ts) and how each is colored: the body in the lap's color, the details in
// their own, the lights unlit (material false) so they glow, the brake lights only while that lap brakes
const CAR_PARTS: { id: string; mesh: Mesh; color: (car: Car, pose: CarPose) => Rgba; material: typeof MATERIAL | false }[] = [
  { id: 'car-bodies', mesh: CAR_BODY_MESH, color: (car) => car.color, material: PAINT },
  { id: 'car-details', mesh: CAR_DETAIL_MESH, color: () => WHITE, material: MATERIAL },
  { id: 'car-headlights', mesh: HEADLIGHT_MESH, color: () => HEADLIGHT_COLOR, material: false },
  {
    id: 'car-brake-lights',
    mesh: BRAKE_LIGHT_MESH,
    color: (_, pose) => (pose.brake > BRAKE_LIGHT_THRESHOLD ? BRAKE_LIGHT_ON : BRAKE_LIGHT_OFF),
    material: false,
  },
];

// Opening view: tilted, looking along the area the way the car drives through it
const FIT_PITCH = 55;
const FIT_PADDING = 40; // px
const MAX_FIT_ZOOM = 19.5;
// Chase view: low behind the Base lap's car
const CHASE_PITCH = 72;
const CHASE_ZOOM = 19.6;
const VIEW_LIMITS = { minZoom: 13, maxZoom: 22, maxPitch: 85 };

type Rgba = [number, number, number, number];
type Car = { key: 'base' | 'compare'; line: ModelLine; color: Rgba; title: string };
// One column of the time gap wall: where it stands, the lap position it stands at and the gap there (s)
type WallColumn = { position: Vec3; pct: number; delta: number };

function rgba(hex: string, alpha = 255): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

// The lap's time (s) at the start of the area, and its fractional sample index a time after that
function areaStart(line: ModelLine) {
  return timeAtPosition(line.trace, line.trace.domain[0]);
}
function indexAtTime(line: ModelLine, seconds: number) {
  const { times } = line.trace;
  const step = (times[times.length - 1] - times[0]) / Math.max(1, times.length - 1);
  return step > 0 ? (areaStart(line) + seconds - times[0]) / step : 0;
}

// The Base (blue) and Compare (red) laps through one focus area as a 3D model built from the laps alone
// (lapModel3d.ts): a road following the first line at its altitude, both driving lines on it, a car for each
// lap posed from its telemetry (heading from Yaw, so a slide shows as the nose pointing off the line, front
// wheels steered, pitched with the road), and a wall beside the road as tall as the Compare lap's time gap:
// red where it's behind, green where it's ahead. The cars sit at the pedal traces' crosshair (hoverPct), both
// at the same point; Play drives them through the area at their real pace, moving the crosshair with the Base
// car. Pointing at the wall moves the crosshair; the chase view follows the Base car from behind. Loaded with
// next/dynamic (DrivingLineMap) so deck.gl only downloads when the 3D view is picked.
export default function TrackLineMap3D({
  base,
  compare,
  width,
  height,
  hoverPct,
  onHover,
  headerExtra,
}: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  width: number;
  height: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
  headerExtra?: ReactNode;
}) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const t = dictionary.charts;
  const units = useUnits();
  // The moved view, and the laps it was set for: analyzing other laps opens fitted again
  const [saved, setSaved] = useState<{ view: MapViewState; trace: unknown } | null>(null);
  const [chase, setChase] = useState(false);
  const [failed, setFailed] = useState(false);
  const [heightScale, setHeightScale] = useState(DEFAULT_HEIGHT_SCALE);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  // Seconds since the start of the area that the cars are driven to by Play, and the crosshair position Play
  // last set: once the crosshair moves anywhere else, the cars go back to it
  const [play, setPlay] = useState<{ seconds: number; pct: number } | null>(null);
  const clock = useRef(0);

  const withPositions = [
    { key: 'base' as const, lap: base, color: rgba(BASE_COLOR), title: dictionary.lapCompare.base },
    { key: 'compare' as const, lap: compare, color: rgba(COMPARE_COLOR), title: dictionary.lapCompare.compare },
  ].filter(({ lap }) => lap.trace.positions !== null && lap.trace.positions.length > 1);
  const missing = [!base.trace.positions && dictionary.lapCompare.base, !compare.trace.positions && dictionary.lapCompare.compare].filter(Boolean);
  const origin = withPositions[0]?.lap.trace.positions![0] ?? null;

  const model = useMemo(
    () => (origin ? buildRoadModel(withPositions.map(({ lap }) => lap.trace), origin, heightScale) : null),
    // withPositions is rebuilt each render from the traces
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.trace, compare.trace, heightScale]
  );
  const cars: Car[] = model
    ? withPositions.map(({ key, color, title }, i) => ({ key, color, title, line: model.lines[i] }))
    : [];

  const wall = useMemo((): WallColumn[] => {
    if (!model) return [];
    const d0 = base.trace.domain[0];
    const [baseStart, compareStart] = [timeAtPosition(base.trace, d0), timeAtPosition(compare.trace, d0)];
    return model.wallBase.map(({ position, pct }) => ({
      position,
      pct,
      delta: timeAtPosition(compare.trace, pct) - compareStart - (timeAtPosition(base.trace, pct) - baseStart),
    }));
  }, [model, base.trace, compare.trace]);
  const largestGap = Math.max(0, ...wall.map((c) => Math.abs(c.delta)));

  const grid = useMemo(() => {
    if (!model) return [];
    const [x0, y0, x1, y1] = model.bounds.map((v, i) =>
      i < 2 ? Math.floor((v - GRID_MARGIN) / GRID_SPACING) * GRID_SPACING : Math.ceil((v + GRID_MARGIN) / GRID_SPACING) * GRID_SPACING
    );
    const segments: { from: Vec3; to: Vec3 }[] = [];
    for (let x = x0; x <= x1; x += GRID_SPACING) segments.push({ from: [x, y0, 0], to: [x, y1, 0] });
    for (let y = y0; y <= y1; y += GRID_SPACING) segments.push({ from: [x0, y, 0], to: [x1, y, 0] });
    return segments;
  }, [model]);

  // Play: the longest of the laps' times through the area
  const duration = Math.max(
    0,
    ...cars.map(({ line }) => timeAtPosition(line.trace, line.trace.domain[1]) - areaStart(line))
  );
  const timed = play !== null && hoverPct === play.pct;

  useEffect(() => {
    if (!playing || cars.length === 0) return;
    let frame = 0;
    let last: number | null = null; // the first frame's time
    const step = (now: number) => {
      clock.current = Math.min(duration, clock.current + ((now - (last ?? now)) / 1000) * rate);
      last = now;
      const pct = poseAt(cars[0].line, indexAtTime(cars[0].line, clock.current)).pct;
      setPlay({ seconds: clock.current, pct });
      onHover(pct);
      if (clock.current >= duration) setPlaying(false);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // cars and onHover are new each render; the loop only needs the ones it started with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate, duration, model]);

  if (!model || cars.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.noPositions}</p>;
  }

  const poses: CarPose[] = cars.map(({ line }) => {
    if (timed) return poseAt(line, indexAtTime(line, play.seconds));
    return poseAt(line, nearestIndex(line.trace.pcts, hoverPct ?? line.trace.domain[0]));
  });
  const lead = poses[0];

  const fitView = (): MapViewState => {
    const [x0, y0, x1, y1] = model.bounds;
    const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(
      [toLngLat(origin!, [x0, y0]), toLngLat(origin!, [x1, y1])],
      { padding: Math.min(FIT_PADDING, width / 4, height / 4) }
    );
    const { points, heights } = cars[0].line;
    const [first, end] = [points[0], points[points.length - 1]];
    return {
      longitude,
      latitude,
      // A little further out than flat, as tilting brings the near end closer
      zoom: Math.min(zoom - 0.3, MAX_FIT_ZOOM),
      pitch: FIT_PITCH,
      bearing: 90 - (Math.atan2(end[1] - first[1], end[0] - first[0]) * 180) / Math.PI,
      position: [0, 0, (Math.max(...heights) + Math.min(...heights)) / 2],
      ...VIEW_LIMITS,
    };
  };
  // Low behind the Base car, looking the way it's going
  const chaseView = (): MapViewState => {
    const [longitude, latitude] = toLngLat(origin!, [lead.position[0], lead.position[1]]);
    return {
      longitude,
      latitude,
      zoom: CHASE_ZOOM,
      pitch: CHASE_PITCH,
      bearing: 90 - lead.travel,
      position: [0, 0, lead.position[2] + 1],
      ...VIEW_LIMITS,
    };
  };
  const viewState = chase ? chaseView() : saved && saved.trace === base.trace ? saved.view : fitView();

  const offsets = { coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [origin![1], origin![0], 0] as Vec3 };
  const linePath = ({ points, heights }: ModelLine) => points.map(([x, y], i): Vec3 => [x, y, heights[i] + LINE_LIFT]);
  const carData = cars.map((car, i) => ({ car, pose: poses[i] }));

  const layers = [
    new LineLayer<{ from: Vec3; to: Vec3 }>({
      id: 'ground-grid',
      data: grid,
      getSourcePosition: (d) => d.from,
      getTargetPosition: (d) => d.to,
      getColor: GRID_COLOR,
      getWidth: 1,
      ...offsets,
    }),
    new SimpleMeshLayer({
      id: 'road',
      data: [{ position: [0, 0, 0] as Vec3 }],
      mesh: model.road,
      getPosition: (d) => d.position,
      getColor: [255, 255, 255, 255],
      material: MATERIAL,
      ...offsets,
    }),
    new PathLayer<Vec3[]>({
      id: 'road-edges',
      data: [model.leftEdge, model.rightEdge],
      getPath: (edge) => edge.map(([x, y, z]): Vec3 => [x, y, z + LINE_LIFT]),
      getColor: EDGE_COLOR,
      getWidth: 0.25,
      widthUnits: 'meters',
      widthMinPixels: 1,
      ...offsets,
    }),
    new PathLayer<Car>({
      id: 'line-casings',
      data: cars,
      getPath: (car) => linePath(car.line),
      getColor: CASING_COLOR,
      getWidth: CASING_WIDTH,
      widthUnits: 'meters',
      widthMinPixels: 4,
      capRounded: true,
      jointRounded: true,
      ...offsets,
    }),
    new PathLayer<Car>({
      id: 'lines',
      data: cars,
      getPath: (car) => linePath(car.line),
      getColor: (car) => car.color,
      getWidth: LINE_WIDTH,
      widthUnits: 'meters',
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
      ...offsets,
    }),
    new ColumnLayer<WallColumn>({
      id: 'gap-wall',
      data: wall,
      getPosition: (c) => c.position,
      getElevation: (c) =>
        largestGap > 0.001 ? WALL_MIN_HEIGHT + (Math.abs(c.delta) / largestGap) * WALL_MAX_HEIGHT : WALL_MIN_HEIGHT,
      getFillColor: (c) => (c.delta > 0 ? LOSS_COLOR : GAIN_COLOR),
      radius: WALL_RADIUS,
      diskResolution: 4,
      extruded: true,
      flatShading: true,
      // Points at the crosshair while neither the chase view nor Play is steering it
      pickable: !chase && !playing,
      updateTriggers: { getElevation: largestGap },
      ...offsets,
    }),
    ...CAR_PARTS.map(
      ({ id, mesh, color, material }) =>
        new SimpleMeshLayer<(typeof carData)[number]>({
          id,
          data: carData,
          mesh,
          getPosition: (d) => d.pose.position,
          getOrientation: (d) => [d.pose.pitch, d.pose.yaw, 0],
          getColor: (d) => color(d.car, d.pose),
          material,
          ...offsets,
        })
    ),
    new SimpleMeshLayer<{ position: Vec3; orientation: Vec3 }>({
      id: 'wheels',
      data: poses.flatMap(wheelsOf),
      mesh: WHEEL_MESH,
      getPosition: (d) => d.position,
      getOrientation: (d) => d.orientation,
      getColor: [255, 255, 255, 255],
      material: MATERIAL,
      ...offsets,
    }),
  ];

  const onPick = (info: PickingInfo<WallColumn>) => {
    if (chase || playing) return;
    onHover(info.layer?.id === 'gap-wall' && info.object ? info.object.pct : null);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Carry on from a pause, or start again from the start of the area
    clock.current = timed && play.seconds < duration ? play.seconds : 0;
    setPlaying(true);
  };

  const buttonClass =
    'h-8 px-2 flex items-center justify-center rounded-md bg-black/60 text-white text-xs hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const number = (value: number, digits: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const distance = (meters: number) => `${number(distanceFromMeters(meters, units), 0)} ${DISTANCE_UNIT[units]}`;

  return (
    <figure className="space-y-1">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{t.drivingLine}</span>
        {cars.map((car) => (
          <span key={car.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: car.key === 'base' ? BASE_COLOR : COMPARE_COLOR }} />
            {car.key === 'base' ? base.title : compare.title}
          </span>
        ))}
        {headerExtra}
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-slate-800 touch-none"
        style={{ width, height }}
        role="img"
        aria-label={fmt(t.drivingLinesAria3d, { laps: [base.title, compare.title].join(t.and) })}
        onPointerLeave={() => !chase && !playing && onHover(null)}
      >
        <DeckGL
          width={width}
          height={height}
          layers={layers}
          viewState={viewState}
          controller={{ dragRotate: true, touchRotate: true }}
          onViewStateChange={({ viewState: next, interactionState }) => {
            // Moving the view by hand leaves the chase view
            if (interactionState.isDragging || interactionState.isZooming || interactionState.isRotating) setChase(false);
            setSaved({ view: next as MapViewState, trace: base.trace });
          }}
          onHover={onPick}
          onClick={onPick}
          onError={() => setFailed(true)}
          getCursor={({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'crosshair' : 'grab')}
        />

        {failed && (
          <p className="absolute inset-x-4 top-4 rounded-md bg-black/70 px-3 py-2 text-sm text-white">{t.failed3d}</p>
        )}

        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <button type="button" className={buttonClass} onClick={togglePlay}>
              {playing ? t.pause3d : t.play3d}
            </button>
            <select
              aria-label={t.playRate}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="h-8 rounded-md bg-black/60 px-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {PLAY_RATES.map((r) => (
                <option key={r} value={r}>
                  {fmt(t.playRateOption, { n: number(r, r < 1 ? 2 : 0) })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            aria-pressed={chase}
            title={t.chaseViewHelp}
            className={`${buttonClass} ${chase ? 'ring-2 ring-white' : ''}`}
            onClick={() => setChase(!chase)}
          >
            {t.chaseView}
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setChase(false);
              setSaved(null);
            }}
          >
            {t.resetView}
          </button>
          <select
            aria-label={t.heightScale}
            title={t.heightScaleHelp}
            value={heightScale}
            onChange={(e) => setHeightScale(Number(e.target.value))}
            className="h-8 rounded-md bg-black/60 px-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {HEIGHT_SCALES.map((s) => (
              <option key={s} value={s}>
                {fmt(t.heightScaleOption, { n: s })}
              </option>
            ))}
          </select>
        </div>

        {/* Each car's speed, gear and slide at this moment */}
        <div className="absolute bottom-2 left-2 space-y-0.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white tabular-nums pointer-events-none">
          {cars.map((car, i) => {
            const pose = poses[i];
            return (
              <div key={car.key} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: car.key === 'base' ? BASE_COLOR : COMPARE_COLOR }} />
                {fmt(t.carReadout, {
                  lap: car.title,
                  speed: number(speedFromMetersPerSecond(pose.speed, units), 0),
                  unit: SPEED_UNIT[units],
                  gear: Number.isFinite(pose.gear) ? String(pose.gear) : '–',
                  slip: pose.slip === null ? '–' : number(pose.slip, 1),
                })}
              </div>
            );
          })}
        </div>
      </div>

      <figcaption className="text-xs text-muted-foreground">
        {missing.length > 0 && fmt(t.lapNoPositions, { laps: missing.join(t.and) })}
        {fmt(t.gapWall, { gap: number(largestGap, 3) })}
        {model.rise === null
          ? t.modelFlat
          : fmt(t.modelNote, { width: distance(model.halfWidth * 2), rise: distance(model.rise), fall: distance(model.fall ?? 0), n: heightScale })}
        {chase ? t.chaseHelp : t.map3dHelp}
      </figcaption>
    </figure>
  );
}
