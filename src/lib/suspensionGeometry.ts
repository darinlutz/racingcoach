// The Setups page's Suspension tab (src/components/SuspensionEngineeringView.tsx): the ride heights, springs, bump
// rubbers, dampers and anti-roll bars of two setups of the same car, found by parameter path in Compare's rows
// (setupCompare.ts), and what the drawings need from them. Pure, with no React, so Node runs it
// (scripts/suspension.test.mjs); the words are the dictionaries' (setups.suspension), so nothing here is shown as it
// is except the values.
//
// What iRacing's CarSetup gives (scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml): each corner's RideHeight
// (57.4 mm), SpringRate (223 N/mm), BumpRubberGap (15 mm) and CornerWeight (3313 N, a reading), each axle's ArbBlades
// (Chassis.FrontBrakes.ArbBlades: 5, Chassis.Rear.ArbBlades: 3) and each axle's dampers in clicks
// (Dampers.FrontDampers.LowSpeedCompressionDamping: 7 clicks). Other cars give dampers per corner
// (LeftFrontDamper.LsCompDamping), a SpringPerchOffset, an ARB as a pair of blades (2-2) or as a size. Values keep
// iRacing's own units (the garage shows inches and lbs/in to drivers who picked imperial units): nothing is
// converted, and a calculation that needs a unit it doesn't have answers nothing.
//
// What the setup doesn't say, so this never works out: the motion ratios (so wheel travel or wheel rate from a spring
// rate), the damping force of a click (more clicks is stiffer on some cars and softer on others), the stiffness of an
// ARB setting, where on the chassis the ride heights are measured, and the wheelbase (so no rake angle). The drawings
// are schematic and say so; only ride height differences are drawn to a (exaggerated) scale.
import { readValue } from './setupYaml.ts';
import { CORNERS, cornerAxle, type Axle, type Corner, type DisplayMode } from './alignmentGeometry.ts';

export { CORNERS, cornerAxle, type Axle, type Corner, type DisplayMode };
export { EXAGGERATIONS, DEFAULT_EXAGGERATION } from './alignmentGeometry.ts';

export type CornerParam = 'rideHeight' | 'springRate' | 'bumpGap' | 'perchOffset' | 'cornerWeight';
export type DamperParam = 'lsComp' | 'hsComp' | 'lsRbd' | 'hsRbd' | 'comp' | 'rbd';
export type ArbParam = 'arb' | 'arbSize';
export type SuspensionParam = CornerParam | DamperParam | ArbParam;
export type SuspensionUnit = 'mm' | 'in' | 'N/mm' | 'lb/in' | 'N' | 'lb' | 'clicks' | 'setting';

export const CORNER_PARAMS: CornerParam[] = ['rideHeight', 'springRate', 'bumpGap', 'perchOffset', 'cornerWeight'];
export const DAMPER_PARAMS: DamperParam[] = ['lsComp', 'hsComp', 'comp', 'lsRbd', 'hsRbd', 'rbd'];
export const AXLES: Axle[] = ['front', 'rear'];

const EPSILON = 1e-9;

export type SuspensionValue = {
  // Exactly as iRacing wrote it
  raw: string;
  value: number;
  unit: SuspensionUnit;
  decimals: number;
  // An ARB given as two blades, left and right ("2-2"); value is then the left one
  pair?: [number, number];
};

export type SuspensionStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'unitsDiffer' | 'unsupported';

export type SuspensionItem = {
  // A stable identifier: LF.rideHeight, front.lsComp, rear.arb ...
  id: string;
  scope: Corner | Axle;
  param: SuspensionParam;
  path: string;
  key: string;
  // Measured or worked out by iRacing (the corner weights), never adjusted directly
  reading: boolean;
  baselineRaw: string | null;
  comparisonRaw: string | null;
  baseline: SuspensionValue | null;
  comparison: SuspensionValue | null;
  // Comparison minus baseline, in their unit, when both are known and in the same unit (an ARB pair: of each blade)
  delta: { value: number; unit: SuspensionUnit; decimals: number; pair?: [number, number] } | null;
  status: SuspensionStatus;
};

export type SuspensionComparison = {
  items: SuspensionItem[];
  // Parameters that look like suspension but couldn't be read: an unknown unit, text, or a second path for the same thing
  unsupported: SuspensionItem[];
  // Whether the dampers are set per axle, per corner, or not at all
  dampers: 'axle' | 'corner' | 'none';
  changedCount: number;
};

// What a comparison row needs to have (setupCompare.ts's CompareRow fits)
export type SuspensionSourceRow = {
  path: string;
  group: string | null;
  section: string;
  key: string;
  kind: 'setting' | 'reading';
  baseline: string | null;
  comparison: string | null;
};

const CORNER_GROUPS: [RegExp, Corner][] = [
  [/^(?:Left\s*Front|LF)(?:Corner|Wheel|Suspension|Damper|Dampers|Shock|Spring)?$/i, 'LF'],
  [/^(?:Right\s*Front|RF)(?:Corner|Wheel|Suspension|Damper|Dampers|Shock|Spring)?$/i, 'RF'],
  [/^(?:Left\s*Rear|LR)(?:Corner|Wheel|Suspension|Damper|Dampers|Shock|Spring)?$/i, 'LR'],
  [/^(?:Right\s*Rear|RR)(?:Corner|Wheel|Suspension|Damper|Dampers|Shock|Spring)?$/i, 'RR'],
];

function cornerOf(group: string | null): Corner | null {
  if (!group) return null;
  for (const [pattern, corner] of CORNER_GROUPS) if (pattern.test(group)) return corner;
  return null;
}

// The axle a non-corner box belongs to, from its own name or the path above it (FrontDampers, FrontBrakes, Rear ...)
function axleOf(path: string): Axle | null {
  const parents = path.split('.').slice(0, -1).reverse();
  for (const part of parents) {
    if (/front/i.test(part)) return 'front';
    if (/rear/i.test(part)) return 'rear';
  }
  return null;
}

type Kind = { param: SuspensionParam; where: 'corner' | 'either' | 'axle' };

function kindOf(key: string): Kind | null {
  if (/^RideHeight$/i.test(key)) return { param: 'rideHeight', where: 'corner' };
  if (/^(?:Coil)?SpringRate$/i.test(key)) return { param: 'springRate', where: 'corner' };
  if (/^Bump(?:Rubber|Stop)?Gap$/i.test(key)) return { param: 'bumpGap', where: 'corner' };
  if (/^SpringPerchOffset$/i.test(key)) return { param: 'perchOffset', where: 'corner' };
  if (/^CornerWeight$/i.test(key)) return { param: 'cornerWeight', where: 'corner' };
  if (/^Arb(?:Blades?|Setting)$/i.test(key)) return { param: 'arb', where: 'axle' };
  if (/^Arb(?:Size|Diameter|OuterDia(?:meter)?)$/i.test(key)) return { param: 'arbSize', where: 'axle' };
  const damper = /^(Ls|Hs|LowSpeed|HighSpeed)?(Comp|Compression|Bump|Rbd|Rebound)(?:Damping|Damp)?$/i.exec(key);
  if (damper) {
    const speed = damper[1] ? (/^(?:Ls|LowSpeed)$/i.test(damper[1]) ? 'ls' : 'hs') : '';
    const rebound = /^(?:Rbd|Rebound)$/i.test(damper[2]);
    const param = (speed ? `${speed}${rebound ? 'Rbd' : 'Comp'}` : rebound ? 'rbd' : 'comp') as DamperParam;
    // A plain Bump or Rebound outside a damper box isn't a damper (a bump steer setting, say)
    return { param, where: 'either' };
  }
  return null;
}

export const isDamper = (param: SuspensionParam): param is DamperParam => (DAMPER_PARAMS as string[]).includes(param);

function unitOf(unit: string | null): SuspensionUnit | null | 'none' {
  if (!unit) return 'none';
  const u = unit.trim().toLowerCase();
  if (u === 'mm') return 'mm';
  if (u === 'in' || u === 'inch' || u === 'inches') return 'in';
  if (u === 'n/mm') return 'N/mm';
  if (u === 'lbs/in' || u === 'lb/in') return 'lb/in';
  if (u === 'n') return 'N';
  if (u === 'lbs' || u === 'lb') return 'lb';
  if (u === 'click' || u === 'clicks') return 'clicks';
  return null;
}

const ALLOWED: Record<SuspensionParam, SuspensionUnit[]> = {
  rideHeight: ['mm', 'in'],
  springRate: ['N/mm', 'lb/in'],
  bumpGap: ['mm', 'in'],
  perchOffset: ['mm', 'in'],
  cornerWeight: ['N', 'lb'],
  arb: ['setting'],
  arbSize: ['mm', 'in'],
  lsComp: ['clicks'],
  hsComp: ['clicks'],
  lsRbd: ['clicks'],
  hsRbd: ['clicks'],
  comp: ['clicks'],
  rbd: ['clicks'],
};

// One raw value read for its parameter, in a unit it can be in; 'unsupported' when it can't be read that way
export function readSuspensionValue(raw: string | null, param: SuspensionParam): SuspensionValue | null | 'unsupported' {
  if (raw == null) return null;
  if (param === 'arb') {
    // A blade or setting number ("5"), or a pair of blades ("2-2", "2/3")
    const pair = /^\s*(\d+)\s*[-–/]\s*(\d+)\s*$/.exec(raw);
    if (pair) {
      const p: [number, number] = [Number(pair[1]), Number(pair[2])];
      return { raw, value: p[0], unit: 'setting', decimals: 0, pair: p };
    }
    const read = readValue(raw);
    if (read.value == null || read.unit) return 'unsupported';
    return { raw, value: read.value, unit: 'setting', decimals: read.decimals };
  }
  const read = readValue(raw);
  if (read.value == null) return 'unsupported';
  let unit = unitOf(read.unit);
  // Damper clicks are sometimes written without a unit
  if (unit === 'none' && isDamper(param) && Number.isInteger(read.value)) unit = 'clicks';
  if (!unit || unit === 'none' || !ALLOWED[param].includes(unit)) return 'unsupported';
  return { raw, value: read.value, unit, decimals: read.decimals };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

// The suspension parameters of two setups of the same car, from Compare's rows (settings, and the corner weights,
// which are readings), in the order the page lists them: by axle, then left and right, then parameter
export function compareSuspension(rows: readonly SuspensionSourceRow[]): SuspensionComparison {
  const items: SuspensionItem[] = [];
  const unsupported: SuspensionItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = kindOf(row.key);
    if (!kind) continue;
    if (row.kind === 'reading' && kind.param !== 'cornerWeight') continue;
    const corner = cornerOf(row.group);
    const axle = axleOf(row.path);
    let scope: Corner | Axle | null = null;
    if (kind.where === 'corner') scope = corner;
    else if (kind.where === 'axle') scope = corner ? cornerAxle(corner) : axle;
    // A damper per corner, or per axle in a damper box; a plain Bump/Rebound outside a damper box isn't one
    else if (corner) scope = corner;
    else if (axle && (/damp|shock/i.test(row.path) || /(Ls|Hs|LowSpeed|HighSpeed)/i.test(row.key))) scope = axle;
    const id = scope ? `${scope}.${kind.param}` : `?.${row.path}`;
    const a = readSuspensionValue(row.baseline, kind.param);
    const b = readSuspensionValue(row.comparison, kind.param);
    const item: SuspensionItem = {
      id,
      scope: scope ?? 'front',
      param: kind.param,
      path: row.path,
      key: row.key,
      reading: row.kind === 'reading',
      baselineRaw: row.baseline,
      comparisonRaw: row.comparison,
      baseline: a === 'unsupported' ? null : a,
      comparison: b === 'unsupported' ? null : b,
      delta: null,
      status: 'same',
    };
    if (!scope) {
      // Not placed on a corner or axle: a damper-like key elsewhere is simply not suspension; anything else is listed
      if (!isDamper(kind.param)) unsupported.push({ ...item, status: 'unsupported' });
      continue;
    }
    if (seen.has(id) || a === 'unsupported' || b === 'unsupported') {
      unsupported.push({ ...item, status: 'unsupported' });
      continue;
    }
    seen.add(id);
    const x = item.baseline;
    const y = item.comparison;
    if (!x) item.status = 'onlyComparison';
    else if (!y) item.status = 'onlyBaseline';
    else if (x.unit !== y.unit || !!x.pair !== !!y.pair) item.status = 'unitsDiffer';
    else {
      const value = round(y.value - x.value);
      const pair: [number, number] | undefined = x.pair && y.pair ? [y.pair[0] - x.pair[0], y.pair[1] - x.pair[1]] : undefined;
      item.delta = { value, unit: x.unit, decimals: Math.max(x.decimals, y.decimals), ...(pair ? { pair } : {}) };
      const changed = pair ? pair.some((d) => d !== 0) : Math.abs(value) >= EPSILON;
      item.status = changed ? 'changed' : 'same';
    }
    items.push(item);
  }
  items.sort((p, q) => orderOf(p) - orderOf(q));
  const dampers = items.filter((i) => isDamper(i.param));
  return {
    items,
    unsupported,
    dampers: dampers.length === 0 ? 'none' : dampers.some((i) => i.scope === 'front' || i.scope === 'rear') ? 'axle' : 'corner',
    changedCount: items.filter((i) => i.status !== 'same').length,
  };
}

const SCOPE_ORDER: Record<Corner | Axle, number> = { front: 0, LF: 1, RF: 2, rear: 3, LR: 4, RR: 5 };
const PARAM_ORDER: Record<SuspensionParam, number> = {
  rideHeight: 0,
  springRate: 1,
  perchOffset: 2,
  bumpGap: 3,
  cornerWeight: 4,
  lsComp: 5,
  hsComp: 6,
  comp: 7,
  lsRbd: 8,
  hsRbd: 9,
  rbd: 10,
  arb: 11,
  arbSize: 12,
};
const orderOf = (item: SuspensionItem) => SCOPE_ORDER[item.scope] * 100 + PARAM_ORDER[item.param];

export function findItem(comparison: SuspensionComparison, scope: Corner | Axle, param: SuspensionParam): SuspensionItem | null {
  return comparison.items.find((i) => i.scope === scope && i.param === param) ?? null;
}

export type Which = 'baseline' | 'comparison';
export const KINDS: Which[] = ['baseline', 'comparison'];
export const visibleIn = (mode: DisplayMode, kind: Which) => mode === 'overlay' || mode === kind;
export const visibleKinds = (mode: DisplayMode): Which[] => KINDS.filter((k) => visibleIn(mode, k));

export const valueOf = (comparison: SuspensionComparison, scope: Corner | Axle, param: SuspensionParam, which: Which) =>
  findItem(comparison, scope, param)?.[which] ?? null;

// The stroke class a setup's drawing of an item gets (globals.css's align-*): neutral when both setups agree
export const toneOf = (item: SuspensionItem | null, which: Which) =>
  item?.status === 'same' ? 'align-unchanged' : which === 'baseline' ? 'align-baseline' : 'align-comparison';

// What the drawings and sections show: everything, or one system
export type ComponentFilter = 'all' | 'rideHeight' | 'springRate' | 'bumpGap' | 'dampers' | 'arb';
export const COMPONENT_FILTERS: ComponentFilter[] = ['all', 'rideHeight', 'springRate', 'bumpGap', 'dampers', 'arb'];
export type SuspensionView = 'overview' | 'side' | 'front' | 'rear' | 'detail';
export const SUSPENSION_VIEWS: SuspensionView[] = ['overview', 'side', 'front', 'rear', 'detail'];

// What every drawing is given
export type SuspensionDrawingProps = {
  comparison: SuspensionComparison;
  mode: DisplayMode;
  exaggeration: number;
  selected: Corner;
  onSelect: (corner: Corner) => void;
  component: ComponentFilter;
};

// The damper items of one scope (an axle, or a corner when the car's dampers are per corner)
export const damperItems = (comparison: SuspensionComparison, scope: Corner | Axle) =>
  comparison.items.filter((i) => i.scope === scope && isDamper(i.param));

// The scopes the dampers are set for, in order
export const damperScopes = (comparison: SuspensionComparison): (Corner | Axle)[] =>
  comparison.dampers === 'axle' ? AXLES.filter((a) => damperItems(comparison, a).length) : comparison.dampers === 'corner' ? CORNERS.filter((c) => damperItems(comparison, c).length) : [];

// ---- Calculations (only from the values, only in their own units) ----

// The mean ride height of an axle's two corners, when both are given in one unit
export function axleMean(comparison: SuspensionComparison, axle: Axle, which: Which): SuspensionValue | null {
  const [l, r] = axle === 'front' ? (['LF', 'RF'] as const) : (['LR', 'RR'] as const);
  const a = valueOf(comparison, l, 'rideHeight', which);
  const b = valueOf(comparison, r, 'rideHeight', which);
  if (!a || !b || a.unit !== b.unit) return null;
  const mean = round((a.value + b.value) / 2);
  // One more decimal only when halving needs it (57.4 and 57.5 average 57.45)
  const given = Math.max(a.decimals, b.decimals);
  const decimals = Math.abs(Number(mean.toFixed(given)) - mean) > EPSILON ? given + 1 : given;
  return { raw: '', value: mean, unit: a.unit, decimals };
}

// Rear mean ride height minus front mean: iRacing measures each car's ride heights at its own chassis points, so this
// is a height difference between those points, not a rake angle (the setup has no distance between them)
export function heightDifference(comparison: SuspensionComparison, which: Which): SuspensionValue | null {
  const f = axleMean(comparison, 'front', which);
  const r = axleMean(comparison, 'rear', which);
  if (!f || !r || f.unit !== r.unit) return null;
  return { raw: '', value: round(r.value - f.value), unit: f.unit, decimals: Math.max(f.decimals, r.decimals) };
}

// Right minus left ride height on one axle
export function heightAsymmetry(comparison: SuspensionComparison, axle: Axle, which: Which): SuspensionValue | null {
  const [l, r] = axle === 'front' ? (['LF', 'RF'] as const) : (['LR', 'RR'] as const);
  const a = valueOf(comparison, l, 'rideHeight', which);
  const b = valueOf(comparison, r, 'rideHeight', which);
  if (!a || !b || a.unit !== b.unit) return null;
  return { raw: '', value: round(b.value - a.value), unit: a.unit, decimals: Math.max(a.decimals, b.decimals) };
}

// Comparison relative to baseline, in percent, when both are in one unit and the baseline isn't 0
export function percentChange(item: SuspensionItem | null): number | null {
  if (!item?.baseline || !item.comparison || item.status === 'unitsDiffer' || item.baseline.value === 0) return null;
  return ((item.comparison.value - item.baseline.value) / Math.abs(item.baseline.value)) * 100;
}

// The load the springs demonstration applies, in the spring rate's own force unit: N for N/mm, lbf for lb/in
export const LOAD_RANGE = {
  'N/mm': { min: 500, max: 2500, step: 100, initial: 1000, unit: 'N', travel: 'mm' },
  'lb/in': { min: 100, max: 550, step: 25, initial: 225, unit: 'lbf', travel: 'in' },
} as const;

// Idealized spring compression under a load (Hooke's law: force / rate), in the rate's own length unit: the spring's
// own compression, not wheel travel, which needs the car's motion ratio
export function springCompression(load: number, rate: SuspensionValue | null): { value: number; unit: 'mm' | 'in' } | null {
  if (!rate || rate.value <= 0 || load < 0) return null;
  if (rate.unit === 'N/mm') return { value: load / rate.value, unit: 'mm' };
  if (rate.unit === 'lb/in') return { value: load / rate.value, unit: 'in' };
  return null;
}

// Whether the bump rubber touches after a compression measured along the gap (in the gap's unit); null without a gap
// in that unit
export function bumpEngaged(travel: number, travelUnit: 'mm' | 'in', gap: SuspensionValue | null): boolean | null {
  if (!gap || gap.unit !== travelUnit) return null;
  return travel >= gap.value - EPSILON;
}

// ---- Drawing ----

// Screen pixels per unit of ride height before exaggeration (a drawing scale, never a measurement)
const HEIGHT_PX: Record<string, number> = { mm: 0.42, in: 0.42 * 25.4 };
export const MAX_HEIGHT_OFFSET = 64;

// The ride heights a drawing is centered on: the mean of every ride height both setups give, in one unit
export function heightReference(comparison: SuspensionComparison): { value: number; unit: SuspensionUnit } | null {
  const values = comparison.items.filter((i) => i.param === 'rideHeight').flatMap((i) => [i.baseline, i.comparison]).filter((v): v is SuspensionValue => !!v);
  if (!values.length) return null;
  const unit = values[0].unit;
  const same = values.filter((v) => v.unit === unit);
  return { value: same.reduce((s, v) => s + v.value, 0) / same.length, unit };
}

// How far above (positive) the reference a ride height is drawn, in pixels, exaggerated and capped
export function heightOffset(value: SuspensionValue | null, reference: { value: number; unit: SuspensionUnit } | null, exaggeration: number) {
  if (!value || !reference || value.unit !== reference.unit) return { offset: 0, clamped: false, known: false };
  const raw = (value.value - reference.value) * (HEIGHT_PX[value.unit] ?? 0) * exaggeration;
  const clamped = Math.abs(raw) > MAX_HEIGHT_OFFSET;
  return { offset: clamped ? Math.sign(raw) * MAX_HEIGHT_OFFSET : raw, clamped, known: true };
}

// The bump rubber drawing's scale at a corner: pixels per unit so that the larger gap of the two setups fills the
// drawing's span (a schematic scale, shown as such)
export function gapScale(comparison: SuspensionComparison, corner: Corner, span: number): number {
  const gaps = [valueOf(comparison, corner, 'bumpGap', 'baseline'), valueOf(comparison, corner, 'bumpGap', 'comparison')].filter(
    (v): v is SuspensionValue => !!v && v.value > 0
  );
  const max = Math.max(...gaps.map((g) => g.value), 0);
  return max > 0 ? span / max : 0;
}

// A blade or setting drawn as a turn of the blade: a schematic angle, never a stiffness
export const arbBladeAngle = (setting: number) => Math.max(-90, Math.min(90, setting * 15));

// ---- Text ----

const UNIT_TEXT: Record<SuspensionUnit, string> = {
  mm: ' mm',
  in: ' in',
  'N/mm': ' N/mm',
  'lb/in': ' lb/in',
  N: ' N',
  lb: ' lb',
  clicks: '',
  setting: '',
};

const number = (value: number, decimals: number, signed: boolean) => {
  const shown = Number(value.toFixed(decimals));
  const text = Math.abs(shown).toFixed(decimals);
  return `${shown < 0 ? '−' : signed && shown > 0 ? '+' : signed ? '±' : ''}${text}`;
};

// A value with its unit: "57.4 mm", "+30 N/mm", "7" (clicks and settings are shown with the dictionaries' word);
// an ARB pair as "2–2"
export function formatSuspension(value: { value: number; unit: SuspensionUnit; decimals: number; pair?: [number, number] } | null, signed = false): string {
  if (!value) return '—';
  if (value.pair) return value.pair.map((p) => number(p, 0, signed)).join(signed ? ' / ' : '–');
  return `${number(value.value, value.decimals, signed)}${UNIT_TEXT[value.unit]}`;
}

// What a change is, as a key of the dictionaries' setups.suspension.direction (a fact about the values, never which
// is better)
export type ChangeDirection =
  | 'higher'
  | 'lower'
  | 'stiffer'
  | 'softer'
  | 'gapLarger'
  | 'gapSmaller'
  | 'clicksUp'
  | 'clicksDown'
  | 'settingUp'
  | 'settingDown'
  | 'settingChanged'
  | 'weightUp'
  | 'weightDown'
  | 'unchanged'
  | 'onlyBaseline'
  | 'onlyComparison'
  | 'unitsDiffer'
  | 'unsupported';

export function changeDirection(item: SuspensionItem): ChangeDirection {
  if (item.status !== 'changed') return item.status === 'same' ? 'unchanged' : item.status;
  const d = item.delta!.value;
  switch (item.param) {
    case 'rideHeight':
    case 'perchOffset':
    case 'arbSize':
      return d > 0 ? 'higher' : 'lower';
    case 'springRate':
      return d > 0 ? 'stiffer' : 'softer';
    case 'bumpGap':
      return d > 0 ? 'gapLarger' : 'gapSmaller';
    case 'cornerWeight':
      return d > 0 ? 'weightUp' : 'weightDown';
    case 'arb':
      if (item.delta!.pair) return 'settingChanged';
      return d > 0 ? 'settingUp' : 'settingDown';
    default:
      return d > 0 ? 'clicksUp' : 'clicksDown';
  }
}

// What the parameter influences in general, as a key of setups.suspension.topics
export type Topic = 'rideHeight' | 'springRate' | 'bumpGap' | 'perchOffset' | 'cornerWeight' | 'damperLow' | 'damperHigh' | 'damper' | 'arb' | 'arbSize';
export function topicOf(item: Pick<SuspensionItem, 'param'>): Topic {
  if (item.param === 'lsComp' || item.param === 'lsRbd') return 'damperLow';
  if (item.param === 'hsComp' || item.param === 'hsRbd') return 'damperHigh';
  if (item.param === 'comp' || item.param === 'rbd') return 'damper';
  return item.param;
}

// ---- The Setup Engineer ----

const PARAM_NAMES: Record<SuspensionParam, string> = {
  rideHeight: 'ride height',
  springRate: 'spring rate',
  bumpGap: 'bump rubber gap',
  perchOffset: 'spring perch offset',
  cornerWeight: 'corner weight (an iRacing reading)',
  lsComp: 'low-speed compression damping',
  hsComp: 'high-speed compression damping',
  comp: 'compression damping',
  lsRbd: 'low-speed rebound damping',
  hsRbd: 'high-speed rebound damping',
  rbd: 'rebound damping',
  arb: 'anti-roll bar setting',
  arbSize: 'anti-roll bar size',
};
const SCOPE_NAMES: Record<Corner | Axle, string> = {
  LF: 'Left front',
  RF: 'Right front',
  LR: 'Left rear',
  RR: 'Right rear',
  front: 'Front',
  rear: 'Rear',
};
const englishValue = (v: SuspensionValue | null) => (v ? v.raw.trim() : 'not in this setup');
const plain = (text: string) => text.replace(/−/g, '-');

// The structured comparison for the Setup Engineer's prompt (English, like every prompt): each value as the garage
// shows it, the deltas, the derived height differences, and what's unchanged, missing or couldn't be read
export function suspensionEngineerFacts(
  comparison: SuspensionComparison,
  names: { baseline: string; comparison: string; car: string | null }
): string[] {
  const line = (i: SuspensionItem) => {
    const delta = i.delta ? `, delta ${plain(formatSuspension(i.delta, true))}` : i.status === 'unitsDiffer' ? ', in different units so no delta' : '';
    const pct = i.param === 'springRate' ? percentChange(i) : null;
    return `- ${SCOPE_NAMES[i.scope]} ${PARAM_NAMES[i.param]} [${i.path}]: ${englishValue(i.baseline)} -> ${englishValue(i.comparison)}${delta}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`;
  };
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const same = comparison.items.filter((i) => i.status === 'same');
  const facts = [
    `Suspension comparison for ${names.car ?? 'the car'}: baseline "${names.baseline}" -> comparison "${names.comparison}". Values exactly as iRacing's garage shows them; deltas are comparison minus baseline.`,
    changed.length ? 'Changed suspension values:' : 'No suspension value differs between the two setups.',
    ...changed.map(line),
  ];
  if (same.length) facts.push('Unchanged suspension values:', ...same.map(line));
  for (const which of KINDS) {
    const d = heightDifference(comparison, which);
    if (d) facts.push(`${which === 'baseline' ? 'Baseline' : 'Comparison'} rear mean ride height minus front mean: ${plain(formatSuspension(d, true))} (between iRacing's measurement points; no rake angle, as the setup doesn't give the distance between them).`);
  }
  for (const axle of AXLES) {
    const a = heightAsymmetry(comparison, axle, 'baseline');
    const b = heightAsymmetry(comparison, axle, 'comparison');
    if ((a && Math.abs(a.value) > EPSILON) || (b && Math.abs(b.value) > EPSILON)) {
      facts.push(`${SCOPE_NAMES[axle]} ride height right minus left: baseline ${a ? plain(formatSuspension(a, true)) : 'unknown'}, comparison ${b ? plain(formatSuspension(b, true)) : 'unknown'}.`);
    }
  }
  const missing: string[] = [];
  for (const param of ['rideHeight', 'springRate', 'bumpGap'] as const) {
    const without = CORNERS.filter((c) => !findItem(comparison, c, param));
    if (without.length === 4) missing.push(PARAM_NAMES[param]);
    else if (without.length) missing.push(`${PARAM_NAMES[param]} at ${without.join(', ')}`);
  }
  if (comparison.dampers === 'none') missing.push('dampers');
  for (const axle of AXLES) if (!findItem(comparison, axle, 'arb') && !findItem(comparison, axle, 'arbSize')) missing.push(`${axle} anti-roll bar`);
  if (missing.length) facts.push(`Not in these setups (never assume a value): ${missing.join('; ')}.`);
  if (comparison.unsupported.length) {
    facts.push(`Suspension values that couldn't be read (left out): ${comparison.unsupported.map((i) => `${i.path} (${i.baselineRaw ?? '—'} -> ${i.comparisonRaw ?? '—'})`).join('; ')}.`);
  }
  facts.push(
    'Not known for this car: motion ratios (so no wheel rate or wheel travel), the damping force of a click (on some cars more clicks is stiffer, on others softer), the roll stiffness of an anti-roll bar setting, and where the ride heights are measured.'
  );
  return facts;
}

// How the Setup Engineer answers a suspension question (added to its system prompt)
export const SUSPENSION_ENGINEER_RULE =
  ' The driver asks about the suspension differences between two setups, listed in the facts: ride heights, springs,' +
  ' bump rubbers, dampers and anti-roll bars. Explain how each change may influence the static attitude and the' +
  ' height difference between the axles, mechanical grip and balance, load transfer and its distribution between the' +
  ' axles, platform control over curbs and bumps, braking and traction, and the aero platform, only for what' +
  ' actually changed. Keep established mechanical principles apart from what would happen on this car: findings are' +
  ' only what the values show, and anything about how this car will feel goes in hypotheses, each saying it needs' +
  ' telemetry or a track test to confirm. Never call either setup better. Use the values and units exactly as listed,' +
  ' never assume a missing value, never turn a spring rate into a wheel rate or wheel travel, never say which way a' +
  ' damper click moves the damping force, and never say a higher anti-roll bar setting is stiffer.';
