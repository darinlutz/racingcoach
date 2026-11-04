// Whether the driver's tires are still warming up, for the In-Car AI Coach's lap feedback and the Race Engineer: on
// cold tires (and brakes) the driver can't brake as late as on warm ones, so the coach mustn't tell them to brake
// later yet, only that they can once the tires are warm.
//
// Live laps have no tire temperatures that change as the car drives: iRacing only updates the carcass temperatures
// in the pit stall, and the surface ones are only in its .ibt files, which the collector copies into a lap after the
// stint. So the surface temperatures decide when a lap has them, and otherwise the number of laps into the stint
// does: the out lap (a pit road lap, which the coach never gets) and the first COLD_FLYING_LAPS flying laps.
// No imports, so `node --test` runs it directly (scripts/tire-warmup.test.mjs).

// Flying laps after the out lap still on cold tires: with the out lap, the first 3 laps of a stint
export const COLD_FLYING_LAPS = 2;
// Surface temperature (°C, the average across all four tires at the end of the lap) under which the tires are cold
export const COLD_SURFACE_C = 60;
// A rise this big (°C) on the lap before means the tires are still coming up to temperature
export const WARMING_RISE_C = 4;
// A lap completed this long (s) after the one before, beyond its own lap time, follows a stop: a new stint
export const STINT_BREAK_S = 60;
// The share of the lap at its end the surface temperature is taken over
const END_SHARE = 0.1;

export type WarmupLap = {
  lapNumber: number;
  lapSeconds: number;
  // ISO time the lap was completed
  completedAt: string;
  // The lap's average surface temperature at its end (°C), or null when the lap has no surface temperatures
  surfaceC: number | null;
};

export type TireWarmup = {
  // Flying laps into the stint of the newest lap (1 = the first after the out lap)
  stintLap: number;
  cold: boolean;
  // What decided it: the newest lap's surface temperatures, or the laps into the stint
  basis: 'temperature' | 'laps';
  surfaceC: number | null;
};

// The average surface temperature of all four tires over the end of the lap, or null when the lap has none
// (tires: each tire's middle, outer and inner temperatures per sample; layers: whether they are surface ones)
export function lapSurfaceTemp(
  tires: Record<string, { outer: number[]; middle: number[]; inner: number[] }>,
  layers: Record<string, 'surface' | 'carcass' | null>
): number | null {
  const values: number[] = [];
  for (const [corner, temps] of Object.entries(tires)) {
    if (layers[corner] !== 'surface') continue;
    const n = temps.middle.length;
    for (let i = Math.floor(n * (1 - END_SHARE)); i < n; i++) {
      for (const edge of [temps.outer[i], temps.middle[i], temps.inner[i]]) if (Number.isFinite(edge)) values.push(edge);
    }
  }
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Each lap's flying lap into its stint (1-based), laps oldest first. The coach is never sent pit road laps, so a lap
// that doesn't follow the one before by number, or was completed well after it, starts a new stint
export function stintLaps(laps: Pick<WarmupLap, 'lapNumber' | 'lapSeconds' | 'completedAt'>[]): number[] {
  const out: number[] = [];
  laps.forEach((lap, i) => {
    const before = laps[i - 1];
    const gapS = before ? (Date.parse(lap.completedAt) - Date.parse(before.completedAt)) / 1000 : NaN;
    const sameStint = before && lap.lapNumber === before.lapNumber + 1 && !(gapS > lap.lapSeconds + STINT_BREAK_S);
    out.push(sameStint ? out[i - 1] + 1 : 1);
  });
  return out;
}

// The newest lap's tires; null without laps
export function tireWarmup(laps: WarmupLap[]): TireWarmup | null {
  if (laps.length === 0) return null;
  const stint = stintLaps(laps);
  const i = laps.length - 1;
  const newest = laps[i];
  if (newest.surfaceC != null) {
    const before = i > 0 && stint[i] > 1 ? laps[i - 1].surfaceC : null;
    const cold = newest.surfaceC < COLD_SURFACE_C || (before != null && newest.surfaceC - before >= WARMING_RISE_C);
    return { stintLap: stint[i], cold, basis: 'temperature', surfaceC: newest.surfaceC };
  }
  return { stintLap: stint[i], cold: stint[i] <= COLD_FLYING_LAPS, basis: 'laps', surfaceC: null };
}

// Words that mean braking later, and tires, in English, Portuguese, Spanish and German
const LATER_RE = /\blater\b|mais tarde|más tarde|\bspäter\b/iu;
const BRAKE_RE = /\bbrak|\bfre(?:n|ie|ar)|\bbrems/iu;
const TIRE_RE = /\btires?\b|\btyres?\b|\bpneu|neumátic|\bgomas?\b|\breifen/iu;

// On cold tires, a callout telling the driver to brake later is only allowed when it says it's for once the tires
// are warm (by mentioning them)
export function brakesLaterOnColdTires(text: string): boolean {
  return BRAKE_RE.test(text) && LATER_RE.test(text) && !TIRE_RE.test(text);
}

// What the AI is told about the tires, or '' when they're warm
export function tireWarmupFact(warmup: TireWarmup | null, units: 'standard' | 'metric'): string {
  if (!warmup?.cold) return '';
  const temp =
    warmup.surfaceC == null
      ? ''
      : ` (surface ${units === 'metric' ? `${Math.round(warmup.surfaceC)} °C` : `${Math.round((warmup.surfaceC * 9) / 5 + 32)} °F`})`;
  const why =
    warmup.basis === 'temperature'
      ? `the tire temperatures${temp} show they are still warming up`
      : `this is only flying lap ${warmup.stintLap} of the stint`;
  return (
    `The tires and brakes are still cold: ${why}. Do not tell the driver to brake later, or anything else that needs ` +
    'more grip than cold tires give: on cold tires braking earlier is right. When the data says to brake later, ' +
    'say it is for once the tires are warm, starting with that (e.g. "Once your tires are warm, brake about ' +
    `${units === 'metric' ? '6 m' : '20 ft'} later in Turn 1"), and coach anything else in the data.`
  );
}
