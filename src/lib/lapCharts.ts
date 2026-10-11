// Shared by Lap Compare's per-focus-area charts (PedalTraces, SteeringTrace, TrackLineMap): the lap
// colors, the horizontal lap position axis and the crosshair's sample lookup.

// The user asked for Base in blue and Compare in red; bright variants so both read on the dark panel
// and on satellite imagery
export const BASE_LAP_COLOR = '#3b8bff';
export const COMPARE_LAP_COLOR = '#ff4040';

// Plot margins of the line charts, so their plots line up under each other
export const CHART_MARGIN = { top: 10, right: 64, bottom: 28, left: 40 };

// The horizontal axis: a focus area's start and end as lap positions, the track length that turns
// them into feet (null shows % of the lap instead), and the locale its numbers are formatted for
export type Axis = {
  domain: [number, number];
  lengthFeet: number | null;
  locale: string;
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Lap position -> axis label: feet from the start/finish line, or % of the lap without a track length
export function positionLabel(pct: number, { lengthFeet, locale }: Axis) {
  const lapPct = ((pct % 1) + 1) % 1;
  return lengthFeet
    ? `${Math.round(lapPct * lengthFeet).toLocaleString(locale)} ft`
    : `${(lapPct * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Round tick positions (lap positions) across the domain: steps of 1/2/5 x 10^n feet (or % of the lap)
export function xTicks({ domain, lengthFeet }: Axis) {
  const unit = lengthFeet ?? 100;
  const [lo, hi] = [domain[0] * unit, domain[1] * unit];
  const raw = (hi - lo) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v / unit);
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
