'use client';

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { BASE_LAP_COLOR as BASE_COLOR, clamp, COMPARE_LAP_COLOR as COMPARE_COLOR, nearestIndex } from '@/lib/lapCharts';
import { DISTANCE_UNIT, distanceFromMeters, type Units } from '@/lib/units';

// Under each line, so it also holds up on light concrete and run-off
const CASING_COLOR = 'rgba(0, 0, 0, 0.55)';

const HEIGHT = 360;
const PADDING = 28; // px between the lines and the map's edge
const TILE_SIZE = 256;
// Web Mercator: meters per pixel at the equator at zoom 0 (256 px tiles)
const METERS_PER_PIXEL_Z0 = 156543.03392;
// Must match MAX_TILE_ZOOM in src/lib/mapTiles.ts
const MAX_TILE_ZOOM = 19;
// Fitting a short focus area stops at this zoom, so it doesn't open on blurry imagery
const MAX_FIT_ZOOM = 20;
// Zooming in stops here (a few cm per pixel); past MAX_TILE_ZOOM the imagery is enlarged, the lines stay sharp
const MAX_USER_ZOOM = 21;
// Each +/- press, and each double-click, zooms by this factor
const ZOOM_STEP = 1.6;
// A press that moves less than this (px) is a click, not a drag
const DRAG_THRESHOLD = 4;
// Pointer within this many px of the Base line moves the crosshair
const HOVER_DISTANCE = 40;

// Where the map is looking: pixels per zoom-0 pixel, and the zoom-0 point at the map's center
type View = { scale: number; centerX: number; centerY: number };

// What zooming and panning need to know: the view that fits the lines, and the lines' extent (zoom-0
// pixels), which the center is kept inside so the lines can't be dragged out of sight
type Frame = { fit: View; minX: number; maxX: number; minY: number; maxY: number; width: number };

type MapSettings = { available: boolean; attribution: string | null };

// Fetched once per page load and shared by every map
let settingsPromise: Promise<MapSettings> | null = null;
function loadSettings() {
  settingsPromise ??= fetch('/api/map-tiles')
    .then((res) => (res.ok ? (res.json() as Promise<MapSettings>) : { available: false, attribution: null }))
    .catch(() => ({ available: false, attribution: null }));
  return settingsPromise;
}

function useMapSettings() {
  const [settings, setSettings] = useState<MapSettings | null>(null);
  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => active && setSettings(s));
    return () => {
      active = false;
    };
  }, []);
  return settings;
}

// [lat, lon] -> Web Mercator pixels at zoom 0 (the world is 256 px across)
function project([lat, lon]: [number, number]): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * TILE_SIZE,
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * TILE_SIZE,
  ];
}

// A round scale bar length in the user's units (feet or meters) close to 100 px
function scaleBar(metersPerPixel: number, units: Units) {
  const perPixel = distanceFromMeters(metersPerPixel, units);
  const target = perPixel * 100;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const length = [1, 2, 5, 10].map((m) => m * magnitude).filter((m) => m <= target).at(-1) ?? magnitude;
  return { length: Number(length.toPrecision(2)), pixels: length / perPixel };
}

// Keeps the center over the lines; fully zoomed out is always the fitted view
function settle(view: View, frame: Frame): View {
  if (view.scale <= frame.fit.scale * 1.001) return frame.fit;
  return {
    scale: view.scale,
    centerX: clamp(view.centerX, frame.minX, frame.maxX),
    centerY: clamp(view.centerY, frame.minY, frame.maxY),
  };
}

// Zooms by factor, keeping the point under (px, py) in place
function zoomView(view: View, frame: Frame, factor: number, px: number, py: number): View {
  const scale = clamp(view.scale * factor, frame.fit.scale, 2 ** MAX_USER_ZOOM);
  const shift = 1 / view.scale - 1 / scale;
  return settle(
    {
      scale,
      centerX: view.centerX + (px - frame.width / 2) * shift,
      centerY: view.centerY + (py - HEIGHT / 2) * shift,
    },
    frame
  );
}

// Moves the map by (dx, dy) screen pixels
function panView(view: View, frame: Frame, dx: number, dy: number): View {
  return settle({ ...view, centerX: view.centerX - dx / view.scale, centerY: view.centerY - dy / view.scale }, frame);
}

type Line = { key: 'base' | 'compare'; lap: PedalTraceLap; color: string; positions: [number, number][] };

// The Base (blue) and Compare (red) laps' driving lines through one focus area, over satellite imagery
// when it's set up (SATELLITE_TILE_URL, see src/lib/mapTiles.ts), otherwise on a plain background.
// Shares the pedal traces' crosshair: hoverPct puts a dot on each line, and pointing at the map moves it.
// Opens fitted to the area; the mouse wheel, a pinch, double-click or the +/- buttons zoom, dragging pans.
export default function TrackLineMap({
  base,
  compare,
  width,
  hoverPct,
  onHover,
}: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.charts;
  const settings = useMapSettings();
  // The zoomed or panned view, and the laps it was set for: analyzing other laps starts fitted again
  const [saved, setSaved] = useState<{ view: View; trace: unknown } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Latest view and frame for event handlers, updated as soon as they change rather than on the next
  // render, so quick wheel and pointer events build on each other
  const live = useRef<{ view: View; frame: Frame } | null>(null);
  // Pointers pressed on the map (two for a pinch), and whether this press has become a drag
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragging = useRef(false);

  const lines: Line[] = [
    { key: 'base' as const, lap: base, color: BASE_COLOR, positions: base.trace.positions },
    { key: 'compare' as const, lap: compare, color: COMPARE_COLOR, positions: compare.trace.positions },
  ].filter((line): line is Line => line.positions !== null && line.positions.length > 1);
  const missing = [!base.trace.positions && dictionary.lapCompare.base, !compare.trace.positions && dictionary.lapCompare.compare].filter(Boolean);

  // Fit both lines in the view, centered
  const projected = lines.map((line) => line.positions.map(project));
  const all = projected.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit: View = {
    scale: Math.min(
      (width - 2 * PADDING) / Math.max(maxX - minX, 1e-12),
      (HEIGHT - 2 * PADDING) / Math.max(maxY - minY, 1e-12),
      2 ** MAX_FIT_ZOOM
    ),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
  const frame: Frame = { fit, minX, maxX, minY, maxY, width };
  const view = saved && saved.trace === base.trace ? settle(saved.view, frame) : fit;

  const show = (next: View) => {
    if (live.current) live.current.view = next;
    setSaved({ view: next, trace: base.trace });
  };

  useEffect(() => {
    live.current = lines.length > 0 ? { view, frame } : null;
  });

  // The wheel zooms the map instead of scrolling the page, which needs a non-passive listener
  const hasLines = lines.length > 0;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const current = live.current;
      if (!current) return;
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      const next = zoomView(current.view, current.frame, Math.exp(-pixels * 0.002), event.clientX - box.left, event.clientY - box.top);
      current.view = next;
      setSaved({ view: next, trace: base.trace });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasLines, base.trace]);

  if (!hasLines) {
    return (
      <p className="text-xs text-muted-foreground">
        {t.noPositions}
      </p>
    );
  }

  const { scale, centerX, centerY } = view;
  const toScreen = ([x, y]: [number, number]): [number, number] => [
    width / 2 + (x - centerX) * scale,
    HEIGHT / 2 + (y - centerY) * scale,
  ];
  const screenLines = projected.map((points) => points.map(toScreen));
  const zoomedIn = view !== fit;

  // Tiles one zoom level sharper than the view, drawn at 50-100% size (larger past MAX_TILE_ZOOM),
  // covering the whole view
  const tileZoom = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.ceil(Math.log2(scale))));
  const tileWorld = TILE_SIZE / 2 ** tileZoom; // one tile's size in zoom-0 pixels
  const tileScreen = tileWorld * scale;
  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  if (settings?.available) {
    const [left, top] = [centerX - width / 2 / scale, centerY - HEIGHT / 2 / scale];
    const [right, bottom] = [centerX + width / 2 / scale, centerY + HEIGHT / 2 / scale];
    for (let tx = Math.floor(left / tileWorld); tx <= Math.floor(right / tileWorld); tx++) {
      for (let ty = Math.floor(top / tileWorld); ty <= Math.floor(bottom / tileWorld); ty++) {
        const [sx, sy] = toScreen([tx * tileWorld, ty * tileWorld]);
        tiles.push({ x: tx, y: ty, left: sx, top: sy });
      }
    }
  }

  const latitude = lines[0].positions[0][0];
  const bar = scaleBar((METERS_PER_PIXEL_Z0 * Math.cos((latitude * Math.PI) / 180)) / scale, units);

  const pointerAt = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  // Moves the crosshair to the nearest point on the first line (Base when it has one)
  const hoverAt = ({ x: px, y: py }: { x: number; y: number }) => {
    let best = -1;
    let bestDistance = HOVER_DISTANCE ** 2;
    screenLines[0].forEach(([x, y], i) => {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestDistance) [best, bestDistance] = [i, d];
    });
    onHover(best < 0 ? null : lines[0].lap.trace.pcts[best]);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, pointerAt(event));
    if (pointers.current.size === 1) dragging.current = false;
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = pointerAt(event);
    const previous = pointers.current.get(event.pointerId);
    const current = live.current;
    if (!previous || !current) {
      hoverAt(point); // just pointing
      return;
    }

    if (pointers.current.size >= 2) {
      // Pinch: zoom by how far the fingers moved apart, and pan with their midpoint
      const other = [...pointers.current].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      const mid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
      const zoomed = zoomView(current.view, current.frame, before > 0 ? after / before : 1, mid.x, mid.y);
      show(panView(zoomed, current.frame, (point.x - previous.x) / 2, (point.y - previous.y) / 2));
      dragging.current = true;
    } else {
      const [dx, dy] = [point.x - previous.x, point.y - previous.y];
      if (!dragging.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // not a drag yet
      dragging.current = true;
      onHover(null);
      show(panView(current.view, current.frame, dx, dy));
    }
    pointers.current.set(event.pointerId, point);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    // A tap or click without dragging marks the nearest point, which is how touch screens move the crosshair
    if (pointers.current.size === 0 && !dragging.current) hoverAt(pointerAt(event));
  };

  const zoomButton = (factor: number) => {
    const current = live.current;
    if (current) show(zoomView(current.view, current.frame, factor, width / 2, HEIGHT / 2));
  };

  const pathOf = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

  const buttonClass =
    'w-8 h-8 flex items-center justify-center rounded-md bg-black/60 text-white text-lg leading-none hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <figure className="space-y-1">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{t.drivingLine}</span>
        {lines.map((line) => (
          <span key={line.key} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: line.color }} />
            {line.lap.title}
          </span>
        ))}
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-slate-800"
        style={{ width, height: HEIGHT }}
      >
        {tiles.map((tile) => (
          // Plain <img>: tiles are already sized for the view, next/image would only add a resize pass
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${tileZoom}-${tile.x}-${tile.y}`}
            src={`/api/map-tiles/${tileZoom}/${tile.x}/${tile.y}`}
            alt=""
            draggable={false}
            onError={(event) => (event.currentTarget.style.visibility = 'hidden')}
            className="absolute max-w-none select-none pointer-events-none"
            style={{ left: tile.left, top: tile.top, width: tileScreen + 0.5, height: tileScreen + 0.5 }}
          />
        ))}

        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={fmt(t.drivingLinesAria, { laps: lines.map((l) => l.lap.title).join(t.and) })}
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => pointers.current.size === 0 && onHover(null)}
          onDoubleClick={(event) => {
            const current = live.current;
            const { x, y } = pointerAt(event);
            if (current) show(zoomView(current.view, current.frame, ZOOM_STEP, x, y));
          }}
        >
          <defs>
            {lines.map((line) => (
              <marker
                key={line.key}
                id={`arrow-${line.key}-${line.color.slice(1)}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={line.color} />
              </marker>
            ))}
          </defs>
          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            {screenLines.map((points, i) => (
              <path key={`casing-${lines[i].key}`} d={pathOf(points)} stroke={CASING_COLOR} strokeWidth={5} />
            ))}
            {screenLines.map((points, i) => (
              <path
                key={lines[i].key}
                d={pathOf(points)}
                stroke={lines[i].color}
                strokeWidth={2.5}
                markerEnd={`url(#arrow-${lines[i].key}-${lines[i].color.slice(1)})`}
              />
            ))}
          </g>

          {hoverPct !== null &&
            screenLines.map((points, i) => {
              const [x, y] = points[nearestIndex(lines[i].lap.trace.pcts, hoverPct)];
              return <circle key={lines[i].key} cx={x} cy={y} r={5} fill={lines[i].color} stroke="white" strokeWidth={1.5} />;
            })}

          {/* Scale bar, bottom left */}
          <g transform={`translate(12, ${HEIGHT - 14})`} fontSize={11} fill="white">
            <rect x={-4} y={-16} width={bar.pixels + 8} height={22} rx={4} fill="rgba(0, 0, 0, 0.45)" />
            <line x1={0} x2={bar.pixels} y1={0} y2={0} stroke="white" strokeWidth={2} />
            <line x1={0} x2={0} y1={-4} y2={0} stroke="white" strokeWidth={2} />
            <line x1={bar.pixels} x2={bar.pixels} y1={-4} y2={0} stroke="white" strokeWidth={2} />
            <text x={bar.pixels / 2} y={-5} textAnchor="middle">
              {fmt(t.scaleBar, { n: bar.length.toLocaleString(locale), unit: DISTANCE_UNIT[units] })}
            </text>
          </g>
        </svg>

        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <button
            type="button"
            aria-label={t.zoomIn}
            className={buttonClass}
            disabled={scale >= 2 ** MAX_USER_ZOOM * 0.999}
            onClick={() => zoomButton(ZOOM_STEP)}
          >
            +
          </button>
          <button type="button" aria-label={t.zoomOut} className={buttonClass} disabled={!zoomedIn} onClick={() => zoomButton(1 / ZOOM_STEP)}>
            −
          </button>
          <button
            type="button"
            aria-label={t.showWholeArea}
            title={t.showWholeArea}
            className={`${buttonClass} text-sm`}
            disabled={!zoomedIn}
            onClick={() => show(fit)}
          >
            ⤢
          </button>
        </div>

        {settings?.attribution && (
          <p className="absolute bottom-0 right-0 px-1.5 py-0.5 text-[10px] text-white/80 bg-black/45 rounded-tl pointer-events-none">
            {settings.attribution}
          </p>
        )}
      </div>

      <figcaption className="text-xs text-muted-foreground">
        {settings && !settings.available && t.noImagery}
        {missing.length > 0 && fmt(t.lapNoPositions, { laps: missing.join(t.and) })}
        {t.mapHelp}
      </figcaption>
    </figure>
  );
}
