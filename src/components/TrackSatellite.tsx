'use client';

import { useId } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { METERS_PER_PIXEL_Z0, project, SHARPEN_KERNEL, useMapSettings, viewTiles } from '@/lib/satelliteImagery';
import type { TrackData } from '@/lib/tracks';

export const SATELLITE_WIDTH = 360;
export const SATELLITE_HEIGHT = 230;
const PADDING = 14; // px between the track's extent and the picture's edge
// Fitting stops here, so a small track doesn't open on blurry imagery
const MAX_FIT_ZOOM = 17;
const FEET_PER_METER = 3.280839895;

// Where the picture looks: pixels per zoom-0 pixel, and the zoom-0 point at its center. Fitted to the extent of a
// lap's track positions when there are some; otherwise centered on iRacing's location of the track, showing
// about a third of its length across (a circuit's extent is roughly that), or 2 km without a length.
type SatelliteTrack = Pick<TrackData, 'name' | 'lengthFeet' | 'location' | 'bounds'>;

function trackView(track: SatelliteTrack) {
  if (track.bounds) {
    const [west, north] = project([track.bounds.north, track.bounds.west]);
    const [east, south] = project([track.bounds.south, track.bounds.east]);
    const scale = Math.min(
      (SATELLITE_WIDTH - 2 * PADDING) / Math.max(east - west, 1e-9),
      (SATELLITE_HEIGHT - 2 * PADDING) / Math.max(south - north, 1e-9),
      2 ** MAX_FIT_ZOOM
    );
    return { scale, centerX: (west + east) / 2, centerY: (north + south) / 2 };
  }
  if (track.location) {
    const { latitude, longitude } = track.location;
    const lengthMeters = track.lengthFeet ? track.lengthFeet / FEET_PER_METER : 6000;
    const spanMeters = Math.min(Math.max(lengthMeters / 3, 800), 5000);
    const metersPerPixel = spanMeters / SATELLITE_HEIGHT;
    const [centerX, centerY] = project([latitude, longitude]);
    return { scale: (METERS_PER_PIXEL_Z0 * Math.cos((latitude * Math.PI) / 180)) / metersPerPixel, centerX, centerY };
  }
  return null;
}

// A satellite picture of a track (Track Data's, shown while its name is hovered, and Lap Compare's, beside the track
// name), from the same sharpened imagery as Lap Compare's driving line maps. Nothing when the track's location isn't
// known yet or imagery isn't set up.
export default function TrackSatellite({ track }: { track: SatelliteTrack }) {
  const { t, fmt } = useLanguage();
  const settings = useMapSettings();
  const sharpenId = useId();
  const view = trackView(track);
  if (!view || !settings?.available) return null;

  const { zoom, size, tiles } = viewTiles(view.centerX, view.centerY, view.scale, SATELLITE_WIDTH, SATELLITE_HEIGHT);
  return (
    <div
      role="img"
      aria-label={fmt(t.tracks.satellite, { track: track.name })}
      className="relative overflow-hidden rounded-lg border border-border bg-slate-800 shadow-xl"
      style={{ width: SATELLITE_WIDTH, height: SATELLITE_HEIGHT }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id={sharpenId} colorInterpolationFilters="sRGB">
          <feConvolveMatrix order="3" kernelMatrix={SHARPEN_KERNEL} edgeMode="duplicate" preserveAlpha="true" />
        </filter>
      </svg>
      {/* One layer, so the filter sharpens across tile seams rather than tile by tile */}
      <div className="absolute inset-0" style={{ filter: `url(#${sharpenId}) contrast(1.05)` }}>
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${zoom}-${tile.x}-${tile.y}`}
            src={`/api/map-tiles/${zoom}/${tile.x}/${tile.y}`}
            alt=""
            draggable={false}
            onError={(event) => (event.currentTarget.style.visibility = 'hidden')}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top, width: size + 0.5, height: size + 0.5 }}
          />
        ))}
      </div>
      {settings.attribution && (
        <p className="absolute bottom-0 right-0 px-1.5 py-0.5 text-[10px] text-white/80 bg-black/45 rounded-tl">
          {settings.attribution}
        </p>
      )}
    </div>
  );
}
