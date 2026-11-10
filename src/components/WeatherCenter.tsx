'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { HumidityPicture, ThermometerPicture, WeatherPicture, WindCompass } from '@/components/WeatherArt';
import { isNight, isStaticWeather, OUTLOOK_MINUTES, skyCondition, type LiveWeather, type OutlookItem, type SkyCondition } from '@/lib/liveWeather';
import { formatSpeed, formatTemperature } from '@/lib/units';

// TV Broadcast Mode's Weather Center, at the top of the screen: the sky now as a picture, the air and track
// temperatures (in the account's Preferred Units), humidity, wind speed and direction, rain and the track surface, and
// the outlook for the next half hour. iRacing shares no forecast with apps, so the outlook carries on the trend of the
// last few minutes (src/lib/liveWeather.ts) and says so.

// The band's sky behind it: day, night or rain
function skyBackground(sky: SkyCondition | null, night: boolean): string {
  if (sky === 'rain' || sky === 'heavyRain' || sky === 'drizzle') return 'linear-gradient(120deg, #1d2a3a 0%, #13202e 45%, #10141b 100%)';
  if (night) return 'linear-gradient(120deg, #1b1a46 0%, #131a33 45%, #10141b 100%)';
  if (sky === 'overcast' || sky === 'mostlyCloudy') return 'linear-gradient(120deg, #263241 0%, #182230 45%, #10141b 100%)';
  return 'linear-gradient(120deg, #11406e 0%, #10273f 45%, #10141b 100%)';
}

// The outlook item as a small picture
function outlookSky(item: OutlookItem, now: SkyCondition | null): SkyCondition | null {
  switch (item.kind) {
    case 'rainComing':
      return 'rain';
    case 'rainHeavier':
      return 'heavyRain';
    case 'rainEasing':
      return 'drizzle';
    case 'rainStopping':
      return 'partlyCloudy';
    case 'cloudsBuilding':
      return 'mostlyCloudy';
    case 'clearing':
    case 'trackDrying':
      return 'clear';
    case 'trackWetter':
      return 'rain';
    default:
      return now;
  }
}

export default function WeatherCenter({ weather, outlook, outlookMinutes }: { weather: LiveWeather | null; outlook: OutlookItem[]; outlookMinutes: number | null }) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const label = <p className="whitespace-nowrap text-[15px] font-bold uppercase tracking-[0.12em] text-[#7dd3fc]">{t.carWeather.weatherCenter}</p>;
  if (!weather) {
    return (
      <div className="flex h-full w-[1040px] shrink-0 items-center gap-5 rounded-2xl bg-[#10141b] px-6">
        <WeatherPicture condition={null} className="size-[84px] opacity-50" />
        <div>
          {label}
          <p className="mt-1 text-[22px] text-[#a7b0bd]">{t.carWeather.noWeather}</p>
        </div>
      </div>
    );
  }
  const sky = skyCondition(weather);
  const night = isNight(weather);
  const raining = (weather.precipitation ?? 0) > 0.02;
  const deg = weather.windDir != null ? ((((weather.windDir * 180) / Math.PI) % 360) + 360) % 360 : null;
  const compass = deg != null ? t.weather.compass[Math.round(deg / 45) % 8] : null;
  const wetness = weather.wetness != null && weather.wetness > 0 ? t.liveRacing.wetness[weather.wetness] : null;
  const outlookText = (item: OutlookItem) =>
    item.kind === 'trackTemp' || item.kind === 'airTemp'
      ? fmt(t.liveRacing.outlook[`${item.kind}${item.rising ? 'Rising' : 'Falling'}`], { t: formatTemperature(item.projected, units) })
      : item.kind === 'static'
        ? t.carWeather.outlookStatic
        : item.kind === 'gathering'
          ? t.carWeather.outlookGathering
          : t.liveRacing.outlook[item.kind];
  const tiles: { key: string; picture: ReactNode; name: string; value: string; sub?: string | null }[] = [
    {
      key: 'air',
      picture: <ThermometerPicture celsius={weather.airTemp ?? null} className="size-[50px]" />,
      name: t.carWeather.air,
      value: weather.airTemp != null ? formatTemperature(weather.airTemp, units) : '—',
    },
    {
      key: 'track',
      picture: <ThermometerPicture celsius={weather.trackTemp ?? null} hot className="size-[50px]" />,
      name: t.carWeather.track,
      value: weather.trackTemp != null ? formatTemperature(weather.trackTemp, units) : '—',
    },
    {
      key: 'humidity',
      picture: <HumidityPicture humidity={weather.humidity ?? null} className="size-[46px]" />,
      name: t.carWeather.humidity,
      value: weather.humidity != null ? `${Math.round(weather.humidity * 100)}%` : '—',
    },
    {
      key: 'wind',
      picture: <WindCompass fromRadians={weather.windDir ?? null} className="size-[50px]" />,
      name: t.carWeather.wind,
      value: weather.windSpeed != null ? formatSpeed(weather.windSpeed, units, 0) : '—',
      sub: compass ? fmt(t.liveRacing.windFrom, { dir: compass }) : null,
    },
  ];

  return (
    <div className="relative flex h-full w-[1040px] shrink-0 items-center gap-4 overflow-hidden rounded-2xl px-5 ring-1 ring-white/10" style={{ background: skyBackground(sky, night) }}>
      {/* the sky now */}
      <div className="flex w-[318px] shrink-0 items-center gap-2">
        <WeatherPicture condition={sky} night={night} title={sky ? t.liveRacing.sky[sky] : undefined} className="size-[104px] shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]" />
        <div className="min-w-0">
          {label}
          <p className="mt-0.5 truncate font-display text-[32px] font-bold leading-none">{sky ? t.liveRacing.sky[sky] : '—'}</p>
          <p className={`mt-1 truncate text-[17px] ${raining ? 'font-semibold text-[#7cc7ff]' : 'text-[#a7b0bd]'}`}>
            {[raining ? fmt(t.carWeather.radarRain, { n: Math.round((weather.precipitation ?? 0) * 100) }) : t.carWeather.dry, wetness && raining ? wetness : null, night ? t.liveRacing.night : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {weather.declaredWet && <p className="mt-0.5 inline-block rounded bg-[#2f7bff] px-2 text-[14px] font-bold uppercase text-white">{t.liveRacing.declaredWet}</p>}
        </div>
      </div>

      {/* the readings */}
      <div className="grid shrink-0 grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className="flex w-[100px] flex-col items-center rounded-xl bg-black/30 px-1 py-1.5 ring-1 ring-white/5">
            {tile.picture}
            <p className="text-[13px] uppercase tracking-wide text-[#a7b0bd]">{tile.name}</p>
            <p className="whitespace-nowrap text-[21px] font-bold leading-tight tabular-nums">{tile.value}</p>
            {tile.sub && <p className="w-full truncate text-center text-[12px] leading-tight text-[#8b95a3]">{tile.sub}</p>}
          </div>
        ))}
      </div>

      {/* the outlook */}
      <div className="min-w-0 flex-1 self-stretch border-l border-white/10 py-3 pl-4">
        <p className="text-[14px] font-bold uppercase tracking-wide text-[#a7b0bd]">{fmt(t.carWeather.outlookTitle, { n: OUTLOOK_MINUTES })}</p>
        <ul className="mt-1.5 space-y-1">
          {outlook.slice(0, 2).map((item) => (
            <li key={item.kind} className="flex min-w-0 items-center gap-1.5 text-[17px] leading-tight">
              <WeatherPicture condition={outlookSky(item, sky)} night={night} className="size-[28px] shrink-0" />
              <span className="min-w-0 truncate">{outlookText(item)}</span>
            </li>
          ))}
        </ul>
        {outlookMinutes != null && !isStaticWeather(weather.type) && (
          <p className="mt-1 truncate text-[12px] text-[#8b95a3]">{fmt(t.carWeather.outlookProjected, { n: outlookMinutes })}</p>
        )}
      </div>
    </div>
  );
}
