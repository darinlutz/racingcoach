// Rotation Model: detects understeer and oversteer from telemetry, without track position, racing lines or
// reference laps. The math is specified in rotation-model/README.md; the collector's C# port
// (collector/RacingCoach.Collector/RotationModel/) follows this file step for step, and
// scripts/rotation-model.test.mjs checks that both give the same results for the same samples.
// Keep the two in step: change both, in the same order of operations, and run the parity test.
// No imports, so Node can run it straight from the .ts file (tests, calibration script).

export type RotationState = 'UNKNOWN' | 'NEUTRAL' | 'UNDERSTEER' | 'OVERSTEER';
export type CornerPhase = 'STRAIGHT' | 'ENTRY' | 'MID_CORNER' | 'EXIT';
export type OversteerType = 'ENTRY' | 'MID_CORNER' | 'POWER_ON';
// FULL: yaw and sideslip; YAW_ONLY: no usable VelocityX/VelocityY, so oversteer needs countersteer to confirm
export type RotationCapability = 'FULL' | 'YAW_ONLY';

// One telemetry sample, in iRacing's names and units. time is SessionTime (s). Missing values are null.
export type RotationSample = {
  time: number | null;
  speed: number | null; // m/s
  steeringWheelAngle: number | null; // rad, positive left
  yawRate: number | null; // rad/s, positive left (counterclockwise)
  yaw?: number | null; // rad, only needed when conventions.velocityFrame is "world"
  velocityX?: number | null; // m/s
  velocityY?: number | null; // m/s
  latAccel?: number | null; // m/s²
  longAccel?: number | null; // m/s²
  vertAccel?: number | null; // m/s², bump detection only
  throttle?: number | null; // 0-1
  brake?: number | null; // 0-1
  lapDistPct?: number | null; // event metadata only
  sessionNum?: number | null; // a change resets the model
  isOnTrack?: boolean | null; // false resets the model
};

export type RotationModelConfig = {
  modelVersion: string;
  configVersion: string;
  conventions: { velocityFrame: 'body' | 'world'; steeringSign: number; latAccelSign: 'auto' | number };
  filters: {
    speedTau: number;
    steeringTau: number;
    yawRateTau: number;
    velocityTau: number;
    latAccelTau: number;
    derivativeTau: number;
    yawResponseTau: number;
    vertBaselineTau: number;
  };
  validity: {
    minSpeedMps: number;
    maxSampleGapSeconds: number;
    warmupSeconds: number;
    minTurnYawRate: number;
    reverseForwardVelocityMps: number;
    velocityMagnitudeTolerance: number;
    frameCheckMaxSideslipDeg: number;
    frameCheckTau: number;
    frameCheckMinScore: number;
    bumpVertAccelMps2: number;
    bumpHoldSeconds: number;
    maxLatAccelResidualMps2: number;
    latAccelSignMinEvidence: number;
    latAccelSignMinLateralMps2: number;
  };
  understeer: {
    yawDeficitStart: number;
    yawDeficitFull: number;
    coreWeight: number;
    growthStartPerSecond: number;
    growthFullPerSecond: number;
    latAccelPlateauStart: number;
    latAccelPlateauFull: number;
    latAccelPeakMinMps2: number;
    latAccelPeakDecayTau: number;
    frontSlipExcessStartDeg: number;
    frontSlipExcessFullDeg: number;
    weights: { growth: number; plateau: number; frontAxle: number };
    steeringRateOkRadPerSec: number;
    steeringRateMaxRadPerSec: number;
    severityFull: number;
  };
  oversteer: {
    yawExcessStart: number;
    yawExcessFull: number;
    entryAllowance: number;
    coreWeight: number;
    sideslipStartDeg: number;
    sideslipFullDeg: number;
    sideslipRateStartDegPerSec: number;
    sideslipRateFullDegPerSec: number;
    countersteerMinRad: number;
    rearSlipStartDeg: number;
    rearSlipFullDeg: number;
    weights: { sideslip: number; sideslipRate: number; countersteer: number; rearAxle: number };
    severityYawFull: number;
    severitySideslipFullDeg: number;
  };
  state: { enterConfidence: number; exitConfidence: number; enterSeconds: number; exitSeconds: number; minHoldSeconds: number };
  phase: { brakeOn: number; throttleExit: number };
  display: { understeerColor: string; oversteerColor: string };
};

// A car's calibration (rotation-model/calibrations.json). Unknown physical values stay null.
export type RotationCalibration = {
  calibrationId: string;
  calibrationVersion: string;
  carId: string | null; // iRacing's CarPath, e.g. "porsche992rgt3"
  carNames: string[]; // iRacing's CarScreenName(s)
  wheelbaseMeters: number | null;
  steeringRatio: number | null; // steering wheel angle / front road wheel angle
  cgToFrontAxleMeters: number | null;
  cgToRearAxleMeters: number | null;
  understeerGradient: number | null; // Ku in r = v·δ / (L + Ku·v²), s²/m
  effectiveSteerLength: number | null; // Rs·L (m), identified from telemetry
  effectiveUndersteerTerm: number | null; // Rs·Ku (s²), identified from telemetry
  yawReferenceModel: 'calibrated-bicycle' | 'identified-bicycle' | 'yaw-gain-map';
  yawGainMap: { speedMps: number; gainPerRad: number }[] | null; // yaw rate per radian of steering wheel
  validSpeedRangeMps: [number, number] | null;
  overrides?: Record<string, unknown> | null; // partial config, e.g. { "understeer": { "yawDeficitStart": 0.15 } }
  source?: string | null;
};

export type RotationModelResult = {
  timestamp: number | null;
  state: RotationState;
  displayLabel: '' | 'UNDERSTEER' | 'OVERSTEER';
  confidence: number;
  understeerConfidence: number;
  oversteerConfidence: number;
  understeerSeverity: number;
  oversteerSeverity: number;
  yawRateActual: number | null;
  yawRateExpected: number | null;
  yawRateKinematic: number | null;
  yawRateError: number | null;
  yawResponseRatio: number | null;
  forwardVelocityMps: number | null;
  lateralVelocityMps: number | null;
  sideslipAngleRadians: number | null;
  sideslipAngleDegrees: number | null;
  sideslipRateDegreesPerSecond: number | null;
  frontWheelAngleRadians: number | null;
  frontAxleSlipDegrees: number | null;
  rearAxleSlipDegrees: number | null;
  latAccelResidual: number | null;
  cornerPhase: CornerPhase;
  oversteerType: OversteerType | null;
  capability: RotationCapability;
  invalidReason: string | null;
  modelVersion: string;
  calibrationId: string | null;
  isCalibrated: boolean;
  isValid: boolean;
};

export type RotationModelEvent = {
  eventType: 'UNDERSTEER' | 'OVERSTEER';
  startTime: number;
  confirmedTime: number;
  endTime: number;
  durationMs: number;
  peakSeverity: number;
  averageSeverity: number;
  peakConfidence: number;
  speedAtStartMps: number;
  cornerPhase: CornerPhase;
  oversteerType: OversteerType | null;
  phaseSamples: { ENTRY: number; MID_CORNER: number; EXIT: number; STRAIGHT: number };
  averageThrottle: number;
  averageBrake: number;
  lapDistPctStart: number | null;
  lapDistPctEnd: number | null;
  endReason: 'recovered' | 'switched' | 'invalid' | 'reset' | 'end-of-data';
  modelVersion: string;
  calibrationId: string | null;
};

const RAD_TO_DEG = 180 / Math.PI;

// x is a usable number
function ok(x: number | null | undefined): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

// 0 at a, 1 at b, linear between (b > a)
function ramp(x: number, a: number, b: number) {
  if (!(b > a)) return x >= b ? 1 : 0;
  const v = (x - a) / (b - a);
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function sign(x: number) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

// First-order low-pass over elapsed time: y += (1 - e^(-dt/tau)) (x - y). Without a previous value it starts at x.
function lowPass(previous: number | null, x: number, dt: number, tau: number) {
  if (previous === null || tau <= 0) return x;
  return previous + (1 - Math.exp(-dt / tau)) * (x - previous);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The config with a calibration's overrides applied (objects merged key by key, anything else replaced)
export function mergeConfig<T>(base: T, overrides: unknown): T {
  if (!isObject(overrides) || !isObject(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = isObject(value) && isObject(out[key]) ? mergeConfig(out[key], value) : value;
  }
  return out as T;
}

// The calibration for a car, by iRacing's CarPath or one of its screen names (case-insensitive)
export function findCalibration(
  calibrations: RotationCalibration[],
  car: { carId?: string | null; carName?: string | null }
): RotationCalibration | null {
  const id = car.carId?.trim().toLowerCase();
  const name = car.carName?.trim().toLowerCase();
  return (
    calibrations.find((c) => id && c.carId?.toLowerCase() === id) ??
    calibrations.find((c) => name && c.carNames.some((n) => n.toLowerCase() === name)) ??
    null
  );
}

// The yaw reference's parameters, resolved once per calibration
type Reference = {
  kind: 'bicycle' | 'map' | 'none';
  a: number; // Rs·L
  b: number; // Rs·Ku
  map: { speedMps: number; gainPerRad: number }[];
  minSpeed: number;
  maxSpeed: number;
  wheelbase: number | null;
  ratio: number | null;
  cgFront: number | null;
  cgRear: number | null;
};

function resolveReference(cal: RotationCalibration | null): Reference {
  const none: Reference = {
    kind: 'none', a: 0, b: 0, map: [], minSpeed: 0, maxSpeed: 0, wheelbase: null, ratio: null, cgFront: null, cgRear: null,
  };
  if (!cal) return none;
  const wheelbase = ok(cal.wheelbaseMeters) && cal.wheelbaseMeters > 0 ? cal.wheelbaseMeters : null;
  const ratio = ok(cal.steeringRatio) && cal.steeringRatio > 0 ? cal.steeringRatio : null;
  const cgFront = ok(cal.cgToFrontAxleMeters) && cal.cgToFrontAxleMeters > 0 ? cal.cgToFrontAxleMeters : null;
  const cgRear = ok(cal.cgToRearAxleMeters) && cal.cgToRearAxleMeters > 0 ? cal.cgToRearAxleMeters : null;
  const range = cal.validSpeedRangeMps;
  const minSpeed = range && ok(range[0]) ? range[0] : 0;
  const maxSpeed = range && ok(range[1]) ? range[1] : Number.MAX_VALUE;
  const base = { ...none, minSpeed, maxSpeed, wheelbase, ratio, cgFront, cgRear };

  if (cal.yawReferenceModel === 'yaw-gain-map') {
    const map = (cal.yawGainMap ?? [])
      .filter((p) => ok(p.speedMps) && ok(p.gainPerRad) && p.gainPerRad > 0)
      .slice()
      .sort((p, q) => p.speedMps - q.speedMps);
    if (map.length < 2) return none;
    return {
      ...base,
      kind: 'map',
      map,
      minSpeed: Math.max(minSpeed, map[0].speedMps),
      maxSpeed: Math.min(maxSpeed, map[map.length - 1].speedMps),
    };
  }
  if (cal.yawReferenceModel === 'calibrated-bicycle') {
    if (wheelbase === null || ratio === null || !ok(cal.understeerGradient)) return none;
    return { ...base, kind: 'bicycle', a: ratio * wheelbase, b: ratio * cal.understeerGradient };
  }
  if (cal.yawReferenceModel === 'identified-bicycle') {
    if (!ok(cal.effectiveSteerLength) || cal.effectiveSteerLength <= 0 || !ok(cal.effectiveUndersteerTerm)) return none;
    return { ...base, kind: 'bicycle', a: cal.effectiveSteerLength, b: cal.effectiveUndersteerTerm };
  }
  return none;
}

// Steady-state yaw rate the car should have at this speed and steering wheel angle, or null outside the
// calibration's range
function referenceYawRate(ref: Reference, speed: number, steer: number): number | null {
  if (ref.kind === 'none' || speed < ref.minSpeed || speed > ref.maxSpeed) return null;
  if (ref.kind === 'map') {
    const map = ref.map;
    let i = 0;
    while (i < map.length - 2 && speed > map[i + 1].speedMps) i++;
    const p = map[i];
    const q = map[i + 1];
    const f = (speed - p.speedMps) / (q.speedMps - p.speedMps);
    return (p.gainPerRad + f * (q.gainPerRad - p.gainPerRad)) * steer;
  }
  const denominator = ref.a + ref.b * speed * speed;
  if (denominator < 0.25 * ref.a) return null; // past the critical speed of an oversteering fit
  return (speed * steer) / denominator;
}

// Supporting evidence, combined as a noisy-OR: 1 - Π(1 - weight·value). Any one strong, reliable sign is
// enough; missing (null) or absent ones don't count against the others. 0 when there are none
function support(terms: [number | null, number][]) {
  let none = 1;
  for (const [value, weight] of terms) {
    if (value === null) continue;
    none *= 1 - Math.min(1, Math.max(0, weight)) * value;
  }
  return 1 - none;
}

type OpenEvent = {
  type: 'UNDERSTEER' | 'OVERSTEER';
  startTime: number;
  confirmedTime: number;
  speedAtStart: number;
  phase: CornerPhase;
  oversteerType: OversteerType | null;
  lapDistPctStart: number | null;
  lapDistPctEnd: number | null;
  lastTime: number;
  samples: number;
  severitySum: number;
  peakSeverity: number;
  peakConfidence: number;
  throttleSum: number;
  brakeSum: number;
  phaseSamples: { ENTRY: number; MID_CORNER: number; EXIT: number; STRAIGHT: number };
};

export class RotationModel {
  private config: RotationModelConfig;
  private readonly baseConfig: RotationModelConfig;
  private calibration: RotationCalibration | null = null;
  private ref: Reference = resolveReference(null);

  // Time and filters (null = not started)
  private prevTime: number | null = null;
  private prevSessionNum: number | null = null;
  private warm = 0;
  private speedF: number | null = null;
  private steerF: number | null = null;
  private yawRateF: number | null = null;
  private vxF: number | null = null;
  private vyF: number | null = null;
  private latAccelF: number | null = null;
  private prevBeta: number | null = null;
  private betaRateF: number | null = null;
  private prevVl: number | null = null;
  private vlDotF: number | null = null;
  private prevSteer: number | null = null;
  private steerRateF: number | null = null;
  private prevYawRate: number | null = null;
  private yawAccelF: number | null = null;
  private refF: number | null = null;
  private prevDeficit: number | null = null;
  private deficitRateF: number | null = null;
  private vertBase: number | null = null;
  private bumpTimer = 0;

  // Slow statistics, kept through resets (cleared by setCalibration)
  private frameScore = 1;
  private latSignEvidence = 0;
  private latAccelPeak = 0;

  // State machine
  private state: RotationState = 'UNKNOWN';
  private stateSince = 0;
  private usEnterTimer = 0;
  private osEnterTimer = 0;
  private usCandidateStart = 0;
  private osCandidateStart = 0;
  private usCandidateSpeed = 0;
  private osCandidateSpeed = 0;
  private usCandidatePhase: CornerPhase = 'STRAIGHT';
  private osCandidatePhase: CornerPhase = 'STRAIGHT';
  private usCandidatePct: number | null = null;
  private osCandidatePct: number | null = null;
  private exitTimer = 0;
  private exitStart = 0;
  private open: OpenEvent | null = null;
  private events: RotationModelEvent[] = [];
  private last: RotationModelResult | null = null;

  constructor(config: RotationModelConfig, calibration: RotationCalibration | null = null) {
    this.baseConfig = config;
    this.config = config;
    this.setCalibration(calibration);
  }

  get calibrationId() {
    return this.calibration?.calibrationId ?? null;
  }

  // A new car (or none): its overrides and yaw reference, and a fresh start
  setCalibration(calibration: RotationCalibration | null) {
    this.calibration = calibration;
    this.config = mergeConfig(this.baseConfig, calibration?.overrides ?? null);
    this.ref = resolveReference(calibration);
    this.reset(this.prevTime, 'reset');
    this.frameScore = 1;
    this.latSignEvidence = 0;
    this.latAccelPeak = 0;
  }

  // Events completed since the last call
  takeEvents(): RotationModelEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  // Ends an event still in progress (end of a stored lap or session)
  finish() {
    if (this.open) this.closeEvent(this.open.lastTime, 'end-of-data');
    this.state = 'UNKNOWN';
  }

  private reset(time: number | null, reason: 'reset' | 'invalid') {
    if (this.open) this.closeEvent(this.open.lastTime, reason);
    this.prevTime = time;
    this.prevSessionNum = null;
    this.warm = 0;
    this.speedF = this.steerF = this.yawRateF = this.vxF = this.vyF = this.latAccelF = null;
    this.prevBeta = this.betaRateF = this.prevVl = this.vlDotF = null;
    this.prevSteer = this.steerRateF = this.prevYawRate = this.yawAccelF = this.refF = this.prevDeficit = this.deficitRateF = null;
    this.vertBase = null;
    this.bumpTimer = 0;
    this.state = 'UNKNOWN';
    this.stateSince = time ?? 0;
    this.usEnterTimer = this.osEnterTimer = this.exitTimer = 0;
  }

  update(s: RotationSample): RotationModelResult {
    const cfg = this.config;
    const t = s.time;
    if (!ok(t)) {
      this.reset(this.prevTime, 'reset');
      return this.unknown(null, 'missing-time');
    }

    let dt = 0;
    if (this.prevTime !== null && this.speedF !== null) {
      dt = t - this.prevTime;
      if (Math.abs(dt) < 1e-9 && this.last) return this.last; // paused, or the same sample again
      if (dt < 0) {
        this.reset(t, 'reset');
        dt = 0;
      } else if (dt > cfg.validity.maxSampleGapSeconds) {
        this.reset(t, 'reset');
        dt = 0;
      }
    }
    if (ok(s.sessionNum) && this.prevSessionNum !== null && s.sessionNum !== this.prevSessionNum) {
      this.reset(t, 'reset');
      dt = 0;
    }
    if (s.isOnTrack === false) {
      this.reset(t, 'reset');
      return this.unknown(t, 'not-driving');
    }
    if (!ok(s.speed) || !ok(s.steeringWheelAngle) || !ok(s.yawRate)) {
      this.reset(t, 'reset');
      return this.unknown(t, 'missing-telemetry');
    }
    this.prevTime = t;
    if (ok(s.sessionNum)) this.prevSessionNum = s.sessionNum;
    const first = this.speedF === null;
    this.warm = first ? 0 : this.warm + dt;

    // 1. Filtered signals
    const f = cfg.filters;
    const v = (this.speedF = lowPass(this.speedF, s.speed, dt, f.speedTau));
    const steer = (this.steerF = lowPass(this.steerF, s.steeringWheelAngle * cfg.conventions.steeringSign, dt, f.steeringTau));
    const r = (this.yawRateF = lowPass(this.yawRateF, s.yawRate, dt, f.yawRateTau));
    const steerRate = (this.steerRateF =
      this.prevSteer === null || dt <= 0 ? 0 : lowPass(this.steerRateF, (steer - this.prevSteer) / dt, dt, f.derivativeTau));
    this.prevSteer = steer;
    const yawAccel = (this.yawAccelF =
      this.prevYawRate === null || dt <= 0 ? 0 : lowPass(this.yawAccelF, (r - this.prevYawRate) / dt, dt, f.derivativeTau));
    this.prevYawRate = r;
    const val = cfg.validity;

    // 2. Vehicle-frame velocity and sideslip
    let vf: number | null = null;
    let vl: number | null = null;
    let beta: number | null = null;
    let betaRate: number | null = null;
    let vlDot: number | null = null;
    let reversing = false;
    let sideslipValid = false;
    const world = cfg.conventions.velocityFrame === 'world';
    if (ok(s.velocityX) && ok(s.velocityY) && (!world || ok(s.yaw))) {
      const vx = (this.vxF = lowPass(this.vxF, s.velocityX, dt, f.velocityTau));
      const vy = (this.vyF = lowPass(this.vyF, s.velocityY, dt, f.velocityTau));
      if (world) {
        const yaw = s.yaw as number;
        vf = vx * Math.cos(yaw) + vy * Math.sin(yaw);
        vl = -vx * Math.sin(yaw) + vy * Math.cos(yaw);
      } else {
        vf = vx;
        vl = vy;
      }
      const magnitudeOk = Math.abs(Math.sqrt(vx * vx + vy * vy) - v) <= val.velocityMagnitudeTolerance * Math.max(v, 5);
      reversing = vf < val.reverseForwardVelocityMps;
      let b = Math.atan2(vl, vf);
      if (this.prevBeta !== null) {
        while (b - this.prevBeta > Math.PI) b -= 2 * Math.PI;
        while (b - this.prevBeta < -Math.PI) b += 2 * Math.PI;
      }
      beta = b;
      betaRate = this.betaRateF =
        this.prevBeta === null || dt <= 0 ? 0 : lowPass(this.betaRateF, (b - this.prevBeta) / dt, dt, f.derivativeTau);
      this.prevBeta = b;
      vlDot = this.vlDotF =
        this.prevVl === null || dt <= 0 ? 0 : lowPass(this.vlDotF, (vl - this.prevVl) / dt, dt, f.derivativeTau);
      this.prevVl = vl;
      if (v >= val.minSpeedMps && dt > 0) {
        this.frameScore = lowPass(this.frameScore, Math.abs(b) * RAD_TO_DEG < val.frameCheckMaxSideslipDeg ? 1 : 0, dt, val.frameCheckTau);
      }
      sideslipValid = magnitudeOk && !reversing && this.frameScore >= val.frameCheckMinScore && v >= val.minSpeedMps;
    } else {
      this.vxF = this.vyF = this.prevBeta = this.betaRateF = this.prevVl = this.vlDotF = null;
    }
    const vRef = sideslipValid ? (vf as number) : v;

    // 3. Steering and the yaw reference
    const ref = this.ref;
    const delta = ref.ratio !== null ? steer / ref.ratio : null;
    const rKin = delta !== null && ref.wheelbase !== null ? (vRef * Math.tan(delta)) / ref.wheelbase : null;
    const rStatic = referenceYawRate(ref, vRef, steer);
    const rRef = (this.refF = rStatic === null ? null : lowPass(this.refF, rStatic, dt, f.yawResponseTau));

    // 4. Lateral acceleration: magnitude, its recent peak, and the kinematic residual
    let ay: number | null = null;
    if (ok(s.latAccel)) {
      ay = this.latAccelF = lowPass(this.latAccelF, s.latAccel, dt, f.latAccelTau);
      const kinematic = vRef * r;
      if (Math.abs(kinematic) >= val.latAccelSignMinLateralMps2) this.latSignEvidence += ay * kinematic * dt;
    } else {
      this.latAccelF = null;
    }
    const ayMagnitude = ay !== null ? Math.abs(ay) : Math.abs(vRef * r);
    this.latAccelPeak = Math.max(ayMagnitude, this.latAccelPeak * Math.exp(-dt / cfg.understeer.latAccelPeakDecayTau));
    const latSign =
      cfg.conventions.latAccelSign === 'auto'
        ? Math.abs(this.latSignEvidence) >= val.latAccelSignMinEvidence
          ? sign(this.latSignEvidence)
          : 0
        : sign(cfg.conventions.latAccelSign);
    const residual = ay !== null && latSign !== 0 && sideslipValid ? latSign * ay - ((vlDot as number) + vRef * r) : null;

    // 5. Bumps
    if (ok(s.vertAccel)) {
      const base = (this.vertBase = lowPass(this.vertBase, s.vertAccel, dt, f.vertBaselineTau));
      if (Math.abs(s.vertAccel - base) > val.bumpVertAccelMps2) this.bumpTimer = val.bumpHoldSeconds;
      else this.bumpTimer = Math.max(0, this.bumpTimer - dt);
    }

    // 6. Axle slip angles (only with the car's geometry and steering ratio)
    let alphaF: number | null = null;
    let alphaR: number | null = null;
    if (sideslipValid && delta !== null && ref.cgFront !== null && ref.cgRear !== null) {
      alphaF = (delta - Math.atan2((vl as number) + ref.cgFront * r, vRef)) * RAD_TO_DEG;
      alphaR = -Math.atan2((vl as number) - ref.cgRear * r, vRef) * RAD_TO_DEG;
    }

    // 7. Can the model judge this sample?
    let reason: string | null = null;
    if (this.warm < val.warmupSeconds) reason = 'warming-up';
    else if (v < val.minSpeedMps) reason = 'low-speed';
    else if (reversing) reason = 'reversing';
    else if (ref.kind === 'none') reason = 'uncalibrated';
    else if (rRef === null) reason = 'outside-calibrated-range';
    else if (this.bumpTimer > 0) reason = 'disturbance';
    else if (residual !== null && Math.abs(residual) > val.maxLatAccelResidualMps2) reason = 'inconsistent-lateral-acceleration';
    const valid = reason === null;

    // 8. Evidence
    const throttle = ok(s.throttle) ? s.throttle : 0;
    const brake = ok(s.brake) ? s.brake : 0;
    const us = cfg.understeer;
    const os = cfg.oversteer;
    const minTurn = val.minTurnYawRate;
    const refValue = rRef ?? 0;
    const absRef = Math.abs(refValue);
    const absR = Math.abs(r);
    const turn = Math.max(absRef, absR) >= minTurn;
    const turnDir = absR >= minTurn ? sign(r) : sign(refValue);
    // Rotating against the driver's steering demand, however slowly: never understeer (it keeps the deficit
    // within 0-1)
    const opposite = r * sign(refValue) < 0;
    const slipOut = sideslipValid ? -(beta as number) * RAD_TO_DEG * turnDir : null;
    const slipOutRate = sideslipValid ? -(betaRate as number) * RAD_TO_DEG * turnDir : null;
    // Opposite lock while the car keeps rotating: the rear is out (sideslip), or without sideslip, the
    // rotation is still building. Unwinding through a quick direction change has neither
    const countersteer =
      absR >= minTurn &&
      steer * sign(r) < -os.countersteerMinRad &&
      (slipOut !== null ? slipOut >= os.sideslipStartDeg : yawAccel * sign(r) >= 0);
    const phase: CornerPhase = !turn ? 'STRAIGHT' : brake >= cfg.phase.brakeOn ? 'ENTRY' : throttle >= cfg.phase.throttleExit ? 'EXIT' : 'MID_CORNER';

    const deficit = absRef >= minTurn && !opposite && !countersteer ? (absRef - r * sign(refValue)) / absRef : 0;
    const deficitRate = (this.deficitRateF =
      this.prevDeficit === null || dt <= 0 ? 0 : lowPass(this.deficitRateF, (deficit - this.prevDeficit) / dt, dt, f.derivativeTau));
    this.prevDeficit = deficit;
    const rr = refValue * turnDir;
    const excess = turn ? (r * turnDir - rr) / Math.max(Math.abs(rr), minTurn) : 0;
    const allowance = phase === 'ENTRY' ? os.entryAllowance : 0;

    const usCore = ramp(deficit, us.yawDeficitStart, us.yawDeficitFull);
    const usSupport = support([
      [ramp(deficitRate, us.growthStartPerSecond, us.growthFullPerSecond), us.weights.growth],
      [ramp(ayMagnitude / Math.max(this.latAccelPeak, us.latAccelPeakMinMps2), us.latAccelPlateauStart, us.latAccelPlateauFull), us.weights.plateau],
      [alphaF !== null && alphaR !== null ? ramp(Math.abs(alphaF) - Math.abs(alphaR), us.frontSlipExcessStartDeg, us.frontSlipExcessFullDeg) : null, us.weights.frontAxle],
    ]);
    const steadiness = 1 - ramp(Math.abs(steerRate), us.steeringRateOkRadPerSec, us.steeringRateMaxRadPerSec);
    let usConfidence = usCore * (us.coreWeight + (1 - us.coreWeight) * usSupport) * steadiness;

    const osCore = countersteer ? 1 : ramp(excess, os.yawExcessStart + allowance, os.yawExcessFull + allowance);
    const osSupport = support([
      [slipOut !== null ? ramp(slipOut, os.sideslipStartDeg, os.sideslipFullDeg) : null, os.weights.sideslip],
      [slipOutRate !== null ? ramp(slipOutRate, os.sideslipRateStartDegPerSec, os.sideslipRateFullDegPerSec) : null, os.weights.sideslipRate],
      [countersteer ? 1 : 0, os.weights.countersteer],
      [alphaR !== null ? ramp(Math.abs(alphaR), os.rearSlipStartDeg, os.rearSlipFullDeg) : null, os.weights.rearAxle],
    ]);
    let osConfidence = osCore * (os.coreWeight + (1 - os.coreWeight) * osSupport);

    let usSeverity = 100 * ramp(deficit, us.yawDeficitStart, us.severityFull);
    let osSeverity =
      100 *
      Math.max(
        countersteer ? 1 : ramp(excess, os.yawExcessStart + allowance, os.severityYawFull + allowance),
        slipOut !== null ? ramp(slipOut, os.sideslipStartDeg, os.severitySideslipFullDeg) : 0
      );
    if (!valid || !turn) {
      usConfidence = osConfidence = usSeverity = osSeverity = 0;
    }

    // 9. State machine
    if (!valid) {
      if (this.state !== 'UNKNOWN') {
        if (this.open) this.closeEvent(t, 'invalid');
        this.state = 'UNKNOWN';
        this.stateSince = t;
      }
      this.usEnterTimer = this.osEnterTimer = this.exitTimer = 0;
    } else {
      const st = cfg.state;
      const pct = ok(s.lapDistPct) ? s.lapDistPct : null;
      if (usConfidence >= st.enterConfidence) {
        if (this.usEnterTimer === 0) {
          this.usCandidateStart = t;
          this.usCandidateSpeed = v;
          this.usCandidatePhase = phase;
          this.usCandidatePct = pct;
        }
        this.usEnterTimer += dt > 0 ? dt : 1e-9;
      } else this.usEnterTimer = 0;
      if (osConfidence >= st.enterConfidence) {
        if (this.osEnterTimer === 0) {
          this.osCandidateStart = t;
          this.osCandidateSpeed = v;
          this.osCandidatePhase = phase;
          this.osCandidatePct = pct;
        }
        this.osEnterTimer += dt > 0 ? dt : 1e-9;
      } else this.osEnterTimer = 0;

      const held = t - this.stateSince;
      const osReady = this.osEnterTimer >= st.enterSeconds;
      const usReady = this.usEnterTimer >= st.enterSeconds && osConfidence < st.exitConfidence;
      if (this.state === 'UNDERSTEER' || this.state === 'OVERSTEER') {
        const confidence = this.state === 'UNDERSTEER' ? usConfidence : osConfidence;
        if (this.state === 'UNDERSTEER' && osReady && held >= st.minHoldSeconds) {
          this.closeEvent(t, 'switched');
          this.enter('OVERSTEER', t);
        } else if (this.state === 'OVERSTEER' && usReady && osConfidence < st.exitConfidence && held >= st.minHoldSeconds) {
          this.closeEvent(t, 'switched');
          this.enter('UNDERSTEER', t);
        } else if (confidence < st.exitConfidence) {
          if (this.exitTimer === 0) this.exitStart = t;
          this.exitTimer += dt > 0 ? dt : 1e-9;
          if (this.exitTimer >= st.exitSeconds) {
            this.closeEvent(this.exitStart, 'recovered');
            this.state = 'NEUTRAL';
            this.stateSince = t;
          }
        } else this.exitTimer = 0;
      } else if (osReady) this.enter('OVERSTEER', t);
      else if (usReady) this.enter('UNDERSTEER', t);
      else if (this.state === 'UNKNOWN') {
        this.state = 'NEUTRAL';
        this.stateSince = t;
      }
    }

    const oversteerType: OversteerType | null =
      this.state !== 'OVERSTEER' ? null : phase === 'ENTRY' ? 'ENTRY' : phase === 'EXIT' ? 'POWER_ON' : 'MID_CORNER';
    if (this.open) {
      const e = this.open;
      const severity = e.type === 'UNDERSTEER' ? usSeverity : osSeverity;
      const confidence = e.type === 'UNDERSTEER' ? usConfidence : osConfidence;
      e.samples++;
      e.severitySum += severity;
      e.peakSeverity = Math.max(e.peakSeverity, severity);
      e.peakConfidence = Math.max(e.peakConfidence, confidence);
      e.throttleSum += throttle;
      e.brakeSum += brake;
      e.phaseSamples[phase]++;
      e.lastTime = t;
      e.lapDistPctEnd = ok(s.lapDistPct) ? s.lapDistPct : e.lapDistPctEnd;
    }

    const state = this.state;
    const result: RotationModelResult = {
      timestamp: t,
      state,
      displayLabel: state === 'UNDERSTEER' ? 'UNDERSTEER' : state === 'OVERSTEER' ? 'OVERSTEER' : '',
      confidence:
        state === 'UNDERSTEER' ? usConfidence : state === 'OVERSTEER' ? osConfidence : state === 'NEUTRAL' ? 1 - Math.max(usConfidence, osConfidence) : 0,
      understeerConfidence: usConfidence,
      oversteerConfidence: osConfidence,
      understeerSeverity: usSeverity,
      oversteerSeverity: osSeverity,
      yawRateActual: r,
      yawRateExpected: rRef,
      yawRateKinematic: rKin,
      yawRateError: rRef === null ? null : r - rRef,
      yawResponseRatio: rRef !== null && absRef >= minTurn ? r / rRef : null,
      forwardVelocityMps: vf,
      lateralVelocityMps: vl,
      sideslipAngleRadians: beta,
      sideslipAngleDegrees: beta === null ? null : beta * RAD_TO_DEG,
      sideslipRateDegreesPerSecond: betaRate === null ? null : betaRate * RAD_TO_DEG,
      frontWheelAngleRadians: delta,
      frontAxleSlipDegrees: alphaF,
      rearAxleSlipDegrees: alphaR,
      latAccelResidual: residual,
      cornerPhase: phase,
      oversteerType,
      capability: sideslipValid ? 'FULL' : 'YAW_ONLY',
      invalidReason: reason,
      modelVersion: cfg.modelVersion,
      calibrationId: this.calibrationId,
      isCalibrated: ref.kind !== 'none',
      isValid: valid,
    };
    this.last = result;
    return result;
  }

  private enter(state: 'UNDERSTEER' | 'OVERSTEER', t: number) {
    const us = state === 'UNDERSTEER';
    this.state = state;
    this.stateSince = t;
    this.exitTimer = 0;
    const phase = us ? this.usCandidatePhase : this.osCandidatePhase;
    const pct = us ? this.usCandidatePct : this.osCandidatePct;
    this.open = {
      type: state,
      startTime: us ? this.usCandidateStart : this.osCandidateStart,
      confirmedTime: t,
      speedAtStart: us ? this.usCandidateSpeed : this.osCandidateSpeed,
      phase,
      oversteerType: us ? null : phase === 'ENTRY' ? 'ENTRY' : phase === 'EXIT' ? 'POWER_ON' : 'MID_CORNER',
      lapDistPctStart: pct,
      lapDistPctEnd: pct,
      lastTime: t,
      samples: 0,
      severitySum: 0,
      peakSeverity: 0,
      peakConfidence: 0,
      throttleSum: 0,
      brakeSum: 0,
      phaseSamples: { ENTRY: 0, MID_CORNER: 0, EXIT: 0, STRAIGHT: 0 },
    };
  }

  private closeEvent(endTime: number, endReason: RotationModelEvent['endReason']) {
    const e = this.open;
    if (!e) return;
    this.open = null;
    const n = Math.max(e.samples, 1);
    this.events.push({
      eventType: e.type,
      startTime: e.startTime,
      confirmedTime: e.confirmedTime,
      endTime,
      durationMs: Math.max(0, (endTime - e.startTime) * 1000),
      peakSeverity: e.peakSeverity,
      averageSeverity: e.severitySum / n,
      peakConfidence: e.peakConfidence,
      speedAtStartMps: e.speedAtStart,
      cornerPhase: e.phase,
      oversteerType: e.oversteerType,
      phaseSamples: e.phaseSamples,
      averageThrottle: e.throttleSum / n,
      averageBrake: e.brakeSum / n,
      lapDistPctStart: e.lapDistPctStart,
      lapDistPctEnd: e.lapDistPctEnd,
      endReason,
      modelVersion: this.config.modelVersion,
      calibrationId: this.calibrationId,
    });
  }

  private unknown(t: number | null, reason: string): RotationModelResult {
    const result: RotationModelResult = {
      timestamp: t,
      state: 'UNKNOWN',
      displayLabel: '',
      confidence: 0,
      understeerConfidence: 0,
      oversteerConfidence: 0,
      understeerSeverity: 0,
      oversteerSeverity: 0,
      yawRateActual: null,
      yawRateExpected: null,
      yawRateKinematic: null,
      yawRateError: null,
      yawResponseRatio: null,
      forwardVelocityMps: null,
      lateralVelocityMps: null,
      sideslipAngleRadians: null,
      sideslipAngleDegrees: null,
      sideslipRateDegreesPerSecond: null,
      frontWheelAngleRadians: null,
      frontAxleSlipDegrees: null,
      rearAxleSlipDegrees: null,
      latAccelResidual: null,
      cornerPhase: 'STRAIGHT',
      oversteerType: null,
      capability: 'YAW_ONLY',
      invalidReason: reason,
      modelVersion: this.config.modelVersion,
      calibrationId: this.calibrationId,
      isCalibrated: this.ref.kind !== 'none',
      isValid: false,
    };
    this.last = null;
    return result;
  }
}
