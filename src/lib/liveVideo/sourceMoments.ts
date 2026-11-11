import { classify, type DirectorContext } from '../broadcastDirector.ts';
import type { NumberedRaceEvent } from '../liveRacing';
import type { Moment, MomentKind } from './broadcastSource.ts';

// The moments the camera director follows, from the same race events and priorities as the Commentary Director
// (src/lib/broadcastDirector.ts), so there's one idea of what matters. Node's tests run it (npm run test:live-video).

// The kind of moment an event is, or null for events the camera doesn't follow (lap times, summaries, the weather)
export function momentKind(n: NumberedRaceEvent): MomentKind | null {
  const e = n.event;
  switch (e.type) {
    case 'raceStart':
      return 'raceStart';
    case 'battle':
      return e.phase === 'start' || e.phase === 'veryClose' || e.phase === 'closing' ? 'closeBattle' : null;
    case 'overtake':
    case 'positionGained':
    case 'positionLost':
    case 'leaderChange':
      return 'overtake';
    case 'fieldIncident':
    case 'nearbyIncident':
    case 'incident':
    case 'offTrack':
      return 'incident';
    case 'pitStop':
    case 'pitEntry':
    case 'pitExit':
      return 'pitStop';
    case 'finalLap':
      return 'finalLap';
    case 'raceWon':
    case 'driverFinished':
      return 'finish';
    case 'flag':
      if (e.flag === 'green') return 'raceStart';
      if (e.flag === 'white') return 'finalLap';
      if (e.flag === 'checkered') return 'finish';
      if (e.flag === 'red' || e.flag === 'yellow' || e.flag === 'caution') return 'incident';
      return null;
    default:
      return null;
  }
}

// The most important moment within windowMs: the lowest priority number, the newest of those
export function currentMoment(events: NumberedRaceEvent[], ctx: DirectorContext, now: number, windowMs: number): Moment | null {
  let best: Moment | null = null;
  for (const n of events) {
    if (now - n.at > windowMs || n.at > now + 5000) continue;
    const kind = momentKind(n);
    if (!kind) continue;
    const c = classify(n, ctx);
    const moment: Moment = { kind, at: n.at, priority: c.priority, cars: c.cars };
    if (!best || moment.priority < best.priority || (moment.priority === best.priority && moment.at >= best.at)) best = moment;
  }
  return best;
}
