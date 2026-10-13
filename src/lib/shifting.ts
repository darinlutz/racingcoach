// Upshifts and rev limiter hits of one whole lap, for the Debrief Coach's get_shifting_points tool. Measured
// from the lap's RPM and Gear columns wherever the browser or server measures the session (debriefSession.ts);
// the coach judges them against the car's rev limit (shiftLimit).

import { brakeFeet, type LapSamples } from '@/lib/lapData';

// Upshifts are judged only when the throttle was at least this far down just before them: part-throttle
// shifts (short-shifting for traction, cruising) aren't about using the engine's full range
const FULL_THROTTLE = 0.9;
// The shift RPM is the highest RPM in this many samples (0.1 s at 60 Hz) before the gear changes
const SHIFT_LOOKBACK = 6;
// On the rev limiter: full throttle, RPM within 1% of the gear's highest and the car no longer gaining speed
// (under 1 m/s² of acceleration) for at least 0.2 s
const LIMITER_RPM_SHARE = 0.99;
const LIMITER_MIN_SECONDS = 0.2;
const LIMITER_MAX_ACCEL = 1;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export type Upshift = { fromGear: number; rpm: number; feet: number | null };
export type LimiterHit = { gear: number; rpm: number; seconds: number; beforeUpshift: boolean };

export type LapShifting = {
  // Full-throttle upshifts in the order they happened, with the RPM at the shift
  upshifts: Upshift[];
  // Upshifts left out because the throttle wasn't fully down
  partThrottleUpshifts: number;
  // Stretches held on the rev limiter; beforeUpshift when the driver then shifted up (otherwise the top gear
  // ran out, or they lifted)
  limiterHits: LimiterHit[];
  maxRpm: number;
};

// null when the lap has no RPM or Gear column
export function lapShifting({ pcts, throttles, speeds, rpms, gears }: LapSamples, lapSeconds: number, lengthFeet: number | null): LapShifting | null {
  if (rpms.length === 0 || !rpms.some(Number.isFinite) || !gears.some(Number.isFinite)) return null;
  const dt = lapSeconds / rpms.length;
  const upshifts: Upshift[] = [];
  const limiterHits: LimiterHit[] = [];
  let partThrottleUpshifts = 0;

  // One stint per gear: from a gear change to the next
  let stintStart = 0;
  for (let i = 1; i <= gears.length; i++) {
    const changed = i === gears.length || gears[i] !== gears[i - 1];
    if (!changed) continue;
    const gear = gears[i - 1];
    const upshift = i < gears.length && gear >= 1 && gears[i] === gear + 1;
    if (Number.isFinite(gear) && gear >= 1) {
      limiterHits.push(...stintLimiterHits(stintStart, i, gear, upshift, throttles, speeds, rpms, dt));
    }
    if (upshift) {
      const from = Math.max(stintStart, i - SHIFT_LOOKBACK);
      const rpm = Math.max(...rpms.slice(from, i).filter(Number.isFinite));
      if (Math.min(...throttles.slice(from, i)) >= FULL_THROTTLE && Number.isFinite(rpm)) {
        upshifts.push({ fromGear: gear, rpm: Math.round(rpm), feet: lengthFeet ? brakeFeet(pcts[i], lengthFeet) : null });
      } else {
        partThrottleUpshifts++;
      }
    }
    stintStart = i;
  }

  return {
    upshifts,
    partThrottleUpshifts,
    limiterHits,
    maxRpm: Math.round(Math.max(0, ...rpms.filter(Number.isFinite))),
  };
}

// Stretches of one gear's stint [from, to) where the engine sat on its highest RPM at full throttle without
// the car speeding up: the rev limiter (or, in top gear, top speed, which the coach tells apart by the RPM)
function stintLimiterHits(
  from: number,
  to: number,
  gear: number,
  upshift: boolean,
  throttles: number[],
  speeds: number[],
  rpms: number[],
  dt: number
): LimiterHit[] {
  const peak = Math.max(...rpms.slice(from, to).filter(Number.isFinite));
  if (!Number.isFinite(peak) || peak <= 0) return [];
  const hits: LimiterHit[] = [];
  let i = from;
  while (i < to) {
    const on = (j: number) => throttles[j] >= FULL_THROTTLE && rpms[j] >= peak * LIMITER_RPM_SHARE;
    if (!on(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < to && on(j)) j++;
    const seconds = (j - i) * dt;
    const accel = seconds > 0 ? (speeds[j - 1] - speeds[i]) / seconds : 0;
    if (seconds >= LIMITER_MIN_SECONDS && accel < LIMITER_MAX_ACCEL) {
      hits.push({ gear, rpm: Math.round(peak), seconds: round(seconds, 2), beforeUpshift: upshift && j === to });
    }
    i = j;
  }
  return hits;
}

// The RPM the coach judges shifts against, best first: a limiter the laps actually hit before shifting up,
// the car's rpmLimit from the user's Car Data, or the highest RPM in the laps
export type ShiftLimit = { rpm: number; source: 'limiter' | 'carData' | 'highest' };

export function shiftLimit(laps: (LapShifting | null | undefined)[], carDataRpm: number | null): ShiftLimit | null {
  const measured = laps.filter((lap): lap is LapShifting => !!lap);
  const limiter = measured.flatMap((lap) => lap.limiterHits.filter((hit) => hit.beforeUpshift).map((hit) => hit.rpm));
  // A limiter far under the Car Data limit is more likely top speed than the limiter
  const plausible = carDataRpm ? limiter.filter((rpm) => rpm >= carDataRpm * 0.9) : limiter;
  if (plausible.length > 0) return { rpm: Math.max(...plausible), source: 'limiter' };
  if (carDataRpm) return { rpm: carDataRpm, source: 'carData' };
  const highest = Math.max(0, ...measured.map((lap) => lap.maxRpm));
  return highest > 0 ? { rpm: highest, source: 'highest' } : null;
}
