// Shared by Lap Compare's per-focus-area charts (TelemetryChart, TrackLineMap): the lap
// colors, the horizontal lap position axis and the crosshair's sample lookup.

// The user asked for Target in blue and Compare in red; bright variants so both read on the dark panel
// and on satellite imagery
export const BASE_LAP_COLOR = '#3b8bff';
export const COMPARE_LAP_COLOR = '#ff4040';

// Plot margins of the telemetry charts, so their plots line up under each other
export const CHART_MARGIN = { top: 10, right: 44, bottom: 22, left: 52 };

// The horizontal axis: a focus area's start and end as lap positions, the track length in the user's
// units that turns them into feet or meters (null shows % of the lap instead), its unit ("ft" or "m"),
// and the locale its numbers are formatted for
export type Axis = {
  domain: [number, number];
  length: number | null;
  unit: string;
  locale: string;
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Lap position -> axis label: feet or meters from the start/finish line, or % of the lap without a track length
export function positionLabel(pct: number, { length, unit, locale }: Axis) {
  const lapPct = ((pct % 1) + 1) % 1;
  return length
    ? `${Math.round(lapPct * length).toLocaleString(locale)} ${unit}`
    : `${(lapPct * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// A gap between two lap positions in the axis' unit, e.g. "15 ft", or % of the lap without a track length
export function gapLabel(pctGap: number, { length, unit, locale }: Axis) {
  const gap = Math.abs(pctGap);
  return length
    ? `${Math.round(gap * length).toLocaleString(locale)} ${unit}`
    : `${(gap * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Round tick positions (lap positions) across the domain: steps of 1/2/5 x 10^n feet or meters (or % of the lap)
export function xTicks({ domain, length }: Axis) {
  const unit = length ?? 100;
  const [lo, hi] = [domain[0] * unit, domain[1] * unit];
  const raw = (hi - lo) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v / unit);
  return ticks;
}

// Round ticks covering lo..hi, at least smallest apart in all: steps of 1/2/5 x 10^n, about 4 of them. A range
// narrower than smallest is widened around its middle, so a value that never changes still has an axis to sit on.
export function roundTicks(rangeLo: number, rangeHi: number, smallest: number) {
  const middle = (rangeLo + rangeHi) / 2;
  const [lo, hi] = rangeHi - rangeLo < smallest ? [middle - smallest / 2, middle + smallest / 2] : [rangeLo, rangeHi];
  const raw = Math.max(hi - lo, smallest) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) {
    ticks.push(Number((Math.round(v / step) * step).toPrecision(12)));
  }
  return ticks;
}

// Index of the sample nearest a lap position (pcts are increasing)
export function nearestIndex(pcts: number[], pct: number) {
  let lo = 0;
  let hi = pcts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pcts[mid] < pct) lo = mid;
    else hi = mid;
  }
  return Math.abs(pcts[lo] - pct) <= Math.abs(pcts[hi] - pct) ? lo : hi;
}
