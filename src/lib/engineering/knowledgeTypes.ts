// The Race Engineering knowledge base's record shape, shared by the starter corpus (starterCorpus.ts), the ingestion
// pipeline (ingestion.ts, scripts/engineeringKnowledge.mjs), retrieval (retrieval.ts) and the diagnosis engine
// (diagnosis.ts). No imports, so `node --test` runs it directly (scripts/engineering-knowledge.test.mjs).
// docs/race-engineering-rag.md describes the whole system.

export const SIMULATORS = ['iracing', 'acc'] as const;
export type SimulatorId = (typeof SIMULATORS)[number];

// The car classes the knowledge and setup capabilities know about; carClassOf in setupCapabilities.ts works one out
export const CAR_CLASSES = ['GT3', 'GT4', 'GTP', 'LMP2', 'TCR', 'Formula', 'Stock', 'Other'] as const;
export type CarClass = (typeof CAR_CLASSES)[number];

export const COMPONENTS = [
  'vehicleDynamics',
  'suspension',
  'springs',
  'dampers',
  'antiRollBars',
  'rideHeight',
  'alignment',
  'braking',
  'abs',
  'tractionControl',
  'differential',
  'tires',
  'aero',
  'driving',
] as const;
export type Component = (typeof COMPONENTS)[number];

// Where in a corner (or on track) a symptom happens; matches the Rotation Model's phases
export const PHASES = ['braking', 'entry', 'mid', 'exit', 'straight', 'any'] as const;
export type Phase = (typeof PHASES)[number];

export const SYMPTOMS = [
  'understeer',
  'oversteer',
  'brakingInstability',
  'brakeLocking',
  'absIntervention',
  'poorTraction',
  'tcIntervention',
  'bottoming',
  'aeroInstability',
  'tireOverheating',
  'tireWear',
  'coldTires',
  'snapOversteer',
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

// How much a record can be relied on. Only 'car_verified' may state car-specific facts as facts; 'hypothesis'
// records are things to confirm with telemetry, never conclusions.
export const AUTHORITIES = ['general_principle', 'simulator_specific', 'car_class', 'car_verified', 'hypothesis'] as const;
export type Authority = (typeof AUTHORITIES)[number];

// Who has checked a record. 'ai_drafted' content was written with an AI model and hasn't been reviewed by a person:
// agents get it as general guidance, never as authoritative car data (retrieval.ts labels it so).
export const VERIFICATIONS = ['reviewed', 'ai_drafted', 'unverified', 'rejected'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const LICENSES = ['original', 'cc-by', 'permitted', 'public-docs-link-only', 'unknown'] as const;
export type License = (typeof LICENSES)[number];

export type KnowledgeSource = {
  // Stable id, e.g. 'racingcoach-original'
  key: string;
  title: string;
  // Where it can be read; never a guessed URL
  url: string | null;
  kind: 'original' | 'book' | 'simulator_manual' | 'manufacturer' | 'article' | 'other';
  license: License;
  // Who wrote or published it
  publisher: string | null;
};

// A setup parameter family (setupCapabilities.ts lists which exist for each simulator and class)
export type ParameterId =
  | 'brakeBias'
  | 'abs'
  | 'tractionControl'
  | 'engineMap'
  | 'tirePressure'
  | 'springs'
  | 'bumpDamping'
  | 'reboundDamping'
  | 'antiRollBarFront'
  | 'antiRollBarRear'
  | 'rideHeight'
  | 'bumpStops'
  | 'camber'
  | 'caster'
  | 'toe'
  | 'rearWing'
  | 'frontSplitter'
  | 'diffPreload'
  | 'diffRamps'
  | 'brakePressure'
  | 'brakeDucts';

export type Adjustment = {
  parameter: ParameterId;
  // Which way to move it, in words ("softer front", "more to the rear"); never a number unless verified for the car
  direction: string;
  effect: string;
  tradeoff: string;
};

export type EngineeringRecord = {
  // Stable id; a new version of a record keeps its id and bumps version
  id: string;
  version: number;
  title: string;
  authority: Authority;
  verification: Verification;
  // ['any'] or specific simulators / classes / cars (cars by a lowercase match key, e.g. 'huracan gt3')
  simulators: (SimulatorId | 'any')[];
  carClasses: (CarClass | 'any')[];
  cars: string[];
  components: Component[];
  phases: Phase[];
  symptoms: Symptom[];
  // The body of the record, written as an explanation
  summary: string;
  causes: string[];
  // What in the lap telemetry shows it, by channel names the laps have (Brake, Throttle, SteeringWheelAngle,
  // YawRate, VelocityX/VelocityY, LatAccel, LongAccel, Speed, ABSActive, tire temps, pressures, ride heights, RPM)
  telemetryIndicators: string[];
  adjustments: Adjustment[];
  // Driving technique corrections, for when the driver rather than the car is the cause
  drivingCorrections: string[];
  constraints: string[];
  sources: string[];
};
