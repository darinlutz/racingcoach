// What Lap Compare's telemetry charts mark on a focus area, measured from the lap itself (npm run test:lap-events):
// the brakepoint and peak brake, the lift and pickup around the main braking zone, the apex and turn-in, and the
// corner phases they make. Positions are lap positions, like the charts' axis. An event the lap doesn't have is
// null, and isn't drawn. The brakepoint (the first time the brake goes on) and the peak (the most it reaches in
// the area) are areaStats', so they match the focus area table. Everything else hangs off the main braking zone,
// the one holding that peak, as a brush of the brake before it isn't the corner.

import { BRAKE_THRESHOLD, THROTTLE_THRESHOLD, type AreaTrace } from './lapData.ts';

const THROTTLE_FULL = 0.98;
const THROTTLE_OFF = 0.02;
// The apex is the stretch around the lowest speed that stays within this share of it
const APEX_SPEED_SHARE = 1.03;
// Turn-in is where the steering first reaches this share of its largest angle before the apex
const TURN_IN_SHARE = 0.25;
const MIN_TURN_RADIANS = 0.05; // less than this (about 3°) isn't a corner

export type LapEvents = {
  brakePoint: number | null;
  mainBrakeStart: number | null; // where the main braking zone starts: the brakepoint unless the driver brushed the brake first
  peakBrake: { pct: number; value: number } | null; // value 0-1
  brakeRelease: number | null;
  throttleLift: number | null;
  throttlePickup: number | null;
  fullThrottle: number | null;
  turnIn: number | null;
  apex: { pct: number; start: number; end: number; speed: number } | null; // speed in m/s
};

export type CornerPhaseId = 'braking' | 'turnIn' | 'apex' | 'exit';
export type CornerPhase = { id: CornerPhaseId; start: number; end: number };

const indexFrom = (from: number, end: number, test: (i: number) => boolean) => {
  for (let i = from; i < end; i++) if (test(i)) return i;
  return -1;
};

export function detectLapEvents({ pcts, brakes, throttles, steerings, speeds }: AreaTrace): LapEvents {
  const n = pcts.length;
  const brakeStart = indexFrom(0, n, (i) => brakes[i] > BRAKE_THRESHOLD);
  const braked = brakeStart >= 0;

  // The main braking zone: around the area's peak brake, from the brake going on until it's fully off again
  let peak = brakeStart;
  let mainStart = brakeStart;
  let brakeEnd = -1;
  if (braked) {
    for (let i = brakeStart; i < n; i++) if (brakes[i] > brakes[peak]) peak = i;
    mainStart = peak;
    while (mainStart > brakeStart && brakes[mainStart - 1] > BRAKE_THRESHOLD) mainStart--;
    brakeEnd = indexFrom(peak, n, (i) => brakes[i] <= BRAKE_THRESHOLD);
  }
  const nextBrake = brakeEnd >= 0 ? indexFrom(brakeEnd, n, (i) => brakes[i] > BRAKE_THRESHOLD) : -1;
  const cornerStart = braked ? mainStart : 0;
  const cornerEnd = nextBrake >= 0 ? nextBrake : n;

  // Interpolated like areaStats' brakepoint, so the two agree
  let brakePoint: number | null = null;
  if (braked) {
    const prev = brakeStart - 1;
    brakePoint =
      prev >= 0 && brakes[prev] <= BRAKE_THRESHOLD
        ? pcts[prev] + ((BRAKE_THRESHOLD - brakes[prev]) / (brakes[brakeStart] - brakes[prev])) * (pcts[brakeStart] - pcts[prev])
        : pcts[brakeStart];
  }

  // The lift: full throttle dropping, the last time before the brake, or the first time when there's no braking
  let lift = -1;
  for (let i = 1; i <= (braked ? mainStart : n - 1); i++) {
    if (throttles[i - 1] >= THROTTLE_FULL && throttles[i] < THROTTLE_FULL) {
      lift = i;
      if (!braked) break;
    }
  }

  // The pickup: the throttle back after the main braking zone, or after a full lift. On the throttle the charts
  // draw, with downshift blips taken out, so a marker never sits on a blip that isn't on the line
  let pickupFrom = brakeEnd;
  if (!braked && lift >= 0) pickupFrom = indexFrom(lift, n, (i) => throttles[i] <= THROTTLE_OFF);
  const pickup = pickupFrom >= 0 ? indexFrom(pickupFrom, n, (i) => throttles[i] >= THROTTLE_THRESHOLD) : -1;
  const full = pickup >= 0 ? indexFrom(pickup, n, (i) => throttles[i] >= THROTTLE_FULL) : -1;

  let apexIndex = -1;
  for (let i = cornerStart; i < cornerEnd; i++) {
    if (Number.isFinite(speeds[i]) && (apexIndex < 0 || speeds[i] < speeds[apexIndex])) apexIndex = i;
  }
  let apex: LapEvents['apex'] = null;
  if (apexIndex >= 0) {
    const limit = speeds[apexIndex] * APEX_SPEED_SHARE;
    let start = apexIndex;
    let end = apexIndex;
    while (start > cornerStart && speeds[start - 1] <= limit) start--;
    while (end < cornerEnd - 1 && speeds[end + 1] <= limit) end++;
    apex = { pct: pcts[apexIndex], start: pcts[start], end: pcts[end], speed: speeds[apexIndex] };
  }

  let turnIn: number | null = null;
  const mainBrakeStart = !braked ? null : mainStart === brakeStart ? brakePoint : pcts[mainStart];
  if (braked && apexIndex >= mainStart) {
    let largest = 0;
    for (let i = mainStart; i <= apexIndex; i++) {
      if (Number.isFinite(steerings[i])) largest = Math.max(largest, Math.abs(steerings[i]));
    }
    if (largest >= MIN_TURN_RADIANS) {
      const at = indexFrom(mainStart, apexIndex + 1, (i) => Math.abs(steerings[i]) >= largest * TURN_IN_SHARE);
      if (at >= 0) turnIn = at === mainStart ? mainBrakeStart : pcts[at];
    }
  }

  return {
    brakePoint,
    mainBrakeStart,
    peakBrake: braked ? { pct: pcts[peak], value: brakes[peak] } : null,
    brakeRelease: brakeEnd >= 0 ? pcts[brakeEnd] : null,
    throttleLift: lift >= 0 ? pcts[lift] : null,
    throttlePickup: pickup >= 0 ? pcts[pickup] : null,
    fullThrottle: full >= 0 ? pcts[full] : null,
    turnIn,
    apex,
  };
}

// The corner's phases from the Target lap's events, in track order and never overlapping; none without a
// braking zone and an apex after it. A phase the lap doesn't have any length of is left out.
export function cornerPhases(events: LapEvents, domainEnd: number): CornerPhase[] {
  const { mainBrakeStart: brakeAt, apex, turnIn, fullThrottle } = events;
  if (brakeAt === null || apex === null || apex.pct < brakeAt) return [];
  const apexStart = Math.max(apex.start, brakeAt);
  const apexEnd = Math.min(apex.end, domainEnd); // The lap's samples run just past the end of the area
  const turnInAt = turnIn === null ? apexStart : Math.min(Math.max(turnIn, brakeAt), apexStart);
  const exitEnd = fullThrottle !== null && fullThrottle > apexEnd ? fullThrottle : domainEnd;
  const phases: CornerPhase[] = [
    { id: 'braking', start: brakeAt, end: turnInAt },
    { id: 'turnIn', start: turnInAt, end: apexStart },
    { id: 'apex', start: apexStart, end: apexEnd },
    { id: 'exit', start: apexEnd, end: Math.min(exitEnd, domainEnd) },
  ];
  return phases.filter(({ start, end }) => end > start);
}

// Evenly spaced lap positions across a domain, with both ends
export function evenGrid([from, to]: [number, number], count: number) {
  return Array.from({ length: count }, (_, i) => from + (i / (count - 1)) * (to - from));
}

// A lap's values at each of the grid's lap positions (increasing), interpolated between its samples and held at
// its ends. The laps' 60 Hz samples fall at different places, so the charts compare them on one grid. NaN (a
// value the lap file doesn't have) stays NaN, so the line breaks there.
export function resample(pcts: number[], values: number[], grid: number[]) {
  let i = 0;
  return grid.map((pct) => {
    while (i < pcts.length - 2 && pcts[i + 1] < pct) i++;
    if (pct <= pcts[0]) return values[0];
    if (i + 1 >= pcts.length || pct >= pcts[pcts.length - 1]) return values[values.length - 1];
    const fraction = pcts[i + 1] > pcts[i] ? (pct - pcts[i]) / (pcts[i + 1] - pcts[i]) : 0;
    return values[i] + fraction * (values[i + 1] - values[i]);
  });
}

// The same for something that doesn't pass through the values between its samples, like the gear
export function resampleNearest(pcts: number[], values: number[], grid: number[]) {
  let i = 0;
  return grid.map((pct) => {
    while (i < pcts.length - 1 && Math.abs(pcts[i + 1] - pct) <= Math.abs(pcts[i] - pct)) i++;
    return values[i];
  });
}

// Where the lap was at a time (seconds, as AreaTrace's times count them): the inverse of timeAtPosition
export function positionAtTime({ pcts, times }: Pick<AreaTrace, 'pcts' | 'times'>, seconds: number) {
  const last = pcts.length - 1;
  if (seconds <= times[0]) return pcts[0];
  if (seconds >= times[last]) return pcts[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  const fraction = times[hi] > times[lo] ? (seconds - times[lo]) / (times[hi] - times[lo]) : 0;
  return pcts[lo] + fraction * (pcts[hi] - pcts[lo]);
}
