// iRacing's CarSetup section of the session info YAML, as the telemetry collector captures it (SetupCapture.cs),
// turned into a flat list of parameters for the Setups page (docs/setups.md). Pure, with no imports, so Node runs it
// directly (scripts/setups.test.mjs) and client components can use it.
//
// What iRacing writes is the garage's own display: every value is text with its unit as the driver's iRacing shows it
// (e.g. "223 N/mm", "51.00%", "3 (ABS)", "35C, 35C, 35C"), nested by the garage's tabs and boxes, e.g.
//   CarSetup:
//    UpdateCount: 5
//    Chassis:
//     LeftFront:
//      SpringRate: 223 N/mm
// The keys differ from car to car, so nothing here assumes which exist: each parameter is identified by its path
// (Chassis.LeftFront.SpringRate) and only compared or changed against the same path of the same car. Values are kept
// exactly as written (raw); the number and unit are read from them only when the text is a plain number and unit.
// Which values are adjustable isn't in the YAML: readings (measured or worked out by iRacing, e.g. corner weights,
// last hot pressures, tread left, the aero calculator) are told apart by name (READING_KEYS), and say so.

export type SetupCategory =
  | 'tires'
  | 'suspension'
  | 'alignment'
  | 'brakes'
  | 'aero'
  | 'drivetrain'
  | 'fuel'
  | 'electronics'
  | 'other';

// In the order the Setups page shows them
export const SETUP_CATEGORIES: readonly SetupCategory[] = [
  'tires',
  'suspension',
  'alignment',
  'brakes',
  'aero',
  'drivetrain',
  'fuel',
  'electronics',
  'other',
];

export type SetupParameter = {
  // The keys from CarSetup down to the value, dot separated, e.g. Chassis.LeftFront.SpringRate
  path: string;
  // The garage tab (Chassis), box (LeftFront) and key (SpringRate)
  section: string;
  group: string | null;
  key: string;
  // Exactly as iRacing wrote it
  raw: string;
  // The number and unit when raw is one number with a unit (or none); null otherwise
  value: number | null;
  unit: string | null;
  // Every number in a list such as "35C, 35C, 35C" (one entry for a single value; empty for text)
  values: number[];
  // Decimal places written, so a changed value is written the same way
  decimals: number;
  category: SetupCategory;
  // setting: what the garage adjusts. reading: measured or worked out by iRacing, never adjusted directly
  kind: 'setting' | 'reading';
  // Changed from the cockpit (the InCarAdjustments box): allowed in a fixed setup session
  inCar: boolean;
};

export type ParsedCarSetup = {
  // CarSetup.UpdateCount: goes up each time the setup changes in the session
  updateCount: number | null;
  parameters: SetupParameter[];
};

export const SETUP_YAML_PARSER_VERSION = 1;

// The CarSetup section out of the whole session info YAML: from the line "CarSetup:" up to the next top-level key or
// the document end ("..."). null when there's none (a car without a garage, or the session info isn't complete yet)
export function extractCarSetupSection(sessionYaml: string): string | null {
  // Any line ending, CRLF doubled up (\r\r\n) included, is one line break
  const lines = sessionYaml.replace(/\r*\n|\r/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^CarSetup:\s*$/.test(line));
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '...' || /^\S/.test(line)) break;
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop();
  return out.length > 1 ? out.join('\n') + '\n' : null;
}

// Measured or worked out by iRacing rather than set (matched against the key, and AeroBalanceCalc's whole box)
export const READING_KEYS = [/^LastHotPressure$/i, /^LastTemps/i, /^TreadRemaining$/i, /^CornerWeight$/i, /^FWtdist$/i, /^CrossWeight$/i, /^NoseWeight$/i, /AtSpeed$/i, /Downforce$/i];
const READING_GROUPS = [/^AeroBalanceCalc$/i];

const CATEGORY_RULES: [RegExp, SetupCategory][] = [
  [/BrakePressureBias|BrakeBias|MasterCyl|BrakePad|BrakeDuct|^Abs|AbsSetting|Brake/i, 'brakes'],
  [/Camber|Toe|Caster/i, 'alignment'],
  [/Pressure|TireType|Compound|Tread|LastTemps|Stagger/i, 'tires'],
  [/Wing|Splitter|Flap|Gurney|Aero|Downforce|AtSpeed|Diffuser|Louver/i, 'aero'],
  [/Diff|FrictionFace|Preload|Gear|Ramp|Clutch|FinalDrive/i, 'drivetrain'],
  [/Fuel/i, 'fuel'],
  [/^Tc|TcSetting|Traction|EngineMap|ThrottleMap|Map$|Mixture|Boost|Hybrid|Ers|Mgu|Display|Light|Pit ?Limiter/i, 'electronics'],
  [/Spring|RideHeight|FWtdist|Arb|AntiRoll|Damp|Bump|Rebound|Compression|Packer|Perch|Shock|Heave|Third|Weight|Torsion|Bar|Slider/i, 'suspension'],
];

export function categoryOf(section: string, group: string | null, key: string): SetupCategory {
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(key)) return category;
  if (group) for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(group)) return category;
  if (/Tire/i.test(section)) return 'tires';
  if (/Damper/i.test(section)) return 'suspension';
  return 'other';
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*(.*))?$/;

// One value's number(s) and unit: "223 N/mm" is 223 N/mm, "51.00%" 51 %, "3 (ABS)" 3 with no unit, "Medium friction"
// none, and "35C, 35C, 35C" the list 35, 35, 35 with the unit C
export function readValue(raw: string): { value: number | null; unit: string | null; values: number[]; decimals: number } {
  const text = raw.trim();
  const parts = text.split(/\s*,\s*/);
  const read = parts.map((part) => {
    const match = NUMBER.exec(part);
    if (!match) return null;
    let unit = (match[2] ?? '').trim();
    // A note in parentheses is a label (iRacing's "3 (ABS)"), not a unit
    if (/^\(.*\)$/.test(unit)) unit = '';
    if (unit && !/^[%A-Za-z°/][A-Za-z°/%·²]*$/.test(unit) && !/^[A-Za-z]+\/[A-Za-z]+$/.test(unit)) return null;
    const decimals = match[1].includes('.') ? match[1].split('.')[1].length : 0;
    return { number: Number(match[1]), unit: unit || null, decimals };
  });
  if (read.some((r) => r === null || !Number.isFinite(r.number))) return { value: null, unit: null, values: [], decimals: 0 };
  const ok = read as { number: number; unit: string | null; decimals: number }[];
  const unit = ok[0].unit;
  if (ok.some((r) => r.unit !== unit)) return { value: null, unit: null, values: [], decimals: 0 };
  return {
    value: ok.length === 1 ? ok[0].number : null,
    unit,
    values: ok.map((r) => r.number),
    decimals: ok[0].decimals,
  };
}

// The CarSetup section (with or without its "CarSetup:" line) as parameters. iRacing's YAML here is one key per line,
// indented one space per level, every value on its key's line; anything else is ignored rather than guessed at
export function parseCarSetupYaml(yaml: string): ParsedCarSetup {
  const lines = yaml.replace(/\r\n?/g, '\n').split('\n');
  const stack: { indent: number; key: string }[] = [];
  const parameters: SetupParameter[] = [];
  let updateCount: number | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trim() === '...' || line.trim() === '---' || line.trimStart().startsWith('#')) continue;
    const match = /^(\s*)([^:\s][^:]*?):(?:\s(.*))?$/.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const value = match[3] ?? '';
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (key === 'CarSetup' && indent === 0) {
      stack.length = 0;
      continue;
    }
    if (value.trim() === '') {
      stack.push({ indent, key });
      continue;
    }
    const parents = stack.map((s) => s.key);
    if (parents.length === 0 && key === 'UpdateCount') {
      const n = Number(value.trim());
      updateCount = Number.isInteger(n) ? n : null;
      continue;
    }
    const raw = value.trim().replace(/^"(.*)"$/, '$1');
    const section = parents[0] ?? key;
    const group = parents.length >= 2 ? parents[parents.length - 1] : null;
    const read = readValue(raw);
    const reading =
      READING_KEYS.some((p) => p.test(key)) || parents.some((parent) => READING_GROUPS.some((p) => p.test(parent)));
    parameters.push({
      path: [...parents, key].join('.'),
      section,
      group,
      key,
      raw,
      ...read,
      category: categoryOf(section, group, key),
      kind: reading ? 'reading' : 'setting',
      inCar: parents.some((parent) => /InCar/i.test(parent)),
    });
  }
  return { updateCount, parameters };
}

// A key as words for display, e.g. LowSpeedCompressionDamping is "Low Speed Compression Damping", LeftFront "Left
// Front", FWtdist stays as iRacing writes it
export function keyLabel(key: string): string {
  if (!/[a-z][A-Z]/.test(key)) return key;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

// A parameter's value written the way iRacing wrote it, with a new number: the same decimals and unit, a sign kept when
// it had one (e.g. "+1.5 mm"), and a label in parentheses kept ("3 (ABS)")
export function formatLike(parameter: Pick<SetupParameter, 'raw' | 'decimals' | 'unit'>, value: number): string {
  const text = value.toFixed(parameter.decimals);
  const signed = /^\s*\+/.test(parameter.raw) && value > 0 ? `+${text}` : text;
  const label = /\((.*)\)\s*$/.exec(parameter.raw);
  if (label) return `${signed} (${label[1]})`;
  if (!parameter.unit) return signed;
  // "51.00%" has no space before its unit; "223 N/mm" has one
  const spaced = !new RegExp(`\\d${parameter.unit.replace(/[.*+?^${}()|[\]\\/%]/g, '\\$&')}`).test(parameter.raw.replace(/\s+$/, ''));
  return spaced ? `${signed} ${parameter.unit}` : `${signed}${parameter.unit}`;
}
