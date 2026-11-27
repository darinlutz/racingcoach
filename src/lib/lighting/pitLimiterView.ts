import { FRESH_TELEMETRY_MS } from './events.ts';

// What the Live Racing page's pit limiter indicator shows (PitLimiterIndicator.tsx), from the same pitLimiterActive
// the collector shows and the lighting agent follows. Pure. Never left blue when the telemetry stopped: in the car the
// collector sends twice a second, so FRESH_TELEMETRY_MS without an update means it stopped; in the garage it sends
// every 5 s, so it gets longer before it's called stale.

export type PitLimiterView = 'active' | 'off' | 'unavailable' | 'stale';

export const GARAGE_STALE_MS = 12_000;

export function pitLimiterView(driver: {
  pitLimiterActive?: boolean | null;
  onTrack: boolean;
  offline: boolean;
  ageMs: number;
}): PitLimiterView {
  if (driver.offline || driver.ageMs > (driver.onTrack ? FRESH_TELEMETRY_MS : GARAGE_STALE_MS)) return 'stale';
  if (driver.pitLimiterActive == null) return 'unavailable';
  return driver.pitLimiterActive ? 'active' : 'off';
}
