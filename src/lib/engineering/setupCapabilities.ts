import type { CarClass, ParameterId, SimulatorId } from './knowledgeTypes.ts';

// Which setup parameters exist for a simulator, car class and (when known) car, and which of them the driver can
// change from the cockpit. The Setup Engineer only suggests parameters listed here, and in a fixed setup only the
// in-car ones (setupAnswerGuard.ts checks its answers). This is structured data, never retrieved by embeddings:
// the database copy ("EngineeringSetupCapabilities", see knowledgeSchema.ts) is seeded from these defaults and can be
// overridden per car on the Admin page once someone has checked the car's garage.
//
// 'class_typical' means the parameter is normally in that class's garage in that simulator but hasn't been checked
// for the exact car: agents say "if your car has it" rather than asserting it. 'verified' is a person having checked
// the car's garage. No ranges or click counts are recorded here: none are verified.
// No imports beyond types, so `node --test` runs it directly.

export type CapabilityVerification = 'verified' | 'class_typical' | 'unverified';

export type SetupCapability = {
  parameter: ParameterId;
  // Changeable from the cockpit while driving (and so in a fixed-setup session)
  inCar: boolean;
  // Changeable in the garage on an open setup
  garage: boolean;
  verification: CapabilityVerification;
  // Optional note, e.g. how the car labels it
  note?: string;
  // Exact range, only when verified for the car; never filled from guesses
  range?: { min: number; max: number; step: number; unit: string } | null;
};

export const PARAMETER_LABELS: Record<ParameterId, string> = {
  brakeBias: 'brake bias',
  abs: 'ABS setting',
  tractionControl: 'traction control setting',
  engineMap: 'engine map',
  tirePressure: 'tire pressures',
  springs: 'springs',
  bumpDamping: 'bump damping',
  reboundDamping: 'rebound damping',
  antiRollBarFront: 'front anti-roll bar',
  antiRollBarRear: 'rear anti-roll bar',
  rideHeight: 'ride height / rake',
  bumpStops: 'bump stops',
  camber: 'camber',
  caster: 'caster',
  toe: 'toe',
  rearWing: 'rear wing',
  frontSplitter: 'front splitter',
  diffPreload: 'differential preload',
  diffRamps: 'differential ramps / locking',
  brakePressure: 'brake pressure',
  brakeDucts: 'brake ducts',
};

const cap = (parameter: ParameterId, inCar: boolean, garage = true, note?: string): SetupCapability => ({
  parameter,
  inCar,
  garage,
  verification: 'class_typical',
  ...(note ? { note } : {}),
});

const GT_GARAGE: SetupCapability[] = [
  cap('tirePressure', false),
  cap('springs', false),
  cap('bumpDamping', false),
  cap('reboundDamping', false),
  cap('antiRollBarFront', false),
  cap('antiRollBarRear', false),
  cap('rideHeight', false),
  cap('camber', false),
  cap('toe', false),
  cap('rearWing', false),
];

// Class defaults per simulator. A class with no entry has unknown capabilities: the agent may only name parameter
// families as "if your car has it" (capabilitiesFor's known: false).
const DEFAULTS: Partial<Record<SimulatorId, Partial<Record<CarClass, SetupCapability[]>>>> = {
  iracing: {
    GT3: [
      cap('brakeBias', true),
      cap('abs', true),
      cap('tractionControl', true),
      ...GT_GARAGE,
      cap('caster', false),
      cap('diffPreload', false),
      cap('brakePressure', false, true, 'brake pressure / master cylinder, where the car has it'),
    ],
    GT4: [cap('brakeBias', true), cap('abs', true), cap('tractionControl', true), ...GT_GARAGE, cap('diffPreload', false)],
  },
  acc: {
    GT3: [
      cap('brakeBias', true),
      cap('abs', true),
      cap('tractionControl', true, true, 'ACC cars often have TC1 and TC2'),
      cap('engineMap', true),
      ...GT_GARAGE,
      cap('caster', false),
      cap('bumpStops', false),
      cap('frontSplitter', false),
      cap('diffPreload', false),
      cap('brakePressure', false),
      cap('brakeDucts', false),
    ],
    GT4: [
      cap('brakeBias', true),
      cap('abs', true),
      cap('tractionControl', true),
      cap('engineMap', true),
      ...GT_GARAGE,
      cap('bumpStops', false),
      cap('diffPreload', false),
      cap('brakeDucts', false),
    ],
  },
};

// The car's class from its name (iRacing's and ACC's names, and Car Data's), or Other
export function carClassOf(car: string | null | undefined): CarClass {
  const name = (car ?? '').toLowerCase();
  if (!name) return 'Other';
  if (/\bgt3\b|gt3 r\b|evo2? gt3|\bgt3 evo/.test(name)) return 'GT3';
  if (/\bgt4\b/.test(name)) return 'GT4';
  if (/\bgtp\b|lmdh|\bgtp\b|963|v-series\.r|arx-06|lmh\b/.test(name)) return 'GTP';
  if (/lmp2|dallara p217|oreca 07/.test(name)) return 'LMP2';
  if (/\btcr\b/.test(name)) return 'TCR';
  if (/formula|\bf[234]\b|\bf1\b|super formula|indycar|dallara ir|fr2\.0|\bfr\b|skip barber|ray ff/.test(name)) return 'Formula';
  if (/nascar|cup series|xfinity|truck|arca|late model|street stock/.test(name)) return 'Stock';
  return 'Other';
}

// A lowercase key for matching knowledge to a car, with accents and punctuation taken out
export function carMatchKey(car: string | null | undefined): string {
  return (car ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Whether a knowledge record's car key (e.g. 'porsche 911 gt3 r') names this car: every word of the key appears in
// the car's name, so 'Porsche 911 GT3 R (992)' matches and 'Porsche 911 GT3 Cup (992)' doesn't
export function carMatches(recordCar: string, car: string | null | undefined): boolean {
  const words = new Set(carMatchKey(car).split(' ').filter(Boolean));
  const need = carMatchKey(recordCar).split(' ').filter(Boolean);
  return need.length > 0 && need.every((word) => words.has(word));
}

export type CarCapabilities = {
  simulator: SimulatorId;
  carClass: CarClass;
  car: string | null;
  // False when nothing is known for this simulator and class
  known: boolean;
  capabilities: SetupCapability[];
};

// The car's setup capabilities: a per-car override (from the database) when given, else the class default
export function capabilitiesFor(
  simulator: SimulatorId,
  car: string | null | undefined,
  overrides: { car: string; capabilities: SetupCapability[] }[] = []
): CarCapabilities {
  const carClass = carClassOf(car);
  const own = overrides.find((o) => carMatches(o.car, car));
  const capabilities = own?.capabilities ?? DEFAULTS[simulator]?.[carClass] ?? [];
  return { simulator, carClass, car: car ?? null, known: capabilities.length > 0, capabilities };
}

// The parameters a recommendation may use: in a fixed setup only the in-car ones
export function allowedParameters(caps: CarCapabilities, fixed: boolean): Set<ParameterId> {
  return new Set(caps.capabilities.filter((c) => (fixed ? c.inCar : c.inCar || c.garage)).map((c) => c.parameter));
}

// Lines of facts about the car's setup options, for an agent's prompt
export function capabilityFacts(caps: CarCapabilities, fixed: boolean): string[] {
  if (!caps.known) {
    return [
      `Setup options for this car (${caps.carClass} class in ${caps.simulator}) are not in the knowledge base: name a ` +
        'setup change only as "if your car has it", and prefer brake bias and driving changes.',
    ];
  }
  const list = (items: SetupCapability[]) =>
    items.map((c) => PARAMETER_LABELS[c.parameter] + (c.verification === 'verified' ? '' : '*')).join(', ');
  const inCar = caps.capabilities.filter((c) => c.inCar);
  const garage = caps.capabilities.filter((c) => c.garage && !c.inCar);
  const facts = [`In-car adjustments: ${list(inCar) || 'none known'}.`];
  facts.push(fixed ? 'Garage changes are locked in this fixed-setup session.' : `Garage adjustments: ${list(garage) || 'none known'}.`);
  if (caps.capabilities.some((c) => c.verification !== 'verified')) {
    facts.push('* = usual for this class in this simulator but not checked for this exact car: say "if your car has it".');
  }
  return facts;
}
