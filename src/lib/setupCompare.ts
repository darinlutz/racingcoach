// Comparing two setups parameter by parameter for the Setups page's Compare tab. Pure (scripts/setups.test.mjs).
//
// Parameters are matched by their exact path (setupYaml.ts), never by a similar label, and only between setups of the
// same car: another car's garage has other parameters, so its setups are "incompatible" and nothing is lined up. A
// difference is worked out only when both values are numbers in the same unit, and a percentage's difference is in
// percentage points. Raw values are always shown as iRacing wrote them.
import type { SetupCategory, SetupParameter } from './setupYaml.ts';

export type CompareStatus = 'same' | 'changed' | 'onlyBaseline' | 'onlyComparison' | 'notComparable';

export type CompareRow = {
  path: string;
  section: string;
  group: string | null;
  key: string;
  category: SetupCategory;
  kind: 'setting' | 'reading';
  baseline: string | null;
  comparison: string | null;
  // Comparison minus baseline, when both are one number in the same unit
  difference: number | null;
  // The difference's unit: the values' own, or "pp" (percentage points) for a percentage
  differenceUnit: string | null;
  // The difference as a share of the baseline's size (for the charts); null when the baseline is 0 or not a number
  relative: number | null;
  status: CompareStatus;
};

export type SetupComparison = {
  compatible: boolean;
  rows: CompareRow[];
  counts: Record<CompareStatus, number>;
};

export type ComparedSetup = { car: string | null; carKey: string | null; parameters: SetupParameter[] };

const norm = (value: string | null) => (value ?? '').trim().toLowerCase();

// Same car: the same iRacing car key when both have one, else the same name
export function sameCar(a: ComparedSetup, b: ComparedSetup): boolean {
  if (a.carKey && b.carKey) return norm(a.carKey) === norm(b.carKey);
  return !!a.car && !!b.car && norm(a.car) === norm(b.car);
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function compareSetups(baseline: ComparedSetup, comparison: ComparedSetup): SetupComparison {
  const counts: Record<CompareStatus, number> = { same: 0, changed: 0, onlyBaseline: 0, onlyComparison: 0, notComparable: 0 };
  if (!sameCar(baseline, comparison)) return { compatible: false, rows: [], counts };
  const other = new Map(comparison.parameters.map((p) => [p.path, p]));
  const rows: CompareRow[] = [];
  const row = (p: SetupParameter, a: SetupParameter | undefined, b: SetupParameter | undefined): CompareRow => {
    let status: CompareStatus;
    let difference: number | null = null;
    let differenceUnit: string | null = null;
    let relative: number | null = null;
    if (!a) status = 'onlyComparison';
    else if (!b) status = 'onlyBaseline';
    else if (a.raw.trim() === b.raw.trim()) status = 'same';
    else if (a.value != null && b.value != null && a.unit === b.unit) {
      status = 'changed';
      difference = round(b.value - a.value);
      differenceUnit = a.unit === '%' ? 'pp' : a.unit;
      relative = a.value !== 0 ? round(difference / Math.abs(a.value)) : null;
    } else if (a.values.length && a.values.length === b.values.length && a.unit === b.unit) {
      // A list such as tread or temperatures: changed, without one difference to show
      status = 'changed';
    } else if (a.value == null && b.value == null) {
      // Text such as "Medium friction" against "High friction"
      status = 'changed';
    } else {
      status = 'notComparable';
    }
    counts[status]++;
    return {
      path: p.path,
      section: p.section,
      group: p.group,
      key: p.key,
      category: p.category,
      kind: p.kind,
      baseline: a?.raw ?? null,
      comparison: b?.raw ?? null,
      difference,
      differenceUnit,
      relative,
      status,
    };
  };
  for (const a of baseline.parameters) {
    rows.push(row(a, a, other.get(a.path)));
    other.delete(a.path);
  }
  for (const b of other.values()) rows.push(row(b, undefined, b));
  return { compatible: true, rows, counts };
}

// A difference as text: "+2 mm", "-1.5 pp", "+1"
export function formatDifference(difference: number, unit: string | null, decimals = 2): string {
  const shown = Number(difference.toFixed(decimals));
  const sign = shown > 0 ? '+' : shown < 0 ? '−' : '±';
  const text = `${sign}${Math.abs(shown)}`;
  return unit ? `${text} ${unit}` : text;
}
