import { commitDecision, direct, newDirectorState, pickStatTopic, type Decision, type DirectorContext, type DirectorState, type Speaker } from './broadcastDirector';
import { recordDecision, recordDroppedLine, recordFailure, recordNote, recordSpoken, recordStale } from './broadcastMetrics';
import { lineVolume, type BroadcastSettings } from './broadcastSettings';
import type { BroadcastTracker, CarStats } from './broadcastTracker';
import { estimatedSeconds, type LineFacts } from './broadcastValidation';
import { spokenCarName } from './carBrands';
import { getCoachVoice, synthesizeSpeech, type SpeechFormat } from './coachVoice';
import { readRaceEvents, type NumberedRaceEvent, type RaceEventContext } from './liveRacing';
import {
  ANNOUNCER_ROLES,
  describeEvent,
  describeStoryline,
  getRaceAnnouncerSettings,
  linePlans,
  raceAnnouncerLines,
  type Announcer,
  type NameFor,
} from './raceAnnouncer';
import { aiRateLimit, type AiRateLimit } from './rateLimits';
import { formatSeconds } from './stintExport';
import type { User } from './users';

// One Race Broadcast commentary for a live driver the user may watch, shared by the Live Racing page
// (POST /api/live/announcer, WAV) and TV Broadcast Mode (POST /api/tv/announcer, MP3). The pipeline: the driver's
// race events newer than after (src/lib/liveRacing.ts, with the field's from src/lib/broadcastTracker.ts) go to the
// Commentary Director (src/lib/broadcastDirector.ts), which picks one or none by fixed rules; only then is there an AI
// call, the RaceAnnouncer agent writing the lines the Director planned from a structured request of verified facts,
// each checked before it's spoken in the announcers' voices at the Director's intensity. Each listener has their own
// Director (what they heard, their pacing and intensity), per driver and session, in this server's memory.

// The AI and the speech each get this long; a line about an event that has expired by then is discarded
const AI_TIMEOUT_MS = 12_000;
const RECENT_LINES = 8;
// Bytes a second of the WAV the Live Racing page gets (24 kHz 16-bit mono); MP3 lengths are estimated from the words
const WAV_BYTES_PER_SECOND = 48_000;

type Listener = { director: DirectorState; recent: { speaker: Announcer; text: string }[] };
const store = globalThis as unknown as { raceBroadcast?: Map<string, Listener> };
const listeners = (store.raceBroadcast ??= new Map<string, Listener>());

function listenerFor(viewerId: number, driverId: number, sessionKey: string): Listener {
  const key = `${viewerId}:${driverId}`;
  let listener = listeners.get(key);
  if (!listener || listener.director.sessionKey !== sessionKey) {
    listener = { director: newDirectorState(sessionKey), recent: [] };
    listeners.set(key, listener);
  }
  return listener;
}

export type SpokenLine = {
  speaker: Announcer;
  text: string;
  audio: string;
  intensity: number;
  // The Director's priority (0 critical to 4 background), how long from now the line is still worth playing, how
  // long it plays and how loud (0-1, the listener's volumes)
  priority: number;
  ttlMs: number;
  durationMs: number;
  volume: number;
};

export type CommentaryResult =
  | { kind: 'notLive' }
  // seq: the newest event's number, to send as after next time; audio is base64. replaceQueued: these lines matter
  // more than any less important ones still waiting to be played, which the page drops
  | { kind: 'lines'; seq: number; lines: SpokenLine[]; replaceQueued: boolean }
  | { kind: 'refused'; response: Response };

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

export async function commentate(input: {
  request: Request;
  user: User;
  driverId: number;
  after: number;
  lead: boolean;
  color: boolean;
  format: SpeechFormat;
}): Promise<CommentaryResult> {
  const { user, driverId, after, format } = input;
  const found = await readRaceEvents(user, driverId, after);
  if (!found) return { kind: 'notLive' };
  const nothing: CommentaryResult = { kind: 'lines', seq: found.seq, lines: [], replaceQueued: false };
  const speakers: Speaker[] = [...(input.lead ? ['lead' as const] : []), ...(input.color ? ['color' as const] : [])];
  if (found.events.length === 0 || speakers.length === 0) return nothing;

  const settings = await getRaceAnnouncerSettings(user.id);
  const tracker = found.broadcast;
  const listener = listenerFor(user.id, driverId, found.sessionKey);
  const ctx: DirectorContext = {
    isRace: tracker.isRace || found.context.sessionType?.toLowerCase() === 'race',
    phase: tracker.phase(),
    raceProgress: tracker.raceProgress(),
    userIdx: tracker.userIdx,
    userPosition: found.context.position,
    storylines: tracker.storylines(),
  };
  const now = Date.now();
  const { decision, diagnostics } = direct({ events: found.events, now, settings: settings.broadcast, speakers, ctx, state: listener.director });
  recordDecision(
    user.id,
    driverId,
    diagnostics,
    decision
      ? { seq: decision.selected.seq, type: decision.selected.event.type, priority: decision.selected.priority, intensity: decision.intensity, format: decision.format }
      : null,
    decision?.userRelated ?? false
  );
  if (!decision) return nothing;

  let limit: AiRateLimit | null = null;
  try {
    limit = await aiRateLimit(input.request, 'raceAnnouncer', user);
    if (limit.response) return { kind: 'refused', response: limit.response };
    const built = buildRequest(decision, found.context, tracker, settings.broadcast, listener);
    const plans = linePlans(decision);
    const started = Date.now();
    let written: Awaited<ReturnType<typeof raceAnnouncerLines>>;
    try {
      written = await limit.track(() =>
        withTimeout(raceAnnouncerLines({ request: built.request, plans, facts: built.facts, instructions: settings.instructions, language: user.preferredLanguage }), AI_TIMEOUT_MS)
      );
    } catch (error) {
      recordFailure('llm');
      throw error;
    }
    const llmMs = Date.now() - started;
    for (const d of written.dropped) {
      recordDroppedLine(d.reason.split(':')[0]);
      console.warn(`Race Broadcast dropped a ${d.speaker} line (${d.reason}): ${d.text}`);
    }
    if (written.lines.length === 0) {
      recordNote(user.id, driverId, 'every line failed the factual check', diagnostics);
      return nothing;
    }

    const { spanishAccent } = await getCoachVoice(user.id);
    const speechStarted = Date.now();
    const audio = await Promise.all(
      written.lines.map((line) =>
        synthesizeSpeech(
          line.spoken,
          line.speaker === 'lead' ? settings.leadVoice : settings.colorVoice,
          user.preferredLanguage,
          spanishAccent,
          ANNOUNCER_ROLES[line.speaker],
          format,
          line.intensity
        ).catch((error) => {
          recordFailure('speech');
          console.error('Race Broadcast speech error:', error);
          return null;
        })
      )
    );
    const speechMs = Date.now() - speechStarted;
    // A line without audio ends the exchange: the next one answers it
    const firstMissing = audio.findIndex((a) => a === null);
    const usable = firstMissing < 0 ? written.lines.length : firstMissing;
    if (usable === 0) return nothing;
    if (Date.now() > decision.expiresAt) {
      recordStale();
      recordNote(user.id, driverId, 'expired before the audio was ready', diagnostics);
      return nothing;
    }

    const lines: SpokenLine[] = written.lines.slice(0, usable).map((line, i) => {
      const bytes = audio[i]!;
      const durationMs =
        format === 'wav' ? Math.round(((bytes.length - 44) / WAV_BYTES_PER_SECOND) * 1000) : Math.round(estimatedSeconds(line.text) * 1000);
      return {
        speaker: line.speaker,
        text: line.text,
        audio: bytes.toString('base64'),
        intensity: line.intensity,
        priority: decision.selected.priority,
        // a line still waiting once the event has gone stale isn't played
        ttlMs: Math.max(decision.expiresAt - Date.now(), 0) + 10_000 * i,
        durationMs,
        volume: lineVolume(settings.broadcast, line.speaker),
      };
    });
    commitDecision(listener.director, decision, Date.now(), lines.reduce((sum, l) => sum + l.durationMs, 0) + 400 * lines.length, decision.format, ctx.userIdx);
    listener.recent = [...listener.recent, ...lines.map((l) => ({ speaker: l.speaker, text: l.text }))].slice(-RECENT_LINES);
    recordSpoken({
      viewerId: user.id,
      driverId,
      announced: { seq: decision.selected.seq, type: decision.selected.event.type, priority: decision.selected.priority, intensity: decision.intensity, format: decision.format },
      lines: lines.map((l) => ({ speaker: l.speaker, text: l.text, intensity: l.intensity })),
      diagnostics,
      llmMs,
      speechMs,
      eventAgeMs: Date.now() - decision.selected.at,
    });
    return { kind: 'lines', seq: found.seq, lines, replaceQueued: decision.replaceQueued };
  } catch (error) {
    await limit?.refund();
    throw error;
  }
}

const tenth = (s: number | null) => (s === null ? null : Math.round(s * 10) / 10);

// A car's statistics as the announcers get them, times as lap times and gaps in tenths
function statsFacts(s: CarStats, name: NameFor) {
  return {
    driver: name(s.driver),
    car: s.car ? spokenCarName(s.car) : null,
    position: s.position,
    startPosition: s.startPosition,
    placesGainedSinceStart: s.gained,
    cleanLaps: s.cleanLaps,
    bestLap: s.best !== null ? formatSeconds(s.best) : null,
    lastLap: s.last !== null ? formatSeconds(s.last) : null,
    averageLap: s.average !== null ? formatSeconds(s.average) : null,
    lapTimeSpreadSeconds: s.consistency !== null && s.cleanLaps >= 4 ? tenth(s.consistency) : null,
    lastThreeLapsVsThreeBefore: s.trend !== null ? `${s.trend < 0 ? 'faster' : 'slower'} by ${Math.abs(s.trend).toFixed(1)} s a lap` : null,
    recentPaceRankInClass: s.paceRank,
    pitStops: s.pitStops,
    lastPitStopSeconds: tenth(s.lastPitSeconds),
  };
}

// The statistics there are to talk about now, for the Director to rotate through
function statTopics(user: CarStats | null, tracker: BroadcastTracker): string[] {
  const topics: string[] = [];
  if (user?.gained != null && Math.abs(user.gained) >= 2) topics.push('listenersDriverPlacesSinceStart');
  if (user?.paceRank != null) topics.push('listenersDriverRecentPace');
  if (user?.consistency != null && user.cleanLaps >= 4) topics.push('listenersDriverConsistency');
  if (user && tracker.neighbors(user.idx).ahead) topics.push('listenersDriverGapAhead');
  if (tracker.isRace) topics.push('fastestInTheField');
  return topics;
}

// The structured request for the RaceAnnouncer agent, and the facts its lines are checked against
function buildRequest(
  decision: Decision,
  context: RaceEventContext,
  tracker: BroadcastTracker,
  settings: BroadcastSettings,
  listener: Listener
): { request: Record<string, unknown>; facts: LineFacts } {
  const roster = tracker.roster();
  const userCar = roster.find((r) => r.idx === tracker.userIdx);
  // the driver as the field knows them (their iRacing name), and their RacingCoach.app name too
  const driver = userCar?.driver ?? context.driver;
  const numbers = new Map(roster.map((r) => [r.driver, r.number]));
  const name: NameFor = (n) => {
    if (settings.announceNames || n === driver || n === context.driver) return n;
    const number = numbers.get(n);
    return number ? `car number ${number}` : 'a car';
  };
  const carsByDriver = { ...context.carsByDriver };
  const describe = (e: NumberedRaceEvent) => describeEvent(e.event, driver, name, carsByDriver);
  const involved = [...new Set([...decision.selected.cars, ...decision.related.flatMap((r) => r.cars)])];
  const stats = settings.statistics || decision.selected.kind === 'stats';
  const userStats = tracker.userIdx != null ? tracker.carStats(tracker.userIdx) : null;
  const carStats = involved
    .filter((idx) => idx !== tracker.userIdx)
    .slice(0, 3)
    .map((idx) => tracker.carStats(idx))
    .filter((s): s is CarStats => s !== null);
  const neighbors = userStats ? tracker.neighbors(userStats.idx) : null;
  const order = tracker.runningOrder(5);
  let statFocus: string | null = null;
  let fastest: CarStats | null = null;
  if (decision.selected.kind === 'stats') {
    statFocus = pickStatTopic(statTopics(userStats, tracker), listener.director);
    if (statFocus === 'fastestInTheField') {
      fastest = roster.map((r) => tracker.carStats(r.idx)).find((s) => s?.paceRank === 1 && s.carClass === (userStats?.carClass ?? s.carClass)) ?? null;
      if (fastest && !carStats.some((c) => c.idx === fastest!.idx) && fastest.idx !== tracker.userIdx) carStats.push(fastest);
    }
  }
  const phase = tracker.phase();
  const request: Record<string, unknown> = {
    session: {
      track: context.track,
      type: context.sessionType,
      name: context.sessionName,
      phase,
      lap: context.lap,
      lapsTotal: context.lapsTotal,
      lapsRemaining: tracker.lapsRemaining(),
      minutesRemaining: context.timeRemain != null && !context.lapsTotal ? Math.round(context.timeRemain / 60) : null,
      cars: roster.length || context.carsInSession,
      multiClass: tracker.multiClass,
    },
    listenersDriver: {
      name: driver,
      alsoKnownAs: context.driver !== driver ? context.driver : undefined,
      car: spokenCarName(context.car),
      position: context.position,
      carClass: userStats?.carClass ?? null,
      incidentPoints: context.incidents,
      carAhead: neighbors?.ahead ? { driver: name(neighbors.ahead.driver), gapSeconds: neighbors.ahead.gap } : null,
      carBehind: neighbors?.behind ? { driver: name(neighbors.behind.driver), gapSeconds: neighbors.behind.gap } : null,
      statistics: stats && userStats ? statsFacts(userStats, name) : undefined,
    },
    event: {
      priority: `P${decision.selected.priority}`,
      confidence: decision.selected.confidence,
      what: describe(decision.selected),
      ...(statFocus ? { statisticToDiscuss: statFocus } : {}),
    },
    alsoJustHappened: decision.related.map(describe),
    runningOrder: order.map((o) => ({ position: o.position, driver: name(o.driver), car: carsByDriver[o.driver] ? spokenCarName(carsByDriver[o.driver]) : null })),
    otherDriversStatistics: stats ? carStats.map((s) => statsFacts(s, name)) : [],
    storylines: decision.storylines.map((s) => ({ story: describeStoryline(s, name), since: `${Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000))} minutes` })),
    recentCommentary: listener.recent.map((l) => `${l.speaker === 'lead' ? 'Lead' : 'Color'}: ${l.text}`),
    strategyDiscussion: settings.strategy,
  };

  const allowedNames = new Set<string>([driver, context.driver]);
  const collect = (value: unknown, numbersOut: number[], decimalsOut: string[]) => {
    if (typeof value === 'number') {
      numbersOut.push(value, Math.floor(value), Math.round(value));
      decimalsOut.push(value.toFixed(1), value.toFixed(2), value.toFixed(3), String(value));
    } else if (typeof value === 'string') {
      for (const m of value.matchAll(/\d+(?:[.:]\d+)*/g)) {
        decimalsOut.push(m[0]);
        if (!/[.:]/.test(m[0])) numbersOut.push(Number(m[0]));
      }
      for (const r of roster) if (value.includes(r.driver)) allowedNames.add(r.driver);
    } else if (Array.isArray(value)) {
      for (const v of value) collect(v, numbersOut, decimalsOut);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) collect(v, numbersOut, decimalsOut);
    }
  };
  const allowedNumbers: number[] = [];
  const allowedDecimals: string[] = [];
  collect(request, allowedNumbers, allowedDecimals);
  // what the commentary already said may be referred back to
  collect(listener.recent.map((l) => l.text), allowedNumbers, allowedDecimals);
  return {
    request,
    facts: { allowedNames: [...allowedNames], fieldNames: roster.map((r) => r.driver), allowedNumbers, allowedDecimals },
  };
}
