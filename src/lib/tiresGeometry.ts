// The Setups page's Tires tab (src/components/TireEngineeringView.tsx): the tires of two setups of the same car,
// found by parameter path in Compare's rows (setupCompare.ts), and what the drawings and tables need. Pure, with no
// React, so Node runs it (scripts/tires.test.mjs); the words are the dictionaries' (setups.tires), so nothing here is
// shown as it is except the values.
//
// What iRacing's CarSetup gives (scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml), in TiresAero: the tire type
// (TireType.TireType: Dry), each corner's StartingPressure (159 kPa), the setting, and three readings from the last run
// iRacing saw: LastHotPressure (159 kPa), LastTempsOMI or LastTempsIMO (35C, 35C, 35C: outer, middle, inner on the left
// tires and inner, middle, outer on the right, as the key says) and TreadRemaining (100%, 100%, 100%, across the tread
// in iRacing's order, which the key doesn't name). Readings are what iRacing measured, never adjusted directly, and
// from whatever run came before the capture, so they're shown apart from the setup's own values.
//
// Pressures convert exactly between kPa, psi and bar for display (1 psi = 6.894757 kPa, 1 bar = 100 kPa); the stored
// value and its decimals are kept. Nothing here predicts a hot pressure, grip, a contact patch's size or a tire's
// deflection: those drawings are conceptual and say so. The gas law illustration works on absolute pressure and
// kelvin only, for a hypothetical reference, never a setup's gauge pressure.
import { readValue } from './setupYaml.ts';
import { CORNERS, type Corner, type DisplayMode } from './alignmentGeometry.ts';

export { CORNERS, type Corner, type DisplayMode };
export { EXAGGERATIONS, DEFAULT_EXAGGERATION } from './alignmentGeometry.ts';

export type PressureUnit = 'kPa' | 'psi' | 'bar';
export const PRESSURE_UNITS: PressureUnit[] = ['kPa', 'psi', 'bar'];
const KPA_PER: Record<PressureUnit, number> = { kPa: 1, psi: 6.894757, bar: 100 };

export type TireParam = 'startPressure' | 'hotPressure' | 'temps' | 'tread' | 'type' | 'other';
export const READINGS: TireParam[] = ['hotPressure', 'temps', 'tread'];

const EPSILON = 1e-9;

export type TireValue = {
  // Exactly as iRacing wrote it
  raw: string;
  // A pressure in its own unit, the tread's or temperatures' three values, or text (the tire type)
  value: number | null;
  values: number[];
  unit: PressureUnit | 'C' | 'F' | '%' | 'text' | 'other';
  decimals: number;
};

export type TireStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'unitsDiffer' | 'unsupported';

export type TireItem = {
  id: string;
  // A corner, or 'car' for the tire type and anything not at a corner
  scope: Corner | 'car';
  param: TireParam;
  path: string;
  key: string;
  reading: boolean;
  // For temperatures: the order of the three values, from the key (OMI: outer, middle, inner)
  order: ('I' | 'M' | 'O')[] | null;
  baselineRaw: string | null;
  comparisonRaw: string | null;
  baseline: TireValue | null;
  comparison: TireValue | null;
  // Comparison minus baseline in kPa for pressures; null otherwise
  deltaKpa: number | null;
  status: TireStatus;
};

export type TireComparison = {
  items: TireItem[];
  unsupported: TireItem[];
  // Changes among the setup's own values (readings aren't changes to the setup)
  changedCount: number;
  // The unit iRacing gave the starting pressures in, the page's default
  sourceUnit: PressureUnit;
};

export type TireSourceRow = {
  path: string;
  group: string | null;
  section: string;
  key: string;
  kind: 'setting' | 'reading';
  baseline: string | null;
  comparison: string | null;
};

const CORNER_GROUPS: [RegExp, Corner][] = [
  [/^(?:Left\s*Front|LF)(?:Tire|Tyre)?$/i, 'LF'],
  [/^(?:Right\s*Front|RF)(?:Tire|Tyre)?$/i, 'RF'],
  [/^(?:Left\s*Rear|LR)(?:Tire|Tyre)?$/i, 'LR'],
  [/^(?:Right\s*Rear|RR)(?:Tire|Tyre)?$/i, 'RR'],
];
const cornerOf = (group: string | null): Corner | null => {
  if (!group) return null;
  for (const [pattern, corner] of CORNER_GROUPS) if (pattern.test(group)) return corner;
  return null;
};

function paramOf(key: string, path: string): { param: TireParam; order: TireItem['order'] } | null {
  if (/^(?:Starting|Cold)Pressure$/i.test(key)) return { param: 'startPressure', order: null };
  if (/^LastHotPressure$/i.test(key)) return { param: 'hotPressure', order: null };
  const temps = /^LastTemps([IMO]{3})$/i.exec(key);
  if (temps) return { param: 'temps', order: temps[1].toUpperCase().split('') as ('I' | 'M' | 'O')[] };
  if (/^TreadRemaining$/i.test(key)) return { param: 'tread', order: null };
  if (/^(?:TireType|TireCompound|Compound)$/i.test(key) && /tire|tyre/i.test(path)) return { param: 'type', order: null };
  return null;
}

const pressureUnit = (unit: string | null): PressureUnit | null => {
  const u = unit?.trim().toLowerCase();
  if (u === 'kpa') return 'kPa';
  if (u === 'psi') return 'psi';
  if (u === 'bar') return 'bar';
  return null;
};

// One raw value read for its parameter; 'unsupported' when it can't be read that way
export function readTireValue(raw: string | null, param: TireParam): TireValue | null | 'unsupported' {
  if (raw == null) return null;
  const text = raw.trim();
  if (param === 'type' || param === 'other') return text ? { raw, value: null, values: [], unit: 'text', decimals: 0 } : 'unsupported';
  if (param === 'startPressure' || param === 'hotPressure') {
    const read = readValue(text);
    const unit = pressureUnit(read.unit);
    if (read.value == null || !unit || read.value < 0) return 'unsupported';
    return { raw, value: read.value, values: [read.value], unit, decimals: read.decimals };
  }
  // Three values across the tread: temperatures (35C) or what's left of it (100%)
  const parts = text.split(/\s*,\s*/);
  const numbers: number[] = [];
  let unit: TireValue['unit'] | null = null;
  let decimals = 0;
  for (const part of parts) {
    const m = /^(-?\d+(?:\.\d+)?)\s*(°?[CF]|%)$/i.exec(part);
    if (!m) return 'unsupported';
    const u = m[2] === '%' ? '%' : (m[2].replace('°', '').toUpperCase() as 'C' | 'F');
    if (unit && unit !== u) return 'unsupported';
    unit = u;
    numbers.push(Number(m[1]));
    decimals = Math.max(decimals, m[1].includes('.') ? m[1].split('.')[1].length : 0);
  }
  if (numbers.length !== 3 || !unit) return 'unsupported';
  if (param === 'temps' && unit === '%') return 'unsupported';
  if (param === 'tread' && unit !== '%') return 'unsupported';
  return { raw, value: null, values: numbers, unit, decimals };
}

export const toKpa = (v: TireValue | null): number | null =>
  v && v.value != null && (v.unit === 'kPa' || v.unit === 'psi' || v.unit === 'bar') ? v.value * KPA_PER[v.unit] : null;
export const fromKpa = (kpa: number, unit: PressureUnit) => kpa / KPA_PER[unit];

export function compareTires(rows: readonly TireSourceRow[]): TireComparison {
  const items: TireItem[] = [];
  const unsupported: TireItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = paramOf(row.key, row.path);
    if (!kind) continue;
    const corner = cornerOf(row.group);
    const scope: Corner | 'car' | null = kind.param === 'type' ? 'car' : corner;
    const a = readTireValue(row.baseline, kind.param);
    const b = readTireValue(row.comparison, kind.param);
    const item: TireItem = {
      id: `${scope ?? '?'}.${kind.param}`,
      scope: scope ?? 'car',
      param: kind.param,
      path: row.path,
      key: row.key,
      reading: row.kind === 'reading' || READINGS.includes(kind.param),
      order: kind.order,
      baselineRaw: row.baseline,
      comparisonRaw: row.comparison,
      baseline: a === 'unsupported' ? null : a,
      comparison: b === 'unsupported' ? null : b,
      deltaKpa: null,
      status: 'same',
    };
    if (!scope || seen.has(item.id) || a === 'unsupported' || b === 'unsupported') {
      unsupported.push({ ...item, status: 'unsupported' });
      continue;
    }
    seen.add(item.id);
    const x = item.baseline;
    const y = item.comparison;
    if (!x) item.status = 'onlyComparison';
    else if (!y) item.status = 'onlyBaseline';
    else if (item.param === 'startPressure' || item.param === 'hotPressure') {
      const d = toKpa(y)! - toKpa(x)!;
      item.deltaKpa = Math.round(d * 1e6) / 1e6;
      item.status = Math.abs(d) < 1e-6 ? 'same' : 'changed';
    } else if (x.unit !== y.unit) item.status = 'unitsDiffer';
    else if (x.value == null && x.values.length === 0) item.status = x.raw.trim().toLowerCase() === y.raw.trim().toLowerCase() ? 'same' : 'changed';
    else item.status = x.values.every((v, i) => Math.abs(v - y.values[i]) < EPSILON) ? 'same' : 'changed';
    items.push(item);
  }
  const order: TireParam[] = ['type', 'startPressure', 'hotPressure', 'temps', 'tread', 'other'];
  const scopeOrder = ['car', ...CORNERS];
  items.sort((p, q) => order.indexOf(p.param) - order.indexOf(q.param) || scopeOrder.indexOf(p.scope) - scopeOrder.indexOf(q.scope));
  const first = items.find((i) => i.param === 'startPressure');
  const sourceUnit = ((first?.baseline ?? first?.comparison)?.unit as PressureUnit | undefined) ?? 'kPa';
  return {
    items,
    unsupported,
    changedCount: items.filter((i) => i.status !== 'same' && !i.reading).length,
    sourceUnit: PRESSURE_UNITS.includes(sourceUnit) ? sourceUnit : 'kPa',
  };
}

export function findItem(comparison: TireComparison, scope: Corner | 'car', param: TireParam): TireItem | null {
  return comparison.items.find((i) => i.scope === scope && i.param === param) ?? null;
}

export type Which = 'baseline' | 'comparison';
export const KINDS: Which[] = ['baseline', 'comparison'];
export const visibleKinds = (mode: DisplayMode): Which[] => KINDS.filter((k) => mode === 'overlay' || mode === k);
export const toneOf = (item: TireItem | null, which: Which) =>
  item?.status === 'same' ? 'align-unchanged' : which === 'baseline' ? 'align-baseline' : 'align-comparison';

export const pressureOf = (comparison: TireComparison, corner: Corner, which: Which, param: 'startPressure' | 'hotPressure' = 'startPressure') =>
  findItem(comparison, corner, param)?.[which] ?? null;

// ---- Pressures ----

// A pressure (in kPa) shown in a unit: the value's own decimals when it's shown in its own unit, else enough to be exact
// to the source (psi 2, bar 3, kPa 1)
export function formatPressure(kpa: number | null, unit: PressureUnit, opts: { signed?: boolean; source?: TireValue | null } = {}): string {
  if (kpa == null || !Number.isFinite(kpa)) return '—';
  const source = opts.source;
  const value = source && source.unit === unit && source.value != null && !opts.signed ? source.value : fromKpa(kpa, unit);
  const decimals = source && source.unit === unit ? source.decimals : unit === 'bar' ? 3 : unit === 'psi' ? 2 : 1;
  const shown = Number(value.toFixed(decimals));
  const sign = shown < 0 ? '−' : opts.signed && shown > 0 ? '+' : opts.signed ? '±' : '';
  return `${sign}${Math.abs(shown).toFixed(decimals)} ${unit}`;
}

export const formatValuePressure = (v: TireValue | null, unit: PressureUnit) => formatPressure(toKpa(v), unit, { source: v });

export function percentChange(a: TireValue | null, b: TireValue | null): number | null {
  const x = toKpa(a);
  const y = toKpa(b);
  return x != null && y != null && x !== 0 ? ((y - x) / x) * 100 : null;
}

export type PressureBalance = {
  front: number | null;
  rear: number | null;
  frontRear: number | null;
  leftRight: number | null;
  highest: number | null;
  lowest: number | null;
  spread: number | null;
};
export const BALANCE_KEYS: (keyof PressureBalance)[] = ['front', 'rear', 'frontRear', 'leftRight', 'highest', 'lowest', 'spread'];

// One setup's pressure balance in kPa: an axle's or side's mean needs both its corners, the extremes and spread all four
export function pressureBalance(comparison: TireComparison, which: Which, param: 'startPressure' | 'hotPressure' = 'startPressure'): PressureBalance {
  const v = Object.fromEntries(CORNERS.map((c) => [c, toKpa(pressureOf(comparison, c, which, param))])) as Record<Corner, number | null>;
  const mean = (a: Corner, b: Corner) => (v[a] != null && v[b] != null ? (v[a]! + v[b]!) / 2 : null);
  const front = mean('LF', 'RF');
  const rear = mean('LR', 'RR');
  const left = mean('LF', 'LR');
  const right = mean('RF', 'RR');
  const all = CORNERS.every((c) => v[c] != null) ? CORNERS.map((c) => v[c]!) : null;
  const highest = all ? Math.max(...all) : null;
  const lowest = all ? Math.min(...all) : null;
  return {
    front,
    rear,
    frontRear: front != null && rear != null ? front - rear : null,
    leftRight: left != null && right != null ? left - right : null,
    highest,
    lowest,
    spread: highest != null && lowest != null ? highest - lowest : null,
  };
}

// The rise from the starting pressure to iRacing's last hot pressure at a corner, in kPa (both in the same setup)
export function pressureRise(comparison: TireComparison, corner: Corner, which: Which): number | null {
  const cold = toKpa(pressureOf(comparison, corner, which));
  const hot = toKpa(pressureOf(comparison, corner, which, 'hotPressure'));
  return cold != null && hot != null ? hot - cold : null;
}

// The gauges' scale: every starting and hot pressure of both setups, padded and rounded to 10 kPa
export function gaugeRange(comparison: TireComparison): { min: number; max: number } | null {
  const values = comparison.items
    .filter((i) => i.param === 'startPressure' || i.param === 'hotPressure')
    .flatMap((i) => [toKpa(i.baseline), toKpa(i.comparison)])
    .filter((v): v is number => v != null);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(20, (high - low) / 2);
  return { min: Math.max(0, Math.floor((low - pad) / 10) * 10), max: Math.ceil((high + pad) / 10) * 10 };
}

export const gaugeFraction = (kpa: number | null, range: { min: number; max: number } | null) =>
  kpa == null || !range || range.max <= range.min ? null : Math.max(0, Math.min(1, (kpa - range.min) / (range.max - range.min)));

// ---- Temperatures and tread ----

export type TreadTemps = { inner: number; middle: number; outer: number; unit: 'C' | 'F'; decimals: number };

// The three temperatures as inner, middle, outer, from the key's order
export function treadTemps(item: TireItem | null, which: Which): TreadTemps | null {
  const v = item?.[which];
  if (!item?.order || !v || v.values.length !== 3 || (v.unit !== 'C' && v.unit !== 'F')) return null;
  const at = (side: 'I' | 'M' | 'O') => v.values[item.order!.indexOf(side)];
  return { inner: at('I'), middle: at('M'), outer: at('O'), unit: v.unit, decimals: v.decimals };
}

// Inner minus outer, and the middle minus the edges' mean: how the heat lies across the tread (measured, no verdict)
export function tempSpread(t: TreadTemps | null): { innerOuter: number; middleEdges: number } | null {
  return t ? { innerOuter: t.inner - t.outer, middleEdges: t.middle - (t.inner + t.outer) / 2 } : null;
}

// The three bands across a tire as drawn on screen, left to right: a left tire's outer edge is on the screen's left in
// the top view (car's nose up), a right tire's inner edge
export function bandsOnScreen(t: TreadTemps, corner: Corner): number[] {
  return corner.startsWith('L') ? [t.outer, t.middle, t.inner] : [t.inner, t.middle, t.outer];
}

// The heat scale's range: every temperature of both setups in one unit (relative, never an operating window)
export function tempRange(comparison: TireComparison): { min: number; max: number; unit: 'C' | 'F' } | null {
  const values: number[] = [];
  let unit: 'C' | 'F' | null = null;
  for (const item of comparison.items.filter((i) => i.param === 'temps')) {
    for (const which of KINDS) {
      const t = treadTemps(item, which);
      if (!t) continue;
      if (unit && unit !== t.unit) continue;
      unit = t.unit;
      values.push(t.inner, t.middle, t.outer);
    }
  }
  if (!values.length || !unit) return null;
  return { min: Math.min(...values), max: Math.max(...values), unit };
}

// A temperature's place on the relative scale, 0 (coolest reading) to 1 (hottest); 0.5 when they're all the same
export const heatFraction = (value: number, range: { min: number; max: number } | null) =>
  !range || range.max - range.min < EPSILON ? 0.5 : (value - range.min) / (range.max - range.min);

// The tread left: the three values, their lowest and mean
export function treadLeft(item: TireItem | null, which: Which): { values: number[]; lowest: number; mean: number } | null {
  const v = item?.[which];
  if (!v || v.unit !== '%' || v.values.length !== 3) return null;
  return { values: v.values, lowest: Math.min(...v.values), mean: v.values.reduce((s, x) => s + x, 0) / 3 };
}

// ---- Illustrations ----

export type TireView = 'overview' | 'cutaway' | 'patch' | 'type' | 'readings';
export const TIRE_VIEWS: TireView[] = ['overview', 'cutaway', 'patch', 'type', 'readings'];

// What every drawing is given
export type TireDrawingProps = {
  comparison: TireComparison;
  mode: DisplayMode;
  selected: Corner;
  onSelect: (corner: Corner) => void;
  unit: PressureUnit;
  exaggeration: number;
};

// The tire type drawn: a slick for dry, grooves for wet or intermediate, a plain schematic otherwise
export function tireKind(item: TireItem | null, which: Which): 'dry' | 'wet' | 'unknown' {
  const name = item?.[which]?.raw.trim().toLowerCase() ?? '';
  if (/\bdry\b|slick/.test(name)) return 'dry';
  if (/\bwet\b|rain|inter/.test(name)) return 'wet';
  return 'unknown';
}

// A symbolic sidewall bulge for a pressure against a reference pressure (both kPa): never a stiffness or load model
export function conceptualDeflection(kpa: number | null, referenceKpa: number | null, exaggeration: number): number {
  if (kpa == null || referenceKpa == null) return 0;
  return Math.max(-12, Math.min(12, ((referenceKpa - kpa) / Math.max(referenceKpa, 1)) * 18 * exaggeration));
}

// Constant-volume gas law on absolute values (P₁/T₁ = P₂/T₂): the illustration's only physics, for a hypothetical tire
export function constantVolumePressure(absoluteKpa: number, initialKelvin: number, finalKelvin: number): number | null {
  return [absoluteKpa, initialKelvin, finalKelvin].every((n) => Number.isFinite(n) && n > 0) ? (absoluteKpa * finalKelvin) / initialKelvin : null;
}
export const GAS_REFERENCE = { absoluteKpa: 260, kelvin: 300 } as const;

// ---- Text ----

export function formatTemps(t: TreadTemps | null): string {
  if (!t) return '—';
  const n = (v: number) => v.toFixed(t.decimals);
  return `${n(t.inner)} / ${n(t.middle)} / ${n(t.outer)} °${t.unit}`;
}

export const formatSigned = (value: number, decimals: number, unit: string) => {
  const shown = Number(value.toFixed(decimals));
  return `${shown < 0 ? '−' : shown > 0 ? '+' : '±'}${Math.abs(shown).toFixed(decimals)}${unit}`;
};

// ---- The Setup Engineer ----

const CORNER_NAMES: Record<Corner, string> = { LF: 'Left front', RF: 'Right front', LR: 'Left rear', RR: 'Right rear' };
const plain = (text: string) => text.replace(/−/g, '-');

// The structured comparison for the Setup Engineer's prompt (English, like every prompt): the tire type, each starting
// pressure as the garage shows it with the deltas and balance, and iRacing's last-run readings apart from the setup
export function tireEngineerFacts(comparison: TireComparison, names: { baseline: string; comparison: string; car: string | null; track?: string | null }): string[] {
  const unit = comparison.sourceUnit;
  const facts = [
    `Tire comparison for ${names.car ?? 'the car'}${names.track ? ` at ${names.track}` : ''}: baseline "${names.baseline}" -> comparison "${names.comparison}". Values exactly as iRacing's garage shows them; deltas are comparison minus baseline.`,
  ];
  const type = findItem(comparison, 'car', 'type');
  if (type) facts.push(`Tire type [${type.path}]: ${type.baseline?.raw.trim() ?? 'not in this setup'} -> ${type.comparison?.raw.trim() ?? 'not in this setup'}${type.status === 'same' ? ' (unchanged)' : ''}.`);
  const starts = CORNERS.map((c) => findItem(comparison, c, 'startPressure')).filter((i): i is TireItem => !!i);
  if (starts.length) {
    facts.push('Starting (cold) pressures, the setup values:');
    for (const i of starts) {
      const pct = percentChange(i.baseline, i.comparison);
      const delta = i.deltaKpa != null ? `, delta ${plain(formatPressure(i.deltaKpa, unit, { signed: true }))}${pct != null && i.status === 'changed' ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}` : '';
      facts.push(`- ${CORNER_NAMES[i.scope as Corner]} [${i.path}]: ${i.baseline?.raw.trim() ?? 'not in this setup'} -> ${i.comparison?.raw.trim() ?? 'not in this setup'}${delta}`);
    }
    for (const which of KINDS) {
      const b = pressureBalance(comparison, which);
      const parts = [
        b.frontRear != null ? `front minus rear ${plain(formatPressure(b.frontRear, unit, { signed: true }))}` : null,
        b.leftRight != null ? `left minus right ${plain(formatPressure(b.leftRight, unit, { signed: true }))}` : null,
        b.spread != null ? `four-corner spread ${formatPressure(b.spread, unit)}` : null,
      ].filter(Boolean);
      if (parts.length) facts.push(`${which === 'baseline' ? 'Baseline' : 'Comparison'} starting pressure balance: ${parts.join(', ')}.`);
    }
  } else facts.push('Neither setup gives starting pressures (never assume one).');
  const readings: string[] = [];
  for (const corner of CORNERS) {
    for (const which of KINDS) {
      const hot = pressureOf(comparison, corner, which, 'hotPressure');
      const rise = pressureRise(comparison, corner, which);
      const temps = treadTemps(findItem(comparison, corner, 'temps'), which);
      const spread = tempSpread(temps);
      const tread = treadLeft(findItem(comparison, corner, 'tread'), which);
      const bits = [
        hot ? `last hot pressure ${hot.raw.trim()}${rise != null ? ` (${plain(formatPressure(rise, unit, { signed: true }))} from its starting pressure)` : ''}` : null,
        temps ? `tread temperatures inner/middle/outer ${formatTemps(temps)} (inner minus outer ${plain(formatSigned(spread!.innerOuter, temps.decimals, `°${temps.unit}`))}, middle minus edges ${plain(formatSigned(spread!.middleEdges, temps.decimals + 1, `°${temps.unit}`))})` : null,
        tread ? `tread remaining ${tread.values.join('%, ')}%` : null,
      ].filter(Boolean);
      if (bits.length) readings.push(`- ${CORNER_NAMES[corner]}, ${which}: ${bits.join('; ')}`);
    }
  }
  if (readings.length) {
    facts.push(
      "iRacing's readings from the last run before each setup was captured (measured, not setup values, and from whatever run that was; say so if you use them):",
      ...readings
    );
  }
  if (comparison.unsupported.length) {
    facts.push(`Tire values that couldn't be read (left out): ${comparison.unsupported.map((i) => `${i.path} (${i.baselineRaw ?? '—'} -> ${i.comparisonRaw ?? '—'})`).join('; ')}.`);
  }
  facts.push(
    'Not known: target hot pressures or operating temperature windows for this tire, the tire load, its stiffness, contact patch size or deflection, and the weather of the run the readings came from.'
  );
  return facts;
}

// How the Setup Engineer answers a tire question (added to its system prompt)
export const TIRES_ENGINEER_RULE =
  ' The driver asks about the tire differences between two setups, listed in the facts: the tire type, starting' +
  " pressures and their balance, and iRacing's readings from the last run. Explain how each change may influence the" +
  ' tire’s warm-up, its pressure as it heats, the contact patch, grip and balance between the axles, steering response,' +
  ' and wear, only for what actually changed. Keep established principles apart from what would happen on this car:' +
  ' findings are only what the values show, and anything about how this car will feel goes in hypotheses, each saying' +
  ' it needs telemetry or a track test to confirm. The readings are measurements from one earlier run, not setup' +
  ' values: never treat them as a target or a prediction. Never call either setup better, never give a target hot' +
  ' pressure or an operating temperature window, use the values and units exactly as listed and never assume a missing value.';
