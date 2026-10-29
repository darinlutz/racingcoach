'use client';

import {
  ArrowDown,
  Cloud,
  CloudDrizzle,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudRainWind,
  CloudSun,
  Cloudy,
  Droplets,
  Lock,
  Minus,
  Moon,
  Sun,
  Thermometer,
  ThermometerSun,
  TrendingDown,
  TrendingUp,
  Umbrella,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import RaceFlag from '@/components/RaceFlag';
import { useUnits } from '@/components/UnitsProvider';
import type { LiveDriver } from '@/lib/liveRacing';
import {
  isNight,
  isStaticWeather,
  OUTLOOK_MINUTES,
  skyCondition,
  weatherOutlook,
  type OutlookItem,
  type SkyCondition,
} from '@/lib/liveWeather';
import { sessionFlag, type FlagKind } from '@/lib/raceFlags';
import { formatSpeed, formatTemperature } from '@/lib/units';

// The top of a Live Racing session: the session's flag, big and waving (src/lib/raceFlags.ts), with what's said
// under it (e.g. "One lap to green") and the watched driver's own flags (blue, black, repair); the session (Practice,
// Qualifying, Race, and iRacing's name for it when that says more, e.g. "Heat 1"); the weather now; and the outlook
// for the next half hour (src/lib/liveWeather.ts: iRacing doesn't share its forecast). All from the collector's live
// update of the driver whose session it is (from 1.54.0; older collectors send only the session type).

// The flag's words and its band's colors (token-safe in both themes)
const FLAG_STYLE: Record<FlagKind, { text: string; band: string; edge: string }> = {
  green: { text: 'text-green-500', band: 'bg-green-500/10', edge: 'border-l-green-500' },
  yellow: { text: 'text-amber-500', band: 'bg-yellow-400/15', edge: 'border-l-yellow-400' },
  caution: { text: 'text-amber-500', band: 'bg-yellow-400/15', edge: 'border-l-yellow-400' },
  red: { text: 'text-red-500', band: 'bg-red-500/15', edge: 'border-l-red-500' },
  white: { text: 'text-foreground', band: 'bg-muted/60', edge: 'border-l-slate-200' },
  checkered: { text: 'text-foreground', band: 'bg-muted/60', edge: 'border-l-foreground' },
  debris: { text: 'text-amber-500', band: 'bg-yellow-400/15', edge: 'border-l-red-500' },
  none: { text: 'text-muted-foreground', band: '', edge: 'border-l-border' },
  blue: { text: 'text-blue-500', band: 'bg-blue-500/10', edge: 'border-l-blue-500' },
  black: { text: 'text-foreground', band: 'bg-muted/60', edge: 'border-l-foreground' },
  repair: { text: 'text-orange-500', band: 'bg-muted/60', edge: 'border-l-orange-500' },
  disqualify: { text: 'text-foreground', band: 'bg-muted/60', edge: 'border-l-foreground' },
};

const SKY_ICON: Record<SkyCondition, { day: LucideIcon; night: LucideIcon; color: string }> = {
  clear: { day: Sun, night: Moon, color: 'text-amber-400' },
  partlyCloudy: { day: CloudSun, night: CloudMoon, color: 'text-amber-300' },
  mostlyCloudy: { day: Cloud, night: CloudMoon, color: 'text-slate-400' },
  overcast: { day: Cloudy, night: Cloudy, color: 'text-slate-400' },
  drizzle: { day: CloudDrizzle, night: CloudMoonRain, color: 'text-sky-400' },
  rain: { day: CloudRain, night: CloudRain, color: 'text-sky-500' },
  heavyRain: { day: CloudRainWind, night: CloudRainWind, color: 'text-blue-500' },
};

const OUTLOOK_ICON: Record<OutlookItem['kind'], LucideIcon> = {
  static: Lock,
  gathering: Minus,
  steady: Minus,
  rainComing: CloudRain,
  rainHeavier: CloudRainWind,
  rainEasing: CloudDrizzle,
  rainStopping: Umbrella,
  cloudsBuilding: Cloud,
  clearing: Sun,
  trackWetter: Waves,
  trackDrying: Sun,
  trackTemp: ThermometerSun,
  airTemp: Thermometer,
};

export default function LiveSessionBanner({ driver, driverName }: { driver: LiveDriver; driverName: string }) {
  const { t, fmt } = useLanguage();
  const flag = sessionFlag(driver.sessionFlags, driver.sessionState);
  const weather = driver.weather ?? null;
  const flagKind = flag?.flag ?? 'none';
  const style = FLAG_STYLE[flagKind];

  const typeKey = driver.sessionType?.trim().toLowerCase() ?? '';
  const sessionLabel = driver.sessionType ? t.liveRacing.sessionTypes[typeKey] ?? driver.sessionType : null;
  // iRacing's name for the session, when it says more than its type (e.g. "HEAT 1", not "RACE" for a race)
  const name = driver.sessionName?.trim();
  const nameSaysMore = !!name && !typeKey.includes(name.toLowerCase()) && name.toLowerCase() !== sessionLabel?.toLowerCase();
  const sessionName = nameSaysMore ? name.charAt(0) + name.slice(1).toLowerCase() : null;

  return (
    <div className={`grid gap-4 border-b border-border border-l-8 ${style.edge} ${style.band} px-4 py-4 lg:grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)] items-center`}>
      {/* the flag */}
      <div className="flex items-center gap-4 min-w-0">
        <RaceFlag
          flag={flagKind}
          waving={!!flag?.waving}
          label={t.liveRacing.flags[flagKind]}
          className="w-36 sm:w-44 shrink-0 drop-shadow-md"
        />
        <div className="min-w-0">
          <p className={`text-3xl sm:text-4xl font-black uppercase tracking-tight leading-none ${style.text}`}>
            {flag ? t.liveRacing.flags[flagKind] : '—'}
          </p>
          {flag && (flag.waving || flag.notes.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {flag.waving && (
                <span className="rounded bg-foreground/10 px-2 py-0.5 text-xs font-semibold uppercase text-foreground">{t.liveRacing.flagWaved}</span>
              )}
              {flag.notes.map((note) =>
                t.liveRacing.flagNotes[note] ? (
                  <span key={note} className="rounded bg-foreground/10 px-2 py-0.5 text-xs font-semibold uppercase text-foreground">
                    {t.liveRacing.flagNotes[note]}
                  </span>
                ) : null
              )}
            </div>
          )}
          {flag && flag.driverFlags.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{fmt(t.liveRacing.driverFlags, { name: driverName })}</span>
              {flag.driverFlags.map((kind) => (
                <span key={kind} className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                  <RaceFlag flag={kind} label={t.liveRacing.flags[kind]} className="w-9" />
                  {t.liveRacing.flags[kind]}
                </span>
              ))}
            </div>
          )}
          {!flag && <p className="mt-2 text-xs text-muted-foreground">{t.liveRacing.flagNeedsCollector}</p>}
        </div>
      </div>

      {/* the session */}
      <div className="lg:border-l lg:pl-4 border-border">
        <p className="text-4xl sm:text-5xl font-black uppercase tracking-tight leading-none text-foreground">{sessionLabel ?? '—'}</p>
        {sessionName && <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{sessionName}</p>}
      </div>

      {weather && <WeatherNow weather={weather} />}
      {weather && <Outlook driver={driver} />}
    </div>
  );

}

function WeatherNow({ weather }: { weather: NonNullable<LiveDriver['weather']> }) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const sky = skyCondition(weather);
  const night = isNight(weather);
  const icon = sky ? SKY_ICON[sky] : null;
  const Icon = icon ? (night ? icon.night : icon.day) : null;
  const degrees = weather.windDir != null ? ((((weather.windDir * 180) / Math.PI) % 360) + 360) % 360 : null;
  const compass = degrees != null ? t.weather.compass[Math.round(degrees / 45) % 8] : null;
  const wetness = weather.wetness != null && weather.wetness > 0 ? t.liveRacing.wetness[weather.wetness] : null;
  const headings = t.weather.headings;

  const items: { icon: LucideIcon; label: string; value: ReactNode; title?: string }[] = [];
  if (weather.trackTemp != null) items.push({ icon: ThermometerSun, label: headings.trackTemp, value: formatTemperature(weather.trackTemp, units) });
  if (weather.airTemp != null) items.push({ icon: Thermometer, label: headings.airTemp, value: formatTemperature(weather.airTemp, units) });
  if (weather.humidity != null) items.push({ icon: Droplets, label: headings.humidity, value: `${Math.round(weather.humidity * 100)}%` });
  if (weather.windSpeed != null) {
    items.push({
      icon: Wind,
      label: headings.wind,
      title: compass ? fmt(t.liveRacing.windFrom, { dir: compass }) : undefined,
      value: (
        <span className="inline-flex items-center gap-1">
          {degrees != null && (
            // points where the wind blows to: down for a wind from the north
            <ArrowDown className="size-4 text-primary" style={{ transform: `rotate(${degrees}deg)` }} aria-hidden />
          )}
          {formatSpeed(weather.windSpeed, units)}
          {compass && <span className="text-muted-foreground">{compass}</span>}
        </span>
      ),
    });
  }
  if (wetness) {
    items.push({
      icon: Waves,
      label: t.liveRacing.trackSurface,
      value: weather.declaredWet ? `${wetness} · ${t.liveRacing.declaredWet}` : wetness,
    });
  }
  if (weather.precipitation != null && (weather.precipitation > 0 || !isStaticWeather(weather.type))) {
    items.push({ icon: Umbrella, label: t.liveRacing.rain, value: `${Math.round(weather.precipitation * 100)}%` });
  }

  return (
    <div className="2xl:border-l 2xl:pl-4 border-border min-w-0">
      <div className="flex items-center gap-3">
        {Icon && icon && <Icon className={`size-12 shrink-0 ${icon.color}`} strokeWidth={1.75} aria-hidden />}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.liveRacing.weatherTitle}</p>
          <p className="text-xl font-bold text-foreground leading-tight">
            {sky ? t.liveRacing.sky[sky] : '—'}
            {night && <span className="ml-2 text-sm font-medium text-muted-foreground">{t.liveRacing.night}</span>}
          </p>
          {weather.type && <p className="text-xs text-muted-foreground">{fmt(t.liveRacing.weatherType, { type: weather.type })}</p>}
        </div>
      </div>
      {items.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
          {items.map(({ icon: ItemIcon, label, value, title }) => (
            <div key={label} className="min-w-0" title={title}>
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <ItemIcon className="size-3.5 text-primary" aria-hidden />
                {label}
              </dt>
              <dd className="text-sm font-semibold text-foreground tabular-nums truncate">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Outlook({ driver }: { driver: LiveDriver }) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const weather = driver.weather!;
  const items = weatherOutlook(weather, driver.weatherTrend);
  const text = (item: OutlookItem) => {
    if (item.kind === 'trackTemp' || item.kind === 'airTemp') {
      return fmt(t.liveRacing.outlook[`${item.kind}${item.rising ? 'Rising' : 'Falling'}`], { t: formatTemperature(item.projected, units) });
    }
    return t.liveRacing.outlook[item.kind];
  };
  const estimated = driver.weatherTrend && !isStaticWeather(weather.type);
  return (
    <div className="lg:col-span-2 2xl:col-span-1 2xl:border-l 2xl:pl-4 border-border min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{fmt(t.liveRacing.outlookTitle, { n: OUTLOOK_MINUTES })}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => {
          const ItemIcon =
            item.kind === 'trackTemp' || item.kind === 'airTemp' ? (item.rising ? TrendingUp : TrendingDown) : OUTLOOK_ICON[item.kind];
          return (
            <li key={item.kind} className="flex items-center gap-2 text-sm text-foreground">
              <ItemIcon className="size-4 shrink-0 text-primary" aria-hidden />
              {text(item)}
            </li>
          );
        })}
      </ul>
      {estimated && <p className="mt-2 text-[11px] text-muted-foreground">{fmt(t.liveRacing.outlookNote, { n: driver.weatherTrend!.minutes })}</p>}
    </div>
  );
}
