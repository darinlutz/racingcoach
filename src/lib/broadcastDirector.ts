// The Commentary Director: the one authority over what the Race Announcers say. Each time a live driver's race events
// move on, it reads the new ones (detectRaceEvents and the field-wide BroadcastTracker, src/lib/broadcastTracker.ts)
// and decides, by fixed rules rather than the AI, which deserves commentary now, which waits or is dropped, who speaks
// (Lead only, Color only, Lead then Color, or Lead, Color, Lead), and how excited they sound. The AI only phrases what
// it chose (src/lib/raceAnnouncer.ts).
//
// Priority (P0 critical to P4 background) and intensity (1 calm to 5 race-deciding) are kept apart: a crash involving
// the leader is P0 but called with controlled intensity, a clean-air fastest lap P2 at intensity 2. The listener's
// driver is favoured by RELEVANCE_WEIGHTS, scaled by their Coverage Focus, without ever outranking a P0 elsewhere, and a
// rolling count of what was covered nudges the balance back toward the field when the driver has had too much of it.
// How often the announcers speak (mode and frequency) is independent of how excited they are (intensity, capped by the
// listener's Maximum Commentary Intensity). Every event gets a verdict and a reason (diagnostics). No runtime imports,
// so Node's tests run it directly (npm run test:broadcast).

import type { BroadcastSettings, BroadcastMode, CoverageFocus, CommentaryFrequency } from './broadcastSettings';
import type { BroadcastEvent, SessionPhase, Storyline } from './broadcastTracker';
import type { NumberedRaceEvent, RaceEvent } from './liveRacing';

export type Speaker = 'lead' | 'color';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Format = 'lead' | 'color' | 'leadColor' | 'leadColorLead';
export type EventKind = 'action' | 'incident' | 'strategy' | 'stats' | 'summary' | 'storyline' | 'routine' | 'preRace' | 'postRace';

// How much more the listener's own driver's moments count, before their Coverage Focus scales it
export const RELEVANCE_WEIGHTS = {
  userBattle: 1.75,
  userOvertake: 1.75,
  userLostPosition: 1.6,
  userIncident: 1.75,
  personalBest: 1.4,
  userStrategy: 1.4,
  userStory: 1.4,
  nearUser: 1.4,
  leadBattle: 1.5,
  majorIncident: 1.5,
  otherPositionChange: 1.0,
  neutral: 1.0,
  routineElsewhere: 0.75,
} as const;
export type RelevanceCategory = keyof typeof RELEVANCE_WEIGHTS;

const USER_CATEGORIES = new Set<RelevanceCategory>([
  'userBattle',
  'userOvertake',
  'userLostPosition',
  'userIncident',
  'personalBest',
  'userStrategy',
  'userStory',
  'nearUser',
]);

// Coverage Focus: how far the user weights reach (0 none, 1 as listed), and the share of discretionary commentary
// about the driver aimed for
const FOCUS: Record<CoverageFocus, { reach: number; target: number }> = {
  balanced: { reach: 0.35, target: 0.4 },
  user: { reach: 1, target: 0.6 },
  maxUser: { reach: 1.5, target: 0.75 },
};

const PRIORITY_BASE: Record<Priority, number> = { 0: 100, 1: 70, 2: 45, 3: 25, 4: 12 };

// The shortest silence (seconds) before a line of each priority, by mode; null never. P0 always goes at once
const MIN_SILENCE_S: Record<Exclude<BroadcastMode, 'off'>, (number | null)[]> = {
  quiet: [0, 5, null, null, null],
  standard: [0, 3, 15, 40, 60],
  full: [0, 2, 8, 20, 25],
};
// The shortest time (seconds) between two of these kinds, by mode
const KIND_INTERVAL_S: Record<Exclude<BroadcastMode, 'off'>, Partial<Record<EventKind, number | null>>> = {
  quiet: { stats: null, summary: null, storyline: null, routine: null },
  standard: { stats: 240, summary: 300, storyline: 120, routine: null },
  full: { stats: 120, summary: 180, storyline: 60, routine: 40 },
};
const FREQUENCY: Record<CommentaryFrequency, number> = { low: 1.6, normal: 1, high: 0.6 };

// How long the same thing isn't said again (by key), and how much a battle's gap must change to be said again
const REPEAT_MS: Partial<Record<string, number>> = { battle: 15_000, raceSummary: 120_000, statsUpdate: 90_000 };
const DEFAULT_REPEAT_MS = 45_000;
const GAP_CHANGE = 0.25;
// History kept for repetition, coverage and storylines
const HISTORY = 40;
const COVERAGE_WINDOW = 20;
// Continuous situations (battles, analysis) move at most one intensity level in this long; intensity eases back a
// level every INTENSITY_DECAY_MS after the last line
const INTENSITY_STEP_MS = 20_000;
const INTENSITY_DECAY_MS = 30_000;

export type DirectorContext = {
  isRace: boolean;
  phase: SessionPhase;
  raceProgress: number | null;
  userIdx: number | null;
  userPosition: number | null;
  storylines: Storyline[];
};

type HistoryItem = {
  at: number;
  key: string;
  type: string;
  cars: number[];
  gap: number | null;
  storyline: string | null;
  userRelated: boolean;
  priority: Priority;
};

export type DirectorState = {
  sessionKey: string;
  history: HistoryItem[];
  // Coverage of the last discretionary lines: about the driver or not, and the other driver most involved
  coverage: { user: boolean; idx: number | null }[];
  level: number;
  levelAt: number;
  // When the audio already sent should have finished playing (ms since the epoch), and its priority: only something
  // more important may replace it
  busyUntil: number;
  busyPriority: Priority;
  lastKindAt: Partial<Record<EventKind, number>>;
  lastFormat: Format | null;
  lastTripleAt: number;
  statTopics: string[];
};

export function newDirectorState(sessionKey: string): DirectorState {
  return {
    sessionKey,
    history: [],
    coverage: [],
    level: 1,
    levelAt: 0,
    busyUntil: 0,
    busyPriority: 4,
    lastKindAt: {},
    lastFormat: null,
    lastTripleAt: 0,
    statTopics: [],
  };
}

export type Classified = {
  seq: number;
  at: number;
  event: RaceEvent;
  key: string;
  priority: Priority;
  category: RelevanceCategory;
  kind: EventKind;
  baseIntensity: number;
  userInvolved: boolean;
  // Car indexes involved (the listener's driver's own events use the driver's car)
  cars: number[];
  // Race-deciding: the only events that may reach intensity 5
  decisive: boolean;
  // A situation that carries on (battles, analysis), smoothed rather than jumping in intensity
  continuous: boolean;
  confidence: 'confirmed' | 'inferred';
  ttlMs: number;
  gap: number | null;
  position: number | null;
};

export type Diagnostic = {
  seq: number;
  type: string;
  priority: Priority;
  score: number;
  verdict: 'announced' | 'merged' | 'suppressed';
  reason: string;
};

export type Decision = {
  selected: Classified;
  // Other fresh events worth a mention in the same breath
  related: Classified[];
  intensity: number;
  colorIntensity: number;
  format: Format;
  // The longest each announcer's line should run, seconds
  maxSeconds: Record<Speaker, number>;
  expiresAt: number;
  // A line important enough to replace what's waiting to be played
  replaceQueued: boolean;
  storylines: Storyline[];
  score: number;
  userRelated: boolean;
};

const isBroadcast = (e: RaceEvent): e is BroadcastEvent =>
  ['preRace', 'raceStart', 'overtake', 'battle', 'pitStop', 'fieldIncident', 'finalLap', 'raceWon', 'driverFinished', 'storyline', 'raceSummary', 'statsUpdate'].includes(
    e.type
  );

// What an event is: its priority, relevance, kind and base intensity
export function classify(n: NumberedRaceEvent, ctx: DirectorContext): Classified {
  const e = n.event;
  const me = ctx.userIdx;
  const mine = me != null ? [me] : [];
  const base = {
    seq: n.seq,
    at: n.at,
    event: e,
    userInvolved: false,
    cars: [] as number[],
    decisive: false,
    continuous: false,
    confidence: 'confirmed' as 'confirmed' | 'inferred',
    ttlMs: 20_000,
    gap: null as number | null,
    position: null as number | null,
  };
  const make = (c: Partial<Classified> & Pick<Classified, 'key' | 'priority' | 'category' | 'kind' | 'baseIntensity'>): Classified => ({ ...base, ...c });
  const finalStage = ctx.phase === 'finalLaps';

  if (!isBroadcast(e)) {
    switch (e.type) {
      case 'lapComplete':
        return e.newBest
          ? make({ key: 'userBest', priority: 2, category: 'personalBest', kind: 'action', baseIntensity: 2, userInvolved: true, cars: mine })
          : make({ key: `userLap:${e.lap ?? n.seq}`, priority: 4, category: 'personalBest', kind: 'routine', baseIntensity: 1, userInvolved: true, cars: mine });
      case 'pitEntry':
      case 'pitExit':
        return make({ key: `userPit:${e.type}`, priority: 2, category: 'userStrategy', kind: 'strategy', baseIntensity: 1, userInvolved: true, cars: mine, ttlMs: 25_000 });
      case 'offTrack':
        return make({ key: 'userOff', priority: 2, category: 'userIncident', kind: 'incident', baseIntensity: 2, userInvolved: true, cars: mine });
      case 'incident':
        return make({
          key: 'userIncident',
          priority: e.added >= 4 ? 1 : 2,
          category: 'userIncident',
          kind: 'incident',
          baseIntensity: e.added >= 4 ? 3 : 2,
          userInvolved: true,
          cars: mine,
        });
      case 'positionGained':
        return make({ key: 'userPos:gained', priority: 1, category: 'userOvertake', kind: 'action', baseIntensity: 3, userInvolved: true, cars: mine, position: e.to });
      case 'positionLost':
        return make({ key: 'userPos:lost', priority: 1, category: 'userLostPosition', kind: 'action', baseIntensity: 2, userInvolved: true, cars: mine, position: e.to });
      case 'flag':
        if (e.flag === 'checkered') return make({ key: 'checkered', priority: 0, category: 'leadBattle', kind: 'action', baseIntensity: 4, ttlMs: 30_000 });
        if (e.flag === 'white') return make({ key: 'finalLap', priority: 1, category: 'leadBattle', kind: 'action', baseIntensity: 3, ttlMs: 30_000 });
        if (e.flag === 'green' && (ctx.phase === 'opening' || ctx.phase === 'preRace'))
          return make({ key: 'start', priority: 0, category: 'leadBattle', kind: 'action', baseIntensity: 4, ttlMs: 30_000 });
        if (e.flag === 'red') return make({ key: 'flag:red', priority: 0, category: 'majorIncident', kind: 'incident', baseIntensity: 3, ttlMs: 30_000 });
        if (e.flag === 'yellow' || e.flag === 'caution')
          return make({ key: `flag:${e.flag}`, priority: ctx.isRace ? 1 : 3, category: 'majorIncident', kind: 'incident', baseIntensity: 2, ttlMs: 30_000 });
        return make({ key: `flag:${e.flag}`, priority: 3, category: 'neutral', kind: 'action', baseIntensity: 1 });
      case 'leaderChange':
        return make({ key: `lead:${e.leader}`, priority: finalStage ? 0 : 1, category: 'leadBattle', kind: 'action', baseIntensity: 4, position: 1 });
      case 'sessionFastestLap':
        return e.isDriver
          ? make({ key: 'fastestLap', priority: 2, category: 'personalBest', kind: 'action', baseIntensity: 2, userInvolved: true, cars: mine })
          : make({ key: 'fastestLap', priority: 2, category: 'neutral', kind: 'action', baseIntensity: 2 });
      case 'nearbyIncident':
        return make({
          key: `near:${e.idx}`,
          priority: e.kind === 'slowed' ? 1 : 2,
          category: 'nearUser',
          kind: 'incident',
          baseIntensity: e.kind === 'slowed' ? 3 : 2,
          cars: [e.idx, ...mine],
          confidence: e.kind === 'slowed' ? 'inferred' : 'confirmed',
          ttlMs: 25_000,
        });
    }
  }

  const b = e as BroadcastEvent;
  switch (b.type) {
    case 'preRace':
      return make({ key: 'preRace', priority: 1, category: 'neutral', kind: 'preRace', baseIntensity: 2, ttlMs: 120_000 });
    case 'raceStart':
      return make({ key: 'start', priority: 0, category: 'leadBattle', kind: 'action', baseIntensity: 4, ttlMs: 30_000 });
    case 'overtake': {
      const cars = [b.idx, b.passedIdx];
      if (b.position === 1)
        return make({
          key: `lead:${b.driver}`,
          priority: b.finalLap ? 0 : 1,
          category: b.user ? 'userOvertake' : 'leadBattle',
          kind: 'action',
          baseIntensity: b.finalLap ? 5 : 4,
          decisive: b.finalLap,
          userInvolved: !!b.user,
          cars,
          position: 1,
        });
      if (b.user)
        return make({
          // the same pass as positionGained / positionLost, which this one (with names) is preferred to
          key: `userPos:${b.user}`,
          priority: b.finalLap && b.position <= 3 ? 0 : 1,
          category: b.user === 'gained' ? 'userOvertake' : 'userLostPosition',
          kind: 'action',
          baseIntensity: b.user === 'gained' ? 3 : 2,
          decisive: b.finalLap && b.position <= 3,
          userInvolved: true,
          cars,
          position: b.position,
        });
      return make({
        key: `pass:${b.idx}>${b.passedIdx}`,
        priority: b.position <= 5 ? 1 : 2,
        category: b.position <= 3 ? 'leadBattle' : 'otherPositionChange',
        kind: 'action',
        baseIntensity: 3,
        cars,
        position: b.position,
      });
    }
    case 'battle': {
      const cars = [b.aheadIdx, b.behindIdx];
      const lead = b.position === 1;
      const strong = b.phase === 'start' || b.phase === 'veryClose';
      const priority: Priority = strong ? (b.user || lead ? 1 : 2) : b.phase === 'closing' ? (b.user || lead ? 2 : 3) : 3;
      return make({
        key: `battle:${b.aheadIdx}-${b.behindIdx}`,
        priority,
        category: b.user ? 'userBattle' : lead ? 'leadBattle' : 'otherPositionChange',
        kind: 'action',
        baseIntensity: b.phase === 'veryClose' || (b.phase === 'start' && b.gap < 0.5) ? 3 : b.phase === 'pulling' || b.phase === 'ended' ? 1 : 2,
        userInvolved: b.user,
        cars,
        continuous: true,
        gap: b.gap,
        position: b.position,
        ttlMs: 15_000,
      });
    }
    case 'pitStop':
      return make({
        key: `pit:${b.idx}:${b.phase}`,
        priority: (b.position ?? 99) <= 3 ? 2 : 3,
        category: (b.position ?? 99) <= 3 ? 'leadBattle' : 'routineElsewhere',
        kind: 'strategy',
        baseIntensity: 1,
        cars: [b.idx],
        position: b.position,
        ttlMs: 30_000,
      });
    case 'fieldIncident': {
      const multi = b.others.length > 0;
      const priority: Priority = !ctx.isRace ? 4 : b.leader ? 0 : multi ? 1 : b.kind === 'slowed' ? 2 : 3;
      return make({
        key: `incident:${b.idx}`,
        priority,
        category: b.leader || multi ? 'majorIncident' : b.kind === 'slowed' ? 'otherPositionChange' : 'routineElsewhere',
        kind: 'incident',
        baseIntensity: b.leader || multi ? 3 : b.kind === 'slowed' ? 2 : 1,
        cars: [b.idx],
        confidence: b.kind === 'slowed' ? 'inferred' : 'confirmed',
        position: b.position,
        ttlMs: 25_000,
      });
    }
    case 'finalLap':
      return make({ key: 'finalLap', priority: 0, category: 'leadBattle', kind: 'action', baseIntensity: 3, ttlMs: 30_000 });
    case 'raceWon':
      return make({
        key: 'checkered',
        priority: 0,
        category: b.userWon ? 'userOvertake' : 'leadBattle',
        kind: 'action',
        baseIntensity: b.userWon || (b.margin !== null && b.margin < 0.5) ? 5 : 4,
        decisive: b.userWon || (b.margin !== null && b.margin < 0.5),
        userInvolved: b.userWon,
        cars: [b.winnerIdx],
        position: 1,
        ttlMs: 40_000,
      });
    case 'driverFinished':
      return make({
        key: 'userFinished',
        priority: 1,
        category: 'userOvertake',
        kind: 'postRace',
        baseIntensity: b.position !== null && b.position <= 3 ? 3 : 2,
        userInvolved: true,
        cars: mine,
        position: b.position,
        ttlMs: 45_000,
      });
    case 'storyline': {
      const user = me != null && b.storyline.cars.includes(me);
      return make({
        key: `story:${b.storyline.id}`,
        priority: b.storyline.significance >= 3 ? 2 : 3,
        category: user ? 'userStory' : b.storyline.kind === 'leaderPressure' ? 'leadBattle' : 'neutral',
        kind: 'storyline',
        baseIntensity: 2,
        userInvolved: user,
        cars: b.storyline.cars,
        continuous: true,
        ttlMs: 60_000,
      });
    }
    case 'raceSummary':
      return make({ key: 'raceSummary', priority: 4, category: 'neutral', kind: 'summary', baseIntensity: 1, continuous: true, ttlMs: 30_000 });
    case 'statsUpdate':
      return make({ key: 'statsUpdate', priority: 3, category: 'neutral', kind: 'stats', baseIntensity: 1, continuous: true, ttlMs: 30_000 });
  }
}

// How much the event counts for this listener: the category's weight, reached as far as their Coverage Focus says
export function relevance(category: RelevanceCategory, focus: CoverageFocus): number {
  const weight = RELEVANCE_WEIGHTS[category];
  if (!USER_CATEGORIES.has(category)) return weight;
  return 1 + (weight - 1) * FOCUS[focus].reach;
}

// How excited the announcers sound, 1-5: the event's own intensity adjusted for the stakes, the stage of the race,
// how close it is and who's in it, never 5 unless it decides the race, smoothed for situations that carry on, and
// capped by the listener's Maximum Commentary Intensity
export function intensityFor(c: Classified, ctx: DirectorContext, state: DirectorState, now: number, maxIntensity: number): { lead: number; color: number } {
  let i = c.baseIntensity;
  if (c.kind === 'action' || c.kind === 'incident') {
    if (ctx.phase === 'finalLaps') i += 1;
    else if (ctx.phase === 'finalQuarter') i += 0.5;
  }
  if (c.category !== 'leadBattle' && c.position === 1) i += 0.5;
  else if (c.position !== null && c.position <= 3 && c.kind === 'action') i += 0.5;
  if (c.gap !== null && c.gap < 0.3) i += 0.25;
  const ev = c.event as BroadcastEvent;
  if (ev.type === 'fieldIncident' && ev.others.length >= 2) i += 0.5;
  // the driver's moments get a little lift, never a level of their own
  if (c.userInvolved && c.kind !== 'routine') i += 0.25;
  // A crash is called seriously, not celebrated
  if (c.kind === 'incident') i = Math.min(i, 4);
  if (!c.decisive) i = Math.min(i, 4.4);
  // a half level rounds down: excitement has to be earned
  let level = Math.min(Math.max(Math.round(i - 0.01), 1), 5);
  if (c.continuous) {
    const eased = Math.max(1, state.level - Math.floor((now - state.levelAt) / INTENSITY_DECAY_MS));
    if (now - state.levelAt < INTENSITY_STEP_MS) level = Math.min(Math.max(level, eased - 1), eased + 1);
  }
  level = Math.min(level, maxIntensity);
  // The analyst sits a little under the play-by-play in the big moments, unless the moment is race-deciding
  const color = Math.min(level >= 4 && !c.decisive ? level - 1 : level, maxIntensity);
  return { lead: level, color };
}

function chooseFormat(c: Classified, speakers: Speaker[], state: DirectorState, mode: BroadcastMode, intensity: number, now: number): Format {
  if (!speakers.includes('color')) return 'lead';
  if (!speakers.includes('lead')) return 'color';
  if (c.priority === 0) return 'leadColor';
  if (mode === 'quiet') return 'lead';
  const lastDialogue = state.lastFormat === 'leadColor' || state.lastFormat === 'leadColorLead';
  switch (c.kind) {
    case 'stats':
      return mode === 'full' && !lastDialogue && state.statTopics.length % 2 === 1 ? 'leadColor' : 'color';
    case 'summary':
      return mode === 'full' && now - state.lastTripleAt > 360_000 ? 'leadColorLead' : 'leadColor';
    case 'storyline':
    case 'preRace':
    case 'postRace':
      return 'leadColor';
    case 'routine':
      return 'lead';
    default:
      break;
  }
  if (c.priority === 1) return intensity >= 3 || !lastDialogue ? 'leadColor' : 'lead';
  if (c.priority === 2) return lastDialogue ? (c.kind === 'strategy' ? 'color' : 'lead') : 'leadColor';
  return 'color';
}

function maxSecondsFor(c: Classified, intensity: number): Record<Speaker, number> {
  const urgent = c.priority <= 1 && intensity >= 4;
  return {
    lead: c.kind === 'summary' || c.kind === 'preRace' || c.kind === 'postRace' ? 12 : urgent ? 7 : 10,
    color: c.kind === 'stats' || c.kind === 'summary' || c.kind === 'preRace' ? 16 : urgent ? 10 : 14,
  };
}

// Picks what to say about these events, or nothing; never changes state (commitDecision does, once it's been said)
export function direct(input: {
  events: NumberedRaceEvent[];
  now: number;
  settings: BroadcastSettings;
  speakers: Speaker[];
  ctx: DirectorContext;
  state: DirectorState;
}): { decision: Decision | null; diagnostics: Diagnostic[] } {
  const { now, settings, speakers, ctx, state } = input;
  const diagnostics: Diagnostic[] = [];
  const classified = input.events.map((e) => classify(e, ctx));
  const mode = settings.mode;
  const suppress = (c: Classified, reason: string, score = 0) =>
    diagnostics.push({ seq: c.seq, type: c.event.type, priority: c.priority, score: Math.round(score), verdict: 'suppressed', reason });

  if (mode === 'off' || speakers.length === 0) {
    for (const c of classified) suppress(c, mode === 'off' ? 'broadcastOff' : 'noAnnouncers');
    return { decision: null, diagnostics };
  }
  const freq = FREQUENCY[settings.frequency];
  const silenceS = Math.max(0, (now - state.busyUntil) / 1000);
  const busy = now < state.busyUntil;

  // Coverage balance: how much of the recent discretionary commentary was about the driver
  const recent = state.coverage.slice(-COVERAGE_WINDOW);
  const userShare = recent.length >= 5 ? recent.filter((r) => r.user).length / recent.length : null;
  const target = FOCUS[settings.focus].target;
  const counts = new Map<number, number>();
  for (const r of recent) if (r.idx !== null) counts.set(r.idx, (counts.get(r.idx) ?? 0) + 1);

  const candidates: { c: Classified; score: number }[] = [];
  for (const c of classified) {
    const userRelated = USER_CATEGORIES.has(c.category);
    if (now - c.at > c.ttlMs) {
      suppress(c, 'stale');
      continue;
    }
    if (c.kind === 'stats' && !settings.statistics) {
      suppress(c, 'statisticsOff');
      continue;
    }
    if (c.kind === 'strategy' && !settings.strategy && !c.userInvolved) {
      suppress(c, 'strategyOff');
      continue;
    }
    if (c.kind === 'preRace' && !settings.preRace) {
      suppress(c, 'preRaceOff');
      continue;
    }
    if (c.kind === 'postRace' && !settings.postRace) {
      suppress(c, 'postRaceOff');
      continue;
    }
    // Said already: the same thing lately, or a battle whose gap hasn't really changed
    const window = REPEAT_MS[c.event.type] ?? DEFAULT_REPEAT_MS;
    const said = [...state.history].reverse().find((h) => h.key === c.key);
    if (said && now - said.at < window && c.priority > 0) {
      suppress(c, 'repeat');
      continue;
    }
    if (said && c.gap !== null && said.gap !== null && Math.abs(c.gap - said.gap) < GAP_CHANGE && now - said.at < 120_000) {
      suppress(c, 'gapUnchanged');
      continue;
    }
    if (said && c.priority === 0 && now - said.at < 60_000) {
      suppress(c, 'repeat');
      continue;
    }
    // What the mode lets through
    if (mode === 'quiet' && c.priority >= 1 && !(c.priority === 1 && (c.userInvolved || c.category === 'leadBattle' || c.category === 'majorIncident'))) {
      suppress(c, 'quietMode');
      continue;
    }
    const minSilence = MIN_SILENCE_S[mode][c.priority];
    if (minSilence === null) {
      suppress(c, `${mode}Mode`);
      continue;
    }
    const kindInterval = KIND_INTERVAL_S[mode][c.kind];
    if (kindInterval === null) {
      suppress(c, `${mode}Mode`);
      continue;
    }
    if (c.priority > 0) {
      if (kindInterval !== undefined && now - (state.lastKindAt[c.kind] ?? 0) < kindInterval * 1000 * freq) {
        suppress(c, 'kindInterval');
        continue;
      }
      const important = c.priority === 1 && (c.userInvolved || c.category === 'leadBattle' || c.category === 'majorIncident');
      if (busy && !(important && c.priority < state.busyPriority)) {
        suppress(c, 'busy');
        continue;
      }
      if (!busy && silenceS < minSilence * freq) {
        suppress(c, 'pacing');
        continue;
      }
    }

    let score = PRIORITY_BASE[c.priority] * relevance(c.category, settings.focus);
    score *= Math.max(0.2, 1 - (now - c.at) / c.ttlMs);
    if (c.confidence === 'inferred') score *= 0.85;
    if (c.priority > 0) {
      if (userShare !== null) {
        if (userShare > target + 0.1) score *= userRelated ? 0.8 : 1.2;
        else if (userShare < target - 0.1) score *= userRelated ? 1.2 : 0.9;
      }
      // no one other driver takes over the broadcast
      const others = c.cars.filter((idx) => idx !== ctx.userIdx);
      if (others.some((idx) => (counts.get(idx) ?? 0) >= COVERAGE_WINDOW * 0.4)) score *= 0.8;
      if (state.history.some((h) => now - h.at < 30_000 && h.cars.some((idx) => c.cars.includes(idx)))) score *= 0.75;
      if (ctx.storylines.some((s) => s.status === 'active' && s.significance >= 2 && s.cars.some((idx) => c.cars.includes(idx)))) score += 8;
      // The tracker's named passes are preferred to the plain position change of the same moment
      if (c.event.type === 'overtake') score += 1;
    }
    candidates.push({ c, score });
  }

  if (candidates.length === 0) return { decision: null, diagnostics };
  // P0 first, whatever the weights; then the best score
  candidates.sort((a, b) => Number(b.c.priority === 0) - Number(a.c.priority === 0) || b.score - a.score);
  const best = candidates[0];
  const selected = best.c;
  const related: Classified[] = [];
  for (const { c, score } of candidates.slice(1)) {
    const sameMoment = c.key === selected.key || (c.key.startsWith('userPos:') && selected.key.startsWith('userPos:'));
    const linked = c.cars.some((idx) => selected.cars.includes(idx)) || c.kind === selected.kind;
    if (!sameMoment && linked && related.length < 2 && c.priority <= 3) {
      related.push(c);
      diagnostics.push({ seq: c.seq, type: c.event.type, priority: c.priority, score: Math.round(score), verdict: 'merged', reason: `with ${selected.seq}` });
    } else {
      suppress(c, sameMoment ? 'sameMoment' : 'outranked', score);
    }
  }
  diagnostics.push({ seq: selected.seq, type: selected.event.type, priority: selected.priority, score: Math.round(best.score), verdict: 'announced', reason: 'selected' });

  const intensity = intensityFor(selected, ctx, state, now, settings.maxIntensity);
  const format = chooseFormat(selected, speakers, state, mode, intensity.lead, now);
  const storylines = ctx.storylines
    .filter((s) => s.status === 'active' && now - s.updatedAt < 300_000 && (s.cars.some((idx) => selected.cars.includes(idx)) || (ctx.userIdx != null && s.cars.includes(ctx.userIdx))))
    .sort((a, b) => b.significance - a.significance)
    .slice(0, 2);
  return {
    decision: {
      selected,
      related,
      intensity: intensity.lead,
      colorIntensity: intensity.color,
      format,
      maxSeconds: maxSecondsFor(selected, intensity.lead),
      expiresAt: selected.at + selected.ttlMs,
      replaceQueued: selected.priority <= 1,
      storylines,
      score: best.score,
      userRelated: USER_CATEGORIES.has(selected.category),
    },
    diagnostics,
  };
}

// Records what was said: its keys for repetition, the coverage, the intensity, and how long the audio plays
export function commitDecision(state: DirectorState, decision: Decision, now: number, audioMs: number, format: Format, userIdx: number | null): void {
  for (const c of [decision.selected, ...decision.related]) {
    state.history.push({
      at: now,
      key: c.key,
      type: c.event.type,
      cars: c.cars,
      gap: c.gap,
      storyline: c.event.type === 'storyline' ? (c.event as Extract<BroadcastEvent, { type: 'storyline' }>).storyline.id : null,
      userRelated: USER_CATEGORIES.has(c.category),
      priority: c.priority,
    });
  }
  state.history = state.history.slice(-HISTORY);
  const s = decision.selected;
  if (s.priority > 0) {
    const other = s.cars.find((idx) => idx !== userIdx) ?? null;
    state.coverage = [...state.coverage, { user: decision.userRelated, idx: other }].slice(-COVERAGE_WINDOW);
  }
  state.level = decision.intensity;
  state.levelAt = now;
  state.busyUntil = Math.max(now, state.busyUntil) + audioMs;
  state.busyPriority = s.priority;
  state.lastKindAt[s.kind] = now;
  state.lastFormat = format;
  if (format === 'leadColorLead') state.lastTripleAt = now;
}

// The statistic to talk about next: the first available not used lately, so analysis rotates
export function pickStatTopic(available: string[], state: DirectorState): string | null {
  if (available.length === 0) return null;
  const fresh = available.find((t) => !state.statTopics.slice(-Math.min(3, available.length - 1)).includes(t)) ?? available[0];
  state.statTopics = [...state.statTopics, fresh].slice(-10);
  return fresh;
}
