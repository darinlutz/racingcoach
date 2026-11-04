import { useEffect, useState, useSyncExternalStore } from 'react';

// Browser side of the satellite imagery (tiles from /api/map-tiles, src/lib/mapTiles.ts), shared by Lap
// Compare's driving line maps (TrackLineMap) and Track Data's track pictures (TrackSatellite).

export const TILE_SIZE = 256;
// Web Mercator: meters per pixel at the equator at zoom 0 (256 px tiles)
export const METERS_PER_PIXEL_Z0 = 156543.03392;
// Must match MAX_TILE_ZOOM in src/lib/mapTiles.ts
export const MAX_TILE_ZOOM = 19;

// Sharpens the satellite tiles in the browser (no extra tiles from the provider): an unsharp mask that pushes
// each pixel away from its 4 neighbors by this much, for crisper curbs, paint and run-off edges. Used by an SVG
// feConvolveMatrix filter over one layer of all the tiles, so it sharpens across tile seams too
const SHARPEN = 0.35;
export const SHARPEN_KERNEL = [0, -SHARPEN, 0, -SHARPEN, 1 + 4 * SHARPEN, -SHARPEN, 0, -SHARPEN, 0].join(' ');

// [lat, lon] -> Web Mercator pixels at zoom 0 (the world is 256 px across)
export function project([lat, lon]: [number, number]): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * TILE_SIZE,
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * TILE_SIZE,
  ];
}

// The tiles covering a width x height view centered on (centerX, centerY) in zoom-0 pixels at scale screen
// pixels per zoom-0 pixel, and where each goes on screen. maxZoom is the deepest zoom with imagery there
// (useImageryZoom); past it the tiles are drawn larger
export function viewTiles(
  centerX: number,
  centerY: number,
  scale: number,
  width: number,
  height: number,
  maxZoom: number = MAX_TILE_ZOOM
) {
  const zoom = Math.max(0, Math.min(maxZoom, MAX_TILE_ZOOM, Math.ceil(Math.log2(scale))));
  const tileWorld = TILE_SIZE / 2 ** zoom; // one tile's size in zoom-0 pixels
  const size = tileWorld * scale;
  const [left, top] = [centerX - width / 2 / scale, centerY - height / 2 / scale];
  const [right, bottom] = [centerX + width / 2 / scale, centerY + height / 2 / scale];
  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  for (let tx = Math.floor(left / tileWorld); tx <= Math.floor(right / tileWorld); tx++) {
    for (let ty = Math.floor(top / tileWorld); ty <= Math.floor(bottom / tileWorld); ty++) {
      tiles.push({ x: tx, y: ty, left: (tx * tileWorld - left) * scale, top: (ty * tileWorld - top) * scale });
    }
  }
  return { zoom, size, tiles };
}

// The provider's imagery doesn't go as deep everywhere: Esri's stops at zoom 18 around Fuji Speedway, for
// example, where zoom 19 tiles answer 404. So when a tile fails, the maps drop that region (the zoom-8 tile
// it's in) a zoom level and try again, enlarging the deepest tiles there are, down to MIN_FALLBACK_ZOOM;
// below that the region has no imagery (null). Kept for the page, shared by every map on it.
const MIN_FALLBACK_ZOOM = 12;
const regionZoom = new Map<string, number | null>();
const zoomListeners = new Set<() => void>();
let zoomVersion = 0;

// The zoom-8 tile holding a zoom-0 pixel position: at zoom 8 the world is 256 tiles across, one per zoom-0 pixel
const regionOf = (centerX: number, centerY: number) => `${Math.floor(centerX)}/${Math.floor(centerY)}`;

function subscribeZoom(listener: () => void) {
  zoomListeners.add(listener);
  return () => void zoomListeners.delete(listener);
}

// The deepest zoom with imagery around (centerX, centerY) in zoom-0 pixels (null: none there), and what a
// tile's onError calls with the zoom it was fetched at
export function useImageryZoom(centerX: number, centerY: number) {
  useSyncExternalStore(subscribeZoom, () => zoomVersion, () => 0);
  const region = regionOf(centerX, centerY);
  const maxZoom = regionZoom.has(region) ? regionZoom.get(region)! : MAX_TILE_ZOOM;
  const tileFailed = (zoom: number) => {
    const current = regionZoom.has(region) ? regionZoom.get(region)! : MAX_TILE_ZOOM;
    // Only the first failure at a zoom lowers it; the view's other tiles at that zoom fail too
    if (current === null || zoom > current) return;
    regionZoom.set(region, zoom - 1 < MIN_FALLBACK_ZOOM ? null : zoom - 1);
    zoomVersion++;
    zoomListeners.forEach((listener) => listener());
  };
  return { maxZoom, tileFailed };
}

export type MapSettings ={ available: boolean; attribution: string | null };

const NO_SETTINGS: MapSettings = { available: false, attribution: null };

// Fetched once per page load and shared by every map
let settingsPromise: Promise<MapSettings> | null = null;
function loadSettings() {
  settingsPromise ??= fetch('/api/map-tiles')
    .then((res) => (res.ok ? (res.json() as Promise<MapSettings>) : NO_SETTINGS))
    .then((settings) => ({ ...NO_SETTINGS, ...settings }))
    .catch(() => NO_SETTINGS);
  return settingsPromise;
}

// Whether satellite imagery is set up, and its credit line; null while loading
export function useMapSettings() {
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
