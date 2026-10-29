'use client';

import { memo } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { formatGap, formatLapTime } from '@/lib/liveRacingFormat';
import type { TvGap, TvRow } from '@/lib/tvBroadcast';

// TV Broadcast Mode's leaderboard: the running order the server worked out (src/lib/tvBroadcast.ts), up to 20 rows,
// in type big enough to read across a room. The followed driver's row is highlighted, other RacingCoach.app drivers
// the account watches are marked, and the session's fastest lap is purple. A row that didn't change since the last
// update isn't drawn again (a low-powered TV redraws only what moved).

const FASTEST = '#b56cff';

type Labels = { leader: string; lapsDown: string };

function gapText(gap: TvGap, labels: Labels, fmt: (s: string, v: Record<string, string | number>) => string): string {
  if (!gap) return '—';
  if ('leader' in gap) return labels.leader;
  if ('laps' in gap) return fmt(labels.lapsDown, { n: gap.laps });
  return formatGap(gap.seconds);
}

const Row = memo(function Row({ row, multiClass, isRace }: { row: TvRow; multiClass: boolean; isRace: boolean }) {
  const { t, fmt } = useLanguage();
  const labels = { leader: t.tv.leader, lapsDown: t.tv.lapsDown };
  return (
    <tr className={row.isFocus ? 'bg-[#e10600] text-white' : row.isWatched ? 'bg-[#1d2a3d]' : 'odd:bg-[#0d1117]'}>
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
      <td className="px-2 max-w-[330px] truncate font-semibold">
        {row.name}
        {row.onPitRoad && <span className="ml-3 rounded bg-[#ffd400] px-2 text-[18px] font-bold text-black">{t.tv.pit}</span>}
        {row.offTrack && <span className="ml-3 rounded bg-[#ff8a00] px-2 text-[18px] font-bold text-black">{t.tv.offTrack}</span>}
      </td>
      <td className={`px-2 max-w-[260px] truncate ${row.isFocus ? 'text-white' : 'text-[#a7b0bd]'}`}>{row.car ?? '—'}</td>
      <td className="px-2 text-right tabular-nums">{gapText(row.gap, labels, fmt)}</td>
      {isRace && <td className="px-2 text-right tabular-nums">{gapText(row.interval, labels, fmt)}</td>}
      <td className="px-2 text-right tabular-nums">{formatLapTime(row.lastLapTime)}</td>
      <td className="pl-2 pr-4 text-right tabular-nums" style={row.fastest ? { color: row.isFocus ? '#fff' : FASTEST, fontWeight: 700 } : undefined}>
        {formatLapTime(row.bestLapTime)}
      </td>
    </tr>
  );
}, (a, b) => a.multiClass === b.multiClass && a.isRace === b.isRace && JSON.stringify(a.row) === JSON.stringify(b.row));

export default function TvLeaderboard({ rows, multiClass, isRace }: { rows: TvRow[]; multiClass: boolean; isRace: boolean }) {
  const { t } = useLanguage();
  return (
    <table className="w-full table-fixed text-[24px] leading-[34px]">
      <colgroup>
        <col className="w-[76px]" />
        {multiClass && <col className="w-[66px]" />}
        <col className="w-[84px]" />
        <col />
        <col className="w-[250px]" />
        <col className="w-[140px]" />
        {isRace && <col className="w-[130px]" />}
        <col className="w-[140px]" />
        <col className="w-[150px]" />
      </colgroup>
      <thead>
        <tr className="text-left text-[20px] uppercase tracking-wide text-[#8b95a3]">
          <th className="pl-4 pr-2 py-1 font-semibold">{t.tv.pos}</th>
          {multiClass && <th className="px-2 font-semibold">{t.tv.classPos}</th>}
          <th className="px-2 font-semibold">#</th>
          <th className="px-2 font-semibold">{t.tv.driver}</th>
          <th className="px-2 font-semibold">{t.tv.car}</th>
          <th className="px-2 text-right font-semibold">{isRace ? t.tv.gap : t.tv.gapToFastest}</th>
          {isRace && <th className="px-2 text-right font-semibold">{t.tv.interval}</th>}
          <th className="px-2 text-right font-semibold">{t.tv.last}</th>
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
