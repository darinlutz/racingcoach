import { query } from './db';
import { lapSamplesFromText } from './lapData';

// Each track's outline, for Live Racing's maps (the Live Racing page and the collector's Live Racing tab): where the
// car is at every step around the lap, on its racingcoach."Tracks" row (track_outline, JSONB). Live telemetry has
// no track positions (iRacing only writes Lat/Lon to its .ibt files), so a car on the map is placed by its live
// LapDistPct on this outline. It's made once per track from the first clean lap (no pit road, no off-track)
// uploaded with track positions (collectorLaps.ts), or from laps already stored (backfillTrackBounds).
//
// Until a track has one, the collector draws an approximate outline from the car's own speed and yaw rate over a
// clean lap (LiveRacing.cs) and sends it with its live position; that one is only kept with the driver's live
// state (liveRacing.ts), in meters east and north of an arbitrary start and turned an arbitrary way.

// Points around the lap: point i is at LapDistPct i / OUTLINE_POINTS
export const OUTLINE_POINTS = 500;

// "latlon": [latitude, longitude] in degrees, north up. "meters": [east, north] in meters, the collector's
// approximate outline
export type TrackOutline = { kind: 'latlon' | 'meters'; points: [number, number][] };

// The share of the lap's steps that must have samples for an outline (the rest are filled in between them)
const MIN_COVERAGE = 0.9;

// An outline from samples of one lap: each step's average position, gaps filled in a straight line between the
// steps either side. pcts may be unwrapped (past 1 at the end of the lap). null when the lap doesn't cover enough
// of the track.
export function outlineFromSamples(pcts: number[], xs: number[], ys: number[]): [number, number][] | null {
  const sums = Array.from({ length: OUTLINE_POINTS }, () => [0, 0, 0]);
  for (let i = 0; i < pcts.length; i++) {
    const [pct, x, y] = [pcts[i], xs[i], ys[i]];
    if (![pct, x, y].every(Number.isFinite) || (x === 0 && y === 0)) continue;
    const step = Math.floor((((pct % 1) + 1) % 1) * OUTLINE_POINTS) % OUTLINE_POINTS;
    sums[step][0] += x;
    sums[step][1] += y;
    sums[step][2]++;
  }
  const filled = sums.map((s, i) => (s[2] > 0 ? i : -1)).filter((i) => i >= 0);
  if (filled.length < OUTLINE_POINTS * MIN_COVERAGE) return null;
  const points: [number, number][] = sums.map((s) => (s[2] > 0 ? [s[0] / s[2], s[1] / s[2]] : [NaN, NaN]));
  // Fill each gap between the filled steps before and after it, round the start/finish line too
  for (let k = 0; k < filled.length; k++) {
    const from = filled[k];
    const to = filled[(k + 1) % filled.length];
    const gap = (to - from + OUTLINE_POINTS) % OUTLINE_POINTS;
    for (let g = 1; g < gap; g++) {
      const t = g / gap;
      const a = points[from];
      const b = points[to];
      points[(from + g) % OUTLINE_POINTS] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return points;
}

// The outline of a lap CSV with Lat/Lon columns, rounded to about 1 cm; null without enough positions
export function lapCsvOutline(csv: string): TrackOutline | null {
  const { pcts, lats, lons } = lapSamplesFromText(csv);
  const points = outlineFromSamples(pcts, lats, lons);
  if (!points) return null;
  return { kind: 'latlon', points: points.map(([lat, lon]) => [Math.round(lat * 1e7) / 1e7, Math.round(lon * 1e7) / 1e7]) };
}

// Whether the track with this key has no outline yet (so a clean lap with track positions should give it)
export async function trackNeedsOutline(trackKey: string | null): Promise<boolean> {
  if (!trackKey) return false;
  const rows = await query(
    `SELECT 1 FROM racingcoach."Tracks" WHERE lower(track_key) = lower($1) AND track_outline IS NULL LIMIT 1`,
    [trackKey]
  );
  return rows.length > 0;
}

// Saves a track's outline, unless it already has one (the first clean lap's is kept)
export async function saveTrackOutline(trackKey: string, outline: TrackOutline | null): Promise<void> {
  if (!outline) return;
  await query(
    `UPDATE racingcoach."Tracks" SET track_outline = $2, updated_at = now()
     WHERE lower(track_key) = lower($1) AND track_outline IS NULL`,
    [trackKey, JSON.stringify(outline)]
  );
}

export type LiveTrack = {
  name: string;
  // iRacing's length of the track, or null when no lap has sent it
  lengthFeet: number | null;
  outline: TrackOutline | null;
  // Track Data's focus areas, as shares of the lap (an area can run over the start/finish line, end < start)
  areas: { name: string; start: number; end: number }[];
};

// The track with this iRacing track key (e.g. "monza full"), for Live Racing; null when there's no such track.
// The caller has run ensureUserSchema.
export async function readLiveTrack(trackKey: string): Promise<LiveTrack | null> {
  const [track] = await query<{ id: number; track_name: string; track_length_feet: number | null; track_outline: TrackOutline | null }>(
    `SELECT id, track_name, track_length_feet, track_outline FROM racingcoach."Tracks" WHERE lower(track_key) = lower($1) LIMIT 1`,
    [trackKey]
  );
  if (!track) return null;
  const areas = await query<{ name: string; start_point: number; end_point: number }>(
    'SELECT name, start_point, end_point FROM racingcoach."TrackFocusAreas" WHERE track_id = $1 ORDER BY position',
    [track.id]
  );
  return {
    name: track.track_name,
    lengthFeet: track.track_length_feet == null ? null : Math.round(Number(track.track_length_feet)),
    outline: track.track_outline,
    areas: areas.map((a) => ({ name: a.name, start: Number(a.start_point), end: Number(a.end_point) })),
  };
}

// Which of these track keys have a saved outline, cached a minute so the collector's live updates (twice a second)
// don't each ask the database
const outlineKnown = new Map<string, { saved: boolean; until: number }>();
export async function hasSavedOutline(trackKey: string): Promise<boolean> {
  const key = trackKey.toLowerCase();
  const cached = outlineKnown.get(key);
  if (cached && cached.until > Date.now()) return cached.saved;
  const rows = await query(
    'SELECT 1 FROM racingcoach."Tracks" WHERE lower(track_key) = $1 AND track_outline IS NOT NULL LIMIT 1',
    [key]
  );
  const saved = rows.length > 0;
  outlineKnown.set(key, { saved, until: Date.now() + 60_000 });
  return saved;
}
