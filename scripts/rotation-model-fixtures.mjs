// Builds the Rotation Model's synthetic test telemetry (rotation-model/fixtures/*.json): short, deterministic
// sequences at 60 Hz from a simple single-track "car", each with what the model should conclude. They test
// the implementation (and C#/Node parity), not whether the model finds real tire saturation; that needs real
// laps with reviewed handling events (rotation-model/README.md, Validation).
//
//   node scripts/rotation-model-fixtures.mjs
//
// The fixture car's numbers are test values, not any real car's.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'rotation-model', 'fixtures');
const HZ = 60;
const DEG = Math.PI / 180;

// Test-only calibration: Rs·L = 36 m (e.g. 14:1 and 2.57 m), Rs·Ku = 0.004 s²
export const TEST_CALIBRATION = {
  calibrationId: 'synthetic-test-car',
  calibrationVersion: '1.0.0',
  carId: 'synthetic-test-car',
  carNames: ['Synthetic Test Car'],
  wheelbaseMeters: null,
  steeringRatio: null,
  cgToFrontAxleMeters: null,
  cgToRearAxleMeters: null,
  understeerGradient: null,
  effectiveSteerLength: 36,
  effectiveUndersteerTerm: 0.004,
  yawReferenceModel: 'identified-bicycle',
  yawGainMap: null,
  validSpeedRangeMps: [5, 90],
  overrides: null,
  source: 'Synthetic test values for rotation-model fixtures; not a real car.',
};
// Same car with its geometry known, for the axle slip angle path
const GEOMETRY_CALIBRATION = {
  ...TEST_CALIBRATION,
  calibrationId: 'synthetic-test-car-geometry',
  wheelbaseMeters: 2.5,
  steeringRatio: 14.4,
  cgToFrontAxleMeters: 1.3,
  cgToRearAxleMeters: 1.2,
  understeerGradient: 0.004 / 14.4,
  yawReferenceModel: 'calibrated-bicycle',
};

function referenceYaw(v, steer) {
  return (v * steer) / (TEST_CALIBRATION.effectiveSteerLength + TEST_CALIBRATION.effectiveUndersteerTerm * v * v);
}

// Seeded normal noise (mulberry32 + Box-Muller), so fixtures are identical every time
function noise(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (sigma) => sigma * Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// value goes from a to b between t0 and t1
const ease = (t, t0, t1, a, b) => a + (b - a) * smooth((t - t0) / (t1 - t0));

// One run of samples. spec(t) gives speed v, steering wheel angle steer, yaw multiplier k (actual vs
// reference), sideslip beta (rad), throttle, brake; extra(t, sample) can change the finished sample.
function simulate({ seconds, spec, sigma = null, seed = 1, start = 100, extra = null, yawTau = 0.12 }) {
  const n = Math.round(seconds * HZ);
  const rnd = noise(seed);
  const samples = [];
  let r = null;
  let yaw = 0.3;
  let prevVl = null;
  let pct = 0.2;
  for (let i = 0; i < n; i++) {
    const t = i / HZ;
    const dt = 1 / HZ;
    const s = { k: 1, beta: 0, throttle: 0.3, brake: 0, ...spec(t) };
    const target = s.rate ?? s.k * referenceYaw(s.v, s.steer);
    r = r === null ? target : r + (1 - Math.exp(-dt / yawTau)) * (target - r);
    yaw += r * dt;
    const vf = s.v * Math.cos(s.beta);
    const vl = s.v * Math.sin(s.beta);
    const vlDot = prevVl === null ? 0 : (vl - prevVl) / dt;
    prevVl = vl;
    pct = (pct + (s.v * dt) / 5000) % 1;
    const sample = {
      time: +(start + t).toFixed(6),
      speed: s.v,
      steeringWheelAngle: s.steer,
      yawRate: r,
      yaw,
      velocityX: vf,
      velocityY: vl,
      latAccel: vf * r + vlDot,
      longAccel: s.longAccel ?? 0,
      vertAccel: 9.81,
      throttle: s.throttle,
      brake: s.brake,
      lapDistPct: pct,
      sessionNum: 0,
      isOnTrack: true,
    };
    if (sigma) {
      sample.yawRate += rnd(sigma.yawRate ?? 0);
      sample.steeringWheelAngle += rnd(sigma.steer ?? 0);
      sample.velocityX += rnd(sigma.velocity ?? 0);
      sample.velocityY += rnd(sigma.velocity ?? 0);
      sample.latAccel += rnd(sigma.latAccel ?? 0);
      sample.speed += rnd(sigma.speed ?? 0);
      sample.vertAccel += rnd(sigma.vertAccel ?? 0);
    }
    if (extra) extra(t, sample, i);
    for (const key of Object.keys(sample)) {
      if (typeof sample[key] === 'number') sample[key] = Math.round(sample[key] * 1e7) / 1e7;
    }
    samples.push(sample);
  }
  return samples;
}

// A corner: turn in over 0.8 s from 0.5 s, hold, unwind over 0.8 s
const corner = (t, peak, holdUntil) => ease(t, 0.5, 1.3, 0, peak) - ease(t, holdUntil, holdUntil + 0.8, 0, peak);

const fixtures = [];
function add(name, description, samples, expect, calibration = TEST_CALIBRATION) {
  fixtures.push({ name, description, calibration, samples, expect });
}

add('01-straight-acceleration', 'Straight line, full throttle from 20 to 50 m/s.',
  simulate({ seconds: 4, spec: (t) => ({ v: 20 + 7.5 * t, steer: 0, throttle: 1, longAccel: 7.5 }) }),
  { events: [], neverLabel: true });

add('02-neutral-constant-radius', 'Steady 30 m/s corner, yaw rate as the reference predicts, -1° sideslip.',
  simulate({ seconds: 6, spec: (t) => ({ v: 30, steer: corner(t, 0.5, 5), beta: -1 * DEG * smooth(t - 0.5) }) }),
  { events: [], neverLabel: true, neutralBetween: [2, 4.5] });

add('03-understeer-push', 'Steering keeps increasing at 28 m/s but yaw rate stays put at the grip limit.',
  simulate({
    seconds: 6,
    spec: (t) => {
      const steer = ease(t, 0.5, 1.3, 0, 0.35) + ease(t, 1.5, 4, 0, 0.5) - ease(t, 4.8, 5.6, 0, 0.85);
      const cap = referenceYaw(28, 0.38);
      return { v: 28, steer, rate: Math.min(referenceYaw(28, steer), cap) * Math.sign(steer || 1) };
    },
  }),
  { events: [{ eventType: 'UNDERSTEER', count: 1, startBetween: [1.6, 3.5] }], noEventsOf: ['OVERSTEER'] });

add('04-excessive-yaw', 'Steady corner where yaw rate rises 60% over the reference and the rear slides out.',
  simulate({ seconds: 6, spec: (t) => ({ v: 30, steer: corner(t, 0.4, 5), k: ease(t, 2, 3, 1, 1.6), beta: ease(t, 2, 3, -1 * DEG, -7 * DEG) }) }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [2, 3.5] }], noEventsOf: ['UNDERSTEER'] });

add('05-progressive-rear-sideslip', 'Sideslip grows to -12° over 1.5 s with 40% extra yaw.',
  simulate({ seconds: 6, spec: (t) => ({ v: 32, steer: corner(t, 0.35, 5), k: ease(t, 2, 3.5, 1, 1.4), beta: ease(t, 2, 3.5, -1 * DEG, -12 * DEG) }) }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [2, 4] }], noEventsOf: ['UNDERSTEER'] });

add('06-countersteer', 'The car keeps rotating left while the driver steers right.',
  simulate({
    seconds: 5,
    spec: (t) => {
      const steer = corner(t, 0.4, 2) - ease(t, 2, 2.4, 0, 0.25) + ease(t, 3.4, 3.9, 0, 0.25);
      const rate = t < 2 ? referenceYaw(30, steer) : ease(t, 2, 3.4, referenceYaw(30, 0.4) * 1.5, 0.1) - ease(t, 3.4, 4, 0, 0.1);
      return { v: 30, steer, rate, beta: ease(t, 1.8, 2.6, -1 * DEG, -10 * DEG) - ease(t, 3.2, 4, 0, -9 * DEG) };
    },
  }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [1.9, 3] }], noEventsOf: ['UNDERSTEER'] });

add('07-trail-braking-rotation', 'Braking into the corner with 15% extra yaw and -3° sideslip: normal rotation.',
  simulate({ seconds: 5, spec: (t) => ({ v: 40 - 4 * Math.min(t, 2.5), steer: corner(t, 0.4, 4), k: ease(t, 0.8, 1.5, 1, 1.15) - ease(t, 2.5, 3.2, 0, 0.15), beta: ease(t, 0.8, 1.5, 0, -3 * DEG), brake: t < 2.5 ? 0.35 : 0, throttle: t < 2.5 ? 0 : 0.4, longAccel: t < 2.5 ? -4 : 0 }) }),
  { events: [], neverLabel: true });

add('08-power-on-oversteer', 'Full throttle on the exit; the rear steps out to -8° with 50% extra yaw.',
  simulate({ seconds: 5, spec: (t) => ({ v: 22 + 2 * t, steer: corner(t, 0.7, 4.2), k: ease(t, 2, 2.8, 1, 1.5), beta: ease(t, 2, 2.8, -1 * DEG, -8 * DEG), throttle: t < 1.8 ? 0.3 : 1, longAccel: t < 1.8 ? 0 : 3 }) }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [1.9, 3.3], oversteerType: 'POWER_ON' }], noEventsOf: ['UNDERSTEER'] });

add('09-high-speed-steady', 'A 60 m/s sweeper with the yaw rate on the reference.',
  simulate({ seconds: 6, spec: (t) => ({ v: 60, steer: corner(t, 0.12, 5), beta: -0.5 * DEG * smooth(t - 0.5), throttle: 0.8 }) }),
  { events: [], neverLabel: true });

add('10-low-speed-hairpin', 'A 15 m/s hairpin with 2 rad of steering, yaw on the reference.',
  simulate({ seconds: 6, spec: (t) => ({ v: 15, steer: corner(t, 2, 5), beta: 1 * DEG * smooth(t - 0.5) }) }),
  { events: [], neverLabel: true });

add('11a-right-understeer', 'Fixture 03 turning right.',
  simulate({
    seconds: 6,
    spec: (t) => {
      const steer = -(ease(t, 0.5, 1.3, 0, 0.35) + ease(t, 1.5, 4, 0, 0.5) - ease(t, 4.8, 5.6, 0, 0.85));
      const cap = referenceYaw(28, 0.38);
      return { v: 28, steer, rate: -Math.min(referenceYaw(28, -steer), cap) };
    },
  }),
  { events: [{ eventType: 'UNDERSTEER', count: 1, startBetween: [1.6, 3.5] }], noEventsOf: ['OVERSTEER'] });

add('11b-right-oversteer', 'Fixture 04 turning right.',
  simulate({ seconds: 6, spec: (t) => ({ v: 30, steer: -corner(t, 0.4, 5), k: ease(t, 2, 3, 1, 1.6), beta: ease(t, 2, 3, 1 * DEG, 7 * DEG) }) }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [2, 3.5] }], noEventsOf: ['UNDERSTEER'] });

add('12-noisy-neutral', 'Fixture 02 with sensor noise on every channel.',
  simulate({ seconds: 6, seed: 12, sigma: { yawRate: 0.01, steer: 0.004, velocity: 0.05, latAccel: 0.3, speed: 0.05, vertAccel: 0.5 }, spec: (t) => ({ v: 30, steer: corner(t, 0.5, 5), beta: -1 * DEG * smooth(t - 0.5) }) }),
  { events: [], neverLabel: true });

add('13-vertical-disturbance', 'Understeer, but the car is bouncing over a kerb in the middle of it.',
  simulate({
    seconds: 6,
    spec: (t) => {
      const steer = ease(t, 0.5, 1.3, 0, 0.35) + ease(t, 1.5, 4, 0, 0.5) - ease(t, 4.8, 5.6, 0, 0.85);
      return { v: 28, steer, rate: Math.min(referenceYaw(28, steer), referenceYaw(28, 0.38)) * Math.sign(steer || 1) };
    },
    extra: (t, s) => {
      if (t > 1.5 && t < 5.8 && Math.floor(t * 60) % 6 === 0) s.vertAccel = 25;
    },
  }),
  { events: [], neverLabel: true, reasonSeen: 'disturbance' });

add('14a-missing-velocity-understeer', 'Fixture 03 without VelocityX/VelocityY (yaw only).',
  simulate({
    seconds: 6,
    spec: (t) => {
      const steer = ease(t, 0.5, 1.3, 0, 0.35) + ease(t, 1.5, 4, 0, 0.5) - ease(t, 4.8, 5.6, 0, 0.85);
      return { v: 28, steer, rate: Math.min(referenceYaw(28, steer), referenceYaw(28, 0.38)) * Math.sign(steer || 1) };
    },
    extra: (t, s) => {
      s.velocityX = null;
      s.velocityY = null;
    },
  }),
  { events: [{ eventType: 'UNDERSTEER', count: 1, startBetween: [1.6, 3.5] }], capability: 'YAW_ONLY' });

add('14b-missing-velocity-oversteer', 'Fixture 05 without VelocityX/VelocityY: no countersteer, so not enough evidence.',
  simulate({
    seconds: 6,
    spec: (t) => ({ v: 32, steer: corner(t, 0.35, 5), k: ease(t, 2, 3.5, 1, 1.4), beta: ease(t, 2, 3.5, -1 * DEG, -12 * DEG) }),
    extra: (t, s) => {
      s.velocityX = null;
      s.velocityY = null;
    },
  }),
  { events: [], neverLabel: true, capability: 'YAW_ONLY' });

add('14c-missing-yaw-rate', 'YawRate missing for a second in a corner.',
  simulate({
    seconds: 5,
    spec: (t) => ({ v: 30, steer: corner(t, 0.5, 4) }),
    extra: (t, s) => {
      if (t > 2 && t < 3) s.yawRate = null;
    },
  }),
  { events: [], neverLabel: true, reasonSeen: 'missing-telemetry' });

add('14d-uncalibrated', 'Fixture 04 without a calibration: nothing can be judged.',
  simulate({ seconds: 6, spec: (t) => ({ v: 30, steer: corner(t, 0.4, 5), k: ease(t, 2, 3, 1, 1.6), beta: ease(t, 2, 3, -1 * DEG, -7 * DEG) }) }),
  { events: [], neverLabel: true, reasonSeen: 'uncalibrated', alwaysUnknown: true }, null);

add('15-zero-speed', 'Pulling away from a standstill with the wheel turned.',
  simulate({ seconds: 4, spec: (t) => ({ v: Math.max(0, 4 * t - 1), steer: 1, throttle: 0.5 }) }),
  { events: [], neverLabel: true, reasonSeen: 'low-speed' });

add('16-pause', 'Paused in a corner (SessionTime stops), then a 2 s gap.',
  simulate({
    seconds: 6,
    spec: (t) => ({ v: 30, steer: corner(t, 0.5, 5) }),
    extra: (t, s, i) => {
      if (i >= 120 && i < 180) s.time = 100 + 119 / 60; // paused for a second
      if (i >= 180) s.time = +(s.time + 2).toFixed(6); // then resumes 2 s later
    },
  }),
  { events: [], neverLabel: true, reasonSeen: 'warming-up' });

add('17-session-reset', 'SessionNum changes mid-corner.',
  simulate({
    seconds: 5,
    spec: (t) => ({ v: 30, steer: corner(t, 0.5, 4) }),
    extra: (t, s) => {
      if (t >= 2.5) s.sessionNum = 1;
    },
  }),
  { events: [], neverLabel: true, reasonSeen: 'warming-up' });

add('18-steering-reversal', 'A quick left-right chicane with yaw following the steering normally.',
  simulate({ seconds: 6, spec: (t) => ({ v: 30, steer: t < 0.5 ? 0 : 0.5 * Math.sin(2 * Math.PI * 0.6 * (t - 0.5)) * Math.min(1, t - 0.5) }) }),
  { events: [], neverLabel: true });

add('19-spin-recovery', 'Snap oversteer to -35° sideslip, opposite lock, then the car gathers up.',
  simulate({
    seconds: 7,
    spec: (t) => {
      const steer = corner(t, 0.5, 2) - ease(t, 2, 2.3, 0, 0.9) + ease(t, 3.5, 4.5, 0, 0.9);
      const rate = t < 2 ? referenceYaw(30 - 2 * t, steer) : ease(t, 2, 2.6, referenceYaw(26, 0.5), 0.9) - ease(t, 2.8, 4.5, 0, 0.9);
      return { v: Math.max(18, 30 - 2 * t), steer, rate, beta: ease(t, 1.9, 2.8, -1 * DEG, -35 * DEG) - ease(t, 3, 4.6, 0, -35 * DEG), brake: t > 2.2 && t < 3.5 ? 0.6 : 0, throttle: 0 };
    },
  }),
  { events: [{ eventType: 'OVERSTEER', count: 1, startBetween: [1.9, 3] }], noEventsOf: ['UNDERSTEER'] });

add('20-axle-slip-understeer', 'Fixture 03 with the car geometry known (axle slip angles).',
  simulate({
    seconds: 6,
    spec: (t) => {
      const steer = ease(t, 0.5, 1.3, 0, 0.35) + ease(t, 1.5, 4, 0, 0.5) - ease(t, 4.8, 5.6, 0, 0.85);
      return { v: 28, steer, rate: Math.min(referenceYaw(28, steer), referenceYaw(28, 0.38)) * Math.sign(steer || 1), beta: 1 * DEG * smooth(t - 0.5) };
    },
  }),
  { events: [{ eventType: 'UNDERSTEER', count: 1, startBetween: [1.6, 3.5] }], noEventsOf: ['OVERSTEER'] }, GEOMETRY_CALIBRATION);

mkdirSync(out, { recursive: true });
for (const fixture of fixtures) {
  writeFileSync(join(out, `${fixture.name}.json`), JSON.stringify(fixture) + '\n');
}
console.log(`Wrote ${fixtures.length} fixtures to ${out}`);
