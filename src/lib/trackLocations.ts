import { query } from './db';

// Where each track is, for Track Data's satellite pictures (TrackSatellite), on its racingcoach."Tracks" row:
// - track_latitude / track_longitude: iRacing's location of the track (WeekendInfo.TrackLatitude and
//   TrackLongitude), which the collector sends with each lap along with the track key
// - track_south / track_west / track_north / track_east: the extent of a lap's Lat/Lon, from the first lap of the
//   track uploaded with track positions (collectorLaps.ts), or from laps already stored (backfillTrackBounds)
// Laps without a track key (collectors before 1.29.0) give neither.

export type TrackBounds = { south: number; west: number; north: number; east: number };

// The extent of a lap CSV's Lat/Lon columns (degrees), or null without them. Rows without a position
// (empty, or 0,0) are skipped.
export function lapCsvBounds(csv: string): TrackBounds | null {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(',').map((column) => column.trim());
  const latColumn = header.indexOf('Lat');
  const lonColumn = header.indexOf('Lon');
  if (latColumn < 0 || lonColumn < 0) return null;
  let bounds: TrackBounds | null = null;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const lat = parseFloat(cells[latColumn]);
    const lon = parseFloat(cells[lonColumn]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (Math.abs(lat) > 85 || Math.abs(lon) > 180) continue;
    if (!bounds) bounds = { south: lat, west: lon, north: lat, east: lon };
    else {
      bounds.south = Math.min(bounds.south, lat);
      bounds.north = Math.max(bounds.north, lat);
      bounds.west = Math.min(bounds.west, lon);
      bounds.east = Math.max(bounds.east, lon);
    }
  }
  return bounds;
}

// Saves iRacing's location of the track an uploaded lap was driven on, when it differs from the one there.
// Nothing without a key or location. The caller has run ensureUserSchema.
export async function saveTrackLocation(
  trackKey: string | null,
  latitude: number | null,
  longitude: number | null
): Promise<void> {
  if (!trackKey || latitude == null || longitude == null || (latitude === 0 && longitude === 0)) return;
  await query(
    `UPDATE racingcoach."Tracks" SET track_latitude = $2, track_longitude = $3, updated_at = now()
     WHERE lower(track_key) = lower($1)
       AND (track_latitude IS DISTINCT FROM $2 OR track_longitude IS DISTINCT FROM $3)`,
    [trackKey, latitude, longitude]
  );
}

// Whether the track with this key has no bounds yet (so a lap with track positions should give them)
export async function trackNeedsBounds(trackKey: string | null): Promise<boolean> {
  if (!trackKey) return false;
  const rows = await query(
    `SELECT 1 FROM racingcoach."Tracks" WHERE lower(track_key) = lower($1) AND track_south IS NULL LIMIT 1`,
    [trackKey]
  );
  return rows.length > 0;
}

// Saves a track's bounds, unless it already has some (the first lap's are kept)
export async function saveTrackBounds(trackKey: string, bounds: TrackBounds | null): Promise<void> {
  if (!bounds) return;
  await query(
    `UPDATE racingcoach."Tracks"
     SET track_south = $2, track_west = $3, track_north = $4, track_east = $5, updated_at = now()
     WHERE lower(track_key) = lower($1) AND track_south IS NULL`,
    [trackKey, bounds.south, bounds.west, bounds.north, bounds.east]
  );
}
