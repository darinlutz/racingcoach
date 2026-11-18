// The Setups page's Brakes tab (src/components/BrakeEngineeringView.tsx): the brake system of two setups of the same
// car, found by parameter path in Compare's rows (setupCompare.ts), the hydraulics worked out from them, and what the
// drawings need. Pure, with no React, so Node runs it (scripts/brakes.test.mjs); the words are the dictionaries'
// (setups.brakes), so nothing here is shown as it is except the values.
//
// What iRacing's CarSetup gives (scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml): the master cylinder bores
// (Chassis.FrontBrakes.FrontMasterCyl: 17.8 mm, RearMasterCyl: 17.8 mm), the pad compound (BrakePads: Medium friction),
// the brake pressure bias (Chassis.InCarAdjustments.BrakePressureBias: 51.00%) and the ABS setting (AbsSetting: 3 (ABS)).
// Some cars give a night LED strip color, which is lighting and is kept out of every brake calculation.
//
// iRacing's BrakePressureBias is the front's share of the brake line pressure, so it alone is split into front and
// rear; any other bias key's convention isn't known, so it's shown but never split. Master cylinder hydraulics follow
// from the bore only (area = π(d/2)², pressure = force / area, travel for one fluid volume ∝ 1 / area) and are worked
// out in millimeters only, for a hypothetical piston force: the pedal ratio and the balance bar's geometry aren't in
// the setup, so no pedal force, line pressure or braking torque is ever claimed. An ABS setting is a position, not an
// intervention strength, and a pad compound's friction isn't given.
import { readValue } from './setupYaml.ts';
import { CORNERS, type Corner, type DisplayMode } from './alignmentGeometry.ts';

export { CORNERS, type Corner, type DisplayMode };
export { EXAGGERATIONS, DEFAULT_EXAGGERATION } from './alignmentGeometry.ts';

export type BrakeParam = 'frontMaster' | 'rearMaster' | 'bias' | 'abs' | 'pads' | 'led' | 'other';
export type BrakeUnit = 'mm' | 'in' | '%' | 'setting' | 'text';

const EPSILON = 1e-9;

export type BrakeValue = {
  // Exactly as iRacing wrote it
  raw: string;
  // null for text (a pad compound, an LED color)
  value: number | null;
  unit: BrakeUnit;
  decimals: number;
};

export type BrakeStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'unitsDiffer' | 'unsupported';

export type BrakeItem = {
  id: string;
  param: BrakeParam;
  path: string;
  key: string;
  baselineRaw: string | null;
  comparisonRaw: string | null;
  baseline: BrakeValue | null;
  comparison: BrakeValue | null;
  // Comparison minus baseline, for numbers in one unit (a bias in percentage points)
  delta: { value: number; unit: BrakeUnit; decimals: number } | null;
  status: BrakeStatus;
  // The bias is iRacing's front share of the line pressure, so it splits into front and rear
  frontPercentage: boolean;
};

export type BrakeComparison = {
  items: BrakeItem[];
  unsupported: BrakeItem[];
  // Changes that matter to braking (the LED strip's color isn't one)
  changedCount: number;
};

// What a comparison row needs to have (setupCompare.ts's CompareRow fits)
export type BrakeSourceRow = {
  path: string;
  group: string | null;
  section: string;
  key: string;
  kind: 'setting' | 'reading';
  baseline: string | null;
  comparison: string | null;
};

function paramOf(key: string, path: string): BrakeParam | null {
  if (/^Front(?:Brake)?MasterCyl(?:inder)?(?:Size|Bore)?$/i.test(key)) return 'frontMaster';
  if (/^Rear(?:Brake)?MasterCyl(?:inder)?(?:Size|Bore)?$/i.test(key)) return 'rearMaster';
  if (/^(?:Brake(?:Pressure)?Bias|BrakeBalance|FrontBrakeBias)$/i.test(key)) return 'bias';
  if (/^Abs(?:Setting)?$/i.test(key)) return 'abs';
  if (/^(?:Brake)?Pads?(?:Compound)?$/i.test(key) && (/brake/i.test(key) || /brake/i.test(path))) return 'pads';
  if (/Led/i.test(key) && /(Color|Colour|Strip)/i.test(key)) return 'led';
  // Anything else about the brakes (ducts, a brake bias migration ...), kept as it's written
  if (/Brake/i.test(key) && !/Cooling/i.test(path) && !/Bias/i.test(key)) return 'other';
  if (/^BrakeBias/i.test(key)) return 'other';
  return null;
}

const UNITS: Record<BrakeParam, BrakeUnit[]> = {
  frontMaster: ['mm', 'in'],
  rearMaster: ['mm', 'in'],
  bias: ['%'],
  abs: ['setting'],
  pads: ['text'],
  led: ['text'],
  other: ['mm', 'in', '%', 'setting', 'text'],
};

function unitOf(unit: string | null): BrakeUnit | null {
  if (!unit) return 'setting';
  const u = unit.trim().toLowerCase();
  if (u === 'mm') return 'mm';
  if (u === 'in' || u === 'inch' || u === 'inches') return 'in';
  if (u === '%') return '%';
  return null;
}

// One raw value read for its parameter; 'unsupported' when it can't be read that way
export function readBrakeValue(raw: string | null, param: BrakeParam): BrakeValue | null | 'unsupported' {
  if (raw == null) return null;
  const text = raw.trim();
  if (param === 'pads' || param === 'led') return text ? { raw, value: null, unit: 'text', decimals: 0 } : 'unsupported';
  const read = readValue(text);
  if (read.value == null) return param === 'other' && text ? { raw, value: null, unit: 'text', decimals: 0 } : 'unsupported';
  const unit = unitOf(read.unit);
  if (!unit || !UNITS[param].includes(unit)) return param === 'other' ? { raw, value: null, unit: 'text', decimals: 0 } : 'unsupported';
  if ((param === 'frontMaster' || param === 'rearMaster') && read.value <= 0) return 'unsupported';
  if (param === 'bias' && (read.value < 0 || read.value > 100)) return 'unsupported';
  return { raw, value: read.value, unit, decimals: read.decimals };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function compareBrakes(rows: readonly BrakeSourceRow[]): BrakeComparison {
  const items: BrakeItem[] = [];
  const unsupported: BrakeItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'setting') continue;
    const param = paramOf(row.key, row.path);
    if (!param) continue;
    const id = param === 'other' ? `other.${row.path}` : param;
    const a = readBrakeValue(row.baseline, param);
    const b = readBrakeValue(row.comparison, param);
    const item: BrakeItem = {
      id,
      param,
      path: row.path,
      key: row.key,
      baselineRaw: row.baseline,
      comparisonRaw: row.comparison,
      baseline: a === 'unsupported' ? null : a,
      comparison: b === 'unsupported' ? null : b,
      delta: null,
      status: 'same',
      frontPercentage: param === 'bias' && /^BrakePressureBias$/i.test(row.key),
    };
    if (seen.has(id) || a === 'unsupported' || b === 'unsupported') {
      unsupported.push({ ...item, status: 'unsupported' });
      continue;
    }
    seen.add(id);
    const x = item.baseline;
    const y = item.comparison;
    if (!x) item.status = 'onlyComparison';
    else if (!y) item.status = 'onlyBaseline';
    else if (x.unit !== y.unit) item.status = 'unitsDiffer';
    else if (x.value == null || y.value == null) item.status = x.raw.trim().toLowerCase() === y.raw.trim().toLowerCase() ? 'same' : 'changed';
    else {
      const value = round(y.value - x.value);
      item.delta = { value, unit: x.unit, decimals: Math.max(x.decimals, y.decimals) };
      item.status = Math.abs(value) < EPSILON ? 'same' : 'changed';
    }
    items.push(item);
  }
  const order: BrakeParam[] = ['bias', 'frontMaster', 'rearMaster', 'pads', 'abs', 'other', 'led'];
  items.sort((p, q) => order.indexOf(p.param) - order.indexOf(q.param));
  return { items, unsupported, changedCount: items.filter((i) => i.status !== 'same' && i.param !== 'led').length };
}

export function findItem(comparison: BrakeComparison, param: Exclude<BrakeParam, 'other'>): BrakeItem | null {
  return comparison.items.find((i) => i.param === param) ?? null;
}

export type Which = 'baseline' | 'comparison';
export const KINDS: Which[] = ['baseline', 'comparison'];
export const visibleKinds = (mode: DisplayMode): Which[] => KINDS.filter((k) => mode === 'overlay' || mode === k);

// The stroke class a setup's drawing of an item gets (globals.css's align-*): neutral when both setups agree
export const toneOf = (item: BrakeItem | null, which: Which) =>
  item?.status === 'same' ? 'align-unchanged' : which === 'baseline' ? 'align-baseline' : 'align-comparison';

// ---- Hydraulics (millimeters only) ----

// A master cylinder's piston area in mm², from its bore
export function pistonArea(bore: BrakeValue | null): number | null {
  return bore?.unit === 'mm' && bore.value != null && bore.value > 0 ? Math.PI * (bore.value / 2) ** 2 : null;
}

// The hydraulic pressure a hypothetical force on the piston makes, in MPa (N/mm²)
export function pressure(forceN: number, bore: BrakeValue | null): number | null {
  const area = pistonArea(bore);
  return area && forceN >= 0 ? forceN / area : null;
}

// Comparison relative to baseline, in percent
export function relativeChange(a: number | null, b: number | null): number | null {
  return a != null && b != null && a !== 0 ? ((b - a) / a) * 100 : null;
}

// How far the comparison's piston travels to move the baseline's fluid volume, as a multiple of the baseline's travel:
// travel ∝ 1 / area, so area(baseline) / area(comparison)
export function travelRatio(a: BrakeValue | null, b: BrakeValue | null): number | null {
  const x = pistonArea(a);
  const y = pistonArea(b);
  return x && y ? x / y : null;
}

// The nominal front/rear split of the line pressure, only for iRacing's front-percentage bias
export function distribution(comparison: BrakeComparison, which: Which): { front: number; rear: number; decimals: number } | null {
  const item = findItem(comparison, 'bias');
  const v = item?.[which];
  if (!item?.frontPercentage || !v || v.value == null) return null;
  return { front: v.value, rear: round(100 - v.value), decimals: v.decimals };
}

// The bias change in percentage points (positive: forward)
export function biasDelta(comparison: BrakeComparison): number | null {
  const a = distribution(comparison, 'baseline');
  const b = distribution(comparison, 'comparison');
  return a && b ? round(b.front - a.front) : null;
}

// ---- Drawing ----

export type BrakeComponent = 'all' | 'bias' | 'masters' | 'pedal' | 'calipers' | 'abs';
export const BRAKE_COMPONENTS: BrakeComponent[] = ['all', 'bias', 'masters', 'pedal', 'calipers', 'abs'];
export type SelectedBrake = 'frontMaster' | 'rearMaster' | 'pedal' | 'balance' | 'abs' | Corner;

// What every drawing is given
export type BrakeDrawingProps = {
  comparison: BrakeComparison;
  mode: DisplayMode;
  exaggeration: number;
  // How far the brakes are applied in the illustration, 0-100
  application: number;
  selected: SelectedBrake;
  onSelect: (part: SelectedBrake) => void;
  component: BrakeComponent;
  // The illustrative ABS event's stage (an index of ABS_STAGES)
  absStage: number;
};

// A master cylinder bore drawn as a radius: the difference from the setups' mean bore, exaggerated, within limits
export function boreRadius(bore: BrakeValue | null, mean: number | null, exaggeration: number): number {
  if (!bore || bore.unit !== 'mm' || bore.value == null || mean == null) return 24;
  return Math.max(12, Math.min(44, 24 + (bore.value - mean) * exaggeration * 1.6));
}

// The mean of every bore both setups give, in mm
export function meanBore(comparison: BrakeComparison): number | null {
  const values = comparison.items
    .filter((i) => i.param === 'frontMaster' || i.param === 'rearMaster')
    .flatMap((i) => [i.baseline, i.comparison])
    .filter((v): v is BrakeValue => !!v && v.unit === 'mm' && v.value != null)
    .map((v) => v.value!);
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

// The balance bar's tilt in the drawing, from the bias (schematic: no balance bar geometry is known)
export const balanceTilt = (front: number | null) => (front == null ? 0 : Math.max(-30, Math.min(30, (front - 50) * 1.4)));

// The illustrative ABS event: its stages, and the pedal application at each (schematic, the same for both setups)
export const ABS_STAGES = ['ready', 'rolling', 'apply', 'decel', 'lockup', 'intervene', 'modulate', 'recover'] as const;
export type AbsStage = (typeof ABS_STAGES)[number];
export const ABS_APPLICATION = [0, 0, 25, 55, 80, 85, 60, 35];

// The LED strip colors the page has a swatch for; anything else is drawn neutral with its own name
export const LED_SWATCHES = ['yellow', 'blue', 'red', 'green', 'white', 'purple', 'orange', 'pink', 'cyan'] as const;
export const ledSwatch = (value: BrakeValue | null) => {
  const name = value?.raw.trim().toLowerCase() ?? '';
  return (LED_SWATCHES as readonly string[]).find((c) => name.includes(c)) ?? null;
};

// ---- Text ----

const UNIT_TEXT: Record<BrakeUnit, string> = { mm: ' mm', in: ' in', '%': '%', setting: '', text: '' };

// A value as shown: numbers with their unit and iRacing's decimals, text as written ("3 (ABS)" shows as 3)
export function formatBrake(value: { value: number | null; unit: BrakeUnit; decimals: number; raw?: string } | null, signed = false): string {
  if (!value) return '—';
  if (value.value == null) return value.raw?.trim() || '—';
  const shown = Number(value.value.toFixed(value.decimals));
  const text = Math.abs(shown).toFixed(value.decimals);
  return `${shown < 0 ? '−' : signed && shown > 0 ? '+' : signed ? '±' : ''}${text}${UNIT_TEXT[value.unit]}`;
}

export type ChangeDirection =
  | 'biasForward'
  | 'biasRearward'
  | 'biasChanged'
  | 'boreLarger'
  | 'boreSmaller'
  | 'absUp'
  | 'absDown'
  | 'padsChanged'
  | 'ledChanged'
  | 'otherChanged'
  | 'unchanged'
  | 'onlyBaseline'
  | 'onlyComparison'
  | 'unitsDiffer'
  | 'unsupported';

export function changeDirection(item: BrakeItem): ChangeDirection {
  if (item.status !== 'changed') return item.status === 'same' ? 'unchanged' : item.status;
  const d = item.delta?.value ?? 0;
  switch (item.param) {
    case 'bias':
      return item.frontPercentage ? (d > 0 ? 'biasForward' : 'biasRearward') : 'biasChanged';
    case 'frontMaster':
    case 'rearMaster':
      return d > 0 ? 'boreLarger' : 'boreSmaller';
    case 'abs':
      return d > 0 ? 'absUp' : 'absDown';
    case 'pads':
      return 'padsChanged';
    case 'led':
      return 'ledChanged';
    default:
      return 'otherChanged';
  }
}

// ---- The Setup Engineer ----

const PARAM_NAMES: Record<BrakeParam, string> = {
  frontMaster: 'front master cylinder bore',
  rearMaster: 'rear master cylinder bore',
  bias: 'brake bias',
  abs: 'ABS setting',
  pads: 'brake pad compound',
  led: 'night LED strip color (lighting only)',
  other: 'brake parameter',
};
const plain = (text: string) => text.replace(/−/g, '-');

// The structured comparison for the Setup Engineer's prompt (English, like every prompt): each value as the garage
// shows it, the deltas, the hydraulics worked out from the bores, and what isn't known
export function brakeEngineerFacts(comparison: BrakeComparison, names: { baseline: string; comparison: string; car: string | null }): string[] {
  const line = (i: BrakeItem) => {
    const delta = i.delta
      ? `, delta ${plain(formatBrake(i.delta, true))}${i.param === 'bias' ? (i.frontPercentage ? ' (percentage points of front bias)' : ' (convention unknown)') : ''}`
      : i.status === 'unitsDiffer'
        ? ', in different units so no delta'
        : '';
    const name = i.param === 'other' ? `${PARAM_NAMES.other} ${i.key}` : PARAM_NAMES[i.param];
    return `- ${name} [${i.path}]: ${i.baseline?.raw.trim() ?? 'not in this setup'} -> ${i.comparison?.raw.trim() ?? 'not in this setup'}${delta}`;
  };
  const brakes = comparison.items.filter((i) => i.param !== 'led');
  const changed = brakes.filter((i) => i.status !== 'same');
  const same = brakes.filter((i) => i.status === 'same');
  const facts = [
    `Brake system comparison for ${names.car ?? 'the car'}: baseline "${names.baseline}" -> comparison "${names.comparison}". Values exactly as iRacing's garage shows them; deltas are comparison minus baseline.`,
    changed.length ? 'Changed brake values:' : 'No brake value differs between the two setups.',
    ...changed.map(line),
  ];
  if (same.length) facts.push('Unchanged brake values:', ...same.map(line));
  const bias = findItem(comparison, 'bias');
  if (bias?.frontPercentage) {
    for (const which of KINDS) {
      const d = distribution(comparison, which);
      if (d) facts.push(`${which === 'baseline' ? 'Baseline' : 'Comparison'} nominal line pressure split: ${d.front.toFixed(d.decimals)}% front / ${d.rear.toFixed(d.decimals)}% rear (iRacing's BrakePressureBias is the front share of line pressure, not of braking force at the tires).`);
    }
  } else if (bias) facts.push(`The brake bias key ${bias.key} doesn't say what its percentage is a share of, so no front/rear split is worked out.`);
  for (const param of ['frontMaster', 'rearMaster'] as const) {
    const item = findItem(comparison, param);
    const a = pistonArea(item?.baseline ?? null);
    const b = pistonArea(item?.comparison ?? null);
    if (item && a && b && item.status === 'changed') {
      facts.push(
        `${param === 'frontMaster' ? 'Front' : 'Rear'} master cylinder piston area ${a.toFixed(1)} -> ${b.toFixed(1)} mm²: for the same force on the piston the line pressure changes ${plain((((a / b) - 1) * 100).toFixed(1))}%, and the piston travels ${(a / b).toFixed(3)}x as far for the same fluid volume (bore only; pedal ratio and balance bar unknown).`
      );
    }
  }
  const led = findItem(comparison, 'led');
  if (led && led.status !== 'same') facts.push(`The night LED strip color changed (${led.baseline?.raw.trim() ?? '—'} -> ${led.comparison?.raw.trim() ?? '—'}): lighting only, never part of brake advice.`);
  const missing: string[] = [];
  for (const param of ['bias', 'frontMaster', 'rearMaster', 'pads', 'abs'] as const) if (!findItem(comparison, param)) missing.push(PARAM_NAMES[param]);
  if (missing.length) facts.push(`Not in these setups (never assume a value): ${missing.join('; ')}.`);
  if (comparison.unsupported.length) {
    facts.push(`Brake values that couldn't be read (left out): ${comparison.unsupported.map((i) => `${i.path} (${i.baselineRaw ?? '—'} -> ${i.comparisonRaw ?? '—'})`).join('; ')}.`);
  }
  facts.push(
    'Not known for this car: the pedal ratio and balance bar geometry (so no pedal force or line pressure), caliper piston areas, disc radius and pad friction coefficients (so no braking torque), and what each ABS setting does (a position, not an intervention strength).'
  );
  return facts;
}

// How the Setup Engineer answers a brake question (added to its system prompt)
export const BRAKES_ENGINEER_RULE =
  ' The driver asks about the brake system differences between two setups, listed in the facts: brake bias, master' +
  ' cylinders, pads and ABS. Explain how each change may influence braking stability, front and rear locking, corner' +
  ' entry rotation, trail braking, pedal feel and travel, and how hard the ABS works, only for what actually changed.' +
  ' Keep established mechanical principles apart from what would happen on this car: findings are only what the' +
  ' values show, and anything about how this car will feel goes in hypotheses, each saying it needs telemetry or a' +
  ' track test to confirm. Never call either setup better. Use the values and units exactly as listed, never assume a' +
  ' missing value, give bias changes in percentage points, never turn a master cylinder change into a pedal force,' +
  ' line pressure or braking torque, never say what an ABS setting number does, and leave the LED strip color out.';
