// What the dashboards in Lap Compare's bottom tabs work out from the laps' channels (npm run test:lap-events): tire
// slip angles and car balance, statistics of what's in view, shift events and which correspond between two laps,
// steering reversals, and stretches where something holds. Pure, and NaN (a value the lap file doesn't have) is skipped.

import type { AreaTrace } from './lapData.ts';

// The tire slip angles need the car's geometry, which neither iRacing nor the lap files give, so they're estimated
// for a typical GT3 car: steering wheel angle / front wheel angle, and the distances (m) from the center of gravity to
// the front and rear axles (2.7 m wheelbase, a little more weight on the rear). One value per axle: the lap files
// have nothing per tire.
const STEERING_RATIO = 11;
const CG_TO_FRONT_AXLE = 1.49;
const CG_TO_REAR_AXLE = 1.21;
const DEGREES_PER_RADIAN = 180 / Math.PI;

// Each sample's front and rear tire slip angles (degrees, NaN where the lap can't tell), from the steering, the
// yaw rate and the sideslip (a bicycle model, as the Rotation Model works them out): the angle between where
// each axle's wheels point and the direction that axle travels. Signed like iRacing's steering: positive in a left turn.
export function tireSlipAngles({ steerings, speeds, handling: { yawRates, sideslips } }: Pick<AreaTrace, 'steerings' | 'speeds' | 'handling'>) {
  const front: number[] = [];
  const rear: number[] = [];
  sideslips.forEach((beta, i) => {
    const forward = speeds[i] * Math.cos(beta);
    const left = speeds[i] * Math.sin(beta);
    const r = yawRates[i];
    front.push((steerings[i] / STEERING_RATIO - Math.atan2(left + CG_TO_FRONT_AXLE * r, forward)) * DEGREES_PER_RADIAN);
    rear.push(-Math.atan2(left - CG_TO_REAR_AXLE * r, forward) * DEGREES_PER_RADIAN);
  });
  return { front, rear };
}

// Front minus rear tire slip angle in the direction the car turns (degrees): positive is understeer (the front
// slipping more), negative oversteer
export function carBalance(trace: Pick<AreaTrace, 'steerings' | 'speeds' | 'handling'>) {
  const { front, rear } = tireSlipAngles(trace);
  return front.map((f, i) => Math.sign(trace.handling.yawRates[i]) * (f - rear[i]));
}

export type Stats = { min: number; max: number; avg: number };

export function stats(values: number[] | null | undefined, from = 0, to = (values?.length ?? 0) - 1): Stats | null {
  if (!values) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    count++;
  }
  return count > 0 ? { min, max, avg: sum / count } : null;
}

// Compare minus Target at each point, NaN where either lap has none; null without both laps
export function deltas(target: number[] | null, compare: number[] | null) {
  return target && compare ? compare.map((value, i) => value - target[i]) : null;
}

// The largest difference either way between two points, signed, with where it is; null when there's nothing to measure
export function largest(values: number[] | null, from = 0, to = (values?.length ?? 0) - 1) {
  if (!values) return null;
  let index = -1;
  for (let i = from; i <= to; i++) {
    if (Number.isFinite(values[i]) && (index < 0 || Math.abs(values[i]) > Math.abs(values[index]))) index = i;
  }
  return index < 0 ? null : { value: values[index], index };
}

export function meanAbs(values: number[] | null, from = 0, to = (values?.length ?? 0) - 1) {
  return stats(values?.map(Math.abs) ?? null, from, to)?.avg ?? null;
}

export type ShiftEvent = { id: string; type: 'up' | 'down'; from: number; to: number; pct: number; rpm: number };

// Each gear change through the area, from the lap's own samples: where the new gear starts and the RPM just before.
// Neutral on the way through (iRacing can read 0 between gears), reverse and gaps aren't gears here.
export function shiftEvents(pcts: number[], gears: number[], rpms: number[]): ShiftEvent[] {
  const events: ShiftEvent[] = [];
  let current = NaN;
  let lastIndex = -1;
  gears.forEach((gear, i) => {
    if (!Number.isFinite(gear) || gear <= 0) return;
    if (Number.isFinite(current) && gear !== current) {
      events.push({ id: `${i}`, type: gear > current ? 'up' : 'down', from: current, to: gear, pct: pcts[i], rpm: rpms[lastIndex] });
    }
    current = gear;
    lastIndex = i;
  });
  return events;
}

export type ShiftPair = { key: string; type: 'up' | 'down'; from: number; to: number; target: ShiftEvent | null; compare: ShiftEvent | null };

const SHIFT_PAIR_WINDOW = 0.05; // Of a lap: further apart than this, two shifts aren't the same one

// Only corresponding shifts are compared: the same gears, nearest each other within the window. Any others are listed
// on their own, in track order.
export function pairShifts(target: ShiftEvent[], compare: ShiftEvent[], window = SHIFT_PAIR_WINDOW): ShiftPair[] {
  const used = new Set<string>();
  const pairs: ShiftPair[] = [];
  for (const t of target) {
    let best: ShiftEvent | null = null;
    for (const c of compare) {
      if (used.has(c.id) || c.from !== t.from || c.to !== t.to || Math.abs(c.pct - t.pct) > window) continue;
      if (!best || Math.abs(c.pct - t.pct) < Math.abs(best.pct - t.pct)) best = c;
    }
    if (best) used.add(best.id);
    pairs.push({ key: `t${t.id}`, type: t.type, from: t.from, to: t.to, target: t, compare: best });
  }
  for (const c of compare) {
    if (!used.has(c.id)) pairs.push({ key: `c${c.id}`, type: c.type, from: c.from, to: c.to, target: null, compare: c });
  }
  return pairs.sort((a, b) => (a.target?.pct ?? a.compare?.pct ?? 0) - (b.target?.pct ?? b.compare?.pct ?? 0));
}

export type Reversal = { pct: number; amplitude: number };

// Where the steering turns back the other way by more than minSwing degrees: each is the extreme it came back from,
// with how far it came back, all the way to where it next turned (or the end of the area)
export function steeringReversals(pcts: number[], steering: number[] | null, minSwing = 6): Reversal[] {
  if (!steering) return [];
  const turns: number[] = [];
  let extreme = -1;
  let direction = 0;
  for (let i = 0; i < steering.length; i++) {
    const value = steering[i];
    if (!Number.isFinite(value)) continue;
    if (extreme < 0) {
      extreme = i;
      continue;
    }
    const move = value - steering[extreme];
    if (direction === 0) {
      if (Math.abs(move) > minSwing) {
        direction = Math.sign(move);
        extreme = i;
      }
    } else if (move * direction > 0) {
      extreme = i;
    } else if (Math.abs(move) > minSwing) {
      turns.push(extreme);
      direction = -direction;
      extreme = i;
    }
  }
  return turns.map((turn, i) => ({ pct: pcts[turn], amplitude: Math.abs(steering[turns[i + 1] ?? extreme] - steering[turn]) }));
}

// The stretches of the grid where the test holds, as lap positions
export function stretchesWhere(pcts: number[], test: (i: number) => boolean) {
  const stretches: { from: number; to: number }[] = [];
  let start = -1;
  pcts.forEach((_, i) => {
    const holds = test(i);
    if (holds && start < 0) start = i;
    if (start >= 0 && (!holds || i === pcts.length - 1)) {
      stretches.push({ from: pcts[start], to: pcts[holds ? i : i - 1] });
      start = -1;
    }
  });
  return stretches;
}

// Fuel a whole lap used (kg, the lap's first reading minus its last), and what's left at its end. Null without
// readings, or if fuel went up (a refuel), as that isn't what it used.
export function lapFuel(fuelKgs: number[]) {
  const finite = fuelKgs.filter(Number.isFinite);
  if (finite.length < 2) return { used: null, left: null };
  const used = finite[0] - finite[finite.length - 1];
  return { used: used >= 0 ? used : null, left: finite[finite.length - 1] };
}
