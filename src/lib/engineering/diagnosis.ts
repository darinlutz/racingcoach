import type { EngineeringRecord, ParameterId, Phase, Symptom } from './knowledgeTypes.ts';
import type { Retrieval } from './retrieval.ts';
import { PARAMETER_LABELS, type CarCapabilities } from './setupCapabilities.ts';

// The diagnosis both the Setup Engineer and the Race Coach work from: one representation of what the driver said,
// what the telemetry measured, what might cause it (driving, setup or conditions), and what to change and how to
// check it. Measured observations, the driver's report, hypotheses and recommendations are kept apart. Confidence is
// a label from how much evidence agrees ('likely', 'possible', 'unconfirmed'), never a probability.
// Pure, so `node --test` runs it (scripts/engineering-knowledge.test.mjs).

type RotationPhase = 'STRAIGHT' | 'ENTRY' | 'MID_CORNER' | 'EXIT';

// What the diagnosis needs of the Rotation Model's session summary (src/lib/rotationAnalysis.ts's SessionRotation),
// written out so this file has no imports from outside the engineering folder
export type RotationEvidence = {
  usableLaps: number;
  understeerEvents: number;
  oversteerEvents: number;
  byPhase: Record<'UNDERSTEER' | 'OVERSTEER', Record<RotationPhase, number>>;
  oversteerTypes: { ENTRY: number; MID_CORNER: number; POWER_ON: number };
  onBrake: { UNDERSTEER: number; OVERSTEER: number };
  onThrottle: { UNDERSTEER: number; OVERSTEER: number };
  // Places it happens lap after lap
  recurring: { eventType: 'UNDERSTEER' | 'OVERSTEER'; cornerPhase: RotationPhase; laps: number }[];
};

export type DiagnosisInput = {
  said: string;
  retrieval: Retrieval;
  capabilities: CarCapabilities;
  allowed: Set<ParameterId>;
  fixed: boolean;
  // Whether it's known that the setup is fixed or open
  setupKnown: boolean;
  rotation: RotationEvidence | null;
  // The newest laps are on cold tires (src/lib/tireWarmup.ts)
  coldTires?: boolean;
};

export type Hypothesis = {
  cause: string;
  kind: 'driving' | 'setup' | 'conditions';
  // What supports it: measured in the laps, said by the driver, or only inferred from engineering knowledge
  support: 'measured' | 'reported' | 'inferred';
  confidence: 'likely' | 'possible' | 'unconfirmed';
  sources: string[];
};

export type SetupRecommendation = {
  parameter: ParameterId;
  label: string;
  direction: string;
  effect: string;
  tradeoff: string;
  inCar: boolean;
  // Whether the parameter is checked for this car or only usual for its class
  verified: boolean;
  source: string;
};

export type Diagnosis = {
  symptom: Symptom | null;
  phase: Phase | null;
  reported: { symptoms: Symptom[]; phases: Phase[] };
  // Measured in the laps; empty when nothing was
  observations: string[];
  conflicts: string[];
  missing: string[];
  hypotheses: Hypothesis[];
  // Which to work on first: the driver, the setup, or neither until the tires are warm
  focus: 'driving' | 'setup' | 'conditions' | 'unknown';
  driverChanges: string[];
  setupChanges: SetupRecommendation[];
  risks: string[];
  validation: string[];
  sources: string[];
};

const PHASE_OF: Record<RotationPhase, Phase> = { STRAIGHT: 'straight', ENTRY: 'entry', MID_CORNER: 'mid', EXIT: 'exit' };
const PHASE_WORD: Record<Phase, string> = { braking: 'under braking', entry: 'on entry', mid: 'mid-corner', exit: 'on exit', straight: 'on the straights', any: '' };

// Diagnosis records hold one symptom in one phase; these are their ids
const DIAGNOSIS_RECORDS: Partial<Record<Symptom, Partial<Record<Phase, string>>>> = {
  understeer: { braking: 'dx-entry-understeer', entry: 'dx-entry-understeer', mid: 'dx-mid-understeer', exit: 'dx-exit-understeer' },
  oversteer: { braking: 'dx-entry-oversteer', entry: 'dx-entry-oversteer', mid: 'dx-mid-oversteer', exit: 'dx-exit-oversteer' },
};

// The measured balance: the type and phase with the most events, or null without any
function measuredBalance(rotation: RotationEvidence | null): { symptom: Symptom; phase: Phase; count: number } | null {
  if (!rotation || rotation.usableLaps === 0) return null;
  let best: { symptom: Symptom; phase: Phase; count: number } | null = null;
  for (const type of ['UNDERSTEER', 'OVERSTEER'] as const) {
    for (const phase of ['ENTRY', 'MID_CORNER', 'EXIT'] as const) {
      const count = rotation.byPhase[type][phase];
      if (count > 0 && (!best || count > best.count)) best = { symptom: type === 'UNDERSTEER' ? 'understeer' : 'oversteer', phase: PHASE_OF[phase], count };
    }
  }
  return best;
}

const isDrivingCause = (cause: string) => /\(driving\)/i.test(cause);
const isConditionCause = (cause: string) => /cold|out lap|stint/i.test(cause);
const cleanCause = (cause: string) => cause.replace(/\s*\(driving( or [^)]*)?\)\s*/i, '').trim();

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { retrieval, rotation } = input;
  const reported = { symptoms: retrieval.query.symptoms, phases: retrieval.query.phases };
  const measured = measuredBalance(rotation);
  const observations: string[] = [];
  const conflicts: string[] = [];
  const missing: string[] = [];

  if (rotation && rotation.usableLaps > 0) {
    observations.push(
      `Rotation Model over ${rotation.usableLaps} lap${rotation.usableLaps === 1 ? '' : 's'}: ${rotation.understeerEvents} understeer and ${rotation.oversteerEvents} oversteer events.`
    );
    for (const r of rotation.recurring.filter((x) => x.laps >= 2).slice(0, 3)) {
      observations.push(`${r.eventType.toLowerCase()} ${PHASE_WORD[PHASE_OF[r.cornerPhase]]} in the same corner on ${r.laps} laps.`);
    }
  } else {
    missing.push(rotation ? 'The Rotation Model could not judge these laps (no calibration for this car, or laps without the channels it needs).' : 'No laps measured this session, so understeer and oversteer are only what the driver reports.');
  }

  // The symptom and phase: what the driver said, else what was measured
  const reportedBalance = reported.symptoms.find((s) => s === 'understeer' || s === 'oversteer') ?? null;
  const symptom: Symptom | null = reportedBalance ?? reported.symptoms[0] ?? measured?.symptom ?? null;
  const reportedPhase = reported.phases.find((p) => p !== 'straight') ?? null;
  const phase: Phase | null = reportedPhase ?? (symptom && measured?.symptom === symptom ? measured.phase : null) ?? null;

  if (reportedBalance && rotation && rotation.usableLaps > 0) {
    const type = reportedBalance === 'understeer' ? 'UNDERSTEER' : 'OVERSTEER';
    const other = type === 'UNDERSTEER' ? 'OVERSTEER' : 'UNDERSTEER';
    const own = reportedBalance === 'understeer' ? rotation.understeerEvents : rotation.oversteerEvents;
    const opposite = reportedBalance === 'understeer' ? rotation.oversteerEvents : rotation.understeerEvents;
    if (own === 0 && opposite > 0) {
      conflicts.push(`The driver reports ${reportedBalance}, but the laps measured ${other.toLowerCase()} and no ${type.toLowerCase()}.`);
    } else if (phase && phase !== 'braking' && phase !== 'any' && phase !== 'straight') {
      const key = phase === 'entry' ? 'ENTRY' : phase === 'mid' ? 'MID_CORNER' : 'EXIT';
      if (own > 0 && rotation.byPhase[type][key] === 0) conflicts.push(`The laps measured ${reportedBalance}, but not ${PHASE_WORD[phase]}.`);
    }
  }
  if (!symptom) missing.push('Neither the driver nor the laps say what the car is doing.');
  if (symptom && !phase && (symptom === 'understeer' || symptom === 'oversteer')) missing.push('Which phase of the corner (entry, mid-corner or exit) is not known.');
  if (!input.setupKnown) missing.push('Whether the setup is fixed or open is not known.');

  // The diagnosis record for this symptom and phase, else the best retrieved one with the symptom
  const records = retrieval.results.map((r) => r.chunk.record).filter((r): r is EngineeringRecord => !!r);
  const wanted = symptom && phase ? DIAGNOSIS_RECORDS[symptom]?.[phase] : undefined;
  const primary =
    records.find((r) => r.id === wanted) ??
    records.find((r) => r.id.startsWith('dx-') && symptom != null && r.symptoms.includes(symptom)) ??
    null;

  // Evidence that points at the driver: understeer on entry with the brakes on, power-on oversteer, one-off events
  const recurring = !!rotation?.recurring.some((r) => r.laps >= 2 && (!symptom || r.eventType.toLowerCase() === symptom));
  const sporadic = !!rotation && rotation.usableLaps >= 3 && !recurring && (rotation.understeerEvents + rotation.oversteerEvents) > 0;
  const measuredDriving: string[] = [];
  if (rotation && symptom === 'understeer' && (phase === 'entry' || phase === 'braking') && rotation.onBrake.UNDERSTEER > 0) {
    measuredDriving.push(`${rotation.onBrake.UNDERSTEER} of the understeer events were with the brake still on`);
  }
  if (rotation && symptom === 'oversteer' && phase === 'exit' && rotation.oversteerTypes.POWER_ON > 0) {
    measuredDriving.push(`${rotation.oversteerTypes.POWER_ON} oversteer events came as the throttle was applied`);
  }
  observations.push(...measuredDriving.map((s) => s.charAt(0).toUpperCase() + s.slice(1) + '.'));

  const hypotheses: Hypothesis[] = [];
  if (input.coldTires) {
    hypotheses.push({ cause: 'Tires and brakes still below working temperature', kind: 'conditions', support: 'measured', confidence: 'likely', sources: ['dx-cold-tires'] });
  }
  for (const cause of primary?.causes ?? []) {
    const kind: Hypothesis['kind'] = isDrivingCause(cause) ? 'driving' : isConditionCause(cause) ? 'conditions' : 'setup';
    let support: Hypothesis['support'] = reportedBalance ? 'reported' : 'inferred';
    let confidence: Hypothesis['confidence'] = 'possible';
    if (kind === 'driving' && measuredDriving.length) {
      support = 'measured';
      confidence = 'likely';
    } else if (kind === 'setup' && recurring) {
      support = 'measured';
      confidence = 'possible';
    } else if (kind === 'setup' && sporadic) {
      confidence = 'unconfirmed';
    } else if (!reportedBalance && !measured) {
      confidence = 'unconfirmed';
    }
    hypotheses.push({ cause: cleanCause(cause), kind, support, confidence, sources: [primary!.id] });
  }
  const order = { likely: 0, possible: 1, unconfirmed: 2 };
  hypotheses.sort((a, b) => order[a.confidence] - order[b.confidence]);

  const focus: Diagnosis['focus'] = input.coldTires
    ? 'conditions'
    : !symptom
      ? 'unknown'
      : measuredDriving.length || sporadic
        ? 'driving'
        : 'setup';

  // Setup changes from the primary record first, then the component records, only parameters the car can use now
  const setupChanges: SetupRecommendation[] = [];
  const seen = new Set<ParameterId>();
  const recordOrder = [primary, ...records.filter((r) => r !== primary)].filter((r): r is EngineeringRecord => !!r);
  for (const record of recordOrder) {
    if (symptom && !record.symptoms.includes(symptom)) continue;
    for (const a of record.adjustments) {
      if (seen.has(a.parameter) || !input.allowed.has(a.parameter)) continue;
      const capability = input.capabilities.capabilities.find((c) => c.parameter === a.parameter);
      seen.add(a.parameter);
      setupChanges.push({
        parameter: a.parameter,
        label: PARAMETER_LABELS[a.parameter],
        direction: a.direction,
        effect: a.effect,
        tradeoff: a.tradeoff,
        inCar: !!capability?.inCar,
        verified: capability?.verification === 'verified',
        source: record.id,
      });
    }
  }
  // In a fixed setup the in-car ones are all there is; otherwise the smallest useful change (in-car) leads too
  setupChanges.sort((a, b) => Number(b.inCar) - Number(a.inCar));
  if (input.coldTires) setupChanges.length = 0;

  const driverChanges = [...(primary?.drivingCorrections ?? [])];
  if (input.coldTires) driverChanges.unshift('Give the tires and brakes a lap or two to come up to temperature before judging the balance.');

  const risks = setupChanges.slice(0, 3).map((c) => `${c.label}: ${c.tradeoff}`);
  const validation = [
    'Drive 3 to 5 laps on warm tires and note the corner\'s time and how the car feels there.',
    'Change one thing, by the smallest step the car allows, then drive the same number of laps.',
    'Compare the same corner: its time, minimum and exit speed, and the understeer and oversteer the laps measure.',
    'Keep the change only if the corner is faster or the car more consistent, and the tradeoff costs nothing elsewhere.',
  ];

  const sources = [...new Set([...(primary ? [primary.id] : []), ...setupChanges.map((c) => c.source), ...hypotheses.flatMap((h) => h.sources)])];
  return { symptom, phase, reported, observations, conflicts, missing, hypotheses: hypotheses.slice(0, 6), focus, driverChanges: driverChanges.slice(0, 3), setupChanges: setupChanges.slice(0, 4), risks, validation, sources };
}

// The diagnosis as lines of facts for an agent's prompt
export function diagnosisFacts(d: Diagnosis): string[] {
  const lines = ['Structured diagnosis (from the knowledge base and the measured laps):'];
  lines.push(`Symptom: ${d.symptom ?? 'unknown'}${d.phase ? `, ${PHASE_WORD[d.phase] || d.phase}` : ''}.`);
  if (d.observations.length) lines.push('Measured: ' + d.observations.join(' '));
  if (d.conflicts.length) lines.push('Conflicting evidence: ' + d.conflicts.join(' '));
  if (d.missing.length) lines.push('Not known: ' + d.missing.join(' '));
  lines.push(
    `Work on first: ${d.focus === 'driving' ? 'driving technique' : d.focus === 'setup' ? 'the setup' : d.focus === 'conditions' ? 'nothing until the tires are warm' : 'find out what the car is doing'}.`
  );
  if (d.hypotheses.length) {
    lines.push('Possible causes (confidence from how much evidence agrees, not a probability):');
    for (const h of d.hypotheses) lines.push(`- ${h.cause} [${h.kind}; ${h.confidence}; ${h.support}]`);
  }
  if (d.driverChanges.length) lines.push('Driving changes: ' + d.driverChanges.join(' '));
  if (d.setupChanges.length) {
    lines.push('Setup changes this car can make now (smallest first; * = usual for the class, not checked for this car):');
    for (const c of d.setupChanges) lines.push(`- ${c.label}${c.verified ? '' : '*'}${c.inCar ? ' (in-car)' : ''}: ${c.direction}; ${c.effect}; tradeoff: ${c.tradeoff}`);
  } else {
    lines.push('No setup change in the knowledge base applies to this car in this session.');
  }
  lines.push('How to check a change: ' + d.validation.join(' '));
  return lines;
}
