import { classify, intensityFor, newDirectorState, type DirectorContext } from './broadcastDirector.ts';
import type { NumberedRaceEvent } from './liveRacing';
import type { RaceConditions } from './videoDirector';

// How the race looks to the Broadcast Director (src/lib/videoDirector.ts), from the same priorities and intensities the
// Commentary Director uses (src/lib/broadcastDirector.ts), so there's one idea of what's exciting. Node's tests run it
// directly (npm run test:video-director).

// How far back a moment counts toward how lively the race is
const LEVEL_WINDOW_MS = 30_000;
// A P0 or P1 moment, or intensity 4 or more, this recently means no clip now
const BLOCK_WINDOW_MS = 15_000;
// The race's start and end are live television, not time for recorded footage
const NO_CLIP_PHASES: readonly DirectorContext['phase'][] = ['opening', 'finalLaps', 'finished'];
// When the map and footage take turns: the race, once its opening's over and until its final laps
const ROTATION_PHASES: readonly DirectorContext['phase'][] = ['middle', 'finalQuarter'];

// since: when the current clip's sequence started (a P0 moment after it brings the broadcast back), or null for none
export function raceConditions(events: NumberedRaceEvent[], ctx: DirectorContext, now: number, since: number | null): RaceConditions {
  const scratch = newDirectorState('conditions');
  let level = 1;
  let blocked = NO_CLIP_PHASES.includes(ctx.phase);
  let critical = false;
  let rotating = ctx.isRace && ROTATION_PHASES.includes(ctx.phase);
  for (const event of events) {
    const c = classify(event, ctx);
    const age = now - c.at;
    if (age > LEVEL_WINDOW_MS) continue;
    // routine laps and the prompts for summaries aren't action
    const lively = c.kind === 'action' || c.kind === 'incident' || c.kind === 'strategy';
    if (!lively) continue;
    const intensity = intensityFor(c, ctx, scratch, now, 5).lead;
    level = Math.max(level, intensity);
    if (age <= BLOCK_WINDOW_MS && (c.priority <= 1 || intensity >= 4)) blocked = true;
    if (age <= BLOCK_WINDOW_MS && c.priority === 0) rotating = false;
    if (c.priority === 0 && since != null && c.at > since) critical = true;
  }
  return { level, blocked, critical, rotating };
}
