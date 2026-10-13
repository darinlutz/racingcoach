// Post-session Rotation Model analysis: runs src/lib/rotationModel.ts (the same model, settings and calibrations
// as the collector's live overlay) over recorded lap CSVs, and sums up the understeer and oversteer events.
// Imports with .ts extensions so Node can run it directly too (scripts/rotation-calibrate.mjs).

import {
  RotationModel,
  type CornerPhase,
  type RotationCalibration,
  type RotationCapability,
  type RotationModelConfig,
  type RotationModelEvent,
  type RotationSample,
} from './rotationModel.ts';

// Without these the model can't run at all
const REQUIRED_COLUMNS = ['SessionTime', 'Speed', 'SteeringWheelAngle', 'YawRate'];

export type LapSamples = { samples: RotationSample[]; columns: string[]; missing: string[] };

// A lap CSV as the collector writes it (iRacing's names and units) as model samples. Cells that are empty or
// missing are null; nothing is filled in. Garage 61 exports have no SessionTime, so missing lists it.
export function rotationSamplesFromCsv(csv: string): LapSamples {
  const lines = csv.split(/\r?\n/);
  const columns = (lines[0] ?? '').split(',').map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) return { samples: [], columns, missing };

  const index = (name: string) => columns.indexOf(name);
  const at = {
    time: index('SessionTime'),
    speed: index('Speed'),
    steer: index('SteeringWheelAngle'),
    yawRate: index('YawRate'),
    yaw: index('Yaw'),
    vx: index('VelocityX'),
    vy: index('VelocityY'),
    lat: index('LatAccel'),
    long: index('LongAccel'),
    vert: index('VertAccel'),
    throttle: index('Throttle'),
    brake: index('Brake'),
    pct: index('LapDistPct'),
  };
  const samples: RotationSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cells = lines[i].split(',');
    const num = (column: number) => {
      if (column < 0) return null;
      const text = (cells[column] ?? '').trim();
      if (text === '') return null;
      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    };
    samples.push({
      time: num(at.time),
      speed: num(at.speed),
      steeringWheelAngle: num(at.steer),
      yawRate: num(at.yawRate),
      yaw: num(at.yaw),
      velocityX: num(at.vx),
      velocityY: num(at.vy),
      latAccel: num(at.lat),
      longAccel: num(at.long),
      vertAccel: num(at.vert),
      throttle: num(at.throttle),
      brake: num(at.brake),
      lapDistPct: num(at.pct),
    });
  }
  return { samples, columns, missing };
}

export type RotationSummary = {
  understeerEvents: number;
  oversteerEvents: number;
  understeerSeconds: number;
  oversteerSeconds: number;
  averageUndersteerSeverity: number | null;
  averageOversteerSeverity: number | null;
  maxUndersteerSeverity: number | null;
  maxOversteerSeverity: number | null;
  // Events by the corner phase they started in
  byPhase: Record<'UNDERSTEER' | 'OVERSTEER', Record<CornerPhase, number>>;
  // Events that started on the brakes (Brake ≥ the config's brakeOn) / on the throttle (≥ throttleExit)
  onBrake: Record<'UNDERSTEER' | 'OVERSTEER', number>;
  onThrottle: Record<'UNDERSTEER' | 'OVERSTEER', number>;
  oversteerTypes: Record<'ENTRY' | 'MID_CORNER' | 'POWER_ON', number>;
};

export type LapRotation = {
  lapId: number | string;
  lapNumber: number | null;
  car: string | null;
  // false when the CSV lacks what the model needs, or the car isn't calibrated
  supported: boolean;
  reason: string | null;
  capability: RotationCapability | null; // YAW_ONLY for laps recorded before VelocityX/VelocityY were saved
  calibrationId: string | null;
  modelVersion: string;
  // Share of samples the model could judge (fast enough, calibrated, no bumps, ...)
  validShare: number;
  events: RotationModelEvent[];
  summary: RotationSummary;
};

// The same place on several laps: events that keep happening there
export type RecurringRotationIssue = {
  eventType: 'UNDERSTEER' | 'OVERSTEER';
  lapDistPct: number;
  laps: number;
  events: number;
  averageSeverity: number;
  cornerPhase: CornerPhase;
};

export type SessionRotation = {
  laps: LapRotation[];
  summary: RotationSummary;
  recurring: RecurringRotationIssue[];
};

// Events within this much of a lap of each other are the same place on track
const SAME_PLACE_PCT = 0.01;

export function summarizeRotationEvents(events: RotationModelEvent[], config: RotationModelConfig): RotationSummary {
  const of = (type: 'UNDERSTEER' | 'OVERSTEER') => events.filter((e) => e.eventType === type);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const phases = (list: RotationModelEvent[]) => {
    const counts: Record<CornerPhase, number> = { STRAIGHT: 0, ENTRY: 0, MID_CORNER: 0, EXIT: 0 };
    for (const e of list) counts[e.cornerPhase]++;
    return counts;
  };
  const us = of('UNDERSTEER');
  const os = of('OVERSTEER');
  const types = { ENTRY: 0, MID_CORNER: 0, POWER_ON: 0 };
  for (const e of os) if (e.oversteerType) types[e.oversteerType]++;
  const onBrake = (list: RotationModelEvent[]) => list.filter((e) => e.averageBrake >= config.phase.brakeOn).length;
  const onThrottle = (list: RotationModelEvent[]) => list.filter((e) => e.averageThrottle >= config.phase.throttleExit).length;
  return {
    understeerEvents: us.length,
    oversteerEvents: os.length,
    understeerSeconds: us.reduce((a, e) => a + e.durationMs / 1000, 0),
    oversteerSeconds: os.reduce((a, e) => a + e.durationMs / 1000, 0),
    averageUndersteerSeverity: mean(us.map((e) => e.averageSeverity)),
    averageOversteerSeverity: mean(os.map((e) => e.averageSeverity)),
    maxUndersteerSeverity: max(us.map((e) => e.peakSeverity)),
    maxOversteerSeverity: max(os.map((e) => e.peakSeverity)),
    byPhase: { UNDERSTEER: phases(us), OVERSTEER: phases(os) },
    onBrake: { UNDERSTEER: onBrake(us), OVERSTEER: onBrake(os) },
    onThrottle: { UNDERSTEER: onThrottle(us), OVERSTEER: onThrottle(os) },
    oversteerTypes: types,
  };
}

// One lap through the model. The model starts fresh on each lap (its filters warm up in the first 0.3 s).
export function analyzeRotationLap(
  lap: { id: number | string; lapNumber?: number | null; car?: string | null; csv: string },
  config: RotationModelConfig,
  calibration: RotationCalibration | null
): LapRotation {
  const base = {
    lapId: lap.id,
    lapNumber: lap.lapNumber ?? null,
    car: lap.car ?? null,
    calibrationId: calibration?.calibrationId ?? null,
    modelVersion: config.modelVersion,
  };
  const { samples, missing } = rotationSamplesFromCsv(lap.csv);
  if (missing.length > 0) {
    return { ...base, supported: false, reason: `missing columns: ${missing.join(', ')}`, capability: null, validShare: 0, events: [], summary: summarizeRotationEvents([], config) };
  }
  if (!calibration) {
    return { ...base, supported: false, reason: 'uncalibrated', capability: null, validShare: 0, events: [], summary: summarizeRotationEvents([], config) };
  }

  const model = new RotationModel(config, calibration);
  const events: RotationModelEvent[] = [];
  let valid = 0;
  let full = 0;
  for (const sample of samples) {
    const result = model.update(sample);
    if (result.isValid) valid++;
    if (result.capability === 'FULL') full++;
    events.push(...model.takeEvents());
  }
  model.finish();
  events.push(...model.takeEvents());
  return {
    ...base,
    supported: true,
    reason: null,
    // Laps saved before the collector recorded VelocityX/VelocityY have no sideslip
    capability: full > 0 ? 'FULL' : 'YAW_ONLY',
    validShare: samples.length ? valid / samples.length : 0,
    events,
    summary: summarizeRotationEvents(events, config),
  };
}

// Several laps (e.g. a session), with what keeps happening at the same place lap after lap
export function analyzeRotationSession(
  laps: { id: number | string; lapNumber?: number | null; car?: string | null; csv: string }[],
  config: RotationModelConfig,
  calibrationFor: (car: string | null) => RotationCalibration | null
): SessionRotation {
  const results = laps.map((lap) => analyzeRotationLap(lap, config, calibrationFor(lap.car ?? null)));
  const all = results.flatMap((r) => r.events.map((e) => ({ lap: r.lapId, e })));

  // Group events of one type whose start is within SAME_PLACE_PCT (around the start/finish line too)
  const recurring: RecurringRotationIssue[] = [];
  for (const type of ['UNDERSTEER', 'OVERSTEER'] as const) {
    const placed = all.filter(({ e }) => e.eventType === type && e.lapDistPctStart !== null).sort((a, b) => (a.e.lapDistPctStart as number) - (b.e.lapDistPctStart as number));
    const groups: (typeof placed)[] = [];
    for (const item of placed) {
      const group = groups.at(-1);
      if (group && (item.e.lapDistPctStart as number) - (group.at(-1)!.e.lapDistPctStart as number) <= SAME_PLACE_PCT) group.push(item);
      else groups.push([item]);
    }
    if (groups.length > 1) {
      const first = groups[0];
      const last = groups.at(-1)!;
      if ((first[0].e.lapDistPctStart as number) + 1 - (last.at(-1)!.e.lapDistPctStart as number) <= SAME_PLACE_PCT) {
        groups[0] = [...last, ...first];
        groups.pop();
      }
    }
    for (const group of groups) {
      const lapsInGroup = new Set(group.map((g) => g.lap)).size;
      if (lapsInGroup < 2) continue;
      const phases = new Map<CornerPhase, number>();
      for (const { e } of group) phases.set(e.cornerPhase, (phases.get(e.cornerPhase) ?? 0) + 1);
      // Mean position on the circle of the lap, so a group across the line doesn't average to mid-lap
      const angle = Math.atan2(
        group.reduce((a, { e }) => a + Math.sin(2 * Math.PI * (e.lapDistPctStart as number)), 0),
        group.reduce((a, { e }) => a + Math.cos(2 * Math.PI * (e.lapDistPctStart as number)), 0)
      );
      recurring.push({
        eventType: type,
        lapDistPct: ((angle / (2 * Math.PI)) % 1 + 1) % 1,
        laps: lapsInGroup,
        events: group.length,
        averageSeverity: group.reduce((a, { e }) => a + e.averageSeverity, 0) / group.length,
        cornerPhase: [...phases.entries()].sort((a, b) => b[1] - a[1])[0][0],
      });
    }
  }
  recurring.sort((a, b) => b.laps - a.laps || b.averageSeverity - a.averageSeverity);

  return {
    laps: results,
    summary: summarizeRotationEvents(
      all.map(({ e }) => e),
      config
    ),
    recurring,
  };
}
