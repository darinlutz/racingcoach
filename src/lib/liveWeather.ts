// Live Racing's weather: the conditions now (the collector's live update from 1.54.0, see liveUpdateSchema's
// weather) and an outlook.
//
// iRacing doesn't share its weather forecast with apps (neither live telemetry nor session info has it), so the
// outlook is worked out here: a weekend with static weather won't change, and with dynamic weather the server
// keeps a sample of the conditions every WEATHER_SAMPLE_MS (src/lib/liveRacing.ts) and the outlook carries the last
// few minutes' trend on for OUTLOOK_MINUTES. Pure, so the page can use it too.

// Temperatures in °C, humidity and precipitation 0-1, wind in m/s and radians (where it blows from, clockwise from
// north), skies 0 clear, 1 partly cloudy, 2 mostly cloudy, 3 overcast, wetness iRacing's 0 unknown, 1 dry to 7
// extremely wet, solarAltitude the sun's height in radians (below 0 at night)
export type LiveWeather = {
  type?: string | null;
  airTemp?: number | null;
  trackTemp?: number | null;
  humidity?: number | null;
  windSpeed?: number | null;
  windDir?: number | null;
  skies?: number | null;
  precipitation?: number | null;
  wetness?: number | null;
  declaredWet?: boolean | null;
  solarAltitude?: number | null;
};

export type WeatherSample = {
  at: number;
  airTemp: number | null;
  trackTemp: number | null;
  skies: number | null;
  precipitation: number | null;
  wetness: number | null;
};

// How the weather changed over the last `minutes`: each value's change (°C, precipitation 0-1, skies and wetness steps)
export type WeatherTrend = {
  minutes: number;
  airTemp: number | null;
  trackTemp: number | null;
  skies: number | null;
  precipitation: number | null;
  wetness: number | null;
};

export const WEATHER_SAMPLE_MS = 30_000;
// The trend is measured over about TREND_MS, and not before MIN_TREND_MS of samples
export const TREND_MS = 15 * 60_000;
export const MIN_TREND_MS = 5 * 60_000;
export const OUTLOOK_MINUTES = 30;

export function weatherSample(weather: LiveWeather, at: number): WeatherSample {
  return {
    at,
    airTemp: weather.airTemp ?? null,
    trackTemp: weather.trackTemp ?? null,
    skies: weather.skies ?? null,
    precipitation: weather.precipitation ?? null,
    wetness: weather.wetness ?? null,
  };
}

// The change since the oldest sample within TREND_MS, or null with less than MIN_TREND_MS of samples
export function weatherTrend(history: WeatherSample[], now: WeatherSample): WeatherTrend | null {
  const base = history.find((s) => now.at - s.at <= TREND_MS + WEATHER_SAMPLE_MS);
  if (!base || now.at - base.at < MIN_TREND_MS) return null;
  const change = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 1000) / 1000);
  return {
    minutes: Math.round((now.at - base.at) / 60_000),
    airTemp: change(now.airTemp, base.airTemp),
    trackTemp: change(now.trackTemp, base.trackTemp),
    skies: change(now.skies, base.skies),
    precipitation: change(now.precipitation, base.precipitation),
    wetness: change(now.wetness, base.wetness),
  };
}

export function isStaticWeather(type: string | null | undefined): boolean {
  return !!type && /static|constant|fixed/i.test(type);
}

// What the sky's doing, for the icon and its words
export type SkyCondition =
  | 'clear'
  | 'partlyCloudy'
  | 'mostlyCloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'heavyRain';

export function skyCondition(weather: LiveWeather): SkyCondition | null {
  const rain = weather.precipitation ?? 0;
  if (rain >= 0.6) return 'heavyRain';
  if (rain >= 0.15) return 'rain';
  if (rain > 0.02) return 'drizzle';
  switch (weather.skies) {
    case 0:
      return 'clear';
    case 1:
      return 'partlyCloudy';
    case 2:
      return 'mostlyCloudy';
    case 3:
      return 'overcast';
    default:
      return null;
  }
}

export const isNight = (weather: LiveWeather) => weather.solarAltitude != null && weather.solarAltitude < 0;

// The outlook: what's expected over the next OUTLOOK_MINUTES. Each item is a dictionary key (liveRacing.outlook)
// and, for temperatures, the projected °C.
export type OutlookItem =
  | { kind: 'static' }
  | { kind: 'gathering' }
  | { kind: 'steady' }
  | { kind: 'rainComing' | 'rainHeavier' | 'rainEasing' | 'rainStopping' }
  | { kind: 'cloudsBuilding' | 'clearing' }
  | { kind: 'trackWetter' | 'trackDrying' }
  | { kind: 'trackTemp' | 'airTemp'; projected: number; rising: boolean };

// A temperature change smaller than this over OUTLOOK_MINUTES counts as steady
const TEMP_STEADY_C = 0.5;

export function weatherOutlook(weather: LiveWeather, trend: WeatherTrend | null): OutlookItem[] {
  if (isStaticWeather(weather.type)) return [{ kind: 'static' }];
  if (!trend || trend.minutes <= 0) return [{ kind: 'gathering' }];
  const ahead = OUTLOOK_MINUTES / trend.minutes;
  const items: OutlookItem[] = [];

  const rain = weather.precipitation ?? 0;
  const rainChange = trend.precipitation ?? 0;
  if (rainChange > 0.01) items.push({ kind: rain > 0.02 ? 'rainHeavier' : 'rainComing' });
  else if (rainChange < -0.01) items.push({ kind: rain + rainChange * ahead <= 0.02 ? 'rainStopping' : 'rainEasing' });

  if ((trend.skies ?? 0) > 0 && rain <= 0.02) items.push({ kind: 'cloudsBuilding' });
  else if ((trend.skies ?? 0) < 0) items.push({ kind: 'clearing' });

  if ((trend.wetness ?? 0) > 0) items.push({ kind: 'trackWetter' });
  else if ((trend.wetness ?? 0) < 0) items.push({ kind: 'trackDrying' });

  for (const kind of ['trackTemp', 'airTemp'] as const) {
    const now = weather[kind];
    const change = trend[kind];
    if (now == null || change == null) continue;
    const projected = change * ahead;
    if (Math.abs(projected) >= TEMP_STEADY_C) items.push({ kind, projected: now + projected, rising: projected > 0 });
  }
  return items.length > 0 ? items : [{ kind: 'steady' }];
}
