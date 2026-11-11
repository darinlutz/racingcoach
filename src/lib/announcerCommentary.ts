import { createHash } from 'node:crypto';
import {
  commentaryRoute,
  commitAiCall,
  commitDecision,
  commitTireMention,
  direct,
  newDirectorState,
  pickStatTopic,
  planCommentary,
  tireMentionAllowed,
  type Decision,
  type DirectorContext,
  type DirectorState,
  type Speaker,
} from './broadcastDirector';
import { recordDecision, recordDroppedLine, recordFailure, recordNote, recordRoute, recordSpoken, recordStale } from './broadcastMetrics';
import { newPhraseMemory, phraseLines, type PhraseMemory, type PhrasedLine } from './broadcastPhrases';
import { lineVolume, type BroadcastSettings } from './broadcastSettings';
import type { BroadcastTracker, CarStats } from './broadcastTracker';
import { deliveryText, estimatedSeconds, type LineFacts } from './broadcastValidation';
import { spokenCarName } from './carBrands';
import { getCoachVoice, speaksElevenLabs, synthesizeSpeech, withPronunciations, type CoachVoice, type Pronunciation, type SpanishAccent, type SpeechFormat } from './coachVoice';
import { engineBedConfigFor } from './engineAudioAssets';
import type { EngineBedConfig } from './engineBedConfig';
import { readRaceEvents, type NumberedRaceEvent, type RaceEventContext } from './liveRacing';
import {
  ANNOUNCER_ROLES,
  describeEvent,
  describeStoryline,
  getNamePronunciation,
  getRaceAnnouncerSettings,
  linePlans,
  namePronunciations,
  raceAnnouncerLines,
  type Announcer,
  type AnnouncerLine,
  type NameFor,
  type RaceAnnouncerSettings,
} from './raceAnnouncer';
import { getDictionary } from './i18n/server';
import { fmt, type Language } from './i18n/languages';
import { aiRateLimit, type AiRateLimit } from './rateLimits';
import { formatSeconds } from './stintExport';
import { speedFromMetersPerSecond, temperatureFromCelsius, type Units } from './units';
import type { User } from './users';
import { isNight, isStaticWeather, OUTLOOK_MINUTES, skyCondition, weatherOutlook, type OutlookItem } from './liveWeather';
import { isWetSession, type FittedTire } from './liveCarStatus';

// One Race Broadcast commentary for a live driver the user may watch, shared by the Live Racing page
// (POST /api/live/announcer, WAV) and TV Broadcast Mode (POST /api/tv/announcer, MP3). The pipeline: the driver's
// race events newer than after (src/lib/liveRacing.ts, with the field's from src/lib/broadcastTracker.ts) go to the
// Commentary Director (src/lib/broadcastDirector.ts), which picks one or none by fixed rules. A routine moment is said
// in fixed wording from the dictionaries (src/lib/broadcastPhrases.ts), at no AI cost; the rest, within the
// Director's AI budget (planCommentary), is written by the RaceAnnouncer agent from a structured request of verified
// facts, each line checked before it's spoken in the announcers' voices at the Director's intensity. Everyone
// watching the same driver's session with the same language, instructions, units and Director preferences shares one
// broadcast (a Channel: its Director, what it said and the wordings it used), so each moment is decided and written
// once however many pages and TVs watch, in this server's memory.

// The AI and the speech each get this long; a line about an event that has expired by then is discarded
const AI_TIMEOUT_MS = 12_000;
const RECENT_LINES = 12;
// Bytes a second of the WAV the Live Racing page gets (24 kHz 16-bit mono); MP3 lengths are estimated from the words
const WAV_BYTES_PER_SECOND = 48_000;
// A viewer who joins a broadcast still hears what was said this recently; a broadcast nobody has asked about this
// long is forgotten, and what it said is kept this long for viewers to catch up
const JOIN_GRACE_MS = 5_000;
const CHANNEL_IDLE_MS = 15 * 60_000;
const SEGMENT_KEPT_MS = 2 * 60_000;

// One broadcast of a driver's session: everyone watching that driver in the same language, with the same
// instructions, units and Director preferences, hears the same broadcast, so each moment is decided and written once
// however many pages and TVs are watching. Its Director, what it said and the wordings it used are shared; each viewer
// gets the lines they haven't heard yet, in their own voices (spoken once per set of voices) and volumes.
type Segment = {
  id: number;
  at: number;
  expiresAt: number;
  priority: number;
  replaceQueued: boolean;
  lines: AnnouncerLine[];
  pronunciations: Pronunciation[];
  // The audio of each line by voices (audioKey), null where the speech failed
  audio: Map<string, Promise<(Buffer | null)[]>>;
};

type Channel = {
  director: DirectorState;
  recent: { speaker: Announcer; text: string }[];
  phrases: PhraseMemory;
  // The newest event this broadcast has decided about
  processedSeq: number;
  segments: Segment[];
  nextId: number;
  // A decision being made and written, which other viewers' requests wait for rather than making their own
  busy: Promise<unknown> | null;
  // The newest segment each viewer was given
  delivered: Map<string, number>;
  lastUsed: number;
};

const store = globalThis as unknown as { raceBroadcastChannels?: Map<string, Channel> };
const channels = (store.raceBroadcastChannels ??= new Map<string, Channel>());

function channelFor(key: string, sessionKey: string, now: number): Channel {
  for (const [k, c] of channels) if (now - c.lastUsed > CHANNEL_IDLE_MS) channels.delete(k);
  let channel = channels.get(key);
  if (!channel || channel.director.sessionKey !== sessionKey) {
    channel = { director: newDirectorState(sessionKey), recent: [], phrases: newPhraseMemory(), processedSeq: 0, segments: [], nextId: 1, busy: null, delivered: new Map(), lastUsed: now };
    channels.set(key, channel);
  }
  channel.lastUsed = now;
  channel.segments = channel.segments.filter((s) => now - s.at < SEGMENT_KEPT_MS);
  return channel;
}

// What makes two viewers' broadcasts the same: everything that changes what's decided or written (not voices or volumes)
function channelKey(driverId: number, sessionKey: string, user: User, speakers: Speaker[], settings: RaceAnnouncerSettings): string {
  const b = settings.broadcast;
  const director = [b.mode, b.focus, b.maxIntensity, b.frequency, b.announceNames, b.statistics, b.strategy, b.preRace, b.postRace].join(',');
  const instructions = createHash('sha256').update(settings.instructions.trim()).digest('hex').slice(0, 16);
  return [driverId, sessionKey, user.preferredLanguage, user.units, speakers.join('+'), director, instructions].join('|');
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
  // Voiced by ElevenLabs, so the page plays it over the engine bed
  elevenLabs: boolean;
};

export type CommentaryResult =
  | { kind: 'notLive' }
  // seq: the newest event's number, to send as after next time; audio is base64. replaceQueued: these lines matter
  // more than any less important ones still waiting to be played, which the page drops. engineBed: the listener's
  // engine sound preferences as they are now, when there are lines to play over it
  | { kind: 'lines'; seq: number; lines: SpokenLine[]; replaceQueued: boolean; engineBed?: EngineBedConfig }
  | { kind: 'refused'; response: Response }
  // A clip's sequence is under way on the TV (src/lib/videoDirector.ts) and this can wait: nothing was spent, and these
  // events are asked about again when it's over
  | { kind: 'held'; seq: number };

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

type Voices = { lead: CoachVoice; color: CoachVoice; spanishAccent: SpanishAccent; language: Language; format: SpeechFormat };
const audioKey = (v: Voices) => [v.format, v.lead, v.color, v.spanishAccent].join('|');

function speak(segment: Segment, voices: Voices): Promise<(Buffer | null)[]> {
  const key = audioKey(voices);
  let audio = segment.audio.get(key);
  if (!audio) {
    audio = Promise.all(
      segment.lines.map((line) =>
        synthesizeSpeech(
          withPronunciations(line.spoken, segment.pronunciations),
          line.speaker === 'lead' ? voices.lead : voices.color,
          voices.language,
          voices.spanishAccent,
          ANNOUNCER_ROLES[line.speaker],
          voices.format,
          line.intensity
        ).catch((error) => {
          recordFailure('speech');
          console.error('Race Broadcast speech error:', error);
          return null;
        })
      )
    );
    segment.audio.set(key, audio);
  }
  return audio;
}

const durationOf = (bytes: Buffer, text: string, format: SpeechFormat) =>
  format === 'wav' ? Math.round(((bytes.length - 44) / WAV_BYTES_PER_SECOND) * 1000) : Math.round(estimatedSeconds(text) * 1000);

export async function commentate(input: {
  request: Request;
  user: User;
  driverId: number;
  after: number;
  lead: boolean;
  color: boolean;
  format: SpeechFormat;
  // The Broadcast Director is holding commentary: only a P0 moment gets through
  held?: boolean;
  // Who is listening, for what they've already heard: a TV session, else the account (default)
  viewerKey?: string;
}): Promise<CommentaryResult> {
  const { user, driverId, after, format } = input;
  const found = await readRaceEvents(user, driverId, after);
  if (!found) return { kind: 'notLive' };
  const nothing: CommentaryResult = { kind: 'lines', seq: found.seq, lines: [], replaceQueued: false };
  const speakers: Speaker[] = [...(input.lead ? ['lead' as const] : []), ...(input.color ? ['color' as const] : [])];
  if (found.events.length === 0 || speakers.length === 0) return nothing;

  // the listener's announcers, and how the driver they follow says their own name
  const [settings, namePronunciation, { spanishAccent }] = await Promise.all([
    getRaceAnnouncerSettings(user.id),
    getNamePronunciation(driverId),
    getCoachVoice(user.id),
  ]);
  const voices: Voices = { lead: settings.leadVoice, color: settings.colorVoice, spanishAccent, language: user.preferredLanguage, format };
  const channel = channelFor(channelKey(driverId, found.sessionKey, user, speakers, settings), found.sessionKey, Date.now());
  const viewer = input.viewerKey ?? `user:${user.id}`;
  if (!channel.delivered.has(viewer)) {
    // a new viewer starts from now, apart from what was only just said
    const old = channel.segments.filter((s) => Date.now() - s.at >= JOIN_GRACE_MS);
    channel.delivered.set(viewer, old.length > 0 ? old[old.length - 1].id : 0);
  }

  // Another viewer's request is already deciding and writing these events: wait for it and share what it says
  while (channel.busy) await channel.busy.catch(() => undefined);
  let made: Segment | null = null;
  if (found.events.some((e) => e.seq > channel.processedSeq)) {
    const work = produce({ input, found, settings, namePronunciation, speakers, voices, channel });
    channel.busy = work;
    let outcome: Awaited<ReturnType<typeof produce>>;
    try {
      outcome = await work;
    } finally {
      channel.busy = null;
    }
    if (outcome.kind === 'refused') return { kind: 'refused', response: outcome.response };
    if (outcome.kind === 'held') return { kind: 'held', seq: after };
    made = outcome.segment;
  }

  // What this viewer hasn't heard yet and can still be played
  const since = channel.delivered.get(viewer) ?? 0;
  const pending = channel.segments.filter((s) => s.id > since && Date.now() < s.expiresAt);
  if (pending.length === 0) return nothing;
  // Lines another viewer's request made are only voiced again when this viewer's voices differ
  const unvoiced = pending.filter((s) => !s.audio.has(audioKey(voices)));
  let speechLimit: AiRateLimit | null = null;
  if (unvoiced.length > 0) {
    speechLimit = await aiRateLimit(input.request, 'speech', user, unvoiced.reduce((n, s) => n + s.lines.length, 0));
    if (speechLimit.response) return { kind: 'refused', response: speechLimit.response };
  }
  const audio = await Promise.all(pending.map((s) => speak(s, voices)));
  if (speechLimit && unvoiced.every((s) => audio[pending.indexOf(s)].every((a) => a === null))) await speechLimit.refund();
  channel.delivered.set(viewer, pending[pending.length - 1].id);
  for (const s of pending) if (s !== made) recordRoute('shared');

  const lines: SpokenLine[] = [];
  pending.forEach((segment, si) => {
    const bytes = audio[si];
    // A line without audio ends its exchange: the next one answers it
    for (let i = 0; i < segment.lines.length; i++) {
      const b = bytes[i];
      if (!b) break;
      const line = segment.lines[i];
      const voice = line.speaker === 'lead' ? voices.lead : voices.color;
      lines.push({
        speaker: line.speaker,
        text: line.text,
        audio: b.toString('base64'),
        intensity: line.intensity,
        priority: segment.priority,
        // a line still waiting once the event has gone stale isn't played
        ttlMs: Math.max(segment.expiresAt - Date.now(), 0) + 10_000 * i,
        durationMs: durationOf(b, line.text, format),
        volume: lineVolume(settings.broadcast, line.speaker),
        elevenLabs: speaksElevenLabs(voice, ANNOUNCER_ROLES[line.speaker], user.preferredLanguage, spanishAccent),
      });
    }
  });
  if (lines.length === 0) return nothing;
  return { kind: 'lines', seq: found.seq, lines, replaceQueued: pending.some((s) => s.replaceQueued), engineBed: await engineBedConfigFor(settings.broadcast) };
}

type Found = NonNullable<Awaited<ReturnType<typeof readRaceEvents>>>;

// Decides what the broadcast says about the events it hasn't decided about yet, and makes it: fixed wording for
// routine moments, the AI (within the Director's budget) for the rest, spoken in the requesting viewer's voices.
// Charged to the viewer whose request made it.
async function produce(args: {
  input: Parameters<typeof commentate>[0];
  found: Found;
  settings: RaceAnnouncerSettings;
  namePronunciation: string;
  speakers: Speaker[];
  voices: Voices;
  channel: Channel;
}): Promise<{ kind: 'done'; segment: Segment | null } | { kind: 'refused'; response: Response } | { kind: 'held' }> {
  const { input, found, settings, namePronunciation, speakers, voices, channel } = args;
  const { user, driverId } = input;
  const done = (segment: Segment | null = null) => {
    channel.processedSeq = Math.max(channel.processedSeq, found.seq);
    return { kind: 'done' as const, segment };
  };
  const tracker = found.broadcast;
  const ctx: DirectorContext = {
    isRace: tracker.isRace || found.context.sessionType?.toLowerCase() === 'race',
    phase: tracker.phase(),
    raceProgress: tracker.raceProgress(),
    userIdx: tracker.userIdx,
    userPosition: found.context.position,
    storylines: tracker.storylines(),
  };
  const now = Date.now();
  const events = found.events.filter((e) => e.seq > channel.processedSeq);
  const { decision, diagnostics } = direct({ events, now, settings: settings.broadcast, speakers, ctx, state: channel.director });
  recordDecision(
    user.id,
    driverId,
    diagnostics,
    decision
      ? { seq: decision.selected.seq, type: decision.selected.event.type, priority: decision.selected.priority, intensity: decision.intensity, format: decision.format }
      : null,
    decision?.userRelated ?? false
  );
  if (!decision) return done();
  // held: these events are asked about again once the clip is over
  if (input.held && decision.selected.priority > 0) return { kind: 'held' };

  const names = announcedNames(found.context, tracker, settings.broadcast, getDictionary(user.preferredLanguage).broadcastPhrases.carNumber);
  const pronunciations = namePronunciations([names.driver, found.context.driver], namePronunciation);
  let plan = planCommentary(decision, channel.director, settings.broadcast.mode, now);
  let phrased: PhrasedLine[] | null = null;
  if (plan === 'fixed') {
    phrased = phraseLines(
      decision.selected,
      decision.format,
      {
        driver: names.driver,
        name: names.name,
        carOf: (n) => (found.context.carsByDriver[n] ? spokenCarName(found.context.carsByDriver[n]) : null),
        multiClass: tracker.multiClass,
        decimal: user.preferredLanguage === 'en' ? '.' : ',',
      },
      getDictionary(user.preferredLanguage).broadcastPhrases,
      channel.phrases
    );
    // no wording fits (e.g. a pit stop of a car with no name): it goes unsaid rather than costing an AI call
    if (!phrased) plan = 'skip';
  }
  if (plan === 'skip') {
    recordRoute(phrased === null && commentaryRoute(decision.selected) !== 'ai' ? 'unphrased' : 'budget');
    recordNote(user.id, driverId, commentaryRoute(decision.selected) === 'ai' ? 'AI budget used up: not said' : 'no fixed wording fits: not said', diagnostics);
    return done();
  }

  let limit: AiRateLimit | null = null;
  let tires: string | null = null;
  try {
    let written: AnnouncerLine[];
    let llmMs = 0;
    if (plan === 'fixed' && phrased) {
      // no AI: only the speech counts against the live broadcast limit
      limit = await aiRateLimit(input.request, 'speech', user, phrased.length);
      if (limit.response) return { kind: 'refused', response: limit.response };
      written = phrased.map((p) => {
        const intensity = p.speaker === 'lead' ? decision.intensity : decision.colorIntensity;
        const text = deliveryText(p.text, intensity);
        return { speaker: p.speaker, text, spoken: text, intensity, claims: [] };
      });
    } else {
      // The live broadcast limit counts each line asked for, as each is also spoken
      const plans = linePlans(decision);
      limit = await aiRateLimit(input.request, 'raceAnnouncer', user, plans.length);
      if (limit.response) return { kind: 'refused', response: limit.response };
      // The driver's tires only now and then (tireMentionAllowed), or the announcers mention them in every line
      const tireKind = found.context.tire && found.context.tire.kind !== 'unknown' ? found.context.tire.kind : (found.context.tire?.name ?? null);
      tires = tireMentionAllowed(channel.director, decision, tireKind, isWetSession(found.context.weather, found.context.tire), now) ? tireKind : null;
      const built = buildRequest(decision, found.context, tracker, settings.broadcast, channel, namePronunciation, user.units, tires);
      const started = Date.now();
      let result: Awaited<ReturnType<typeof raceAnnouncerLines>>;
      try {
        result = await limit.track(() =>
          withTimeout(
            raceAnnouncerLines({
              request: built.request,
              plans,
              facts: built.facts,
              instructions: settings.instructions,
              language: user.preferredLanguage,
              // the critical and major moments get the main model, the rest the cheaper one
              feature: decision.selected.priority <= 1 ? 'raceAnnouncer' : 'raceAnnouncerRoutine',
            }),
            AI_TIMEOUT_MS
          )
        );
      } catch (error) {
        recordFailure('llm');
        throw error;
      }
      llmMs = Date.now() - started;
      commitAiCall(channel.director, Date.now());
      for (const d of result.dropped) {
        recordDroppedLine(d.reason.split(':')[0]);
        console.warn(`Race Broadcast dropped a ${d.speaker} line (${d.reason}): ${d.text}`);
      }
      if (result.lines.length === 0) {
        recordNote(user.id, driverId, 'every line failed the factual check', diagnostics);
        return done();
      }
      written = result.lines;
    }

    const segment: Segment = {
      id: channel.nextId++,
      at: Date.now(),
      expiresAt: decision.expiresAt,
      priority: decision.selected.priority,
      replaceQueued: decision.replaceQueued,
      lines: written,
      pronunciations,
      audio: new Map(),
    };
    const speechStarted = Date.now();
    const audio = await speak(segment, voices);
    const speechMs = Date.now() - speechStarted;
    const firstMissing = audio.findIndex((a) => a === null);
    const usable = firstMissing < 0 ? written.length : firstMissing;
    if (usable === 0) {
      if (plan === 'fixed') await limit.refund();
      return done();
    }
    if (Date.now() > decision.expiresAt) {
      recordStale();
      recordNote(user.id, driverId, 'expired before the audio was ready', diagnostics);
      return done();
    }
    segment.lines = written.slice(0, usable);
    segment.audio.set(audioKey(voices), Promise.resolve(audio.slice(0, usable)));
    const audioMs = segment.lines.reduce((sum, l, i) => sum + durationOf(audio[i]!, l.text, voices.format), 0);
    if (tires) commitTireMention(channel.director, tires, Date.now());
    commitDecision(channel.director, decision, Date.now(), audioMs + 400 * segment.lines.length, decision.format, ctx.userIdx);
    channel.recent = [...channel.recent, ...segment.lines.map((l) => ({ speaker: l.speaker, text: l.text }))].slice(-RECENT_LINES);
    channel.segments.push(segment);
    recordRoute(plan === 'fixed' ? 'fixed' : 'ai');
    recordSpoken({
      viewerId: user.id,
      driverId,
      announced: { seq: decision.selected.seq, type: decision.selected.event.type, priority: decision.selected.priority, intensity: decision.intensity, format: decision.format },
      lines: segment.lines.map((l) => ({ speaker: l.speaker, text: l.text, intensity: l.intensity })),
      diagnostics,
      llmMs,
      speechMs,
      eventAgeMs: Date.now() - decision.selected.at,
    });
    return done(segment);
  } catch (error) {
    await limit?.refund();
    // these events are done with, so a failing AI isn't asked about them again by every viewer's next request
    done();
    throw error;
  }
}

// How the broadcast names drivers: the listener's driver as the field knows them (their iRacing name), and the others
// by name, or with Announce driver names off by car number (carNumber, the language's "car number {n}")
function announcedNames(context: RaceEventContext, tracker: BroadcastTracker, settings: BroadcastSettings, carNumber: string): { driver: string; name: NameFor } {
  const roster = tracker.roster();
  const driver = roster.find((r) => r.idx === tracker.userIdx)?.driver ?? context.driver;
  const numbers = new Map(roster.map((r) => [r.driver, r.number]));
  return {
    driver,
    name: (n) => {
      if (settings.announceNames || n === driver || n === context.driver) return n;
      const number = numbers.get(n);
      return number ? fmt(carNumber, { n: number }) : n;
    },
  };
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

const SKY_WORDS = {
  clear: 'clear skies',
  partlyCloudy: 'partly cloudy',
  mostlyCloudy: 'mostly cloudy',
  overcast: 'overcast',
  drizzle: 'drizzle',
  rain: 'rain',
  heavyRain: 'heavy rain',
} as const;
// iRacing's TrackWetness, 1 dry to 7 extremely wet
const WETNESS_WORDS = ['', 'dry', 'mostly dry', 'very lightly wet', 'lightly wet', 'moderately wet', 'very wet', 'extremely wet'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const TIRE_WORDS: Record<FittedTire['kind'], string> = {
  soft: 'soft compound slicks',
  medium: 'medium compound slicks',
  hard: 'hard compound slicks',
  dry: 'dry tires (slicks)',
  intermediate: 'intermediate tires',
  wet: 'wet weather tires',
  unknown: '',
};

// The weather as the announcers get it, in the listener's units and in words (as they say every number aloud), with
// the outlook (src/lib/liveWeather.ts: projected from the conditions' trend, as iRacing shares no forecast); null
// without readings
export function weatherFacts(context: Pick<RaceEventContext, 'weather' | 'weatherTrend'>, units: Units) {
  const w = context.weather;
  if (!w) return null;
  const temperature = (c: number) => `${Math.round(temperatureFromCelsius(c, units))} degrees ${units === 'metric' ? 'Celsius' : 'Fahrenheit'}`;
  const speed = (ms: number) => `${Math.round(speedFromMetersPerSecond(ms, units))} ${units === 'metric' ? 'kilometers' : 'miles'} per hour`;
  const sky = skyCondition(w);
  const dir = w.windDir != null ? COMPASS[Math.round(((((w.windDir * 180) / Math.PI) % 360) + 360) % 360 / 45) % 8] : null;
  const outlookWords = (item: OutlookItem): string => {
    switch (item.kind) {
      case 'static':
        return 'static weather: no change in the conditions this session';
      case 'gathering':
        return 'not known yet (too few minutes of readings to see a trend)';
      case 'steady':
        return 'conditions holding steady';
      case 'rainComing':
        return 'rain looks to be on the way';
      case 'rainHeavier':
        return 'the rain looks set to get heavier';
      case 'rainEasing':
        return 'the rain looks to be easing';
      case 'rainStopping':
        return 'the rain looks set to stop';
      case 'cloudsBuilding':
        return 'clouds building';
      case 'clearing':
        return 'skies clearing';
      case 'trackWetter':
        return 'the track getting wetter';
      case 'trackDrying':
        return 'the track drying';
      case 'trackTemp':
      case 'airTemp':
        return `${item.kind === 'trackTemp' ? 'track' : 'air'} temperature ${item.rising ? 'rising' : 'falling'} to about ${temperature(item.projected)}`;
    }
  };
  return {
    conditions: sky ? SKY_WORDS[sky] : null,
    night: isNight(w) || undefined,
    airTemperature: w.airTemp != null ? temperature(w.airTemp) : null,
    trackTemperature: w.trackTemp != null ? temperature(w.trackTemp) : null,
    humidityPercent: w.humidity != null ? Math.round(w.humidity * 100) : null,
    wind: w.windSpeed != null ? `${speed(w.windSpeed)}${dir ? ` from the ${dir}` : ''}` : null,
    rainIntensityPercent: w.precipitation != null && (w.precipitation > 0 || !isStaticWeather(w.type)) ? Math.round(w.precipitation * 100) : null,
    trackSurface: w.wetness != null && w.wetness > 0 ? WETNESS_WORDS[w.wetness] ?? null : null,
    declaredWet: w.declaredWet || undefined,
    [`outlookNext${OUTLOOK_MINUTES}Minutes`]: weatherOutlook(w, context.weatherTrend).map(outlookWords),
  };
}

// The structured request for the RaceAnnouncer agent, and the facts its lines are checked against
function buildRequest(
  decision: Decision,
  context: RaceEventContext,
  tracker: BroadcastTracker,
  settings: BroadcastSettings,
  listener: Pick<Channel, 'director' | 'recent'>,
  namePronunciation: string,
  units: Units,
  // the driver's tire compound (a TIRE_WORDS key or iRacing's name) when the announcers may mention it now, else null
  tires: string | null
): { request: Record<string, unknown>; facts: LineFacts; pronunciations: Pronunciation[] } {
  const roster = tracker.roster();
  // the driver as the field knows them (their iRacing name), and their RacingCoach.app name too; the AI is given
  // "car number {n}" in English and says it in the listener's language
  const { driver, name } = announcedNames(context, tracker, settings, 'car number {n}');
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
      weather: weatherFacts(context, units),
    },
    listenersDriver: {
      name: driver,
      alsoKnownAs: context.driver !== driver ? context.driver : undefined,
      namePronunciation: namePronunciation || undefined,
      car: spokenCarName(context.car),
      position: context.position,
      carClass: userStats?.carClass ?? null,
      incidentPoints: context.incidents,
      tires: tires ? (TIRE_WORDS[tires as FittedTire['kind']] ?? tires) : undefined,
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
    avoidOpenings: [...new Set(listener.recent.map((l) => l.text.split(/\s+/).slice(0, 3).join(' ')))],
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
    pronunciations: namePronunciations([driver, context.driver], namePronunciation),
  };
}
