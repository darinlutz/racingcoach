'use client';

import { CarFront, Timer } from 'lucide-react';
import { memo } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { carBrand } from '@/lib/carBrands';
import { formatGap, formatLapTime } from '@/lib/liveRacingFormat';
import type { TvGap, TvRow } from '@/lib/tvBroadcast';

// TV Broadcast Mode's leaderboard: the Live Racing page's (LiveLeaderboard) in type big enough to read across a room,
// from the running order the server worked out (src/lib/tvBroadcast.ts), up to 15 rows (TV_ROWS). Each driver has their country
// flag (their iRacing flair, src/lib/countryFlags.ts, drawn by flag-icons) and their car maker's logo
// (src/lib/carBrands.ts; a plain car for makers without one); RacingCoach.app drivers the account watches have their
// dot color, the account's own row says You, the followed driver's row is highlighted, and the session's fastest lap
// has a purple stopwatch. A row that didn't change since the last update isn't drawn again (a low-powered TV redraws
// only what moved).

const FASTEST = '#b56cff';

type Labels = { leader: string; lapsDown: string };

function gapText(gap: TvGap, labels: Labels, fmt: (s: string, v: Record<string, string | number>) => string): string {
  if (!gap) return '—';
  if ('leader' in gap) return labels.leader;
  if ('laps' in gap) return fmt(labels.lapsDown, { n: gap.laps });
  return formatGap(gap.seconds);
}

function CarLogo({ car }: { car: string | null }) {
  const brand = carBrand(car);
  const label = [brand?.name, car].filter(Boolean).join(' · ') || undefined;
  return (
    <span className="inline-flex shrink-0" role="img" aria-label={label}>
      {brand ? (
        <svg viewBox="0 0 24 24" className="size-[24px] fill-current" aria-hidden>
          <path d={brand.path} />
        </svg>
      ) : (
        <CarFront className="size-[24px] text-[#8b95a3]" aria-hidden />
      )}
    </span>
  );
}

const Row = memo(
  function Row({ row, multiClass, isRace }: { row: TvRow; multiClass: boolean; isRace: boolean }) {
    const { t, fmt } = useLanguage();
    const labels = { leader: t.tv.leader, lapsDown: t.tv.lapsDown };
    return (
      <tr className={row.isFocus ? 'bg-[#e10600] text-white' : row.watchColor ? 'bg-[#1d2a3d]' : 'odd:bg-[#0d1117]'}>
        <td className="pl-4 pr-2 font-bold tabular-nums">{row.position ?? '—'}</td>
        {multiClass && <td className="px-2 tabular-nums text-[#c9d1dc]">{row.classPosition ?? '—'}</td>}
        <td className="px-2">
          <span
            className="inline-block min-w-[52px] rounded px-1 text-center font-bold tabular-nums text-black"
            style={{ backgroundColor: row.classColor ?? '#c9d1dc' }}
          >
            {row.number ?? '—'}
          </span>
        </td>
        <td className="px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {row.countryCode ? (
              <span
                className={`fi fi-${row.countryCode} shrink-0 rounded-[3px]`}
                style={{ width: 30, height: 22 }}
                role="img"
                aria-label={row.flair ?? row.countryCode}
              />
            ) : (
              <span className="shrink-0" style={{ width: 30, height: 22 }} aria-hidden />
            )}
            <CarLogo car={row.car} />
            {row.watchColor && (
              <span className="size-3.5 shrink-0 rounded-full border-2 border-white" style={{ backgroundColor: row.watchColor }} aria-hidden />
            )}
            <span className={`truncate ${row.watchColor ? 'font-bold' : 'font-semibold'}`}>{row.name}</span>
            {row.fastest && (
              <span className="shrink-0" role="img" aria-label={t.liveRacing.fastestLap}>
                <Timer className="size-[24px]" color={row.isFocus ? '#fff' : FASTEST} strokeWidth={2.5} aria-hidden />
              </span>
            )}
            {row.isMe && <span className="shrink-0 font-bold text-[#ffd400]">{t.liveRacing.you}</span>}
            {row.onPitRoad && <span className="shrink-0 rounded bg-[#ffd400] px-2 text-[18px] font-bold text-black">{t.tv.pit}</span>}
            {row.offTrack && !row.onPitRoad && (
              <span className="shrink-0 rounded bg-[#ff8a00] px-2 text-[18px] font-bold text-black">{t.tv.offTrack}</span>
            )}
          </div>
        </td>
        <td className="px-2 text-right tabular-nums">{gapText(row.gap, labels, fmt)}</td>
        {isRace && <td className="px-2 text-right tabular-nums">{gapText(row.interval, labels, fmt)}</td>}
        <td
          className="pl-2 pr-4 text-right tabular-nums"
          style={row.fastest ? { color: row.isFocus ? '#fff' : FASTEST, fontWeight: 700 } : undefined}
        >
          {formatLapTime(row.bestLapTime)}
        </td>
      </tr>
    );
  },
  (a, b) => a.multiClass === b.multiClass && a.isRace === b.isRace && JSON.stringify(a.row) === JSON.stringify(b.row)
);

export default function TvLeaderboard({ rows, multiClass, isRace }: { rows: TvRow[]; multiClass: boolean; isRace: boolean }) {
  const { t } = useLanguage();
  return (
    <table className="w-full table-fixed text-[22px] leading-[34px]">
      <colgroup>
        <col className="w-[64px]" />
        {multiClass && <col className="w-[60px]" />}
        <col className="w-[76px]" />
        <col />
        <col className="w-[124px]" />
        {isRace && <col className="w-[116px]" />}
        <col className="w-[136px]" />
      </colgroup>
      <thead>
        <tr className="text-left text-[18px] uppercase tracking-wide text-[#8b95a3]">
          <th className="pl-4 pr-2 py-1 font-semibold">{t.tv.pos}</th>
          {multiClass && <th className="px-2 font-semibold">{t.tv.classPos}</th>}
          <th className="px-2 font-semibold">#</th>
          <th className="px-2 font-semibold">{t.tv.driver}</th>
          <th className="px-2 text-right font-semibold">{isRace ? t.tv.gap : t.tv.gapToFastest}</th>
          {isRace && <th className="px-2 text-right font-semibold">{t.tv.interval}</th>}
          <th className="pl-2 pr-4 text-right font-semibold">{t.tv.best}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.idx} row={row} multiClass={multiClass} isRace={isRace} />
        ))}
      </tbody>
    </table>
  );
}
