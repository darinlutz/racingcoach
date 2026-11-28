// One Live Racing outline (src/lib/trackOutlines.ts) from several laps' outlines, for tracks whose laps all went off
// the track somewhere, so none is clean enough to give the outline alone (at Suzuka nearly every lap puts a wheel
// off). Each lap's excursion is at a different place, so at every point most laps are on the track, and each point's
// median latitude and longitude follows them. No imports, so tests run it directly.

// How many laps it needs: with two, an excursion would pull the point halfway off the track
export const MIN_MEDIAN_LAPS = 3;

type Outline = { kind: 'latlon' | 'meters'; points: [number, number][] };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The median outline of these laps' [lat, lon] outlines (all with the same number of points as the first), rounded
// to about 1 cm; null with fewer than MIN_MEDIAN_LAPS of them
export function medianOutline(outlines: Outline[]): { kind: 'latlon'; points: [number, number][] } | null {
  const count = outlines[0]?.points.length ?? 0;
  const laps = outlines.filter((o) => o.kind === 'latlon' && o.points.length === count);
  if (count === 0 || laps.length < MIN_MEDIAN_LAPS) return null;
  const points = Array.from({ length: count }, (_, i): [number, number] => [
    Math.round(median(laps.map((l) => l.points[i][0])) * 1e7) / 1e7,
    Math.round(median(laps.map((l) => l.points[i][1])) * 1e7) / 1e7,
  ]);
  return { kind: 'latlon', points };
}
