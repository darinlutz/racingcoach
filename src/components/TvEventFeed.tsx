'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { RaceEvent } from '@/lib/liveRacing';
import { formatLapTime } from '@/lib/liveRacingFormat';
import type { TvEvent } from '@/lib/tvBroadcast';

// TV Broadcast Mode's race events: the followed driver's latest few (detectRaceEvents in src/lib/liveRacing.ts, and
// the field's from src/lib/broadcastTracker.ts), newest first, each with how long ago it happened (by the server's
// clock, `at`). The Race Broadcast's prompts (summaries, statistics, storylines) aren't listed.

type Text = ReturnType<typeof useLanguage>['t']['tv'];
type Fmt = ReturnType<typeof useLanguage>['fmt'];

export function eventText(event: RaceEvent, driver: string, t: Text, fmt: Fmt): string | null {
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
    case 'overtake':
      return fmt(t.eventPass, { driver: event.driver, other: event.passed, position: event.position });
    case 'battle':
      return event.phase === 'start' || event.phase === 'veryClose'
        ? fmt(t.eventBattle, { behind: event.behind, ahead: event.ahead, gap: event.gap.toFixed(1) })
        : null;
    case 'pitStop':
      return event.phase === 'in'
        ? fmt(t.eventPitIn, { driver: event.driver })
        : fmt(t.eventPitOut, { driver: event.driver, seconds: Math.round(event.seconds ?? 0) });
    case 'fieldIncident':
      return fmt(event.kind === 'offTrack' ? t.eventFieldOffTrack : t.eventFieldSlowed, { driver: event.driver });
    case 'raceStart':
      return t.eventRaceStart;
    case 'finalLap':
      return t.eventFinalLap;
    case 'raceWon':
      return fmt(t.eventWon, { winner: event.winner });
    case 'driverFinished':
      return event.position ? fmt(t.eventFinished, { driver, position: event.position }) : null;
    case 'preRace':
    case 'storyline':
    case 'raceSummary':
    case 'statsUpdate':
      return null;
  }
}

export default function TvEventFeed({ events, driver, now }: { events: TvEvent[]; driver: string; now: number }) {
  const { t, fmt } = useLanguage();
  const shown = events.map((e) => ({ ...e, text: eventText(e.event, driver, t.tv, fmt) })).filter((e) => e.text);
  if (shown.length === 0) return <p className="text-[24px] text-[#8b95a3]">{t.tv.noEvents}</p>;
  return (
    <ul className="space-y-2">
      {shown.map((e) => {
        const seconds = Math.max(0, Math.round((now - e.at) / 1000));
        const ago = seconds < 60 ? fmt(t.tv.secondsAgo, { n: seconds }) : fmt(t.tv.minutesAgo, { n: Math.floor(seconds / 60) });
        return (
          <li key={e.seq} className="flex items-baseline gap-4 text-[24px] leading-tight">
            <span className="w-[64px] shrink-0 text-right tabular-nums text-[#8b95a3]">{ago}</span>
            <span className="min-w-0 truncate">{e.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
