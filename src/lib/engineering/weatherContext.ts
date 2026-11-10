import type { LiveWeather, WeatherTrend } from '../liveWeather.ts';

// The shared weather context: one normalized picture of the track conditions and the fitted tires that the Setup
// Engineer, the Race Engineer, the In-Car AI Coach's lap callouts and the Debrief Coach all work from, built only from
// what the simulator reported (never from an AI model). Every value keeps its raw reading, units and source, and has a
// status, so a missing or stale value can never be presented as current. docs/wet-weather.md describes it.
//
// What iRacing gives (verified against the SDK the collector uses, SVappsLAB.iRacingTelemetrySDK 2.5.0):
//   live telemetry   Precipitation (0-1), TrackWetness (irsdk_TrackWetness, 0 unknown, 1 dry .. 7 extremely wet),
//                    WeatherDeclaredWet, AirTemp, TrackTempCrew (°C), RelativeHumidity (0-1), WindVel (m/s),
//                    WindDir (rad), Skies (0-3), PlayerTireCompound (the fitted compound's index),
//                    PitSvTireCompound (the compound chosen for the next stop)
//   session info     DriverInfo.DriverTires[] (TireIndex, TireCompoundType: the compounds this car has),
//                    WeekendInfo.TrackWeatherType (static or dynamic weather)
// What it doesn't: a weather forecast (the sim's forecast screen isn't shared with apps), water depth or standing
// water, and a compound per corner (PlayerTireCompound is one value for the car). So `forecast.available` is always
// false for iRacing, and the only look ahead is a projection of the observed trend, labelled as such.
//
// Pure (no imports but types and liveWeather's pure functions), so `node --test` runs it (scripts/wet-weather.test.mjs).

export type WeatherSimulator = 'iracing' | 'acc' | 'ac' | 'unknown';
export type DataStatus = 'available' | 'unavailable' | 'stale' | 'notExposed';

export type Measurement<T> = {
  value: T | null;
  unit: string | null;
  // What the simulator sent, unchanged
  raw: unknown;
  rawUnit: string | null;
  // The simulator variable it came from
  source: string;
  status: DataStatus;
};

export type CompoundKind = 'dry' | 'intermediate' | 'wet' | 'unknown';
export type TireCompound = {
  kind: CompoundKind;
  // The simulator's index and name for it (iRacing: PlayerTireCompound, and DriverTires' TireCompoundType)
  index: number | null;
  name: string | null;
  // high: the index matched a named compound of this car; low: only an index, or only a name that doesn't say
  confidence: 'high' | 'medium' | 'low' | 'none';
  source: string;
};

export type TrackCondition = 'dry' | 'damp' | 'wet' | 'veryWet' | 'unknown';

export const TRACK_WETNESS_LABELS = [
  'unknown',
  'dry',
  'mostly dry',
  'very lightly wet',
  'lightly wet',
  'moderately wet',
  'very wet',
  'extremely wet',
] as const;

// A mismatch between the fitted tires and the track
export type TireMismatch =
  // slicks (dry tires) on a wet or very wet track
  | 'slicksOnWet'
  // slicks on a damp track: can be right, worth watching
  | 'slicksOnDamp'
  // wet tires on a dry track
  | 'wetsOnDry'
  // wet tires while the track is drying
  | 'wetsOnDrying'
  // the track is wet and this car has no wet tires
  | 'noWetTires';

export type WeatherContext = {
  simulator: WeatherSimulator;
  // iRacing's subsession (or session) ID, when known
  sessionId: number | null;
  car: string | null;
  // When the readings were taken (ms since epoch), how old they are, and whether that's recent enough to call current
  observedAt: number | null;
  ageMs: number | null;
  fresh: boolean;
  // 'live' from the collector's live update; 'lap' from an uploaded lap's conditions (history, never "now")
  origin: 'live' | 'lap' | 'none';
  tires: {
    fitted: TireCompound;
    // The compound chosen for the next pit stop, which is not on the car yet
    nextPit: TireCompound | null;
    // The compounds this car has, from session info; null when not known
    available: { index: number; name: string; kind: CompoundKind }[] | null;
    carHasWetTires: boolean | null;
    // iRacing reports one compound for the car, never per corner
    perCorner: 'notReported';
  };
  rain: Measurement<number> & { label: 'none' | 'light' | 'moderate' | 'heavy' | null };
  trackWetness: Measurement<number> & { label: (typeof TRACK_WETNESS_LABELS)[number] | null };
  declaredWet: Measurement<boolean>;
  // iRacing exposes no water depth or standing water
  standingWater: Measurement<number>;
  trackTemp: Measurement<number>;
  airTemp: Measurement<number>;
  humidity: Measurement<number>;
  windSpeed: Measurement<number>;
  windDirection: Measurement<number>;
  skies: Measurement<number>;
  weatherType: 'static' | 'dynamic' | 'unknown';
  condition: TrackCondition;
  trend: {
    minutes: number;
    rain: 'increasing' | 'decreasing' | 'steady' | null;
    wetness: 'wetter' | 'drying' | 'steady' | null;
    trackTemp: 'rising' | 'falling' | 'steady' | null;
  } | null;
  forecast: {
    available: false;
    reason: string;
    // A projection of the observed trend over the next minutes (not the simulator's forecast), or that the weather
    // is static and won't change; null without enough history
    projection: { basis: string; items: string[] } | null;
  };
  mismatch: TireMismatch | null;
  // Conflicting or doubtful readings, in words
  warnings: string[];
};

// Readings older than this aren't current (the live state's STALE_MS)
export const WEATHER_STALE_MS = 15_000;

// Rain at or above these counts as light, moderate, heavy (Precipitation, 0-1)
const RAIN_LIGHT = 0.02;
const RAIN_MODERATE = 0.15;
const RAIN_HEAVY = 0.5;

export const FORECAST_UNAVAILABLE =
  'iRacing does not share its weather forecast with apps: live telemetry and session info carry only the current ' +
  'conditions, so no forecast is known.';

export type TireInput = {
  // iRacing's PlayerTireCompound and PitSvTireCompound (indexes into DriverTires)
  compound?: number | null;
  pitCompound?: number | null;
  // DriverInfo.DriverTires, from session info
  available?: { index: number; type: string }[] | null;
  // A simulator that names the compound instead (ACC's tyreCompound, e.g. "wet_compound")
  compoundName?: string | null;
};

export function compoundKind(name: string | null | undefined): CompoundKind {
  if (!name || !name.trim()) return 'unknown';
  if (/inter/i.test(name)) return 'intermediate';
  if (/wet|rain/i.test(name)) return 'wet';
  if (/dry|slick|hard|medium|soft|prime|primary|option|alternate|street/i.test(name)) return 'dry';
  return 'unknown';
}

function resolveCompound(index: number | null | undefined, available: TireInput['available'], name: string | null | undefined, source: string): TireCompound {
  if (index != null && index >= 0) {
    const match = available?.find((t) => t.index === index);
    if (match) {
      const kind = compoundKind(match.type);
      return { kind, index, name: match.type, confidence: kind === 'unknown' ? 'low' : 'high', source: `${source} + DriverInfo.DriverTires` };
    }
    return { kind: 'unknown', index, name: null, confidence: 'low', source: `${source} (no compound list to name it)` };
  }
  if (name && name.trim()) {
    const kind = compoundKind(name);
    return { kind, index: null, name: name.trim(), confidence: kind === 'unknown' ? 'low' : 'high', source };
  }
  return { kind: 'unknown', index: null, name: null, confidence: 'none', source: 'not reported' };
}

const measurement = <T>(value: T | null, raw: unknown, unit: string | null, source: string, fresh: boolean, exposed = true): Measurement<T> => ({
  value,
  unit,
  raw: raw ?? null,
  rawUnit: unit,
  source,
  status: !exposed ? 'notExposed' : value == null ? 'unavailable' : fresh ? 'available' : 'stale',
});

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function rainLabel(rain: number | null): WeatherContext['rain']['label'] {
  if (rain == null) return null;
  if (rain >= RAIN_HEAVY) return 'heavy';
  if (rain >= RAIN_MODERATE) return 'moderate';
  if (rain >= RAIN_LIGHT) return 'light';
  return 'none';
}

// The track's condition from iRacing's TrackWetness, else from the rain and declared wet flag. TrackWetness is the
// sim's own word for the surface, so it wins; without it, rain alone can only say the surface is at least damp.
export function trackCondition(wetness: number | null, rain: number | null, declaredWet: boolean | null): TrackCondition {
  if (wetness != null && wetness >= 1 && wetness <= 7) {
    if (wetness === 1) return 'dry';
    if (wetness <= 4) return 'damp';
    if (wetness === 5) return 'wet';
    return 'veryWet';
  }
  if (rain != null && rain >= RAIN_HEAVY) return 'wet';
  if ((rain != null && rain >= RAIN_LIGHT) || declaredWet === true) return 'damp';
  return 'unknown';
}

export const isWetCondition = (condition: TrackCondition) => condition === 'damp' || condition === 'wet' || condition === 'veryWet';

function tireMismatch(fitted: TireCompound, condition: TrackCondition, drying: boolean, carHasWetTires: boolean | null): TireMismatch | null {
  if (fitted.confidence === 'none' || fitted.confidence === 'low') {
    return (condition === 'wet' || condition === 'veryWet') && carHasWetTires === false ? 'noWetTires' : null;
  }
  if (fitted.kind === 'dry') {
    if (condition === 'wet' || condition === 'veryWet') return carHasWetTires === false ? 'noWetTires' : 'slicksOnWet';
    if (condition === 'damp') return 'slicksOnDamp';
  }
  if (fitted.kind === 'wet' || fitted.kind === 'intermediate') {
    if (condition === 'dry') return 'wetsOnDry';
    if (drying && condition === 'damp') return 'wetsOnDrying';
  }
  return null;
}

type BuildInput = {
  simulator?: WeatherSimulator;
  sessionId?: number | null;
  car?: string | null;
  weather: LiveWeather | null | undefined;
  tires?: TireInput | null;
  trend?: WeatherTrend | null;
  observedAt: number | null;
  now: number;
  origin: 'live' | 'lap';
  staleMs?: number;
};

export function buildWeatherContext(input: BuildInput): WeatherContext {
  const simulator = input.simulator ?? 'iracing';
  const w = input.weather ?? null;
  const ageMs = input.observedAt != null ? Math.max(0, input.now - input.observedAt) : null;
  // a lap's conditions are history: never current, whatever their age
  const fresh = input.origin === 'live' && ageMs != null && ageMs <= (input.staleMs ?? WEATHER_STALE_MS) && !!w;
  const rain = num(w?.precipitation);
  const wetnessRaw = num(w?.wetness);
  const wetness = wetnessRaw != null && wetnessRaw >= 1 && wetnessRaw <= 7 ? wetnessRaw : null;
  const declaredWet = typeof w?.declaredWet === 'boolean' ? w.declaredWet : null;
  const condition = w ? trackCondition(wetness, rain, declaredWet) : 'unknown';

  const tiresIn = input.tires ?? null;
  const available = tiresIn?.available?.length
    ? tiresIn.available.map((t) => ({ index: t.index, name: t.type, kind: compoundKind(t.type) }))
    : null;
  const fitted = resolveCompound(tiresIn?.compound, tiresIn?.available, tiresIn?.compoundName, simulator === 'iracing' ? 'PlayerTireCompound' : 'tyreCompound');
  const nextPit =
    tiresIn?.pitCompound != null && tiresIn.pitCompound >= 0
      ? resolveCompound(tiresIn.pitCompound, tiresIn.available, null, 'PitSvTireCompound')
      : null;
  const carHasWetTires = available ? available.some((t) => t.kind === 'wet' || t.kind === 'intermediate') : null;

  const t = input.trend ?? null;
  const trend = t
    ? {
        minutes: t.minutes,
        rain: t.precipitation == null ? null : t.precipitation > 0.02 ? ('increasing' as const) : t.precipitation < -0.02 ? ('decreasing' as const) : ('steady' as const),
        wetness: t.wetness == null ? null : t.wetness > 0 ? ('wetter' as const) : t.wetness < 0 ? ('drying' as const) : ('steady' as const),
        trackTemp: t.trackTemp == null ? null : t.trackTemp >= 1 ? ('rising' as const) : t.trackTemp <= -1 ? ('falling' as const) : ('steady' as const),
      }
    : null;
  const drying = trend?.wetness === 'drying';
  const weatherType = !w?.type ? 'unknown' : /static|constant|fixed/i.test(w.type) ? 'static' : 'dynamic';

  const warnings: string[] = [];
  if (!w) warnings.push('No weather readings from the simulator.');
  else if (!fresh && input.origin === 'live') warnings.push(`The weather readings are ${Math.round((ageMs ?? 0) / 1000)} s old, so they may no longer be current.`);
  if (wetnessRaw === 0) warnings.push('iRacing reports the track wetness as unknown.');
  if (declaredWet === true && wetness === 1) warnings.push('The session is declared wet but the track wetness reads dry.');
  if (rain != null && rain >= RAIN_MODERATE && wetness === 1) warnings.push('Rain is falling but the surface still reads dry: it is probably just starting to rain.');
  if (weatherType === 'static' && trend && (trend.rain === 'increasing' || trend.rain === 'decreasing' || trend.wetness === 'wetter' || trend.wetness === 'drying')) {
    warnings.push('The weather is set to static but the readings are changing.');
  }
  if (tiresIn?.compound != null && tiresIn.compound >= 0 && available && !available.some((a) => a.index === tiresIn.compound)) {
    warnings.push('The fitted compound is not in the car\'s list of compounds.');
  }
  if (fitted.confidence === 'none') warnings.push('The fitted tire compound is not reported.');

  let projection: WeatherContext['forecast']['projection'] = null;
  if (weatherType === 'static') {
    projection = { basis: 'the session\'s weather is static', items: ['No change in the weather is expected during this session.'] };
  } else if (trend && trend.minutes > 0) {
    const items: string[] = [];
    if (trend.rain === 'increasing') items.push('Rain has been getting heavier.');
    if (trend.rain === 'decreasing') items.push('Rain has been easing.');
    if (trend.wetness === 'wetter') items.push('The track has been getting wetter.');
    if (trend.wetness === 'drying') items.push('The track has been drying.');
    if (trend.trackTemp === 'rising') items.push('Track temperature has been rising.');
    if (trend.trackTemp === 'falling') items.push('Track temperature has been falling.');
    if (!items.length) items.push('The conditions have been steady.');
    projection = { basis: `the trend of the last ${trend.minutes} minutes of readings, not a forecast`, items };
  }

  const exposed = simulator === 'iracing' || simulator === 'acc';
  return {
    simulator,
    sessionId: input.sessionId ?? null,
    car: input.car ?? null,
    observedAt: input.observedAt,
    ageMs,
    fresh,
    origin: w ? input.origin : 'none',
    tires: { fitted, nextPit, available, carHasWetTires, perCorner: 'notReported' },
    rain: { ...measurement(rain, w?.precipitation, 'fraction 0-1', 'Precipitation', fresh, exposed), label: rainLabel(rain) },
    trackWetness: {
      ...measurement(wetness, w?.wetness, 'iRacing TrackWetness level 1-7', 'TrackWetness', fresh, simulator === 'iracing'),
      label: wetnessRaw != null && wetnessRaw >= 0 && wetnessRaw <= 7 ? TRACK_WETNESS_LABELS[wetnessRaw] : null,
    },
    declaredWet: measurement(declaredWet, w?.declaredWet, null, 'WeatherDeclaredWet', fresh, simulator === 'iracing'),
    standingWater: measurement<number>(null, null, null, 'not exposed by the simulator', fresh, false),
    trackTemp: measurement(num(w?.trackTemp), w?.trackTemp, '°C', 'TrackTempCrew', fresh),
    airTemp: measurement(num(w?.airTemp), w?.airTemp, '°C', 'AirTemp', fresh),
    humidity: measurement(num(w?.humidity), w?.humidity, 'fraction 0-1', 'RelativeHumidity', fresh),
    windSpeed: measurement(num(w?.windSpeed), w?.windSpeed, 'm/s', 'WindVel', fresh),
    windDirection: measurement(num(w?.windDir), w?.windDir, 'rad', 'WindDir', fresh),
    skies: measurement(num(w?.skies), w?.skies, '0 clear - 3 overcast', 'Skies', fresh),
    weatherType,
    condition,
    trend,
    forecast: { available: false, reason: FORECAST_UNAVAILABLE, projection },
    mismatch: tireMismatch(fitted, condition, drying, carHasWetTires),
    warnings,
  };
}

// What the live state keeps of a driver (liveRacing.ts's EngineerSnapshot), written out so this file stays pure
export type LiveWeatherSnapshot = {
  update: { car: string; weather?: LiveWeather | null; tires?: TireInput | null };
  field?: { subSessionId: number } | null;
  weatherTrend: WeatherTrend | null;
  receivedAt: number;
};

// The weather context of a live driver, from their latest live update; stale once the update is old
export function weatherContextFromLive(snapshot: LiveWeatherSnapshot | null | undefined, now: number, simulator: WeatherSimulator = 'iracing'): WeatherContext {
  return buildWeatherContext({
    simulator,
    sessionId: snapshot?.field?.subSessionId || null,
    car: snapshot?.update.car ?? null,
    weather: snapshot?.update.weather ?? null,
    tires: snapshot?.update.tires ?? null,
    trend: snapshot?.weatherTrend ?? null,
    observedAt: snapshot?.receivedAt ?? null,
    now,
    origin: 'live',
  });
}

// An uploaded lap's conditions (collectors from 1.94.0 add the wet weather and tires to them; older laps have only
// temperatures, humidity, wind and track usage)
export type LapWeatherConditions = {
  trackTempC?: number | null;
  airTempC?: number | null;
  relativeHumidity?: number | null;
  windVelocity?: number | null;
  windDirection?: number | null;
  precipitation?: number | null;
  trackWetness?: number | null;
  declaredWet?: boolean | null;
  tireCompound?: number | null;
  tireCompoundType?: string | null;
};

// The weather of a session from its laps, oldest first: the newest lap's conditions, and the change since the first
export function weatherContextFromLaps(
  laps: { conditions: LapWeatherConditions | null; completedAt: number | null }[],
  now: number,
  car: string | null = null
): WeatherContext {
  const withConditions = laps.filter((l) => l.conditions);
  const last = withConditions[withConditions.length - 1];
  const first = withConditions[0];
  const toWeather = (c: LapWeatherConditions | null | undefined): LiveWeather | null =>
    c
      ? {
          airTemp: c.airTempC ?? null,
          trackTemp: c.trackTempC ?? null,
          humidity: c.relativeHumidity ?? null,
          windSpeed: c.windVelocity ?? null,
          windDir: c.windDirection ?? null,
          precipitation: c.precipitation ?? null,
          wetness: c.trackWetness ?? null,
          declaredWet: c.declaredWet ?? null,
        }
      : null;
  let trend: WeatherTrend | null = null;
  if (first && last && first !== last && first.completedAt != null && last.completedAt != null && last.completedAt > first.completedAt) {
    const change = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);
    trend = {
      minutes: Math.max(1, Math.round((last.completedAt - first.completedAt) / 60_000)),
      airTemp: change(last.conditions!.airTempC, first.conditions!.airTempC),
      trackTemp: change(last.conditions!.trackTempC, first.conditions!.trackTempC),
      skies: null,
      precipitation: change(last.conditions!.precipitation, first.conditions!.precipitation),
      wetness: change(last.conditions!.trackWetness, first.conditions!.trackWetness),
    };
  }
  const c = last?.conditions ?? null;
  return buildWeatherContext({
    car,
    weather: toWeather(c),
    tires: c && (c.tireCompound != null || c.tireCompoundType)
      ? {
          compound: c.tireCompoundType ? null : c.tireCompound,
          compoundName: c.tireCompoundType ?? null,
        }
      : null,
    trend,
    observedAt: last?.completedAt ?? null,
    now,
    origin: 'lap',
  });
}

// What retrieval and the diagnosis need of the weather
export type WeatherAssessment = {
  condition: TrackCondition;
  wet: boolean;
  drying: boolean;
  worsening: boolean;
  fittedCompound: CompoundKind;
  mismatch: TireMismatch | null;
  // Whether the readings are current (a debrief's are history: still true conditions for those laps)
  reliable: boolean;
};

export function assessWeather(ctx: WeatherContext | null | undefined): WeatherAssessment | null {
  if (!ctx || ctx.origin === 'none') return null;
  // stale live readings say nothing about now
  const reliable = ctx.origin === 'lap' || ctx.fresh;
  if (!reliable) return null;
  return {
    condition: ctx.condition,
    wet: isWetCondition(ctx.condition),
    drying: ctx.trend?.wetness === 'drying',
    worsening: ctx.trend?.rain === 'increasing' || ctx.trend?.wetness === 'wetter',
    fittedCompound: ctx.tires.fitted.confidence === 'high' || ctx.tires.fitted.confidence === 'medium' ? ctx.tires.fitted.kind : 'unknown',
    mismatch: ctx.mismatch,
    reliable,
  };
}

const CONDITION_WORDS: Record<TrackCondition, string> = {
  dry: 'dry',
  damp: 'damp',
  wet: 'wet',
  veryWet: 'very wet',
  unknown: 'not known',
};

const temp = (c: number | null, metric: boolean) => (c == null ? null : metric ? `${c.toFixed(1)} °C` : `${(c * 1.8 + 32).toFixed(0)} °F`);

// The weather context as lines of facts for an agent's prompt: observed values marked as observed, the forecast as
// unavailable, the projection as a projection, and stale readings as not current
export function weatherFacts(ctx: WeatherContext | null | undefined, units: 'metric' | 'standard' = 'standard'): string[] {
  if (!ctx || ctx.origin === 'none') {
    return ['Weather: no weather readings are available, so the track conditions and tire compound are not known; do not assume them.'];
  }
  const metric = units === 'metric';
  const when =
    ctx.origin === 'lap'
      ? 'Weather observed on the newest uploaded lap (history, not necessarily now)'
      : ctx.fresh
        ? 'Weather observed now (live telemetry)'
        : `Weather last observed ${Math.round((ctx.ageMs ?? 0) / 1000)} s ago, NOT current; do not present it as the conditions now`;
  const observed = [
    `track ${CONDITION_WORDS[ctx.condition]}`,
    ctx.trackWetness.label && ctx.trackWetness.label !== 'unknown' ? `iRacing track wetness "${ctx.trackWetness.label}"` : null,
    ctx.rain.value != null ? `rain ${ctx.rain.label} (${Math.round(ctx.rain.value * 100)}%)` : null,
    ctx.declaredWet.value === true ? 'session declared wet' : null,
    ctx.trackTemp.value != null ? `track ${temp(ctx.trackTemp.value, metric)}` : null,
    ctx.airTemp.value != null ? `air ${temp(ctx.airTemp.value, metric)}` : null,
    ctx.humidity.value != null ? `humidity ${Math.round(ctx.humidity.value * 100)}%` : null,
  ].filter(Boolean);
  const lines = [`${when}: ${observed.join(', ')}.`];

  const f = ctx.tires.fitted;
  const compoundWords = (c: TireCompound) =>
    c.kind === 'unknown' ? (c.name ? `"${c.name}" (not known whether dry or wet)` : 'not known') : `${c.kind === 'dry' ? 'dry (slick)' : c.kind} tires${c.name ? ` ("${c.name}")` : ''}`;
  lines.push(
    f.confidence === 'none'
      ? 'Fitted tires: not reported, so do not assume slicks or wets.'
      : `Fitted tires: ${compoundWords(f)}${f.confidence === 'low' ? ', low confidence' : ''} (from ${f.source}; one compound for the whole car).`
  );
  if (ctx.tires.nextPit && ctx.tires.nextPit.index !== f.index) {
    lines.push(`Compound selected for the next pit stop (not fitted yet): ${compoundWords(ctx.tires.nextPit)}.`);
  }
  if (ctx.tires.carHasWetTires === false) lines.push('This car has no wet tires in this session: only dry tires are available.');
  if (ctx.tires.available) lines.push(`Compounds this car has: ${ctx.tires.available.map((t) => t.name).join(', ')}.`);

  if (ctx.trend) {
    const parts = [
      ctx.trend.rain && ctx.trend.rain !== 'steady' ? `rain ${ctx.trend.rain}` : null,
      ctx.trend.wetness && ctx.trend.wetness !== 'steady' ? `track ${ctx.trend.wetness === 'drying' ? 'drying' : 'getting wetter'}` : null,
      ctx.trend.trackTemp && ctx.trend.trackTemp !== 'steady' ? `track temperature ${ctx.trend.trackTemp}` : null,
    ].filter(Boolean);
    lines.push(`Observed over the last ${ctx.trend.minutes} minutes: ${parts.length ? parts.join(', ') : 'steady'}.`);
  }
  lines.push(`Forecast: not available. ${ctx.forecast.reason}`);
  if (ctx.forecast.projection) {
    lines.push(`Projection (from ${ctx.forecast.projection.basis}; never call it a forecast): ${ctx.forecast.projection.items.join(' ')}`);
  }
  lines.push('Not measured by the simulator: standing water or water depth, ABS and traction control activity in the laps.');

  switch (ctx.mismatch) {
    case 'slicksOnWet':
      lines.push('TIRE MISMATCH: dry (slick) tires on a wet track. The lack of grip is the tires first; say so before any handling or setup change.');
      break;
    case 'slicksOnDamp':
      lines.push('Dry tires on a damp track: can be the right choice while the track is only damp; watch the grip and the lap times.');
      break;
    case 'wetsOnDry':
      lines.push('Wet tires on a dry track: they will overheat and wear fast; slicks are likely the better tire if conditions stay dry.');
      break;
    case 'wetsOnDrying':
      lines.push('Wet tires on a drying track: watch for them overheating; a change to slicks may become worth it, but only when the laps and conditions show it.');
      break;
    case 'noWetTires':
      lines.push('The track is wet but this car has no wet tires: only driving and in-car changes can help.');
      break;
  }
  for (const w of ctx.warnings) lines.push(`Note: ${w}`);
  return lines;
}

// A short label for logs and the Admin page
export function weatherSummary(ctx: WeatherContext | null | undefined): string {
  if (!ctx || ctx.origin === 'none') return 'no weather';
  return [
    ctx.condition,
    ctx.rain.label ? `rain ${ctx.rain.label}` : null,
    `tires ${ctx.tires.fitted.kind}${ctx.tires.fitted.confidence === 'low' ? '?' : ''}`,
    ctx.mismatch,
    ctx.origin === 'live' && !ctx.fresh ? 'stale' : null,
  ]
    .filter(Boolean)
    .join(', ');
}
