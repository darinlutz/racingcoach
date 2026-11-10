import type { WeatherContext } from './weatherContext.ts';

// The In-Car AI Coach's weather alerts: short spoken messages when the conditions change in a way that matters to
// the driver ("Rain getting heavier. Expect less grip."), decided by fixed rules over the shared weather context
// (weatherContext.ts), never by an AI model, so they cost nothing and add no latency to the telemetry. An alert needs
// fresh readings and the driver in the car, must hold for CONFIRM_MS before it's said (one odd reading never speaks),
// and each kind waits KIND_COOLDOWN_MS, with at least MIN_GAP_MS between any two, so the driver isn't nagged. The most
// important wins when several are due. liveRacing.ts runs it on each live update and delivers the alert with the
// collector's messages, which it says in the coach voice. Pure, so `node --test` runs it (scripts/wet-weather.test.mjs).

// Most important first
export const WEATHER_ALERT_KINDS = ['slicksOnWet', 'rainStarted', 'rainHeavier', 'wetsOnDrying', 'trackDrying', 'rainEasing'] as const;
export type WeatherAlertKind = (typeof WEATHER_ALERT_KINDS)[number];

export const CONFIRM_MS = 20_000;
export const MIN_GAP_MS = 90_000;
export const KIND_COOLDOWN_MS: Record<WeatherAlertKind, number> = {
  slicksOnWet: 5 * 60_000,
  rainStarted: 10 * 60_000,
  rainHeavier: 10 * 60_000,
  wetsOnDrying: 10 * 60_000,
  trackDrying: 15 * 60_000,
  rainEasing: 15 * 60_000,
};

// Rain below this is none, at or above RAIN_STARTED it has started
const NO_RAIN = 0.02;
const RAIN_STARTED = 0.05;

export type WeatherAlertState = {
  lastAlertAt: number;
  saidAt: Partial<Record<WeatherAlertKind, number>>;
  // Since when each kind has been due without a break
  dueSince: Partial<Record<WeatherAlertKind, number>>;
  // Rain was seen at none since the last rainStarted alert, so a new start can be told
  sawNoRain: boolean;
};

export const initialWeatherAlertState = (): WeatherAlertState => ({ lastAlertAt: 0, saidAt: {}, dueSince: {}, sawNoRain: false });

// Which alerts the readings call for right now
export function dueWeatherAlerts(ctx: WeatherContext, state: WeatherAlertState): WeatherAlertKind[] {
  const due: WeatherAlertKind[] = [];
  const rain = ctx.rain.value;
  if (ctx.mismatch === 'slicksOnWet') due.push('slicksOnWet');
  if (rain != null && rain >= RAIN_STARTED && state.sawNoRain) due.push('rainStarted');
  if (ctx.trend?.rain === 'increasing' && (ctx.rain.label === 'moderate' || ctx.rain.label === 'heavy')) due.push('rainHeavier');
  if (ctx.mismatch === 'wetsOnDrying' || ctx.mismatch === 'wetsOnDry') due.push('wetsOnDrying');
  if (ctx.trend?.wetness === 'drying' && ctx.condition !== 'dry') due.push('trackDrying');
  if (ctx.trend?.rain === 'decreasing' && rain != null && rain >= NO_RAIN) due.push('rainEasing');
  return due;
}

export function nextWeatherAlert(
  previous: WeatherAlertState | null | undefined,
  ctx: WeatherContext,
  now: number,
  onTrack: boolean
): { alert: WeatherAlertKind | null; state: WeatherAlertState } {
  const state: WeatherAlertState = previous
    ? { ...previous, saidAt: { ...previous.saidAt }, dueSince: { ...previous.dueSince } }
    : initialWeatherAlertState();
  // Stale or missing readings say nothing about now: no alert, and nothing counts as confirmed
  if (!ctx.fresh || ctx.origin !== 'live') {
    state.dueSince = {};
    return { alert: null, state };
  }
  const rain = ctx.rain.value;
  if (rain != null && rain < NO_RAIN) state.sawNoRain = true;

  const due = dueWeatherAlerts(ctx, state);
  for (const kind of WEATHER_ALERT_KINDS) {
    if (due.includes(kind)) state.dueSince[kind] ??= now;
    else delete state.dueSince[kind];
  }
  if (!onTrack || now - state.lastAlertAt < MIN_GAP_MS) return { alert: null, state };
  for (const kind of WEATHER_ALERT_KINDS) {
    const since = state.dueSince[kind];
    if (since == null || now - since < CONFIRM_MS) continue;
    if (now - (state.saidAt[kind] ?? -Infinity) < KIND_COOLDOWN_MS[kind]) continue;
    state.saidAt[kind] = now;
    state.lastAlertAt = now;
    if (kind === 'rainStarted') state.sawNoRain = false;
    return { alert: kind, state };
  }
  return { alert: null, state };
}
