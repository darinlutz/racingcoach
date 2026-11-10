'use client';

import FuelGauge from '@/components/FuelGauge';
import { useLanguage } from '@/components/LanguageProvider';
import TireBadge from '@/components/TireBadge';
import { useUnits } from '@/components/UnitsProvider';
import { clockText, type FittedTire, type FuelStatus, type TireKind } from '@/lib/liveCarStatus';
import type { Units } from '@/lib/units';

// The followed driver's tires and fuel beside their name, on TV Broadcast Mode (variant tv, its dark graphics at TV
// size) and the Live Racing page: the fitted compound as a tire in its color, and a fuel gauge with the laps and the
// driving time the fuel left lasts (src/lib/liveCarStatus.ts). lapsNeeded, the laps left in the session, lights the
// gauge's warning when the fuel won't reach the end.

const LETTERS: Record<TireKind, string> = { soft: 'S', medium: 'M', hard: 'H', dry: 'D', intermediate: 'I', wet: 'W', unknown: '?' };
const LITERS_PER_GALLON = 3.78541;

export function fuelAmount(liters: number, units: Units): string {
  return units === 'metric' ? `${liters.toFixed(1)} L` : `${(liters / LITERS_PER_GALLON).toFixed(1)} gal`;
}

export default function DriverCarStatus({
  tire,
  fuel,
  lapsNeeded = null,
  variant = 'page',
}: {
  tire: FittedTire | null;
  fuel: FuelStatus | null;
  lapsNeeded?: number | null;
  variant?: 'page' | 'tv';
}) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const tv = variant === 'tv';
  const kind = tire?.kind ?? 'unknown';
  const tireLabel = tire ? (kind === 'unknown' ? (tire.name ?? t.carWeather.tireKinds.unknown) : t.carWeather.tireKinds[kind]) : t.carWeather.tireUnknown;
  const low = fuel?.lapsLeft != null && lapsNeeded != null && fuel.lapsLeft < lapsNeeded;
  const lapsText = fuel?.lapsLeft != null ? fmt(t.carWeather.fuelLaps, { n: fuel.lapsLeft.toFixed(1) }) : null;
  const timeText = fuel?.secondsLeft != null ? clockText(fuel.secondsLeft) : null;

  if (tv) {
    return (
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-black/35 py-0.5 pl-0.5 pr-3 ring-1 ring-white/10">
          <TireBadge kind={kind} letter={LETTERS[kind]} label={tireLabel} className="size-[44px] drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)]" />
          <span className="text-[19px] font-bold leading-none">{tireLabel}</span>
        </div>
        <div
          className={`flex min-w-0 items-center gap-2 rounded-full bg-black/35 py-0.5 pl-1 pr-3 ring-1 ${low ? 'ring-[#f59e0b]/70' : 'ring-white/10'}`}
          title={fuel ? fuelAmount(fuel.liters, units) : undefined}
        >
          <FuelGauge pct={fuel?.pct ?? null} dark low={low} label={t.carWeather.fuel} className="h-[38px] w-[44px] shrink-0" />
          {fuel ? (
            <span className="min-w-0 truncate leading-none tabular-nums">
              <span className={`text-[19px] font-bold ${low ? 'text-[#f59e0b]' : ''}`}>{lapsText ?? fuelAmount(fuel.liters, units)}</span>
              <span className="text-[16px] text-[#a7b0bd]">
                {' · '}
                {timeText ? fmt(t.carWeather.fuelTime, { t: timeText }) : lapsText ? fuelAmount(fuel.liters, units) : t.carWeather.fuelLapsLater}
              </span>
            </span>
          ) : (
            <span className="text-[17px] text-[#a7b0bd]">{t.carWeather.fuel} —</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/60 p-2.5">
        <TireBadge kind={kind} letter={LETTERS[kind]} label={tireLabel} className="size-14 shrink-0 drop-shadow-md" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.carWeather.tires}</p>
          <p className="truncate text-lg font-bold leading-tight text-foreground">{tireLabel}</p>
        </div>
      </div>
      <div className={`flex items-center gap-2 rounded-lg border bg-secondary/60 p-2.5 ${low ? 'border-amber-500/70' : 'border-border'}`}>
        <FuelGauge pct={fuel?.pct ?? null} low={low} label={t.carWeather.fuel} className="h-14 w-16 shrink-0 text-foreground" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.carWeather.fuel}</p>
          {fuel ? (
            <>
              <p className={`truncate text-lg font-bold leading-tight tabular-nums ${low ? 'text-amber-500' : 'text-foreground'}`}>
                {lapsText ?? fuelAmount(fuel.liters, units)}
              </p>
              <p className="truncate text-xs tabular-nums text-muted-foreground">
                {[timeText ? fmt(t.carWeather.fuelTime, { t: timeText }) : null, lapsText ? fuelAmount(fuel.liters, units) : t.carWeather.fuelLapsLater]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.carWeather.fuelNone}</p>
          )}
        </div>
      </div>
    </div>
  );
}
