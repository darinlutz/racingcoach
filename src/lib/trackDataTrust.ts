// What an uploaded lap may teach the shared Track Data ("Tracks": length, location, bounds, outline), which every user
// sees (Live Racing and TV maps, Track Data's pictures, My Dashboard's distance, the overlay's length). A lap's details
// and CSV come from the collector, which anyone with an upload key can imitate, so (docs/launch-readiness-audit, F-11):
// - an ordinary account only fills in what's missing; only a Coach's or Admin's lap changes what's there
// - a length must agree with the lap's own LapDist / LapDistPct
// - an outline must be about as long as the track, and its extent fit a lap of that length
// A track taught wrong is put right on the Coach page (resetLearnedTrackData). No imports, so tests run it directly.

export type LatLon = [number, number];

// How far a reported length may be from the lap's own LapDist / LapDistPct
export const LENGTH_TOLERANCE = 0.02;
// How far an outline's length round may be from the track's (the most in production, 2026-11-07, was 13% over)
export const OUTLINE_LENGTH_TOLERANCE = 0.2;

const EARTH_RADIUS_FEET = 20_902_231;

export function distanceFeet([lat1, lon1]: LatLon, [lat2, lon2]: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_FEET * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Whether a lap's reported length agrees with its own samples' (null when the CSV has no LapDist: nothing to check
// against, so it isn't trusted)
export function lengthConsistent(reportedFeet: number, csvFeet: number | null): boolean {
  return csvFeet !== null && csvFeet > 0 && Math.abs(reportedFeet - csvFeet) / csvFeet <= LENGTH_TOLERANCE;
}

// The outline's length round, closing the loop
export function outlineLengthFeet(points: LatLon[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += distanceFeet(points[i], points[(i + 1) % points.length]);
  return total;
}

// Whether an outline can be the track's: about as long as the track, and where it is when that's known
export function outlinePlausible(points: LatLon[], trackLengthFeet: number | null, location: LatLon | null = null): boolean {
  if (!trackLengthFeet || points.length < 10) return false;
  const length = outlineLengthFeet(points);
  if (Math.abs(length - trackLengthFeet) / trackLengthFeet > OUTLINE_LENGTH_TOLERANCE) return false;
  if (!location) return true;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const center: LatLon = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
  return distanceFeet(center, location) <= trackLengthFeet;
}

export type Bounds = { south: number; west: number; north: number; east: number };

// Whether a lap's extent fits the track: its diagonal no more than half the track's length (and a little), and near
// the track's location when that's known
export function boundsPlausible(bounds: Bounds, trackLengthFeet: number | null, location: LatLon | null): boolean {
  if (!trackLengthFeet) return false;
  const diagonal = distanceFeet([bounds.south, bounds.west], [bounds.north, bounds.east]);
  if (diagonal > trackLengthFeet * 0.6) return false;
  if (!location) return true;
  const center: LatLon = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];
  return distanceFeet(center, location) <= trackLengthFeet;
}
