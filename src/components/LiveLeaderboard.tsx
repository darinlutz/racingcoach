'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { FieldCar, LiveField } from '@/lib/liveRacing';
import { formatGap, formatLapTime } from '@/lib/liveRacingFormat';

// Live Racing's leaderboard: every car in a driver's session (the field the collector sends, src/lib/liveRacing.ts)
// in running order, with each car's gap to the leader and to the car ahead, its last and best laps, and whether it's
// on pit road or off track. In a race the gaps are race time (iRacing's CarIdxF2Time, or laps when a car is a lap or
// more down); in practice and qualifying they're between best laps. RacingCoach.app drivers the user is watching are
// shown with their name and dot color.

export type LeaderboardDriver = { name: string; color: string; isMe: boolean };

const FASTEST_COLOR = 'text-purple-400';

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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left border-b border-border">
            <th className="px-3 py-2 font-medium">{t.liveRacing.pos}</th>
            {multiClass && <th className="px-2 py-2 font-medium">{t.liveRacing.classPos}</th>}
            <th className="px-2 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">{t.liveRacing.driverColumn}</th>
            <th className="px-2 py-2 font-medium text-right">{t.liveRacing.lapColumn}</th>
            <th className="px-2 py-2 font-medium text-right">{isRace ? t.liveRacing.gap : t.liveRacing.gapToFastest}</th>
            <th className="px-2 py-2 font-medium text-right">{t.liveRacing.interval}</th>
            <th className="px-2 py-2 font-medium text-right">{t.liveRacing.last}</th>
            <th className="px-2 py-2 font-medium text-right">{t.liveRacing.best}</th>
            <th className="px-3 py-2 font-medium text-right">iR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {order.map((car, i) => {
            const details = car.details!;
            const ours = racingCoachDrivers.get(car.idx);
            const isFastest = fastest != null && car.bestLapTime === fastest;
            return (
              <tr
                key={car.idx}
                className={`${ours?.isMe ? 'bg-primary/10' : ours ? 'bg-muted/40' : ''} ${car.pct == null ? 'opacity-50' : ''}`}
              >
                <td className="px-3 py-1.5 font-semibold text-foreground tabular-nums">{car.position ?? i + 1}</td>
                {multiClass && <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{car.classPosition ?? '—'}</td>}
                <td className="px-2 py-1.5">
                  <span
                    className="inline-block min-w-8 rounded px-1.5 py-0.5 text-center text-xs font-bold text-black"
                    style={{ backgroundColor: details.classColor ?? '#cbd5e1' }}
                    title={details.carClass ?? undefined}
                  >
                    {details.number ?? '—'}
                  </span>
                </td>
                <td className="px-2 py-1.5 max-w-56">
                  <div className="flex items-center gap-2 min-w-0">
                    {ours && <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: ours.color }} />}
                    <span className={`truncate ${ours ? 'font-semibold text-foreground' : 'text-foreground'}`} title={details.car ?? undefined}>
                      {details.name}
                    </span>
                    {ours && !ours.isMe && ours.name !== details.name && (
                      <span className="text-xs text-muted-foreground truncate">({ours.name})</span>
                    )}
                    {ours?.isMe && <span className="text-xs text-primary font-semibold">{t.liveRacing.you}</span>}
                    {car.onPitRoad && (
                      <span className="rounded bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-500">{t.liveRacing.pit}</span>
                    )}
                    {car.offTrack && !car.onPitRoad && (
                      <span className="rounded bg-red-500/20 px-1.5 text-xs font-semibold text-red-400">{t.liveRacing.off}</span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">{car.lap ?? '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono text-foreground">{leaderGap(car)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{i === 0 ? '—' : gap(car, order[i - 1])}</td>
                <td className="px-2 py-1.5 text-right font-mono text-foreground">{formatLapTime(car.lastLapTime)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${isFastest ? `${FASTEST_COLOR} font-semibold` : 'text-foreground'}`}>
                  {formatLapTime(car.bestLapTime)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums" title={details.license ?? undefined}>
                  {details.iRating ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
