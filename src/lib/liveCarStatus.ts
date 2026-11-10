import { compoundKind, resolveCompound } from './engineering/weatherContext.ts';
import type { LiveWeather } from './liveWeather.ts';

// The followed driver's tires and fuel, as the Live Racing page and TV Broadcast Mode show them beside their name, and
// when those two show the weather radar. Pure (no I/O), from the collector's live update: the fitted compound from
// collectors from 1.94.0 (tires), the fuel left and used per lap from 1.58.0 (fuelLevel, fuelPerLap) and the share of
// the tank left from 1.95.0 (fuelLevelPct). Anything the collector didn't send is null, never guessed.

// soft, medium and hard are named compounds (Formula cars'); dry is a dry tire the car names no other way
export type TireKind = 'soft' | 'medium' | 'hard' | 'dry' | 'intermediate' | 'wet' | 'unknown';
export type FittedTire = { kind: TireKind; name: string | null };

export type TireInput = {
  compound?: number | null;
  pitCompound?: number | null;
  available?: { index: number; type: string }[] | null;
  compoundName?: string | null;
};

function tireKind(name: string | null): TireKind {
  if (!name) return 'unknown';
  const kind = compoundKind(name);
  if (kind === 'wet' || kind === 'intermediate') return kind;
  if (/soft/i.test(name)) return 'soft';
  if (/medium/i.test(name)) return 'medium';
  if (/hard/i.test(name)) return 'hard';
  return kind === 'dry' ? 'dry' : 'unknown';
}

// The compound on the car now, or null when the collector didn't say (before 1.94.0, or not reported)
export function fittedTire(tires: TireInput | null | undefined): FittedTire | null {
  if (!tires) return null;
  const fitted = resolveCompound(tires.compound, tires.available, tires.compoundName, 'live');
  if (fitted.confidence === 'none') return null;
  const name = fitted.name ? fitted.name.replace(/_compound$/i, '').replace(/_/g, ' ') : null;
  return { kind: tireKind(fitted.name), name };
}

export type FuelInput = {
  fuelLevel?: number | null;
  fuelLevelPct?: number | null;
  fuelPerLap?: number | null;
  lastLapTime?: number | null;
  bestLapTime?: number | null;
};

// liters: fuel left; pct: the share of the tank (0-1), null from collectors before 1.95.0; lapsLeft: at the average
// used per green lap; secondsLeft: those laps at the driver's pace (their last lap, unless it was much slower than
// their best, e.g. a pit or yellow-flag lap, then their best)
export type FuelStatus = { liters: number; pct: number | null; lapsLeft: number | null; secondsLeft: number | null };

const positive = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);

// The lap time a stint of fuel is counted at
export function paceLapTime(last: number | null | undefined, best: number | null | undefined): number | null {
  const l = positive(last);
  const b = positive(best);
  if (l && b) return l <= b * 1.15 ? l : b;
  return l ?? b;
}

export function fuelStatus(input: FuelInput): FuelStatus | null {
  if (input.fuelLevel == null || !Number.isFinite(input.fuelLevel) || input.fuelLevel < 0) return null;
  const liters = Math.round(input.fuelLevel * 10) / 10;
  const pct = input.fuelLevelPct != null && Number.isFinite(input.fuelLevelPct) ? Math.min(Math.max(input.fuelLevelPct, 0), 1) : null;
  const perLap = positive(input.fuelPerLap);
  const lapsLeft = perLap ? Math.round((input.fuelLevel / perLap) * 10) / 10 : null;
  const pace = paceLapTime(input.lastLapTime, input.bestLapTime);
  const secondsLeft = lapsLeft != null && pace ? Math.round(lapsLeft * pace) : null;
  return { liters, pct: pct === null ? null : Math.round(pct * 1000) / 1000, lapsLeft, secondsLeft };
}

// Rain falling at the start/finish line (as liveWeather's skyCondition counts drizzle), or wet or intermediate tires
// on the car
export const RAIN_THRESHOLD = 0.02;
export function isWetSession(weather: LiveWeather | null | undefined, tire: FittedTire | null): boolean {
  return (weather?.precipitation ?? 0) > RAIN_THRESHOLD || tire?.kind === 'wet' || tire?.kind === 'intermediate';
}

// While it's wet, the Live Racing page's maps and the TV switch to the weather radar for RADAR_SHOW_MS of every
// RADAR_EVERY_MS, on the wall clock, so every TV and page watching shows it together
export const RADAR_EVERY_MS = 60_000;
export const RADAR_SHOW_MS = 10_000;
export function radarShowing(now: number): boolean {
  return ((now % RADAR_EVERY_MS) + RADAR_EVERY_MS) % RADAR_EVERY_MS < RADAR_SHOW_MS;
}

// "1:05:09" or "12:04" for a time left in seconds
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
