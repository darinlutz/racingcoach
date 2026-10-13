// Braking, throttle, steering and driving line measurements of one lap through one focus area, for Debrief
// Coach's get_braking_detail, get_throttle_detail, get_steering_detail and get_driving_line tools. Measured in
// the browser from an areaTrace, like areaStats, since the CSVs are too big to send.

import { brakeFeet, type AreaTrace } from '@/lib/lapData';

// Brake (0-1) above this counts as pressed; below it is pedal noise
const BRAKE_ON = 0.02;
// Throttle (0-1) at or above this counts as back on the power, as in areaStats
const THROTTLE_ON = 0.1;
// A lift starts when the throttle drops under this from at or above it
const LIFT_FROM = 0.9;
// Throttle at or above this is full throttle
const THROTTLE_FULL = 0.98;
// After the pickup, the throttle cut back by at least this much and then pressed again by at least this much
// is a re-application; smaller changes are feeding the throttle in
const REAPPLY_DROP = 0.15;
const DEGREES_PER_RADIAN = 180 / Math.PI;
// A steering swing back the other way of at least this many degrees counts as a reversal
const STEER_REVERSAL_DEGREES = 4;
// Below this much wheel angle the area is treated as straight, so there's no turn-in
const MIN_TURN_DEGREES = 10;
const METERS_PER_DEGREE = (6371000 * Math.PI) / 180;
// Where through the area the driving line is compared: start, 25%, 50%, 75%, end
const LINE_CHECKPOINTS = [0, 0.25, 0.5, 0.75, 1];
// Points along the area searched for the largest line difference
const LINE_SEARCH_POINTS = 41;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export type BrakingDetail = {
  // Seconds from first touching the brake to peak pressure, and from the peak to releasing it (trail braking)
  rampSeconds: number | null;
  trailSeconds: number | null;
  // Feet from the start/finish line where the brake was released and the throttle came back
  releaseFeet: number | null;
  throttleFeet: number | null;
  // Brake % when the steering first reached half of its largest angle in the area (turn-in)
  brakeAtTurnInPct: number | null;
  // Seconds on the brake, and coasting (off the brake and under 10% throttle), in the whole area
  brakeSeconds: number;
  coastSeconds: number;
};

export type ThrottleDetail = {
  // Seconds from the throttle dropping under 90% to off (under 10%): how quickly it was released. null when
  // there was no full lift in the area (already off at its start, a partial lift, or still lifting at its end)
  liftSeconds: number | null;
  // Lowest throttle % of a lift that went back to 90% or more without getting off the throttle; null otherwise
  partialLiftPct: number | null;
  // Feet from the start/finish line where the throttle went back on (10%) after being off
  pickupFeet: number | null;
  // Seconds from the pickup to full throttle (98%); null when it didn't get there in the area
  pickupToFullSeconds: number | null;
  // Times after the pickup the throttle was cut back by 15% or more and then pressed again, and the largest
  // such cut (throttle % before and after it)
  reapplications: number;
  worstDrop: { fromPct: number; toPct: number } | null;
};

export function throttleDetail({ pcts, times, throttles }: AreaTrace, lengthFeet: number | null): ThrottleDetail {
  const dt = times.length > 1 ? times[1] - times[0] : 0;
  const pct = (value: number) => Math.round(value * 100);

  // The lift: the first drop under 90%, followed until the throttle is off or back up to 90%
  let liftSeconds: number | null = null;
  let partialLiftPct: number | null = null;
  const liftStart = throttles.findIndex((t, i) => i > 0 && throttles[i - 1] >= LIFT_FROM && t < LIFT_FROM);
  if (liftStart >= 0) {
    let lowest = throttles[liftStart];
    for (let i = liftStart; i < throttles.length; i++) {
      if (throttles[i] < THROTTLE_ON) {
        liftSeconds = round((i - liftStart) * dt, 2);
        break;
      }
      if (throttles[i] >= LIFT_FROM) {
        partialLiftPct = pct(lowest);
        break;
      }
      lowest = Math.min(lowest, throttles[i]);
    }
  }

  // The pickup: the throttle back on after being off
  const off = throttles.findIndex((t) => t < THROTTLE_ON);
  const pickup = off < 0 ? -1 : throttles.findIndex((t, i) => i > off && t >= THROTTLE_ON);
  let pickupToFullSeconds: number | null = null;
  let reapplications = 0;
  let worstDrop: ThrottleDetail['worstDrop'] = null;
  if (pickup >= 0) {
    const full = throttles.findIndex((t, i) => i >= pickup && t >= THROTTLE_FULL);
    if (full >= 0) pickupToFullSeconds = round((full - pickup) * dt, 2);

    // Cut back from the highest point so far, then pressed again
    let peak = throttles[pickup];
    let low = peak;
    let dropping = false;
    for (let i = pickup; i < throttles.length; i++) {
      const t = throttles[i];
      if (!dropping) {
        if (t > peak) peak = t;
        else if (peak - t >= REAPPLY_DROP) {
          dropping = true;
          low = t;
        }
      } else if (t < low) {
        low = t;
      } else if (t - low >= REAPPLY_DROP) {
        reapplications++;
        if (!worstDrop || peak - low > (worstDrop.fromPct - worstDrop.toPct) / 100) worstDrop = { fromPct: pct(peak), toPct: pct(low) };
        dropping = false;
        peak = t;
      }
    }
  }

  return {
    liftSeconds,
    partialLiftPct,
    pickupFeet: pickup >= 0 && lengthFeet ? brakeFeet(pcts[pickup], lengthFeet) : null,
    pickupToFullSeconds,
    reapplications,
    worstDrop,
  };
}

export type SteeringDetail = {
  // Largest steering wheel angle in the area (degrees, either way)
  maxDeg: number;
  // Wheel angle at the slowest point of the area, positive to the left
  apexDeg: number;
  // Times the steering swung back the other way by 4 degrees or more (turning in and unwinding is one)
  reversals: number;
};

export type LineDetail = {
  // Meters left (+) or right (-) of the reference lap's line at the area's start, 25%, 50%, 75% and end
  offsetsM: number[];
  // The largest difference anywhere in the area, and how far through the area (%) it was
  maxOffsetM: number;
  maxOffsetAtPct: number;
};

export function brakingDetail({ pcts, times, brakes, throttles, steerings }: AreaTrace, lengthFeet: number | null): BrakingDetail {
  const dt = times.length > 1 ? times[1] - times[0] : 0;
  const feet = (pct: number) => (lengthFeet ? brakeFeet(pct, lengthFeet) : null);
  let rampSeconds: number | null = null;
  let trailSeconds: number | null = null;
  let releaseFeet: number | null = null;
  let throttleFeet: number | null = null;

  const start = brakes.findIndex((b) => b > BRAKE_ON);
  if (start >= 0) {
    let peak = start;
    let end = start;
    while (end < brakes.length && brakes[end] > BRAKE_ON) {
      if (brakes[end] > brakes[peak]) peak = end;
      end++;
    }
    rampSeconds = round((peak - start) * dt, 2);
    // Still braking at the end of the area: the release is past it
    if (end < brakes.length) {
      trailSeconds = round((end - peak) * dt, 2);
      releaseFeet = feet(pcts[end]);
      const pickup = throttles.findIndex((t, i) => i >= end && t >= THROTTLE_ON);
      if (pickup >= 0) throttleFeet = feet(pcts[pickup]);
    }
  }

  let brakeAtTurnInPct: number | null = null;
  const maxSteer = Math.max(...steerings.map(Math.abs));
  if (maxSteer * DEGREES_PER_RADIAN >= MIN_TURN_DEGREES) {
    const turnIn = steerings.findIndex((s) => Math.abs(s) >= maxSteer / 2);
    brakeAtTurnInPct = Math.round(brakes[turnIn] * 100);
  }

  const brakeSamples = brakes.filter((b) => b > BRAKE_ON).length;
  const coastSamples = brakes.filter((b, i) => b <= BRAKE_ON && throttles[i] < THROTTLE_ON).length;
  return {
    rampSeconds,
    trailSeconds,
    releaseFeet,
    throttleFeet,
    brakeAtTurnInPct,
    brakeSeconds: round(brakeSamples * dt, 2),
    coastSeconds: round(coastSamples * dt, 2),
  };
}

export function steeringDetail({ steerings, speeds }: AreaTrace): SteeringDetail {
  const degrees = steerings.map((s) => s * DEGREES_PER_RADIAN);
  let slowest = 0;
  speeds.forEach((speed, i) => {
    if (speed < speeds[slowest]) slowest = i;
  });

  // Count swings back the other way, ignoring wobbles smaller than STEER_REVERSAL_DEGREES
  let direction = 0;
  let extreme = degrees[0] ?? 0;
  let reversals = 0;
  for (const value of degrees) {
    if (direction === 0) {
      if (Math.abs(value - extreme) >= STEER_REVERSAL_DEGREES) {
        direction = Math.sign(value - extreme);
        extreme = value;
      }
    } else if ((value - extreme) * direction > 0) {
      extreme = value;
    } else if ((extreme - value) * direction >= STEER_REVERSAL_DEGREES) {
      reversals++;
      direction = -direction;
      extreme = value;
    }
  }

  return {
    maxDeg: round(Math.max(0, ...degrees.map(Math.abs)), 1),
    apexDeg: round(degrees[slowest] ?? 0, 1),
    reversals,
  };
}

// Fractional sample index where the trace reaches a lap position (clamped to the trace)
function indexAt(pcts: number[], pct: number) {
  const last = pcts.length - 1;
  if (pct <= pcts[0]) return 0;
  if (pct >= pcts[last]) return last;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pcts[mid] <= pct) lo = mid;
    else hi = mid;
  }
  return lo + (pcts[hi] > pcts[lo] ? (pct - pcts[lo]) / (pcts[hi] - pcts[lo]) : 0);
}

function pointAt(pcts: number[], points: [number, number][], pct: number): [number, number] {
  const index = indexAt(pcts, pct);
  const lo = Math.floor(index);
  const hi = Math.min(lo + 1, points.length - 1);
  const f = index - lo;
  return [points[lo][0] + f * (points[hi][0] - points[lo][0]), points[lo][1] + f * (points[hi][1] - points[lo][1])];
}

// How far this lap's line was from the reference lap's (the fastest through the area) at the same lap
// positions: the distance across the reference line's direction of travel, positive to the left. LapDistPct
// follows the track, so the same position on both laps is the same place along the track. null if either
// lap has no track positions here.
export function lineDetail(trace: AreaTrace, reference: AreaTrace): LineDetail | null {
  if (!trace.positions || !reference.positions || reference.positions.length < 2) return null;
  const [lat0, lon0] = reference.positions[0];
  const xScale = METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  const toMeters = ([lat, lon]: [number, number]): [number, number] => [(lon - lon0) * xScale, (lat - lat0) * METERS_PER_DEGREE];
  const referencePoints = reference.positions.map(toMeters);
  const points = trace.positions.map(toMeters);
  const [from, to] = reference.domain;
  // A short step along the track either side, for the reference line's direction
  const step = (to - from) / 200;

  const offsetAt = (fraction: number) => {
    const pct = from + fraction * (to - from);
    const [ax, ay] = pointAt(reference.pcts, referencePoints, pct - step);
    const [bx, by] = pointAt(reference.pcts, referencePoints, pct + step);
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) return 0;
    const [rx, ry] = pointAt(reference.pcts, referencePoints, pct);
    const [px, py] = pointAt(trace.pcts, points, pct);
    return ((bx - ax) * (py - ry) - (by - ay) * (px - rx)) / length;
  };

  let maxOffset = 0;
  let maxAt = 0;
  for (let i = 0; i < LINE_SEARCH_POINTS; i++) {
    const fraction = i / (LINE_SEARCH_POINTS - 1);
    const offset = offsetAt(fraction);
    if (Math.abs(offset) > Math.abs(maxOffset)) {
      maxOffset = offset;
      maxAt = fraction;
    }
  }
  return {
    offsetsM: LINE_CHECKPOINTS.map((fraction) => round(offsetAt(fraction), 1)),
    maxOffsetM: round(maxOffset, 1),
    maxOffsetAtPct: Math.round(maxAt * 100),
  };
}
