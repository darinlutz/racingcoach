// Lap Compare's Tire Temperature Comparison (TireTempDashboard.tsx): what the Target and Compare laps' tire
// temperatures were, and the difference, Compare minus Target, only where the two are the same kind of measurement.
// Everything is in °C. No imports beyond these, so Node runs it directly: npm run test:tire-temps

import { nearestIndex } from './lapCharts.ts';
import { TIRE_CORNERS, type TireCorner, type TireLayer, type TireTemps } from './lapData.ts';
import { temperatureDeltaFromCelsius, temperatureFromCelsius, type Units } from './units.ts';

// What's measured: at the crosshair, through the focus area, over the whole lap, or over the laps' sessions
export type TireScope = 'sample' | 'area' | 'lap' | 'session';
export type TireEdge = keyof TireTemps;

// One lap's whole-lap samples (LapSamples) and the focus area's (AreaTrace)
export type TireLapSource = {
  pcts: number[];
  tireTemps: Record<TireCorner, TireTemps>;
  tireLayers: Record<TireCorner, TireLayer | null>;
  sessionTimes: number[];
};
export type TireLapInput = {
  lap: TireLapSource;
  area: { pcts: number[]; tireTemps: Record<TireCorner, TireTemps> | null };
};

export type TireSegments = Record<TireEdge, number | null>;

// avg is the mean of the three edges, min and max the lowest and highest single reading of any edge in the scope.
// Each needs all three edges, so a lap missing one has no average rather than an average of something else
export type TireReading = { segments: TireSegments; avg: number | null; min: number | null; max: number | null };

export type TireLapChannel = { layer: TireLayer | null; continuous: boolean };

// Why a tire's deltas (or some of them) can't be shown
export type TireCompareReason = 'session' | 'noData' | 'noTarget' | 'noCompare' | 'misaligned' | 'layerMismatch' | 'snapshot' | 'partial';

export type TireDeltas = {
  avg: number | null;
  min: number | null;
  max: number | null;
  inner: number | null;
  middle: number | null;
  outer: number | null;
  spread: number | null;
};

export type TireComparison = {
  corner: TireCorner;
  target: TireReading;
  compare: TireReading;
  targetChannel: TireLapChannel;
  compareChannel: TireLapChannel;
  // The session time of the reading, at the crosshair in sample scope; else null
  targetSessionTime: number | null;
  compareSessionTime: number | null;
  targetSpread: number | null;
  compareSpread: number | null;
  deltas: TireDeltas;
  reason: TireCompareReason | null;
};

// A column with fewer changes than this over a lap is a held reading, not a trace: live telemetry only updates the
// carcass temperatures in the pit stall, so a lap not yet filled in from its .ibt holds one value throughout
export const MIN_CONTINUOUS_CHANGES = 5;
// A scope with less of an edge's samples than this isn't compared: its mean would be of a different stretch of track
export const MIN_COVERAGE = 0.9;
// Further than this (a share of the lap) from the crosshair, a lap's nearest sample isn't at the same place on track
export const MAX_ALIGNMENT_GAP = 0.005;
// The delta (°C) at which the diverging color scale reaches full intensity, the same for all four tires
export const DELTA_FULL_SCALE = 10;

const EDGES: TireEdge[] = ['inner', 'middle', 'outer'];
const NO_SEGMENTS: TireSegments = { inner: null, middle: null, outer: null };
const NO_READING: TireReading = { segments: NO_SEGMENTS, avg: null, min: null, max: null };
const NO_DELTAS: TireDeltas = { avg: null, min: null, max: null, inner: null, middle: null, outer: null, spread: null };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const orNull = (value: number | undefined) => (value !== undefined && Number.isFinite(value) ? value : null);
const difference = (compare: number | null, target: number | null) => (compare === null || target === null ? null : compare - target);

// The tread's temperature spread: how far apart its inner and outer edges were
export function treadSpread({ inner, outer }: TireSegments) {
  return inner === null || outer === null ? null : Math.abs(inner - outer);
}

// Whether the column changes enough over the lap to be a trace (see MIN_CONTINUOUS_CHANGES)
function changes(values: number[]) {
  let count = 0;
  let last = NaN;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (Number.isFinite(last) && value !== last) count++;
    last = value;
  }
  return count;
}

export function tireChannel(lap: TireLapSource, corner: TireCorner): TireLapChannel {
  const temps = lap.tireTemps[corner];
  return {
    layer: lap.tireLayers[corner],
    continuous: Math.max(...EDGES.map((edge) => changes(temps[edge]))) >= MIN_CONTINUOUS_CHANGES,
  };
}

function readingFrom(segments: TireSegments, readings: number[]): TireReading {
  const { inner, middle, outer } = segments;
  if (inner === null || middle === null || outer === null) return { segments, avg: null, min: null, max: null };
  return { segments, avg: (inner + middle + outer) / 3, min: Math.min(...readings), max: Math.max(...readings) };
}

// The reading at the sample nearest pct, or null when the lap has none near that place on track
function readSample(pcts: number[], temps: TireTemps, pct: number): TireReading | null {
  if (pcts.length === 0) return NO_READING;
  const i = nearestIndex(pcts, pct);
  if (Math.abs(pcts[i] - pct) > MAX_ALIGNMENT_GAP) return null;
  const segments: TireSegments = { inner: orNull(temps.inner[i]), middle: orNull(temps.middle[i]), outer: orNull(temps.outer[i]) };
  return readingFrom(segments, EDGES.flatMap((edge) => segments[edge] ?? []));
}

// The means, lowest and highest over a stretch of samples, leaving out an edge with too few of them
function readRange(temps: TireTemps): TireReading {
  const segments = { ...NO_SEGMENTS };
  const readings: number[] = [];
  for (const edge of EDGES) {
    const finite = temps[edge].filter(Number.isFinite);
    if (finite.length === 0 || finite.length / temps[edge].length < MIN_COVERAGE) continue;
    segments[edge] = mean(finite);
    readings.push(...finite);
  }
  return readingFrom(segments, readings);
}

function readTire(input: TireLapInput, corner: TireCorner, scope: TireScope, pct: number): TireReading | null {
  if (scope === 'session') return NO_READING;
  if (scope === 'lap') return readRange(input.lap.tireTemps[corner]);
  const temps = input.area.tireTemps?.[corner];
  if (!temps) return NO_READING;
  return scope === 'area' ? readRange(temps) : readSample(input.area.pcts, temps, pct);
}

const hasAny = ({ segments }: TireReading) => EDGES.some((edge) => segments[edge] !== null);

function sessionTimeAt(lap: TireLapSource, pct: number) {
  return lap.pcts.length === 0 ? null : orNull(lap.sessionTimes[nearestIndex(lap.pcts, pct)]);
}

// Why the two laps' readings of a tire can't be subtracted: only the same layer of the tire, both as a continuous
// trace. A held pit reading has no known time or conditions, so two of them are shown but never compared
function channelReason(target: TireLapChannel, compare: TireLapChannel): TireCompareReason | null {
  if (target.layer !== compare.layer) return 'layerMismatch';
  if (!target.continuous || !compare.continuous) return 'snapshot';
  return null;
}

// One tire in one scope. pct is the crosshair's lap position, used by the sample scope
export function compareTire(target: TireLapInput, compare: TireLapInput, corner: TireCorner, scope: TireScope, pct: number): TireComparison {
  const targetChannel = tireChannel(target.lap, corner);
  const compareChannel = tireChannel(compare.lap, corner);
  const targetReading = readTire(target, corner, scope, pct);
  const compareReading = readTire(compare, corner, scope, pct);
  const result = {
    corner,
    target: targetReading ?? NO_READING,
    compare: compareReading ?? NO_READING,
    targetChannel,
    compareChannel,
    targetSessionTime: scope === 'sample' ? sessionTimeAt(target.lap, pct) : null,
    compareSessionTime: scope === 'sample' ? sessionTimeAt(compare.lap, pct) : null,
  };
  const targetSpread = treadSpread(result.target.segments);
  const compareSpread = treadSpread(result.compare.segments);
  const shown = { ...result, targetSpread, compareSpread };
  const without = (reason: TireCompareReason): TireComparison => ({ ...shown, deltas: NO_DELTAS, reason });

  if (scope === 'session') return without('session');
  if (targetReading === null || compareReading === null) return without('misaligned');
  const [hasTarget, hasCompare] = [hasAny(targetReading), hasAny(compareReading)];
  if (!hasTarget && !hasCompare) return without('noData');
  if (!hasTarget) return without('noTarget');
  if (!hasCompare) return without('noCompare');
  const reason = channelReason(targetChannel, compareChannel);
  if (reason) return without(reason);

  const deltas: TireDeltas = {
    avg: difference(compareReading.avg, targetReading.avg),
    min: difference(compareReading.min, targetReading.min),
    max: difference(compareReading.max, targetReading.max),
    inner: difference(compareReading.segments.inner, targetReading.segments.inner),
    middle: difference(compareReading.segments.middle, targetReading.segments.middle),
    outer: difference(compareReading.segments.outer, targetReading.segments.outer),
    spread: difference(compareSpread, targetSpread),
  };
  return { ...shown, deltas, reason: Object.values(deltas).includes(null) ? 'partial' : null };
}

export function compareTires(target: TireLapInput, compare: TireLapInput, scope: TireScope, pct: number): Record<TireCorner, TireComparison> {
  return Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, compareTire(target, compare, corner, scope, pct)])) as Record<TireCorner, TireComparison>;
}

export type TireExtreme = { corner: TireCorner; delta: number };

// null means no tire qualifies. An axle's average needs both its tires, as one tire isn't that axle's average
export type TireDeltaSummary = {
  comparable: number;
  largestPositive: TireExtreme | null;
  largestNegative: TireExtreme | null;
  largestAbsolute: TireExtreme | null;
  frontAxle: number | null;
  rearAxle: number | null;
  largestSpread: TireExtreme | null;
};

function largest(values: TireExtreme[], score: (delta: number) => number): TireExtreme | null {
  let best: TireExtreme | null = null;
  for (const value of values) if (score(value.delta) > 0 && (!best || score(value.delta) > score(best.delta))) best = value;
  return best;
}

function axle(comparisons: Record<TireCorner, TireComparison>, left: TireCorner, right: TireCorner) {
  const [a, b] = [comparisons[left].deltas.avg, comparisons[right].deltas.avg];
  return a === null || b === null ? null : (a + b) / 2;
}

export function summarizeTires(comparisons: Record<TireCorner, TireComparison>): TireDeltaSummary {
  const list = TIRE_CORNERS.map((corner) => comparisons[corner]);
  const averages = list.flatMap(({ corner, deltas }) => (deltas.avg === null ? [] : [{ corner, delta: deltas.avg }]));
  const spreads = list.flatMap(({ corner, deltas }) => (deltas.spread === null ? [] : [{ corner, delta: deltas.spread }]));
  return {
    comparable: averages.length,
    largestPositive: largest(averages, (delta) => delta),
    largestNegative: largest(averages, (delta) => -delta),
    largestAbsolute: largest(averages, Math.abs),
    frontAxle: axle(comparisons, 'LF', 'RF'),
    rearAxle: axle(comparisons, 'LR', 'RR'),
    largestSpread: largest(spreads, Math.abs),
  };
}

// One tire's average across the tread through the focus area, at each Target lap sample with the Compare lap's
// sample at the same place on track (never the same index: the laps' samples don't line up). NaN where either
// has no reading there, which breaks the lines rather than joining across the gap
export type TireDeltaSeries = { pcts: number[]; target: number[]; compare: number[]; delta: number[] };

function treadAverage(temps: TireTemps, i: number) {
  return (temps.inner[i] + temps.middle[i] + temps.outer[i]) / 3;
}

export function tireDeltaSeries(target: TireLapInput['area'], compare: TireLapInput['area'], corner: TireCorner): TireDeltaSeries | null {
  const targetTemps = target.tireTemps?.[corner];
  const compareTemps = compare.tireTemps?.[corner];
  if (!targetTemps || !compareTemps || compare.pcts.length === 0) return null;
  const series: TireDeltaSeries = { pcts: target.pcts, target: [], compare: [], delta: [] };
  target.pcts.forEach((pct, i) => {
    const j = nearestIndex(compare.pcts, pct);
    const aligned = Math.abs(compare.pcts[j] - pct) <= MAX_ALIGNMENT_GAP;
    const [targetAverage, compareAverage] = [treadAverage(targetTemps, i), aligned ? treadAverage(compareTemps, j) : NaN];
    series.target.push(targetAverage);
    series.compare.push(compareAverage);
    series.delta.push(compareAverage - targetAverage);
  });
  return series;
}

// Why a tire's traces can't be charted against each other, whatever scope the gauges are in
export function tireSeriesReason(target: TireLapInput, compare: TireLapInput, corner: TireCorner): TireCompareReason | null {
  const [hasTarget, hasCompare] = [Boolean(target.area.tireTemps), Boolean(compare.area.tireTemps)];
  if (!hasTarget && !hasCompare) return 'noData';
  if (!hasTarget) return 'noTarget';
  if (!hasCompare) return 'noCompare';
  return channelReason(tireChannel(target.lap, corner), tireChannel(compare.lap, corner));
}

// The difference as the two values read on screen, each rounded to `digits`, so the numbers add up where they're
// shown side by side
export function shownDelta(compare: number, target: number, units: Units, digits = 1) {
  const round = (celsius: number) => Math.round(temperatureFromCelsius(celsius, units) * 10 ** digits) / 10 ** digits;
  return Number((round(compare) - round(target)).toFixed(digits));
}

// +1.3° or −1.3° in the user's units; 0.0° when equal
export function formatDelta(delta: number, locale: string, digits = 1) {
  const text = Math.abs(delta).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rounded = Number(delta.toFixed(digits));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${text}°`;
}

// A delta in °C, in the user's units and formatted, for values that aren't side by side with their two laps (the summary)
export function formatCelsiusDelta(celsius: number, units: Units, locale: string, digits = 1) {
  return formatDelta(temperatureDeltaFromCelsius(celsius, units), locale, digits);
}

export function formatTireTemp(celsius: number, units: Units, locale: string, digits = 1) {
  return `${temperatureFromCelsius(celsius, units).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}°`;
}

// A spread is a difference, so it converts without °F's 32 offset, and has no sign
export function formatTireSpread(celsius: number, units: Units, locale: string, digits = 1) {
  return `${temperatureDeltaFromCelsius(celsius, units).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}°`;
}

// Diverging color centered on zero: neutral, to amber (Compare hotter) or cyan (Compare cooler)
export function deltaColor(celsius: number) {
  const pct = Math.round(Math.min(1, Math.abs(celsius) / DELTA_FULL_SCALE) ** 0.8 * 100);
  return `color-mix(in oklab, ${celsius >= 0 ? 'var(--delta-hot)' : 'var(--delta-cool)'} ${pct}%, var(--delta-neutral))`;
}

// The Target and Compare car views' color for an absolute temperature, HEAT_RANGE (°C) from cold to hot
export const HEAT_RANGE: [number, number] = [60, 120];
export function heatColor(celsius: number) {
  const [lo, hi] = HEAT_RANGE;
  const t = Math.max(0, Math.min(1, (celsius - lo) / (hi - lo)));
  return t < 0.5
    ? `color-mix(in oklab, var(--heat-mid) ${Math.round(t * 200)}%, var(--heat-cold))`
    : `color-mix(in oklab, var(--heat-hot) ${Math.round((t - 0.5) * 200)}%, var(--heat-mid))`;
}
