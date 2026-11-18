// The Setups page's Aerodynamics, Differential & Drivetrain, Fuel, Electronics and Other tabs
// (src/components/SetupDashboardView.tsx and the dashboards): every parameter of one of setupYaml.ts's categories, from
// Compare's rows (setupCompare.ts), with the ones the drawings know by key given a role. Pure, with no React, so Node
// runs it (scripts/setup-dashboards.test.mjs); the words are the dictionaries' (setups.dashboards).
//
// What iRacing's CarSetup gives for them (scripts/fixtures/setups/bmwm4gt3-fixed-carsetup.yaml):
// - aero: Chassis.Rear.WingAngle (6 degrees) and CenterFrontSplitterHeight (50.6 mm), settings, and iRacing's aero
//   calculator, TiresAero.AeroBalanceCalc: FrontRhAtSpeed (50 mm), RearRhAtSpeed (70 mm), WingSetting (6 degrees) and
//   FrontDownforce (43.4%), readings it works out from the setup. FrontDownforce is the front's share of the downforce
//   by its name, so it alone splits front and rear; the wing angle and the calculator's wing setting stay apart
// - drivetrain: GearsDifferential.GearStack (FIA, text), FrictionFaces (10) and DiffPreload (85 Nm)
// - fuel: Chassis.Rear.FuelLevel (50.0 L). The tank's size isn't in the setup, nor the fuel's density
// - electronics: InCarAdjustments.TcSetting (3 (TC)); ABS is in the brakes category but shown here too, as a driver aid
// - other: whatever no other category takes (nothing on this car); a throttle shape setting when a car has one
// Nothing is converted or predicted: no downforce or drag from a wing angle, no locking torque from preload or faces,
// no intervention strength from a TC or ABS number, no throttle map from a setting number, no fuel mass without a
// density the driver gives, no fuel plan without the laps and consumption the driver gives.
import { readValue, type SetupCategory } from './setupYaml.ts';

export const SETUP_DASHBOARDS = ['aero', 'drivetrain', 'fuel', 'electronics', 'other'] as const;
export type SetupDashboard = (typeof SETUP_DASHBOARDS)[number];
export const isSetupDashboard = (value: unknown): value is SetupDashboard => (SETUP_DASHBOARDS as readonly unknown[]).includes(value);

export type DashboardRole =
  | 'wingAngle'
  | 'wingSetting'
  | 'frontRhSpeed'
  | 'rearRhSpeed'
  | 'frontDownforce'
  | 'splitter'
  | 'preload'
  | 'frictionFaces'
  | 'gearStack'
  | 'fuelLevel'
  | 'tc'
  | 'abs'
  | 'engineMap'
  | 'display'
  | 'lights'
  | 'throttleShape';

const ROLES: Record<SetupDashboard, [RegExp, DashboardRole][]> = {
  aero: [
    [/^(?:Rear)?WingAngle$/i, 'wingAngle'],
    [/^WingSetting$/i, 'wingSetting'],
    [/^FrontRhAtSpeed$/i, 'frontRhSpeed'],
    [/^RearRhAtSpeed$/i, 'rearRhSpeed'],
    [/^FrontDownforce$/i, 'frontDownforce'],
    [/Splitter.*Height|SplitterHeight/i, 'splitter'],
  ],
  drivetrain: [
    [/^DiffPreload$|Preload$/i, 'preload'],
    [/^FrictionFaces?$/i, 'frictionFaces'],
    [/^GearStack$/i, 'gearStack'],
  ],
  fuel: [[/^FuelLevel$/i, 'fuelLevel']],
  electronics: [
    [/^Tc(?:Setting)?\d?$|^TractionControl/i, 'tc'],
    [/^Abs(?:Setting)?$/i, 'abs'],
    [/EngineMap|^Map$|Mixture/i, 'engineMap'],
    [/Display|DashPage|Dash$/i, 'display'],
    [/Light/i, 'lights'],
  ],
  other: [[/Throttle(?:Shape|Map)?/i, 'throttleShape']],
};

export type DashValue = {
  // Exactly as iRacing wrote it
  raw: string;
  value: number | null;
  unit: string | null;
  decimals: number;
};

export type DashStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'unitsDiffer';

export type DashboardItem = {
  path: string;
  section: string;
  group: string | null;
  key: string;
  role: DashboardRole | null;
  // Measured or worked out by iRacing (its aero calculator), never adjusted directly
  reading: boolean;
  // Taken from another category (ABS from brakes), so shown here too
  borrowed: boolean;
  baselineRaw: string | null;
  comparisonRaw: string | null;
  baseline: DashValue | null;
  comparison: DashValue | null;
  // Comparison minus baseline in their unit, when both are one number in one unit
  delta: { value: number; unit: string | null; decimals: number } | null;
  status: DashStatus;
};

export type DashboardComparison = {
  dashboard: SetupDashboard;
  items: DashboardItem[];
  // Changes among the setup's own values (readings aren't changes to the setup)
  changedCount: number;
};

// What a comparison row needs to have (setupCompare.ts's CompareRow fits)
export type DashboardSourceRow = {
  path: string;
  group: string | null;
  section: string;
  key: string;
  kind: 'setting' | 'reading';
  category: SetupCategory;
  baseline: string | null;
  comparison: string | null;
};

const read = (raw: string | null): DashValue | null => {
  if (raw == null) return null;
  const v = readValue(raw);
  return { raw, value: v.value, unit: v.unit, decimals: v.decimals };
};

const roleOf = (dashboard: SetupDashboard, key: string): DashboardRole | null => {
  for (const [pattern, role] of ROLES[dashboard]) if (pattern.test(key)) return role;
  return null;
};

export function compareDashboard(dashboard: SetupDashboard, rows: readonly DashboardSourceRow[]): DashboardComparison {
  const items: DashboardItem[] = [];
  const roles = new Set<DashboardRole>();
  for (const row of rows) {
    const own = row.category === dashboard;
    const borrowed = !own && dashboard === 'electronics' && row.category === 'brakes' && /^Abs(?:Setting)?$/i.test(row.key);
    if (!own && !borrowed) continue;
    let role = roleOf(dashboard, row.key);
    // One item per role: a second wing angle elsewhere is shown, but not drawn
    if (role && roles.has(role)) role = null;
    if (role) roles.add(role);
    const a = read(row.baseline);
    const b = read(row.comparison);
    const item: DashboardItem = {
      path: row.path,
      section: row.section,
      group: row.group,
      key: row.key,
      role,
      reading: row.kind === 'reading',
      borrowed,
      baselineRaw: row.baseline,
      comparisonRaw: row.comparison,
      baseline: a,
      comparison: b,
      delta: null,
      status: 'same',
    };
    if (!a) item.status = 'onlyComparison';
    else if (!b) item.status = 'onlyBaseline';
    else if (a.value != null && b.value != null) {
      if (a.unit !== b.unit) item.status = 'unitsDiffer';
      else {
        const value = Math.round((b.value - a.value) * 1e6) / 1e6;
        item.delta = { value, unit: a.unit, decimals: Math.max(a.decimals, b.decimals) };
        item.status = Math.abs(value) < 1e-9 ? 'same' : 'changed';
      }
    } else item.status = a.raw.trim().toLowerCase() === b.raw.trim().toLowerCase() ? 'same' : 'changed';
    items.push(item);
  }
  // Settings first, then readings, each in the garage's order
  items.sort((p, q) => Number(p.reading) - Number(q.reading));
  return { dashboard, items, changedCount: items.filter((i) => i.status !== 'same' && !i.reading).length };
}

export const byRole = (comparison: DashboardComparison, role: DashboardRole) => comparison.items.find((i) => i.role === role) ?? null;

export type Which = 'baseline' | 'comparison';
export const KINDS: Which[] = ['baseline', 'comparison'];
export type DisplayMode = 'baseline' | 'comparison' | 'overlay';
export const visibleKinds = (mode: DisplayMode): Which[] => KINDS.filter((k) => mode === 'overlay' || mode === k);
export const toneOf = (item: DashboardItem | null, which: Which) =>
  item?.status === 'same' ? 'align-unchanged' : which === 'baseline' ? 'align-baseline' : 'align-comparison';

// A number of an item in one of the units given, or null
export function numberOf(item: DashboardItem | null, which: Which, units: (string | null)[]): number | null {
  const v = item?.[which];
  return v && v.value != null && units.includes(v.unit) ? v.value : null;
}

// ---- Aerodynamics ----

// The front/rear split from iRacing's aero calculator's FrontDownforce, a percentage of the downforce at the front
export function aeroBalance(comparison: DashboardComparison, which: Which): { front: number; rear: number; decimals: number } | null {
  const item = byRole(comparison, 'frontDownforce');
  const front = numberOf(item, which, ['%']);
  if (front == null || front < 0 || front > 100) return null;
  return { front, rear: Math.round((100 - front) * 1e6) / 1e6, decimals: item![which]!.decimals };
}

// Rear minus front ride height at speed, from the aero calculator, when both are in one length unit
export function heightAtSpeedDifference(comparison: DashboardComparison, which: Which): { value: number; unit: string; decimals: number } | null {
  const f = byRole(comparison, 'frontRhSpeed')?.[which];
  const r = byRole(comparison, 'rearRhSpeed')?.[which];
  if (!f || !r || f.value == null || r.value == null || f.unit !== r.unit || (f.unit !== 'mm' && f.unit !== 'in')) return null;
  return { value: Math.round((r.value - f.value) * 1e6) / 1e6, unit: f.unit, decimals: Math.max(f.decimals, r.decimals) };
}

// The wing's angle in the drawing: its degrees, exaggerated, within limits (a drawing, never an aerodynamic model)
export const wingDrawAngle = (degrees: number | null, exaggeration: number) => (degrees == null ? 0 : Math.max(-35, Math.min(35, degrees * exaggeration * 0.6)));

// ---- Drivetrain ----

// A preload drawn as how far the clutch pack's spring is squeezed, relative to the larger of the two (schematic)
export function preloadShare(comparison: DashboardComparison, which: Which): number | null {
  const item = byRole(comparison, 'preload');
  const v = numberOf(item, which, ['Nm', 'ft-lbs', 'lb-ft', 'ftlbs']);
  const max = Math.max(numberOf(item, 'baseline', ['Nm', 'ft-lbs', 'lb-ft', 'ftlbs']) ?? 0, numberOf(item, 'comparison', ['Nm', 'ft-lbs', 'lb-ft', 'ftlbs']) ?? 0);
  return v == null || max <= 0 ? null : v / max;
}

// The friction faces as a count, when one is given
export const frictionFaces = (comparison: DashboardComparison, which: Which) => {
  const v = numberOf(byRole(comparison, 'frictionFaces'), which, [null, 'faces']);
  return v != null && Number.isInteger(v) && v >= 0 && v <= 40 ? v : null;
};

// ---- Fuel ----

export const FUEL_VOLUME_UNITS = ['L', 'l', 'gal', 'Gal'] as const;
const LITRES_PER_GALLON = 3.785411784;

// The fuel level in litres (US gallons converted exactly), or null
export function fuelLitres(comparison: DashboardComparison, which: Which): number | null {
  const v = byRole(comparison, 'fuelLevel')?.[which];
  if (!v || v.value == null || v.value < 0) return null;
  if (v.unit === 'L' || v.unit === 'l') return v.value;
  if (v.unit === 'gal' || v.unit === 'Gal') return v.value * LITRES_PER_GALLON;
  return null;
}

// The fuel's mass for a density the driver gives (kg per litre): never assumed silently
export const fuelMassKg = (litres: number | null, density: number) => (litres != null && Number.isFinite(density) && density > 0 ? litres * density : null);

// A race's fuel from the driver's own estimates: what's needed with the reserve, how many laps the fuel covers past the
// reserve, and what's left over (negative: short)
export function fuelPlan(startLitres: number | null, laps: number, perLap: number, reserve: number) {
  if (startLitres == null || ![laps, perLap, reserve].every(Number.isFinite) || laps <= 0 || perLap <= 0 || reserve < 0) return null;
  const required = laps * perLap + reserve;
  return { required, lapsCovered: Math.max(0, startLitres - reserve) / perLap, surplus: startLitres - required };
}

// The laps a timed race runs at a lap time the driver gives (rounded up: the leader finishes the lap they're on)
export const lapsForDuration = (minutes: number, lapSeconds: number) =>
  Number.isFinite(minutes) && Number.isFinite(lapSeconds) && minutes > 0 && lapSeconds > 0 ? Math.ceil((minutes * 60) / lapSeconds) : null;

// ---- Electronics ----

// A discrete setting's position on a dial: the larger of the two setups' values and 10 set the dial's range (schematic)
export function dialRange(item: DashboardItem | null): number {
  return Math.max(10, numberOf(item, 'baseline', [null]) ?? 0, numberOf(item, 'comparison', [null]) ?? 0);
}

// ---- Other ----

// The throttle drawing: pedal to command with an illustrative bend per setting step. Not a car's map: none is in the
// setup, so the curve is labelled schematic and the same setting on two cars draws the same
export const illustrativeThrottle = (pedal: number, setting: number | null) => {
  if (setting == null) return pedal;
  const gamma = Math.max(0.4, Math.min(2.5, 1 + (setting - 3) * 0.18));
  return 100 * (pedal / 100) ** (1 / gamma);
};

// ---- Text ----

export function formatDash(value: { value: number | null; unit: string | null; decimals: number; raw?: string } | null, signed = false): string {
  if (!value) return '—';
  if (value.value == null) return value.raw?.trim() || '—';
  const shown = Number(value.value.toFixed(value.decimals));
  const sign = shown < 0 ? '−' : signed && shown > 0 ? '+' : signed ? '±' : '';
  const unit = value.unit ? (value.unit === '%' ? '%' : ` ${value.unit}`) : '';
  return `${sign}${Math.abs(shown).toFixed(value.decimals)}${unit}`;
}

// ---- The Setup Engineer ----

const TITLES: Record<SetupDashboard, string> = {
  aero: 'Aerodynamics',
  drivetrain: 'Differential and drivetrain',
  fuel: 'Fuel',
  electronics: 'Electronics',
  other: 'Other',
};
const plain = (text: string) => text.replace(/−/g, '-');

// The structured comparison for the Setup Engineer's prompt (English, like every prompt)
export function dashboardEngineerFacts(
  dashboard: SetupDashboard,
  comparison: DashboardComparison,
  names: { baseline: string; comparison: string; car: string | null }
): string[] {
  const line = (i: DashboardItem) =>
    `- ${i.key}${i.reading ? " (iRacing's own calculation, not a setting)" : ''}${i.borrowed ? ' (also a brake setting)' : ''} [${i.path}]: ${i.baseline?.raw.trim() ?? 'not in this setup'} -> ${i.comparison?.raw.trim() ?? 'not in this setup'}${i.delta && i.status === 'changed' ? `, delta ${plain(formatDash(i.delta, true))}` : ''}${i.status === 'unitsDiffer' ? ', in different units so no delta' : ''}`;
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const same = comparison.items.filter((i) => i.status === 'same');
  const facts = [
    `${TITLES[dashboard]} comparison for ${names.car ?? 'the car'}: baseline "${names.baseline}" -> comparison "${names.comparison}". Values exactly as iRacing's garage shows them; deltas are comparison minus baseline.`,
  ];
  if (!comparison.items.length) facts.push(`Neither setup has ${TITLES[dashboard].toLowerCase()} parameters.`);
  else {
    facts.push(changed.length ? 'Changed values:' : 'No value differs between the two setups.', ...changed.map(line));
    if (same.length) facts.push('Unchanged values:', ...same.map(line));
  }
  if (dashboard === 'aero') {
    for (const which of KINDS) {
      const b = aeroBalance(comparison, which);
      const h = heightAtSpeedDifference(comparison, which);
      if (b) facts.push(`${which === 'baseline' ? 'Baseline' : 'Comparison'} aero balance from iRacing's calculator: ${b.front.toFixed(b.decimals)}% front / ${b.rear.toFixed(b.decimals)}% rear (a share, not total downforce).`);
      if (h) facts.push(`${which === 'baseline' ? 'Baseline' : 'Comparison'} rear minus front ride height at speed: ${plain(formatDash(h, true))}.`);
    }
    facts.push('Not known: total downforce, drag, the aero map, or how the wing angle and splitter height change them on this car.');
  }
  if (dashboard === 'drivetrain') facts.push('Not known: locking torque or percentage, ramp angles unless listed, clutch plate count (friction faces are not plates), and gear ratios unless listed.');
  if (dashboard === 'fuel') facts.push("Not known: the tank's capacity, the fuel's density, consumption per lap and the race length; never assume them.");
  if (dashboard === 'electronics') facts.push('Not known: what each TC, ABS or map position does on this car; a higher number is not assumed to intervene more.');
  if (dashboard === 'other') facts.push('Not known: any throttle map or what these settings do on this car.');
  return facts;
}

const COMMON =
  ' Keep established principles apart from what would happen on this car: findings are only what the values show, and' +
  ' anything about how this car will feel goes in hypotheses, each saying it needs telemetry or a track test to confirm.' +
  " Never call either setup better, use the values and units exactly as listed, never assume a missing value, and treat iRacing's calculated values as its calculations, not settings.";

// How the Setup Engineer answers a question about one dashboard (added to its system prompt)
export const DASHBOARD_ENGINEER_RULES: Record<SetupDashboard, string> = {
  aero:
    ' The driver asks about the aerodynamic differences between two setups, listed in the facts. Explain how each change may influence the aero balance, high-speed stability, corner balance at speed, straight-line speed and the ride height at speed, only for what changed. Never put a number on downforce or drag.' +
    COMMON,
  drivetrain:
    ' The driver asks about the differential and drivetrain differences between two setups, listed in the facts. Explain how each change may influence corner entry under coasting, mid-corner rotation, traction on exit and the transitions between power and coast, only for what changed. Never put a number on locking.' +
    COMMON,
  fuel:
    ' The driver asks about the fuel differences between two setups, listed in the facts. Explain how the fuel load may influence the car’s mass, braking, acceleration, tire load and how far the fuel lasts, only for what changed. Never work out a fuel plan without the consumption and race length.' +
    COMMON,
  electronics:
    ' The driver asks about the electronics differences between two setups, listed in the facts: driver aids and maps. Explain how each change may influence traction, stability, tire wear and how the car responds, only for what changed. Never say what a setting number does on this car.' +
    COMMON,
  other: ' The driver asks about the other setup differences between two setups, listed in the facts. Explain what each change may influence, only for what changed.' + COMMON,
};
