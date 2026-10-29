'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DeckGL from '@deck.gl/react';
import { COORDINATE_SYSTEM, WebMercatorViewport, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
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

// Same shading as the time delta chart: where the Compare lap is behind (red) or ahead (green), see-through so
// the cars show behind it
const LOSS_COLOR: [number, number, number, number] = [255, 64, 64, 110];
const GAIN_COLOR: [number, number, number, number] = [38, 167, 100, 110];
const EDGE_COLOR: [number, number, number, number] = [235, 235, 235, 200];

const LINE_WIDTH = 0.3; // m; the lines are often only 1-3 m apart
const LINE_LIFT = 0.06; // m the lines are drawn above the road, so they aren't hidden in it
const WALL_HALF_THICKNESS = 0.36; // m
// Stations (STATION_SPACING apart) each side of each one that the wall's gap is averaged over, so its top
// follows the trend rather than the sample-to-sample noise
const WALL_SMOOTHING = 8;
const WALL_MAX_HEIGHT = 12; // m, the wall's tallest point, at the area's largest time gap
const WALL_MIN_HEIGHT = 0.3; // m, so the wall can still be pointed at where the gap is 0

// How much taller than real the hills are drawn: elevation changes are small next to an area's length
const HEIGHT_SCALES = [1, 2, 3];
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
// The Base lap's car is a ghost: drawn see-through, after everything solid
const GHOST_ALPHA = 140;
// See-through layers blend over what's behind them without hiding it
const SEE_THROUGH = { depthWriteEnabled: false };

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
// Chase views: low behind the Base lap's car, Far (the first there was) or Near, zoomed in closer
type ChaseKind = 'near' | 'far';
const CHASE_VIEWS: Record<ChaseKind, { pitch: number; zoom: number }> = {
  far: { pitch: 72, zoom: 19.6 },
  near: { pitch: 75, zoom: 20.9 },
};
// How the camera arrows have moved a chase view from where it starts (degrees, zoom levels, degrees)
type CameraOffset = { pitch: number; zoom: number; bearing: number };
const NO_OFFSET: CameraOffset = { pitch: 0, zoom: 0, bearing: 0 };
const VIEW_LIMITS = { minZoom: 13, maxZoom: 22, maxPitch: 85 };
// Each press of the camera arrows: up and down tilt (and zoom out or in a little, like a helicopter climbing or
// descending), left and right turn the track
const CAMERA_PITCH_STEP = 10; // degrees
const CAMERA_ZOOM_STEP = 0.2;
const CAMERA_BEARING_STEP = 15; // degrees

type Rgba = [number, number, number, number];
type Car = { key: 'base' | 'compare'; line: ModelLine; color: Rgba; title: string };
// One piece of the time gap wall, between two stations: its footprint, how tall it is, the lap position it
// stands at and the (smoothed) gap there (s)
type WallPiece = { polygon: Vec3[]; elevation: number; pct: number; delta: number };

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
// at the same point; Play (or Reverse, backward) drives them through the area at their real pace, moving the
// crosshair with the Base car, once or with Loop over and over. Pointing at the wall moves the crosshair; the Near and
// Far Chase views follow the Base car from behind, and the camera arrows move the camera around it there. Loaded with
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
  const [chase, setChaseKind] = useState<ChaseKind | null>(null);
  // The camera arrows' moves in the chase view, kept while it follows the car
  const [chaseOffset, setChaseOffset] = useState<CameraOffset>(NO_OFFSET);
  const setChase = (kind: ChaseKind | null) => {
    setChaseKind(kind);
    setChaseOffset(NO_OFFSET);
  };
  const [failed, setFailed] = useState(false);
  const [heightScale, setHeightScale] = useState(DEFAULT_HEIGHT_SCALE);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  // 1 forward (Play), -1 backward (Reverse); with loop, the end (or the start, backward) goes round again
  const [direction, setDirection] = useState<1 | -1>(1);
  const [loop, setLoop] = useState(false);
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

  const { wall, largestGap } = useMemo(() => {
    if (!model) return { wall: [] as WallPiece[], largestGap: 0 };
    const stations = model.wallBase;
    const d0 = base.trace.domain[0];
    const [baseStart, compareStart] = [timeAtPosition(base.trace, d0), timeAtPosition(compare.trace, d0)];
    const raw = stations.map(
      ({ pct }) => timeAtPosition(compare.trace, pct) - compareStart - (timeAtPosition(base.trace, pct) - baseStart)
    );
    const smoothed = raw.map((_, i) => {
      const around = raw.slice(Math.max(0, i - WALL_SMOOTHING), i + WALL_SMOOTHING + 1);
      return around.reduce((sum, d) => sum + d, 0) / around.length;
    });
    const largest = Math.max(0, ...smoothed.map(Math.abs));
    const heightOf = (delta: number) =>
      largest > 0.001 ? WALL_MIN_HEIGHT + (Math.abs(delta) / largest) * WALL_MAX_HEIGHT : WALL_MIN_HEIGHT;
    // Each station's two sides, square to the wall's direction there, so neighboring pieces share an edge
    const sides = stations.map(({ position: [x, y, z] }, i) => {
      const [a, b] = [stations[Math.max(0, i - 1)].position, stations[Math.min(stations.length - 1, i + 1)].position];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [nx, ny] = [(-(b[1] - a[1]) / length) * WALL_HALF_THICKNESS, ((b[0] - a[0]) / length) * WALL_HALF_THICKNESS];
      return [[x + nx, y + ny, z], [x - nx, y - ny, z]] as [Vec3, Vec3];
    });
    const pieces = stations.slice(1).map(({ pct }, k): WallPiece => {
      const delta = (smoothed[k] + smoothed[k + 1]) / 2;
      return { polygon: [sides[k][0], sides[k + 1][0], sides[k + 1][1], sides[k][1]], elevation: heightOf(delta), pct, delta };
    });
    return { wall: pieces, largestGap: largest };
  }, [model, base.trace, compare.trace]);

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
      let seconds = clock.current + ((now - (last ?? now)) / 1000) * rate * direction;
      last = now;
      const ended = direction > 0 ? seconds >= duration : seconds <= 0;
      if (ended && loop && duration > 0) seconds = ((seconds % duration) + duration) % duration;
      clock.current = Math.min(duration, Math.max(0, seconds));
      const pct = poseAt(cars[0].line, indexAtTime(cars[0].line, clock.current)).pct;
      setPlay({ seconds: clock.current, pct });
      onHover(pct);
      if (ended && !loop) setPlaying(false);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // cars and onHover are new each render; the loop only needs the ones it started with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate, duration, model, direction, loop]);

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
  // Low behind the Base car, looking the way it's going, moved by the camera arrows
  const chaseView = (kind: ChaseKind): MapViewState => {
    const [longitude, latitude] = toLngLat(origin!, [lead.position[0], lead.position[1]]);
    return {
      longitude,
      latitude,
      zoom: CHASE_VIEWS[kind].zoom + chaseOffset.zoom,
      pitch: CHASE_VIEWS[kind].pitch + chaseOffset.pitch,
      bearing: 90 - lead.travel + chaseOffset.bearing,
      position: [0, 0, lead.position[2] + 1],
      ...VIEW_LIMITS,
    };
  };
  const viewState = chase ? chaseView(chase) : saved && saved.trace === base.trace ? saved.view : fitView();

  const offsets = { coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS, coordinateOrigin: [origin![1], origin![0], 0] as Vec3 };
  const linePath = ({ points, heights }: ModelLine) => points.map(([x, y], i): Vec3 => [x, y, heights[i] + LINE_LIFT]);
  const carData = cars.map((car, i) => ({ car, pose: poses[i] }));
  // The solid (Compare) car's layers, or the ghost (Base) car's
  const carLayers = (ghosts: boolean) => {
    const data = carData.filter((d) => (d.car.key === 'base') === ghosts);
    const seeThrough = ghosts ? { parameters: SEE_THROUGH } : {};
    return [
      ...CAR_PARTS.map(
        ({ id, mesh, color, material }) =>
          new SimpleMeshLayer<(typeof carData)[number]>({
            id: ghosts ? `${id}-ghost` : id,
            data,
            mesh,
            getPosition: (d) => d.pose.position,
            getOrientation: (d) => [d.pose.pitch, d.pose.yaw, 0],
            getColor: (d): Rgba => {
              const [r, g, b, a] = color(d.car, d.pose);
              return [r, g, b, ghosts ? GHOST_ALPHA : a];
            },
            material,
            ...seeThrough,
            ...offsets,
          })
      ),
      new SimpleMeshLayer<{ position: Vec3; orientation: Vec3 }>({
        id: ghosts ? 'wheels-ghost' : 'wheels',
        data: data.flatMap((d) => wheelsOf(d.pose)),
        mesh: WHEEL_MESH,
        getPosition: (d) => d.position,
        getOrientation: (d) => d.orientation,
        getColor: [255, 255, 255, ghosts ? GHOST_ALPHA : 255],
        material: MATERIAL,
        ...seeThrough,
        ...offsets,
      }),
    ];
  };

  const layers = [
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
      id: 'lines',
      data: cars,
      getPath: (car) => linePath(car.line),
      getColor: (car) => car.color,
      getWidth: LINE_WIDTH,
      widthUnits: 'meters',
      widthMinPixels: 1,
      capRounded: true,
      jointRounded: true,
      ...offsets,
    }),
    // Solid things first, then the see-through wall and ghost car over them
    ...carLayers(false),
    new SolidPolygonLayer<WallPiece>({
      id: 'gap-wall',
      data: wall,
      getPolygon: (p) => p.polygon,
      getElevation: (p) => p.elevation,
      getFillColor: (p) => (p.delta > 0 ? LOSS_COLOR : GAIN_COLOR),
      extruded: true,
      // Points at the crosshair while neither the chase view nor Play is steering it
      pickable: !chase && !playing,
      parameters: SEE_THROUGH,
      ...offsets,
    }),
    ...carLayers(true),
  ];

  const onPick = (info: PickingInfo<WallPiece>) => {
    if (chase || playing) return;
    onHover(info.layer?.id === 'gap-wall' && info.object ? info.object.pct : null);
  };

  // Play (forward) or Reverse: pauses when already going that way, turns round when going the other
  const togglePlay = (way: 1 | -1) => {
    if (playing && direction === way) {
      setPlaying(false);
      return;
    }
    if (!playing) {
      // Carry on from a pause, or start again from the start of the area (the end, backward)
      const paused = timed ? play.seconds : null;
      if (way > 0) clock.current = paused !== null && paused < duration ? paused : 0;
      else clock.current = paused !== null && paused > 0 ? paused : duration;
    }
    setDirection(way);
    setPlaying(true);
  };

  // Moves the camera from where it is now, centered on the cars so it keeps looking at them
  // In a chase view they move the camera around the car it follows, and it keeps following
  const moveCamera = (pitch: number, zoom: number, bearing: number) => {
    if (chase) {
      // Kept within the view's limits, so presses past one don't have to be undone
      const { pitch: pitch0, zoom: zoom0 } = CHASE_VIEWS[chase];
      setChaseOffset((o) => ({
        pitch: Math.min(VIEW_LIMITS.maxPitch, Math.max(0, pitch0 + o.pitch + pitch)) - pitch0,
        zoom: Math.min(VIEW_LIMITS.maxZoom, Math.max(VIEW_LIMITS.minZoom, zoom0 + o.zoom + zoom)) - zoom0,
        bearing: o.bearing + bearing,
      }));
      return;
    }
    const from = viewState;
    const [x, y, z] = [0, 1, 2].map((k) => poses.reduce((sum, p) => sum + p.position[k], 0) / poses.length);
    const [longitude, latitude] = toLngLat(origin!, [x, y]);
    setSaved({
      view: {
        ...from,
        longitude,
        latitude,
        position: [0, 0, z],
        pitch: Math.min(VIEW_LIMITS.maxPitch, Math.max(0, (from.pitch ?? 0) + pitch)),
        zoom: Math.min(VIEW_LIMITS.maxZoom, Math.max(VIEW_LIMITS.minZoom, from.zoom + zoom)),
        bearing: ((((from.bearing ?? 0) + bearing + 180) % 360) + 360) % 360 - 180,
      },
      trace: base.trace,
    });
  };
  const cameraArrows = [
    { label: t.cameraUp, move: [-CAMERA_PITCH_STEP, -CAMERA_ZOOM_STEP, 0], points: '6,1 11,10 1,10', place: 'col-start-2' },
    { label: t.cameraLeft, move: [0, 0, CAMERA_BEARING_STEP], points: '1,6 10,1 10,11', place: 'col-start-1 row-start-2' },
    { label: t.cameraRight, move: [0, 0, -CAMERA_BEARING_STEP], points: '11,6 2,1 2,11', place: 'col-start-3 row-start-2' },
    { label: t.cameraDown, move: [CAMERA_PITCH_STEP, CAMERA_ZOOM_STEP, 0], points: '6,11 11,2 1,2', place: 'col-start-2 row-start-3' },
  ];

  // Like the My Race Trends charts' range buttons (RaceRangePicker), on a card so they read over the model
  const panelClass = 'flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow';
  const buttonClass =
    'px-2 py-1 rounded text-xs font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const pressedClass = 'bg-primary/15 text-primary hover:text-primary';
  const selectClass =
    'px-1 py-1 rounded bg-transparent text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const arrowClass =
    'w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
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
            if (interactionState.isDragging || interactionState.isZooming || interactionState.isRotating) setChase(null);
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
          <div className={panelClass}>
            <button
              type="button"
              aria-pressed={playing && direction < 0}
              title={t.reverse3dHelp}
              className={`${buttonClass} ${playing && direction < 0 ? pressedClass : ''}`}
              onClick={() => togglePlay(-1)}
            >
              {playing && direction < 0 ? t.pause3d : t.reverse3d}
            </button>
            <button
              type="button"
              aria-pressed={playing && direction > 0}
              className={`${buttonClass} ${playing && direction > 0 ? pressedClass : ''}`}
              onClick={() => togglePlay(1)}
            >
              {playing && direction > 0 ? t.pause3d : t.play3d}
            </button>
            <select
              aria-label={t.playRate}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className={selectClass}
            >
              {PLAY_RATES.map((r) => (
                <option key={r} value={r} className="bg-card text-foreground">
                  {fmt(t.playRateOption, { n: number(r, r < 1 ? 2 : 0) })}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={loop}
              title={t.loop3dHelp}
              className={`${buttonClass} ${loop ? pressedClass : ''}`}
              onClick={() => setLoop(!loop)}
            >
              {t.loop3d}
            </button>
          </div>
          <div className={`${panelClass} flex-col items-stretch`}>
            {(
              [
                ['near', t.nearChaseView, t.nearChaseViewHelp],
                ['far', t.chaseView, t.chaseViewHelp],
              ] as const
            ).map(([kind, label, help]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={chase === kind}
                title={help}
                className={`${buttonClass} ${chase === kind ? pressedClass : ''}`}
                onClick={() => setChase(chase === kind ? null : kind)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setChase(null);
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
              className={selectClass}
            >
              {HEIGHT_SCALES.map((s) => (
                <option key={s} value={s} className="bg-card text-foreground">
                  {fmt(t.heightScaleOption, { n: s })}
                </option>
              ))}
            </select>
          </div>
          {/* Camera arrows: up and down raise and lower the camera, left and right turn the track */}
          <div className={`${panelClass} grid grid-cols-3 grid-rows-3 gap-0.5`} role="group" aria-label={t.cameraControls}>
            {cameraArrows.map(({ label, move: [pitch, zoom, bearing], points, place }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                className={`${arrowClass} ${place}`}
                onClick={() => moveCamera(pitch, zoom, bearing)}
              >
                <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden="true">
                  <polygon points={points} fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
            ))}
          </div>
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
