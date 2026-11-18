// The Setups page's Wheel Alignment Engineering Comparison (src/components/AlignmentEngineeringView.tsx): the camber,
// toe and caster of two setups of the same car, found by parameter path in Compare's rows (setupCompare.ts), and the
// angles the diagrams draw them at. Pure, with no React, so Node runs it (scripts/alignment.test.mjs); the words are
// the dictionaries' (setups.alignment), so nothing here is shown as it is except the values.
//
// What iRacing's CarSetup gives (scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml): each corner's Camber in
// degrees (Chassis.LeftFront.Camber: -4.0 deg), each rear wheel's ToeIn (Chassis.LeftRear.ToeIn: +1.5 mm) and the
// front axle's TotalToeIn (Chassis.FrontBrakes.TotalToeIn: -3.0 mm). The key names say which way is positive: ToeIn
// and TotalToeIn are positive toe-in, ToeOut positive toe-out; a plain Toe doesn't say, so its direction isn't drawn.
// Toe in millimeters is a distance, not an angle, and iRacing doesn't say over what length it's measured (the rim, the
// tire's diameter or another), so it's never turned into degrees: those wheels are drawn schematically, at a fixed
// SCHEMATIC_DEG_PER_MM, and labelled as such. Only toe written in degrees is drawn at its real angle.
//
// Sign conventions of the drawings (SVG: x right, y down, rotation clockwise positive):
// - Plan view: the car's nose is up and its left side on the left. Toe-in turns a wheel's front toward the
//   centerline: clockwise on the left, counterclockwise on the right.
// - Front view (standing in front, looking rearward): the car's left side is on the screen's right. Rear view
//   (standing behind, looking forward): its left side is on the left. Negative camber leans a wheel's top toward the
//   centerline in both.
import { readValue } from './setupYaml.ts';

export const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
export type Corner = (typeof CORNERS)[number];
export type Axle = 'front' | 'rear';
export type AlignmentParam = 'camber' | 'toe' | 'caster' | 'totalToe';
export type AlignmentUnit = 'deg' | 'mm' | 'in';
export type DisplayMode = 'baseline' | 'comparison' | 'overlay';

export const EXAGGERATIONS = [1, 2, 5, 10] as const;
export const DEFAULT_EXAGGERATION = 5;
// What a schematic toe wheel turns per millimeter of toe before exaggeration: a drawing scale, never a conversion
export const SCHEMATIC_DEG_PER_MM = 1;
// No wheel is drawn turned or leaned further than this, however large the value or exaggeration
export const MAX_DRAWN_ANGLE = 35;

const EPSILON = 1e-9;

export type AlignmentValue = {
  // Exactly as iRacing wrote it
  raw: string;
  value: number;
  unit: AlignmentUnit;
  decimals: number;
};

export type AlignmentStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'unitsDiffer' | 'unsupported';

export type AlignmentItem = {
  // A stable identifier: LF.camber, LR.toe, front.totalToe ...
  id: string;
  scope: Corner | Axle;
  param: AlignmentParam;
  path: string;
  // What a positive toe means, from the key's name (ToeIn: in); null for camber and caster, or a key that doesn't say
  toeSign: 'in' | 'out' | null;
  baselineRaw: string | null;
  comparisonRaw: string | null;
  // The values when they're one number in a unit this understands; null otherwise (and see status)
  baseline: AlignmentValue | null;
  comparison: AlignmentValue | null;
  // Comparison minus baseline, in their unit, when both are known and in the same unit
  delta: { value: number; unit: AlignmentUnit; decimals: number } | null;
  status: AlignmentStatus;
};

export type AlignmentComparison = {
  items: AlignmentItem[];
  // Parameters that look like alignment but couldn't be read: an unknown unit, text, or a second path for the same thing
  unsupported: AlignmentItem[];
  // How the front toe is given: per wheel, as one axle total, or not at all
  frontToe: 'perWheel' | 'total' | 'none';
  rearToe: 'perWheel' | 'total' | 'none';
  changedCount: number;
};

// What a comparison row needs to have (setupCompare.ts's CompareRow fits)
export type AlignmentSourceRow = {
  path: string;
  group: string | null;
  section: string;
  key: string;
  kind: 'setting' | 'reading';
  baseline: string | null;
  comparison: string | null;
};

const CORNER_GROUPS: [RegExp, Corner][] = [
  [/^(?:Left\s*Front|LF)(?:Corner|Wheel|Suspension)?$/i, 'LF'],
  [/^(?:Right\s*Front|RF)(?:Corner|Wheel|Suspension)?$/i, 'RF'],
  [/^(?:Left\s*Rear|LR)(?:Corner|Wheel|Suspension)?$/i, 'LR'],
  [/^(?:Right\s*Rear|RR)(?:Corner|Wheel|Suspension)?$/i, 'RR'],
];

export const cornerAxle = (corner: Corner): Axle => (corner.endsWith('F') ? 'front' : 'rear');
export const isLeft = (corner: Corner) => corner.startsWith('L');

function cornerOf(group: string | null): Corner | null {
  if (!group) return null;
  for (const [pattern, corner] of CORNER_GROUPS) if (pattern.test(group)) return corner;
  return null;
}

// The axle a non-corner box belongs to, from its own name or the path above it (FrontBrakes, Front, RearArb ...)
function axleOf(path: string): Axle | null {
  const parents = path.split('.').slice(0, -1).reverse();
  for (const part of parents) {
    if (/front/i.test(part)) return 'front';
    if (/rear/i.test(part)) return 'rear';
  }
  return null;
}

type Kind = { param: AlignmentParam; toeSign: 'in' | 'out' | null; total: boolean };

function kindOf(key: string): Kind | null {
  if (/^Camber$/i.test(key)) return { param: 'camber', toeSign: null, total: false };
  if (/^Caster$/i.test(key)) return { param: 'caster', toeSign: null, total: false };
  const toe = /^(Total)?Toe(In|Out)?$/i.exec(key);
  if (toe) return { param: 'toe', toeSign: toe[2] ? (toe[2].toLowerCase() === 'in' ? 'in' : 'out') : null, total: !!toe[1] };
  return null;
}

function unitOf(unit: string | null): AlignmentUnit | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (u === 'deg' || u === 'degs' || u === 'degree' || u === 'degrees' || u === '°') return 'deg';
  if (u === 'mm') return 'mm';
  if (u === 'in' || u === 'inch' || u === 'inches') return 'in';
  return null;
}

// One raw value read as an alignment value: camber and caster only in degrees, toe in degrees, mm or inches
export function readAlignmentValue(raw: string | null, param: AlignmentParam): AlignmentValue | null | 'unsupported' {
  if (raw == null) return null;
  const read = readValue(raw);
  if (read.value == null) return 'unsupported';
  const unit = unitOf(read.unit);
  if (!unit) return 'unsupported';
  if ((param === 'camber' || param === 'caster') && unit !== 'deg') return 'unsupported';
  return { raw, value: read.value, unit, decimals: read.decimals };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

// The alignment parameters of two setups of the same car, from Compare's rows (settings only), in the order the
// page lists them: by axle, then left and right, then camber, toe, caster
export function compareAlignment(rows: readonly AlignmentSourceRow[]): AlignmentComparison {
  const items: AlignmentItem[] = [];
  const unsupported: AlignmentItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'setting') continue;
    const kind = kindOf(row.key);
    if (!kind) continue;
    const corner = cornerOf(row.group);
    let scope: Corner | Axle | null;
    let param: AlignmentParam = kind.param;
    if (corner && !kind.total) scope = corner;
    else if (kind.param === 'toe') {
      scope = corner ? cornerAxle(corner) : axleOf(row.path);
      param = 'totalToe';
    } else scope = null;
    const id = scope ? `${scope}.${param}` : `?.${row.path}`;
    const a = readAlignmentValue(row.baseline, param);
    const b = readAlignmentValue(row.comparison, param);
    const item: AlignmentItem = {
      id,
      scope: scope ?? 'front',
      param,
      path: row.path,
      toeSign: param === 'toe' || param === 'totalToe' ? kind.toeSign : null,
      baselineRaw: row.baseline,
      comparisonRaw: row.comparison,
      baseline: a === 'unsupported' ? null : a,
      comparison: b === 'unsupported' ? null : b,
      delta: null,
      status: 'same',
    };
    // A camber outside any corner box, a toe of no axle, a second path for something already found, or a value this
    // can't read: listed as unsupported, never drawn or guessed at
    if (!scope || seen.has(id) || a === 'unsupported' || b === 'unsupported') {
      unsupported.push({ ...item, status: 'unsupported' });
      continue;
    }
    seen.add(id);
    if (!item.baseline) item.status = 'onlyComparison';
    else if (!item.comparison) item.status = 'onlyBaseline';
    else if (item.baseline.unit !== item.comparison.unit) item.status = 'unitsDiffer';
    else {
      const value = round(item.comparison.value - item.baseline.value);
      item.delta = { value, unit: item.baseline.unit, decimals: Math.max(item.baseline.decimals, item.comparison.decimals) };
      item.status = Math.abs(value) < EPSILON ? 'same' : 'changed';
    }
    items.push(item);
  }
  items.sort((x, y) => orderOf(x) - orderOf(y));
  const toeGiven = (axle: Axle): AlignmentComparison['frontToe'] =>
    items.some((i) => i.param === 'toe' && cornerAxle(i.scope as Corner) === axle)
      ? 'perWheel'
      : items.some((i) => i.param === 'totalToe' && i.scope === axle)
        ? 'total'
        : 'none';
  return {
    items,
    unsupported,
    frontToe: toeGiven('front'),
    rearToe: toeGiven('rear'),
    changedCount: items.filter((i) => i.status !== 'same').length,
  };
}

const SCOPE_ORDER: Record<Corner | Axle, number> = { front: 0, LF: 1, RF: 2, rear: 3, LR: 4, RR: 5 };
const PARAM_ORDER: Record<AlignmentParam, number> = { camber: 0, totalToe: 1, toe: 2, caster: 3 };
const orderOf = (item: AlignmentItem) => SCOPE_ORDER[item.scope] * 10 + PARAM_ORDER[item.param];

export function findItem(comparison: AlignmentComparison, scope: Corner | Axle, param: AlignmentParam): AlignmentItem | null {
  return comparison.items.find((i) => i.scope === scope && i.param === param) ?? null;
}

// The items of one corner, and its axle's total toe when the toe isn't given per wheel
export function cornerItems(comparison: AlignmentComparison, corner: Corner): AlignmentItem[] {
  return comparison.items.filter((i) => i.scope === corner);
}

// ---- Drawing ----

const clamp = (angle: number) => {
  const clamped = Math.abs(angle) > MAX_DRAWN_ANGLE;
  return { angle: clamped ? Math.sign(angle) * MAX_DRAWN_ANGLE : angle, clamped };
};

// How far to lean a wheel in the front or rear view, in SVG degrees (clockwise positive), exaggerated
export function camberRotation(camberDeg: number, corner: Corner, view: 'front' | 'rear', exaggeration: number) {
  const onScreenLeft = view === 'front' ? !isLeft(corner) : isLeft(corner);
  // Negative camber leans the top toward the centerline: right (clockwise) for a wheel on the screen's left
  return clamp(camberDeg * (onScreenLeft ? -1 : 1) * exaggeration);
}

// Which wheels a view shows, left to right on the screen
export const viewCorners = (view: 'front' | 'rear'): [Corner, Corner] => (view === 'front' ? ['RF', 'LF'] : ['LR', 'RR']);

export type ToeDrawing = {
  // SVG degrees in the plan view (clockwise positive), exaggerated
  angle: number;
  clamped: boolean;
  // Drawn at a fixed scale from a distance, not at its real angle
  schematic: boolean;
  // Half of an axle's total, as the wheels' own toe isn't given
  fromAxleTotal: boolean;
  // The wheel's own toe-in, in the value's unit (negative: toe-out); half the total when fromAxleTotal
  toeIn: number;
  unit: AlignmentUnit;
};

// The toe a wheel is drawn with, for one of the setups: its own toe when given, else half its axle's total (drawn as
// a symmetric illustration and labelled so), else null. null too when the key doesn't say which way is positive
export function toeDrawing(
  comparison: AlignmentComparison,
  corner: Corner,
  which: 'baseline' | 'comparison',
  exaggeration: number
): ToeDrawing | null {
  const own = findItem(comparison, corner, 'toe');
  const total = own ? null : findItem(comparison, cornerAxle(corner), 'totalToe');
  const item = own ?? total;
  const value = item?.[which];
  if (!item || !value || !item.toeSign) return null;
  const toeIn = (item.toeSign === 'in' ? 1 : -1) * value.value * (own ? 1 : 0.5);
  const degrees = value.unit === 'deg' ? toeIn : value.unit === 'mm' ? toeIn * SCHEMATIC_DEG_PER_MM : toeIn * 25.4 * SCHEMATIC_DEG_PER_MM;
  // Toe-in turns the front of a left wheel clockwise and of a right wheel counterclockwise
  const { angle, clamped } = clamp(degrees * (isLeft(corner) ? 1 : -1) * exaggeration);
  return { angle, clamped, schematic: value.unit !== 'deg', fromAxleTotal: !own, toeIn: round(toeIn), unit: value.unit };
}

// What each diagram draws for one wheel: a layer per setup, shown or faded out by the display mode
export type DrawnLayer = {
  kind: 'baseline' | 'comparison';
  angle: number | null;
  clamped: boolean;
  visible: boolean;
  unchanged: boolean;
  label: string | null;
  schematic: boolean;
  fromAxleTotal: boolean;
};

const KINDS = ['baseline', 'comparison'] as const;
const visibleIn = (mode: DisplayMode, kind: 'baseline' | 'comparison') => mode === 'overlay' || mode === kind;

export function camberLayers(comparison: AlignmentComparison, corner: Corner, view: 'front' | 'rear', mode: DisplayMode, exaggeration: number): DrawnLayer[] {
  const item = findItem(comparison, corner, 'camber');
  return KINDS.map((kind) => {
    const value = item?.[kind] ?? null;
    const drawn = value ? camberRotation(value.value, corner, view, exaggeration) : null;
    return {
      kind,
      angle: drawn?.angle ?? null,
      clamped: drawn?.clamped ?? false,
      visible: visibleIn(mode, kind),
      unchanged: item?.status === 'same',
      label: value ? formatAlignment(value) : null,
      schematic: false,
      fromAxleTotal: false,
    };
  });
}

export function toeLayers(comparison: AlignmentComparison, corner: Corner, mode: DisplayMode, exaggeration: number): DrawnLayer[] {
  const own = findItem(comparison, corner, 'toe');
  const item = own ?? findItem(comparison, cornerAxle(corner), 'totalToe');
  return KINDS.map((kind) => {
    const drawn = toeDrawing(comparison, corner, kind, exaggeration);
    const value = item?.[kind] ?? null;
    return {
      kind,
      angle: drawn?.angle ?? null,
      clamped: drawn?.clamped ?? false,
      visible: visibleIn(mode, kind),
      unchanged: item?.status === 'same',
      // A wheel's own toe is labelled with its value as iRacing gives it; a wheel drawn from its axle's total gets no
      // value of its own (the axle's total is shown with the axle), as the split is only an illustration
      label: own && value ? formatAlignment(value, true) : null,
      schematic: drawn?.schematic ?? false,
      fromAxleTotal: drawn?.fromAxleTotal ?? false,
    };
  });
}

// An SVG arc from straight up (0) to the given angle, about the origin, for the angle annotations
export function arcPath(angle: number, radius: number): string {
  const a = Math.abs(angle) < 0.3 ? 0 : angle;
  const x = Math.sin((a * Math.PI) / 180) * radius;
  const y = -Math.cos((a * Math.PI) / 180) * radius;
  return `M 0 ${-radius} A ${radius} ${radius} 0 0 ${a > 0 ? 1 : 0} ${x.toFixed(2)} ${y.toFixed(2)}`;
}

// ---- Text ----

const UNIT_TEXT: Record<AlignmentUnit, string> = { deg: '°', mm: ' mm', in: ' in' };

// A value with its unit: "-4.0°", "+1.5 mm"; signed puts + on positives
export function formatAlignment(value: { value: number; unit: AlignmentUnit; decimals: number } | null, signed = false): string {
  if (!value) return '—';
  const shown = Number(value.value.toFixed(value.decimals));
  const text = Math.abs(shown).toFixed(value.decimals);
  const sign = shown < 0 ? '−' : signed && shown > 0 ? '+' : signed ? '±' : '';
  return `${sign}${text}${UNIT_TEXT[value.unit]}`;
}

// What a change does to the wheel, as a key of the dictionaries' setups.alignment.direction
export type ChangeDirection =
  | 'lessNegativeCamber'
  | 'moreNegativeCamber'
  | 'towardPositiveCamber'
  | 'towardNegativeCamber'
  | 'moreToeIn'
  | 'moreToeOut'
  | 'toeChanged'
  | 'moreCaster'
  | 'lessCaster'
  | 'unchanged'
  | 'onlyBaseline'
  | 'onlyComparison'
  | 'unitsDiffer'
  | 'unsupported';

export function changeDirection(item: AlignmentItem): ChangeDirection {
  if (item.status !== 'changed') return item.status === 'same' ? 'unchanged' : item.status;
  const d = item.delta!.value;
  if (item.param === 'camber') {
    if (item.baseline!.value <= 0 && item.comparison!.value <= 0) return d > 0 ? 'lessNegativeCamber' : 'moreNegativeCamber';
    return d > 0 ? 'towardPositiveCamber' : 'towardNegativeCamber';
  }
  if (item.param === 'caster') return d > 0 ? 'moreCaster' : 'lessCaster';
  if (!item.toeSign) return 'toeChanged';
  return d * (item.toeSign === 'in' ? 1 : -1) > 0 ? 'moreToeIn' : 'moreToeOut';
}

// What the parameter influences in general, as a key of setups.alignment.topics (never which setup is better)
export function topicOf(item: Pick<AlignmentItem, 'param' | 'scope'>): 'camberFront' | 'camberRear' | 'toeFront' | 'toeRear' | 'caster' {
  const axle = item.scope === 'front' || item.scope === 'rear' ? item.scope : cornerAxle(item.scope);
  if (item.param === 'camber') return axle === 'front' ? 'camberFront' : 'camberRear';
  if (item.param === 'caster') return 'caster';
  return axle === 'front' ? 'toeFront' : 'toeRear';
}

export type Asymmetry = {
  axle: Axle;
  param: 'camber' | 'toe' | 'caster';
  // Left minus right in each setup; null when either side is missing there
  baseline: number | null;
  comparison: number | null;
  unit: AlignmentUnit;
  decimals: number;
};

// Left/right differences on each axle, where either setup has one
export function asymmetries(comparison: AlignmentComparison): Asymmetry[] {
  const out: Asymmetry[] = [];
  for (const [left, right, axle] of [['LF', 'RF', 'front'], ['LR', 'RR', 'rear']] as const) {
    for (const param of ['camber', 'toe', 'caster'] as const) {
      const l = findItem(comparison, left, param);
      const r = findItem(comparison, right, param);
      if (!l || !r) continue;
      const diff = (which: 'baseline' | 'comparison') => {
        const a = l[which];
        const b = r[which];
        return a && b && a.unit === b.unit ? round(a.value - b.value) : null;
      };
      const baseline = diff('baseline');
      const comparisonDiff = diff('comparison');
      const unit = (l.baseline ?? l.comparison)!.unit;
      if (Math.abs(baseline ?? 0) < EPSILON && Math.abs(comparisonDiff ?? 0) < EPSILON) continue;
      const decimals = Math.max(l.baseline?.decimals ?? 0, l.comparison?.decimals ?? 0, r.baseline?.decimals ?? 0, r.comparison?.decimals ?? 0);
      out.push({ axle, param, baseline, comparison: comparisonDiff, unit, decimals });
    }
  }
  return out;
}

// ---- The Setup Engineer ----

const PARAM_NAMES: Record<AlignmentParam, string> = { camber: 'camber', toe: 'toe', caster: 'caster', totalToe: 'total toe' };
const SCOPE_NAMES: Record<Corner | Axle, string> = {
  LF: 'Left front',
  RF: 'Right front',
  LR: 'Left rear',
  RR: 'Right rear',
  front: 'Front axle',
  rear: 'Rear axle',
};
const englishValue = (v: AlignmentValue | null) => (v ? v.raw : 'not in this setup');

// The structured comparison for the Setup Engineer's prompt (English, like every prompt): each value as the garage
// shows it, the deltas, the toe conventions, and what's unchanged, missing or couldn't be read
export function alignmentEngineerFacts(
  comparison: AlignmentComparison,
  names: { baseline: string; comparison: string; car: string | null }
): string[] {
  const line = (i: AlignmentItem) => {
    const sign = i.toeSign ? ` (positive means toe-${i.toeSign}, from iRacing's key name)` : i.param === 'toe' || i.param === 'totalToe' ? ' (iRacing\'s key doesn\'t say which way is positive)' : '';
    const delta = i.delta ? `, delta ${formatAlignment(i.delta, true).replace('−', '-')}` : i.status === 'unitsDiffer' ? ', in different units so no delta' : '';
    const axleNote = i.param === 'totalToe' ? '; an axle total: iRacing doesn\'t say how it splits between the two wheels' : '';
    return `- ${SCOPE_NAMES[i.scope]} ${PARAM_NAMES[i.param]} [${i.path}]: ${englishValue(i.baseline)} -> ${englishValue(i.comparison)}${delta}${sign}${axleNote}`;
  };
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const same = comparison.items.filter((i) => i.status === 'same');
  const facts = [
    `Wheel alignment comparison for ${names.car ?? 'the car'}: baseline "${names.baseline}" -> comparison "${names.comparison}". Values exactly as iRacing's garage shows them; deltas are comparison minus baseline.`,
    changed.length ? 'Changed alignment values:' : 'No alignment value differs between the two setups.',
    ...changed.map(line),
  ];
  if (same.length) facts.push('Unchanged alignment values:', ...same.map(line));
  const missing: string[] = [];
  if (comparison.frontToe === 'total') missing.push('front toe per wheel (only the axle total is given)');
  if (comparison.frontToe === 'none') missing.push('front toe');
  if (comparison.rearToe === 'none') missing.push('rear toe');
  for (const corner of CORNERS) if (!findItem(comparison, corner, 'camber')) missing.push(`${SCOPE_NAMES[corner].toLowerCase()} camber`);
  if (!comparison.items.some((i) => i.param === 'caster')) missing.push('caster');
  if (missing.length) facts.push(`Not in these setups (never assume a value): ${missing.join('; ')}.`);
  if (comparison.unsupported.length) {
    facts.push(`Alignment values that couldn't be read (left out): ${comparison.unsupported.map((i) => `${i.path} (${i.baselineRaw ?? '—'} -> ${i.comparisonRaw ?? '—'})`).join('; ')}.`);
  }
  if (comparison.items.some((i) => (i.param === 'toe' || i.param === 'totalToe') && (i.baseline?.unit === 'mm' || i.comparison?.unit === 'mm' || i.baseline?.unit === 'in'))) {
    facts.push('Toe in mm or inches is a distance, not an angle: iRacing doesn\'t say over what length it is measured, so never convert it to degrees.');
  }
  const asym = asymmetries(comparison);
  for (const a of asym) {
    const text = (v: number | null) => (v == null ? 'unknown' : formatAlignment({ value: v, unit: a.unit, decimals: a.decimals }, true).replace('−', '-'));
    facts.push(`Left minus right ${a.param} on the ${a.axle} axle: baseline ${text(a.baseline)}, comparison ${text(a.comparison)}.`);
  }
  return facts;
}

// How the Setup Engineer answers an alignment question (added to its system prompt)
export const ALIGNMENT_ENGINEER_RULE =
  ' The driver asks about the wheel alignment differences between two setups, listed in the facts. Explain how each' +
  ' change may influence corner entry, turn-in response, mid-corner balance, braking stability, rear stability, the' +
  ' tire contact patch, tire wear and straight-line behavior, only for what actually changed. Keep established' +
  ' mechanical principles (general tendencies of camber, toe and caster) apart from what would happen on this car:' +
  ' findings are only what the values show, and anything about how this car will feel goes in hypotheses, each' +
  ' saying it needs telemetry or a track test to confirm. Never call either setup better. Use the values and units' +
  ' exactly as listed, never assume a missing value, and never turn toe given as a distance into an angle.';
