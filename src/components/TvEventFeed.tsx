'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { RaceEvent } from '@/lib/liveRacing';
import { formatLapTime } from '@/lib/liveRacingFormat';
import type { TvEvent } from '@/lib/tvBroadcast';

// TV Broadcast Mode's race events: the followed driver's latest few (detectRaceEvents in src/lib/liveRacing.ts),
// newest first, each with how long ago it happened (by the server's clock, `at`)

type Text = ReturnType<typeof useLanguage>['t']['tv'];
type Fmt = ReturnType<typeof useLanguage>['fmt'];

export function eventText(event: RaceEvent, driver: string, t: Text, fmt: Fmt): string {
  switch (event.type) {
    case 'lapComplete':
      if (event.newBest) return fmt(t.eventNewBest, { driver, time: formatLapTime(event.lapTime) });
      return event.lap
        ? fmt(t.eventLap, { driver, lap: event.lap, time: formatLapTime(event.lapTime) })
        : fmt(t.eventLapNoNumber, { driver, time: formatLapTime(event.lapTime) });
    case 'pitEntry':
      return fmt(t.eventPitEntry, { driver });
    case 'pitExit':
      return fmt(t.eventPitExit, { driver });
    case 'offTrack':
      return fmt(t.eventOffTrack, { driver });
    case 'incident':
      return fmt(t.eventIncident, { driver, n: event.added, total: event.total });
    case 'positionGained':
      return event.passed && event.from - event.to === 1
        ? fmt(t.eventGainedPassing, { driver, other: event.passed, to: event.to })
        : fmt(t.eventGained, { driver, to: event.to });
    case 'positionLost':
      return event.passedBy && event.to - event.from === 1
        ? fmt(t.eventLostTo, { driver, other: event.passedBy, to: event.to })
        : fmt(t.eventLost, { driver, to: event.to });
    case 'flag':
      return fmt(t.eventFlag, { flag: t.flags[event.flag] });
    case 'leaderChange':
      return fmt(t.eventLeader, { leader: event.leader });
    case 'nearbyIncident':
      return fmt(event.kind === 'offTrack' ? t.eventNearbyOffTrack : t.eventNearbySlowed, { other: event.driver });
    case 'sessionFastestLap':
      return fmt(t.eventFastest, { driver: event.isDriver ? driver : event.driver, time: formatLapTime(event.lapTime) });
  }
}

export default function TvEventFeed({ events, driver, now }: { events: TvEvent[]; driver: string; now: number }) {
  const { t, fmt } = useLanguage();
  if (events.length === 0) return <p className="text-[24px] text-[#8b95a3]">{t.tv.noEvents}</p>;
  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const seconds = Math.max(0, Math.round((now - e.at) / 1000));
        const ago = seconds < 60 ? fmt(t.tv.secondsAgo, { n: seconds }) : fmt(t.tv.minutesAgo, { n: Math.floor(seconds / 60) });
        return (
          <li key={e.seq} className="flex items-baseline gap-4 text-[24px] leading-tight">
            <span className="w-[64px] shrink-0 text-right tabular-nums text-[#8b95a3]">{ago}</span>
            <span className="min-w-0 truncate">{eventText(e.event, driver, t.tv, fmt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
