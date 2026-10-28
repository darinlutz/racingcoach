'use client';

import { useMemo, useState, type ReactNode } from 'react';
import DeckGL from '@deck.gl/react';
import { WebMercatorViewport, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ColumnLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension, type TerrainExtensionProps } from '@deck.gl/extensions';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { BASE_LAP_COLOR as BASE_COLOR, COMPARE_LAP_COLOR as COMPARE_COLOR, nearestIndex } from '@/lib/lapCharts';
import { timeAtPosition } from '@/lib/lapData';

// Google's Photorealistic 3D Tiles: the real track, its grandstands, barriers and elevation, in 3D
const GOOGLE_3D_TILES_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
// The Google Maps logo on the map, 18 px tall (Google allows 16-19), at the SVG's 105 x 22 shape
const GOOGLE_LOGO_HEIGHT = 18;
const GOOGLE_LOGO_WIDTH = Math.round((GOOGLE_LOGO_HEIGHT * 105) / 22);

// Same shading as the time delta chart: where the Compare lap is behind (red) or ahead (green)
const LOSS_COLOR: [number, number, number, number] = [255, 64, 64, 170];
const GAIN_COLOR: [number, number, number, number] = [38, 167, 100, 170];
const CASING_COLOR: [number, number, number, number] = [0, 0, 0, 140];

const LINE_WIDTH = 0.6; // m, about a tire's width; the lines are often only 1-3 m apart
const CASING_WIDTH = 1.1; // m
const WALL_SPACING = 0.5; // m between the wall's columns
const WALL_RADIUS = 0.36; // m, so neighboring columns nearly touch
const WALL_MAX_HEIGHT = 12; // m, the wall's tallest point, at the area's largest time gap
const WALL_MIN_HEIGHT = 0.3; // m, so the wall can still be pointed at where the gap is 0
const PIN_HEIGHT = 5; // m, the crosshair's pin above each lap's dot
const HEADING_SPAN = 4; // samples either side giving the direction of travel for the chase view

// Opening view: tilted, looking along the area the way the car drives through it
const FIT_PITCH = 55;
const FIT_PADDING = 40; // px
const MAX_FIT_ZOOM = 19.5;
// Chase view: low behind the Base lap's car at the crosshair
const CHASE_PITCH = 72;
const CHASE_ZOOM = 19.6;
const VIEW_LIMITS = { minZoom: 13, maxZoom: 21, maxPitch: 85 };

// Created once: each instance would add its own terrain effect. Still marked experimental (_) in deck.gl 9.4
const TERRAIN = new TerrainExtension();

type Rgba = [number, number, number, number];
type Line = { key: 'base' | 'compare'; lap: PedalTraceLap; color: Rgba; positions: [number, number][] };
// One column of the time gap wall: where (lon, lat), the lap position it stands at and the gap there (s)
type WallColumn = { position: [number, number]; pct: number; delta: number };

function rgba(hex: string, alpha = 255): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

// Meters east and north from a to b, [lat, lon] in degrees; plenty accurate over a focus area
function offsetMeters([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): [number, number] {
  return [(lon2 - lon1) * 111_320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110_540];
}

// Compass bearing (degrees clockwise from north) from a to b
function bearing(a: [number, number], b: [number, number]) {
  const [east, north] = offsetMeters(a, b);
  return (Math.atan2(east, north) * 180) / Math.PI;
}

// The Compare lap's time gained or lost against the Base lap since the area's start (as in TimeDeltaTrace),
// every WALL_SPACING m along line
function wallColumns(line: Line, base: PedalTraceLap, compare: PedalTraceLap): WallColumn[] {
  const { positions } = line;
  const { pcts } = line.lap.trace;
  const d0 = base.trace.domain[0];
  const [baseStart, compareStart] = [timeAtPosition(base.trace, d0), timeAtPosition(compare.trace, d0)];
  const deltaAt = (pct: number) =>
    timeAtPosition(compare.trace, pct) - compareStart - (timeAtPosition(base.trace, pct) - baseStart);

  const columns: WallColumn[] = [];
  let next = 0; // distance along the line (m) of the next column
  let travelled = 0;
  for (let i = 1; i < positions.length; i++) {
    const length = Math.hypot(...offsetMeters(positions[i - 1], positions[i]));
    while (length > 0 && next <= travelled + length) {
      const f = (next - travelled) / length;
      const [lat, lon] = [0, 1].map((k) => positions[i - 1][k] + f * (positions[i][k] - positions[i - 1][k]));
      const pct = pcts[i - 1] + f * (pcts[i] - pcts[i - 1]);
      columns.push({ position: [lon, lat], pct, delta: deltaAt(pct) });
      next += WALL_SPACING;
    }
    travelled += length;
  }
  return columns;
}

// Tilted view of the whole area, facing the way the car drives through it
function fitView(lines: Line[], width: number, height: number): MapViewState {
  const all = lines.flatMap((line) => line.positions);
  const lats = all.map(([lat]) => lat);
  const lons = all.map(([, lon]) => lon);
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: Math.min(FIT_PADDING, width / 4, height / 4) }
  );
  const { positions } = lines[0];
  return {
    longitude,
    latitude,
    // A little further out than flat, as tilting brings the near end closer
    zoom: Math.min(zoom - 0.3, MAX_FIT_ZOOM),
    pitch: FIT_PITCH,
    bearing: bearing(positions[0], positions[positions.length - 1]),
    ...VIEW_LIMITS,
  };
}

// Low behind the car at the crosshair, looking where it's going
function chaseView(line: Line, pct: number): MapViewState {
  const { positions } = line;
  const i = nearestIndex(line.lap.trace.pcts, pct);
  const [from, to] = [Math.max(0, i - HEADING_SPAN), Math.min(positions.length - 1, i + HEADING_SPAN)];
  const [lat, lon] = positions[i];
  return {
    longitude: lon,
    latitude: lat,
    zoom: CHASE_ZOOM,
    pitch: CHASE_PITCH,
    bearing: from < to ? bearing(positions[from], positions[to]) : 0,
    ...VIEW_LIMITS,
  };
}

// The Base (blue) and Compare (red) laps' driving lines through one focus area, draped over Google's
// Photorealistic 3D Tiles of the real track, with a wall standing on the first line (Base when it has
// positions) as tall as the Compare lap's time gap there: red where it's behind, green where it's ahead,
// the tallest at the area's largest gap. Shares the pedal traces' crosshair: hoverPct puts a pin on each
// line, and pointing at the wall moves it. The chase view follows the crosshair from behind the car.
// apiKey is the browser key from /api/map-tiles (GOOGLE_MAP_TILES_API_KEY). Loaded with next/dynamic
// (DrivingLineMap) so deck.gl only downloads when the 3D view is picked.
export default function TrackLineMap3D({
  base,
  compare,
  width,
  height,
  hoverPct,
  onHover,
  apiKey,
  headerExtra,
}: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  width: number;
  height: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
  apiKey: string;
  headerExtra?: ReactNode;
}) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const t = dictionary.charts;
  // The moved view, and the laps it was set for: analyzing other laps opens fitted again
  const [saved, setSaved] = useState<{ view: MapViewState; trace: unknown } | null>(null);
  const [chase, setChase] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [credits, setCredits] = useState('');

  const lines: Line[] = [
    { key: 'base' as const, lap: base, color: rgba(BASE_COLOR), positions: base.trace.positions },
    { key: 'compare' as const, lap: compare, color: rgba(COMPARE_COLOR), positions: compare.trace.positions },
  ].filter((line): line is Line => line.positions !== null && line.positions.length > 1);
  const missing = [!base.trace.positions && dictionary.lapCompare.base, !compare.trace.positions && dictionary.lapCompare.compare].filter(Boolean);

  const wall = useMemo(
    () => (lines.length > 0 ? wallColumns(lines[0], base, compare) : []),
    // lines is rebuilt each render from the traces
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.trace, compare.trace, lines.length]
  );
  const largestGap = Math.max(0, ...wall.map((c) => Math.abs(c.delta)));

  // Recreated only with the key: a new tileset would fetch Google's root again (and start a new billed session)
  const tiles = useMemo(
    () =>
      new Tile3DLayer({
        id: 'google-3d-tiles',
        // Google takes the key only in the URL (an X-GoogleMaps-Api-Key header is refused as unregistered);
        // loaders.gl adds the root's query string, and the session Google answers, to every tile request
        data: `${GOOGLE_3D_TILES_URL}?key=${encodeURIComponent(apiKey)}`,
        // The ground the lines drape over and the wall stands on
        operation: 'terrain+draw',
        onTilesetLoad: (tileset) => {
          setLoaded(true);
          // Google requires the credits of the tiles in view to be shown, most frequent first
          tileset.options.onTraversalComplete = (selected) => {
            const counts = new Map<string, number>();
            for (const tile of selected) {
              const copyright: string | undefined = tile.content?.gltf?.asset?.copyright;
              for (const credit of copyright?.split(';') ?? []) {
                const name = credit.trim();
                if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
              }
            }
            const text = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name).join('; ');
            setCredits((previous) => (previous === text ? previous : text));
            return selected;
          };
        },
      }),
    [apiKey]
  );

  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.noPositions}</p>;
  }

  const fit = fitView(lines, width, height);
  const lead = lines[0];
  const viewState =
    chase && hoverPct !== null ? chaseView(lead, hoverPct) : saved && saved.trace === base.trace ? saved.view : fit;

  const hovered = hoverPct === null ? [] : lines.map((line) => {
    const [lat, lon] = line.positions[nearestIndex(line.lap.trace.pcts, hoverPct)];
    return { position: [lon, lat] as [number, number], color: line.color };
  });

  const layers = [
    tiles,
    new PathLayer<Line, TerrainExtensionProps>({
      id: 'line-casings',
      data: lines,
      getPath: (line) => line.positions.map(([lat, lon]): [number, number] => [lon, lat]),
      getColor: CASING_COLOR,
      getWidth: CASING_WIDTH,
      widthUnits: 'meters',
      widthMinPixels: 4,
      capRounded: true,
      jointRounded: true,
      extensions: [TERRAIN],
      terrainDrawMode: 'drape',
    }),
    new PathLayer<Line, TerrainExtensionProps>({
      id: 'lines',
      data: lines,
      getPath: (line) => line.positions.map(([lat, lon]): [number, number] => [lon, lat]),
      getColor: (line) => line.color,
      getWidth: LINE_WIDTH,
      widthUnits: 'meters',
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
      extensions: [TERRAIN],
      terrainDrawMode: 'drape',
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
      // Points at the crosshair while the chase view isn't steering by it
      pickable: !chase,
      extensions: [TERRAIN],
      updateTriggers: { getElevation: largestGap },
    }),
    new ColumnLayer<{ position: [number, number]; color: Rgba }>({
      id: 'crosshair-pins',
      data: hovered,
      getPosition: (d) => d.position,
      getElevation: PIN_HEIGHT,
      getFillColor: (d) => d.color,
      radius: 0.25,
      diskResolution: 8,
      extruded: true,
      extensions: [TERRAIN],
    }),
    new ScatterplotLayer<{ position: [number, number]; color: Rgba }, TerrainExtensionProps>({
      id: 'crosshair-dots',
      data: hovered,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getLineColor: [255, 255, 255, 255],
      getRadius: 1.2,
      radiusMinPixels: 5,
      lineWidthMinPixels: 1.5,
      stroked: true,
      extensions: [TERRAIN],
      terrainDrawMode: 'drape',
    }),
  ];

  const onPick = (info: PickingInfo<WallColumn>) => {
    if (chase) return;
    onHover(info.layer?.id === 'gap-wall' && info.object ? info.object.pct : null);
  };

  const buttonClass =
    'h-8 px-2 flex items-center justify-center rounded-md bg-black/60 text-white text-xs hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const gap = largestGap.toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  return (
    <figure className="space-y-1">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{t.drivingLine}</span>
        {lines.map((line) => (
          <span key={line.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: line.key === 'base' ? BASE_COLOR : COMPARE_COLOR }} />
            {line.lap.title}
          </span>
        ))}
        {headerExtra}
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-slate-800 touch-none"
        style={{ width, height }}
        role="img"
        aria-label={fmt(t.drivingLinesAria3d, { laps: lines.map((l) => l.lap.title).join(t.and) })}
        onPointerLeave={() => !chase && onHover(null)}
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

        {!loaded && !failed && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80 pointer-events-none">{t.loading3d}</p>
        )}
        {failed && (
          <p className="absolute inset-x-4 top-4 rounded-md bg-black/70 px-3 py-2 text-sm text-white">{t.failed3d}</p>
        )}

        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
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
        </div>

        {/* Google's attribution rules: the official outlined Google Maps logo (white with a dark outline, for
            busy imagery; public/assets/google-maps-logo.svg, unchanged from Google's attribution assets),
            16-19 px tall with 10 px clear on the left, right and top and 5 px below, and the tiles' credits
            in one line along the bottom */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/google-maps-logo.svg"
          alt="Google Maps"
          width={GOOGLE_LOGO_WIDTH}
          height={GOOGLE_LOGO_HEIGHT}
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{ left: 10, bottom: 5 }}
        />
        {credits && (
          <p
            title={credits}
            className="absolute bottom-0 right-0 truncate px-1.5 py-0.5 text-right text-[10px] text-white/80 bg-black/45 rounded-tl pointer-events-none"
            style={{ left: 10 + GOOGLE_LOGO_WIDTH + 10 }}
          >
            {credits}
          </p>
        )}
      </div>

      <figcaption className="text-xs text-muted-foreground">
        {missing.length > 0 && fmt(t.lapNoPositions, { laps: missing.join(t.and) })}
        {fmt(t.gapWall, { gap })}
        {chase ? t.chaseHelp : t.map3dHelp}
      </figcaption>
    </figure>
  );
}
