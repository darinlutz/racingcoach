'use client';

import { Timer } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import type { FieldCar, LiveField } from '@/lib/liveRacing';
import { formatGap, formatLapTime } from '@/lib/liveRacingFormat';

// Live Racing's leaderboard: every car in a driver's session (the field the collector sends, src/lib/liveRacing.ts)
// in running order, with each car's gap to the leader and to the car ahead, its last and best laps, and whether it's
// on pit road or off track. In a race the gaps are race time (iRacing's CarIdxF2Time, or laps when a car is a lap or
// more down); in practice and qualifying they're between best laps. RacingCoach.app drivers the user is watching are
// shown with their name and dot color, and the driver with the session's fastest lap with a purple stopwatch. It sits
// in a quarter of the page's width, so each car's lap, interval to the car ahead and iRating are in its row's tooltip.

export type LeaderboardDriver = { name: string; color: string; isMe: boolean };

const FASTEST_COLOR = 'text-purple-400';
const FASTEST_HEX = '#A855F7';

// Running order: by iRacing's position, then cars without one by how far they've gone
export function runningOrder(cars: FieldCar[]): FieldCar[] {
  const progress = (car: FieldCar) => (car.lapsDone ?? 0) + (car.pct ?? 0);
  return [...cars].sort(
    (a, b) =>
      (a.position ?? Infinity) - (b.position ?? Infinity) || progress(b) - progress(a) || a.idx - b.idx
  );
}

export default function LiveLeaderboard({
  field,
  isRace,
  racingCoachDrivers,
}: {
  field: LiveField;
  isRace: boolean;
  // The RacingCoach.app drivers in this session the user is watching, by their car index
  racingCoachDrivers: Map<number, LeaderboardDriver>;
}) {
  const { t, fmt } = useLanguage();
  const order = runningOrder(field.cars.filter((car) => car.details));
  if (order.length === 0) return null;
  const multiClass = new Set(order.map((car) => car.details?.carClass ?? '')).size > 1;
  const bests = order.map((car) => car.bestLapTime).filter((time): time is number => time != null && time > 0);
  const fastest = bests.length > 0 ? Math.min(...bests) : null;
  const leader = order[0];

  // Gap to the leader, or to the car ahead
  const gap = (car: FieldCar, to: FieldCar | undefined): string => {
    if (!to || car === to) return '—';
    if (isRace) {
      const lapsDown = (to.lapsDone ?? 0) - (car.lapsDone ?? 0) - ((car.pct ?? 0) > (to.pct ?? 0) ? 1 : 0);
      if (lapsDown >= 1) return fmt(t.liveRacing.lapsDown, { n: lapsDown });
      if (car.f2Time == null || to.f2Time == null || !car.position) return '—';
      return formatGap(Math.max(0, car.f2Time - to.f2Time));
    }
    if (!car.bestLapTime || !to.bestLapTime) return '—';
    return formatGap(Math.max(0, car.bestLapTime - to.bestLapTime));
  };
  const leaderGap = (car: FieldCar) =>
    car === leader ? (isRace ? t.liveRacing.leader : formatLapTime(car.bestLapTime)) : gap(car, isRace ? leader : order.find((c) => c.bestLapTime === fastest));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left border-b border-border">
            <th className="pl-2 pr-1 py-2 font-medium">{t.liveRacing.pos}</th>
            {multiClass && <th className="px-1 py-2 font-medium">{t.liveRacing.classPos}</th>}
            <th className="px-1 py-2 font-medium">#</th>
            <th className="px-1 py-2 font-medium">{t.liveRacing.driverColumn}</th>
            <th className="px-1 py-2 font-medium text-right">{isRace ? t.liveRacing.gap : t.liveRacing.gapToFastest}</th>
            <th className="px-1 py-2 font-medium text-right">{t.liveRacing.last}</th>
            <th className="pl-1 pr-2 py-2 font-medium text-right">{t.liveRacing.best}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {order.map((car, i) => {
            const details = car.details!;
            const ours = racingCoachDrivers.get(car.idx);
            const isFastest = fastest != null && car.bestLapTime === fastest;
            const tooltip = [
              details.car,
              car.lap != null ? `${t.liveRacing.lapColumn} ${car.lap}` : null,
              i > 0 ? `${t.liveRacing.interval} ${gap(car, order[i - 1])}` : null,
              details.iRating != null ? `iR ${details.iRating}${details.license ? ` · ${details.license}` : ''}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <tr
                key={car.idx}
                title={tooltip}
                className={`${ours?.isMe ? 'bg-primary/10' : ours ? 'bg-muted/40' : ''} ${car.pct == null ? 'opacity-50' : ''}`}
              >
                <td className="pl-2 pr-1 py-1 font-semibold text-foreground tabular-nums">{car.position ?? i + 1}</td>
                {multiClass && <td className="px-1 py-1 text-muted-foreground tabular-nums">{car.classPosition ?? '—'}</td>}
                <td className="px-1 py-1">
                  <span
                    className="inline-block min-w-7 rounded px-1 py-0.5 text-center text-[11px] font-bold text-black"
                    style={{ backgroundColor: details.classColor ?? '#cbd5e1' }}
                    title={details.carClass ?? undefined}
                  >
                    {details.number ?? '—'}
                  </span>
                </td>
                <td className="px-1 py-1 max-w-40">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {ours && <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: ours.color }} />}
                    <span className={`truncate ${ours ? 'font-semibold text-foreground' : 'text-foreground'}`}>{details.name}</span>
                    {isFastest && (
                      <span className="shrink-0" role="img" aria-label={t.liveRacing.fastestLap} title={t.liveRacing.fastestLap}>
                        <Timer className="size-3.5" color={FASTEST_HEX} strokeWidth={2.5} aria-hidden />
                      </span>
                    )}
                    {ours && !ours.isMe && ours.name !== details.name && (
                      <span className="text-muted-foreground truncate">({ours.name})</span>
                    )}
                    {ours?.isMe && <span className="text-primary font-semibold">{t.liveRacing.you}</span>}
                    {car.onPitRoad && (
                      <span className="rounded bg-amber-500/20 px-1 font-semibold text-amber-500">{t.liveRacing.pit}</span>
                    )}
                    {car.offTrack && !car.onPitRoad && (
                      <span className="rounded bg-red-500/20 px-1 font-semibold text-red-400">{t.liveRacing.off}</span>
                    )}
                  </div>
                </td>
                <td className="px-1 py-1 text-right font-mono text-foreground whitespace-nowrap">{leaderGap(car)}</td>
                <td className="px-1 py-1 text-right font-mono text-foreground">{formatLapTime(car.lastLapTime)}</td>
                <td className={`pl-1 pr-2 py-1 text-right font-mono ${isFastest ? `${FASTEST_COLOR} font-semibold` : 'text-foreground'}`}>
                  {formatLapTime(car.bestLapTime)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
