// Places another simulator's world coordinates on the earth, so its laps get a driving line (Lat/Lon) like iRacing's.
//
// ACC gives the car's position in its own world (carCoordinates, meters: y up, x and z across the ground), never a
// latitude and longitude. Its tracks are laser scans of the real circuits, as iRacing's are, so a lap's x and z have
// the track's real shape and size: only where that world sits on the earth, and which way it's turned, are unknown.
// Those come from the mapped iRacing track's outline ("Tracks".track_outline, 500 [lat, lon] points, point i at
// LapDistPct i / 500): the turn and offset that lay the ACC lap on it best. Nothing is scaled, as both are meters.
//
// ACC's world is mirrored against east and north (the Spa recording, 2026-11-05: with x as east, La Source turns left
// and the lap runs anticlockwise; it's a right hairpin on a clockwise lap), so east, north is (-x, z) turned. One
// alignment is fitted per simulator track (simulator track mappings, worldPositions.ts) and every lap of it goes
// through the same one, so two ACC laps' lines differ exactly as the laps did; against an iRacing lap they're as close
// as the two scans and the fit (rmsMeters). No imports, so the tests run it directly.

// Steps round the lap the fit compares, the same as the outline's points
export const ALIGNMENT_STEPS = 500;
// A fit is only kept when the lap lies on the outline this closely: the spread of two drivers' lines and the two
// scans' differences, well under a track's width. A different layout mapped by mistake is far outside them.
export const MAX_RMS_METERS = 10;
export const MAX_P90_METERS = 20;
// The lap and the outline must be about as long round
const MAX_LENGTH_DIFFERENCE = 0.08;
// How far apart the two simulators' start/finish lines may be, as a share of the lap
const MAX_START_OFFSET = 0.08;
// While refining, each lap point looks for its nearest point on the outline only this many steps either side of where
// it's paired, so a track that crosses itself (Suzuka) can't snap to the other level
const SEARCH_STEPS = 30;
const REFINE_ITERATIONS = 25;
// The share of steps the lap must have samples in
const MIN_COVERAGE = 0.9;
const EARTH_RADIUS_M = 6371008.8;

export type WorldAlignment = {
  version: 1;
  // The site track (iRacing's key) and outline it was fitted to: a different one (the mapping changed, or the outline
  // was learned again) needs a new fit
  trackKey: string;
  outlineHash: string;
  // The origin of the east/north meters: the outline's middle
  originLat: number;
  originLon: number;
  // east, north = rotate(angle) (-x, z) + (east, north), meters
  angle: number;
  east: number;
  north: number;
  // How well the fitted lap lies on the outline (m)
  rmsMeters: number;
  p90Meters: number;
  // The outline's LapDistPct at the simulator's lap position 0, minus 0 (+ when its start/finish line is after
  // iRacing's): how far focus areas, which are iRacing's shares of the lap, are out on this simulator's laps
  startOffset: number;
  fittedAt: string;
};

export type FitResult =
  | { ok: true; alignment: WorldAlignment }
  | { ok: false; reason: 'lapCoverage' | 'outline' | 'length' | 'shape'; rmsMeters?: number; p90Meters?: number };

type Point = [number, number];

// A short fingerprint of an outline, to tell whether an alignment was fitted to this one
export function outlineHash(points: Point[]): string {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(points);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${points.length}:${hash.toString(16)}`;
}

// The simulator's world x, z as the unturned east, north (mirrored, see the top)
const unturned = (x: number, z: number): Point => [-x, z];

// [lat, lon] to meters east and north of the origin, and back: flat at the origin's latitude, which over a circuit's
// few kilometers is out by centimeters
function toMeters([lat, lon]: Point, originLat: number, originLon: number): Point {
  const rad = Math.PI / 180;
  return [(lon - originLon) * rad * EARTH_RADIUS_M * Math.cos(originLat * rad), (lat - originLat) * rad * EARTH_RADIUS_M];
}
function toLatLon([east, north]: Point, originLat: number, originLon: number): Point {
  const deg = 180 / Math.PI;
  return [originLat + (north / EARTH_RADIUS_M) * deg, originLon + (east / (EARTH_RADIUS_M * Math.cos(originLat / deg))) * deg];
}

// A position in the simulator's world as [lat, lon]
export function worldToLatLon(alignment: WorldAlignment, x: number, z: number): Point {
  const [e, n] = unturned(x, z);
  const c = Math.cos(alignment.angle);
  const s = Math.sin(alignment.angle);
  return toLatLon([c * e - s * n + alignment.east, s * e + c * n + alignment.north], alignment.originLat, alignment.originLon);
}

// The lap's average position in each of the steps round the lap, gaps filled in a straight line; null when it
// doesn't cover enough of the lap
export function lapSteps(pcts: number[], xs: number[], zs: number[]): Point[] | null {
  const sums = Array.from({ length: ALIGNMENT_STEPS }, () => [0, 0, 0]);
  for (let i = 0; i < pcts.length; i++) {
    const [pct, x, z] = [pcts[i], xs[i], zs[i]];
    if (![pct, x, z].every(Number.isFinite)) continue;
    const step = Math.floor((((pct % 1) + 1) % 1) * ALIGNMENT_STEPS) % ALIGNMENT_STEPS;
    const [e, n] = unturned(x, z);
    sums[step][0] += e;
    sums[step][1] += n;
    sums[step][2]++;
  }
  const filled = sums.flatMap((s, i) => (s[2] > 0 ? [i] : []));
  if (filled.length < ALIGNMENT_STEPS * MIN_COVERAGE) return null;
  const points: Point[] = sums.map((s) => (s[2] > 0 ? [s[0] / s[2], s[1] / s[2]] : [NaN, NaN]));
  for (let k = 0; k < filled.length; k++) {
    const from = filled[k];
    const to = filled[(k + 1) % filled.length];
    const gap = (to - from + ALIGNMENT_STEPS) % ALIGNMENT_STEPS;
    for (let g = 1; g < gap; g++) {
      const t = g / gap;
      const [a, b] = [points[from], points[to]];
      points[(from + g) % ALIGNMENT_STEPS] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return points;
}

const loopLength = (points: Point[]) =>
  points.reduce((sum, p, i) => sum + Math.hypot(points[(i + 1) % points.length][0] - p[0], points[(i + 1) % points.length][1] - p[1]), 0);

// The turn and offset (no scale) laying `from` on `to` best, pair by pair (2D Procrustes)
function rigidFit(from: Point[], to: Point[]): { angle: number; east: number; north: number } {
  const n = from.length;
  let [fx, fy, tx, ty] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    fx += from[i][0];
    fy += from[i][1];
    tx += to[i][0];
    ty += to[i][1];
  }
  [fx, fy, tx, ty] = [fx / n, fy / n, tx / n, ty / n];
  let [dot, cross] = [0, 0];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = [from[i][0] - fx, from[i][1] - fy];
    const [bx, by] = [to[i][0] - tx, to[i][1] - ty];
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
  }
  const angle = Math.atan2(cross, dot);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return { angle, east: tx - (c * fx - s * fy), north: ty - (s * fx + c * fy) };
}

const apply = ({ angle, east, north }: { angle: number; east: number; north: number }, [x, y]: Point): Point => [
  Math.cos(angle) * x - Math.sin(angle) * y + east,
  Math.sin(angle) * x + Math.cos(angle) * y + north,
];

// The nearest point to p on the outline's segments within SEARCH_STEPS of step `around`, and where that is round the
// outline's lap (0-1, a segment's points in between in proportion). Point i is the average of a lap's samples from
// LapDistPct i / n to (i + 1) / n (trackOutlines.ts, lapSteps), so it stands for the middle of that, (i + 0.5) / n
function nearestOnOutline(outline: Point[], p: Point, around: number): { point: Point; distance: number; pct: number } {
  let best: { point: Point; distance: number; pct: number } = { point: outline[around], distance: Infinity, pct: around / outline.length };
  const n = outline.length;
  for (let k = -SEARCH_STEPS; k <= SEARCH_STEPS; k++) {
    const i = (((around + k) % n) + n) % n;
    const [a, b] = [outline[i], outline[(i + 1) % n]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq)) : 0;
    const q: Point = [a[0] + dx * t, a[1] + dy * t];
    const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (distance < best.distance) best = { point: q, distance, pct: ((i + t + 0.5) / n) % 1 };
  }
  return best;
}

const wrapPct = (pct: number) => ((pct % 1) + 1) % 1;

// The lap position of every sample as iRacing counts it, so focus areas (iRacing's shares of the lap) cut another
// simulator's laps at the same places on the track as iRacing's. The simulator's own LapDistPct counts from its own
// timing line along its own spline, which needn't be iRacing's start/finish line or spread round the lap like
// iRacing's, so a focus area cut by it starts and ends somewhere else. Each sample's world position, placed by the
// alignment, is found on the iRacing outline (point i at LapDistPct i / 500): near where its own lap position plus the
// start line offset says, so a track that crosses itself can't snap to the other level. A sample without a world
// position is moved by the start line offset alone. The positions never go backwards (a car only goes forward round
// a lap), and come back wrapped to 0-1, as lap files have them. NaN where the sample has no lap position.
export function outlineLapPcts(
  alignment: WorldAlignment,
  outlineLatLon: Point[],
  lap: { pcts: number[]; xs: number[]; zs: number[] }
): number[] {
  const outline = outlineLatLon.map((p) => toMeters(p, alignment.originLat, alignment.originLon));
  const n = outline.length;
  const offset = Number.isFinite(alignment.startOffset) ? alignment.startOffset : 0;
  const out: number[] = new Array(lap.pcts.length).fill(NaN);
  let previous: number | null = null; // unwrapped
  for (let i = 0; i < lap.pcts.length; i++) {
    const [pct, x, z] = [lap.pcts[i], lap.xs[i], lap.zs[i]];
    if (!Number.isFinite(pct)) continue;
    const shifted = wrapPct(pct + offset);
    const projected =
      n > 1 && Number.isFinite(x) && Number.isFinite(z)
        ? nearestOnOutline(outline, apply(alignment, unturned(x, z)), Math.round(shifted * n) % n).pct
        : shifted;
    let unwrapped = projected;
    if (previous !== null) {
      // The step from the last sample, the short way round (across the line too), never backwards
      const step = projected - wrapPct(previous);
      unwrapped = previous + Math.max(0, step - Math.round(step));
    }
    previous = unwrapped;
    out[i] = wrapPct(unwrapped);
  }
  return out;
}

// Fits a simulator track's world to the iRacing outline from one clean lap of it: pcts are the lap's LapDistPct
// (counted from the simulator's own line), xs and zs its world x and z. trackKey is the outline's track.
export function fitWorldAlignment(
  lap: { pcts: number[]; xs: number[]; zs: number[] },
  outlineLatLon: Point[],
  trackKey: string,
  now: Date = new Date()
): FitResult {
  if (outlineLatLon.length !== ALIGNMENT_STEPS || !outlineLatLon.every((p) => p.every(Number.isFinite))) {
    return { ok: false, reason: 'outline' };
  }
  const steps = lapSteps(lap.pcts, lap.xs, lap.zs);
  if (!steps) return { ok: false, reason: 'lapCoverage' };

  const originLat = outlineLatLon.reduce((sum, p) => sum + p[0], 0) / outlineLatLon.length;
  const originLon = outlineLatLon.reduce((sum, p) => sum + p[1], 0) / outlineLatLon.length;
  const outline = outlineLatLon.map((p) => toMeters(p, originLat, originLon));
  const [lapLength, outlineLength] = [loopLength(steps), loopLength(outline)];
  if (Math.abs(lapLength / outlineLength - 1) > MAX_LENGTH_DIFFERENCE) return { ok: false, reason: 'length' };

  // Start lines can differ: try each offset of the outline's steps against the lap's, and keep the best
  const maxShift = Math.round(MAX_START_OFFSET * ALIGNMENT_STEPS);
  let coarse = { shift: 0, fit: rigidFit(steps, outline), rms: Infinity };
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    const paired = steps.map((_, i) => outline[(((i + shift) % ALIGNMENT_STEPS) + ALIGNMENT_STEPS) % ALIGNMENT_STEPS]);
    const fit = rigidFit(steps, paired);
    const rms = Math.sqrt(steps.reduce((sum, p, i) => {
      const q = apply(fit, p);
      return sum + (q[0] - paired[i][0]) ** 2 + (q[1] - paired[i][1]) ** 2;
    }, 0) / steps.length);
    if (rms < coarse.rms) coarse = { shift, fit, rms };
  }

  // Then each lap point to its nearest point on the outline (not the same share of the lap: the two lines needn't
  // be the same length round), fitted again until it settles
  const around = (i: number) => (((i + coarse.shift) % ALIGNMENT_STEPS) + ALIGNMENT_STEPS) % ALIGNMENT_STEPS;
  let fit = coarse.fit;
  for (let iteration = 0; iteration < REFINE_ITERATIONS; iteration++) {
    const targets = steps.map((p, i) => nearestOnOutline(outline, apply(fit, p), around(i)).point);
    const next = rigidFit(steps, targets);
    const moved = Math.abs(next.angle - fit.angle) * outlineLength + Math.hypot(next.east - fit.east, next.north - fit.north);
    fit = next;
    if (moved < 0.01) break;
  }

  const distances = steps.map((p, i) => nearestOnOutline(outline, apply(fit, p), around(i)).distance).sort((a, b) => a - b);
  const rmsMeters = Math.sqrt(distances.reduce((sum, d) => sum + d * d, 0) / distances.length);
  const p90Meters = distances[Math.floor(distances.length * 0.9)];
  if (!(rmsMeters <= MAX_RMS_METERS && p90Meters <= MAX_P90_METERS)) {
    return { ok: false, reason: 'shape', rmsMeters, p90Meters };
  }
  return {
    ok: true,
    alignment: {
      version: 1,
      trackKey,
      outlineHash: outlineHash(outlineLatLon),
      originLat,
      originLon,
      angle: fit.angle,
      east: fit.east,
      north: fit.north,
      rmsMeters: Math.round(rmsMeters * 100) / 100,
      p90Meters: Math.round(p90Meters * 100) / 100,
      startOffset: coarse.shift / ALIGNMENT_STEPS,
      fittedAt: now.toISOString(),
    },
  };
}

// Whether a stored alignment is still for this track and outline
export function alignmentCurrent(alignment: unknown, trackKey: string, outline: Point[]): alignment is WorldAlignment {
  const a = alignment as Partial<WorldAlignment> | null;
  return (
    !!a &&
    a.version === 1 &&
    typeof a.trackKey === 'string' &&
    a.trackKey.toLowerCase() === trackKey.toLowerCase() &&
    a.outlineHash === outlineHash(outline) &&
    [a.originLat, a.originLon, a.angle, a.east, a.north].every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}
