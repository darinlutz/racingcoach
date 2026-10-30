import { randomUUID } from 'node:crypto';
import { CATEGORY_FACTS } from './broadcastVideoCategories';
import { lineVolume } from './broadcastSettings';
import { lastNameOf } from './broadcastValidation';
import { getDirectorSettings, readPlayableVideos, readRecentlyPlayed, readVideoStorageKey } from './broadcastVideos';
import { getCoachVoice, speaksElevenLabs, synthesizeSpeech, type CoachVoice, type SpanishAccent } from './coachVoice';
import { query } from './db';
import { getDictionary } from './i18n/server';
import type { Language } from './i18n/languages';
import { readDirectorFeed } from './liveRacing';
import { videoObjectSize, videoStorageConfigured } from './objectStorage';
import { ANNOUNCER_ROLES, getRaceAnnouncerSettings, raceAnnouncerLines, type Announcer, type LinePlan } from './raceAnnouncer';
import { getEnableAiFeatures } from './siteSettings';
import type { User } from './users';
import {
  clipSelected,
  clipValidated,
  commentaryHeld,
  DEFAULT_DIRECTOR_SETTINGS,
  directorTick,
  endSession,
  linesPrepared,
  mp3DurationMs,
  newDirector,
  nextClipDueAt,
  requestClip,
  restoreDirector,
  returnToLive,
  RECENT_VIDEOS,
  selectVideo,
  skipNext,
  videoFailed,
  type DirectorEffect,
  type DirectorSettings,
  type DirectorSnapshot,
  type DirectorState,
  type DirectorTrigger,
  type DirectorVideo,
  type LineTiming,
  type PreparedLine,
  type RaceConditions,
  type ScheduledLine,
  type SelectionRequest,
} from './videoDirector';
import { raceConditions } from './videoDirectorConditions';

// The Broadcast Director at work (the rules are in src/lib/videoDirector.ts): one per race session being watched on a
// TV, in this server's memory like the live positions (one web instance, docs/tv-broadcast.md), ticked a few times a
// second while anyone is watching. Each TV's picture of the race (src/lib/tvBroadcast.ts) carries its snapshot, so all
// of them see the same clip at the same time. Every state is also written to "BroadcastDirectorEvents", which is how a
// clip on screen survives a restart.
//
// The announcers' lines are written once per language and voiced once per voice in use among the viewers; the sequence
// waits for the longest, so the timeline comes from the audio prepared on the server and no viewer's player can hold it
// up. They're AI-written for that clip from its metadata, checked like all commentary, with fixed wording to fall back on.

const TICK_MS = 250;
// A viewer not heard from for this long has left; a session with none for this long ends
const VIEWER_GONE_MS = 20_000;
// Each viewer's voices are read again this often
const VOICES_MAX_AGE_MS = 60_000;
const SPEECH_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 8000;
// Audio outlives its sequence a little, for viewers still fetching it
const AUDIO_KEPT_MS = 2 * 60_000;
// Voicing more than this many different voices per clip isn't worth the cost: the rest hear the words on screen only
const MAX_VOICES = 6;
const MIN_CLIP_FOR_COMMENTARY_MS = 5000;
// A session's saved state is picked up after a restart if it's this recent
const RECENT_RESTORE_MS = 15 * 60_000;

type Voices = { language: Language; accent: SpanishAccent; lead: CoachVoice; color: CoachVoice };
type Viewer = {
  userId: number;
  driverId: number;
  lastSeen: number;
  voices: Voices | null;
  voicesAt: number;
  // Their Race Broadcast preferences: their announcer volumes, and Broadcast Mode off
  volumes: Record<Announcer, number>;
  announcersOff: boolean;
};
type LineVoicing = { text: string; audioId: string | null; elevenLabs: boolean };

type Session = {
  key: string;
  label: string;
  state: DirectorState;
  driverId: number;
  trackKey: string | null;
  viewers: Map<number, Viewer>;
  // Each line's words and audio, by line ID and voices
  voicing: Map<string, Map<string, LineVoicing>>;
  announcersBusyUntil: number;
  // Who reported the clip on screen failed
  failedViewers: Set<number>;
  historyId: Promise<number | null> | null;
  introText: string | null;
  // The database writes, in order
  writes: Promise<unknown>;
  // The clip picked, with the metadata the announcers get
  selected: DirectorVideo | null;
  // When the current clip's sequence started: only what happens after that can bring the broadcast back to the race
  sequenceSince: number | null;
};

const store = globalThis as unknown as {
  videoDirector?: {
    sessions: Map<string, Session>;
    loading: Map<string, Promise<Session | null>>;
    audio: Map<string, { bytes: Buffer; expiresAt: number }>;
    timer: ReturnType<typeof setInterval> | null;
    settings: DirectorSettings | null;
    ticking: boolean;
  };
};
const runtime = (store.videoDirector ??= { sessions: new Map(), loading: new Map(), audio: new Map(), timer: null, settings: null, ticking: false });

const voicesKey = (v: Voices) => [v.language, v.accent, v.lead, v.color].join('|');

function ensureTimer() {
  if (runtime.timer) return;
  runtime.timer = setInterval(() => {
    tickAll().catch((error) => console.error('Broadcast Director tick error:', error));
  }, TICK_MS);
  runtime.timer.unref();
}

async function refreshSettings(): Promise<DirectorSettings> {
  const settings = await getDirectorSettings();
  runtime.settings = settings;
  return settings;
}

function log(session: Session, message: string): void {
  console.log(`Broadcast Director [${session.key}] ${message}`);
}

function persist(session: Session): void {
  const s = session.state;
  const snapshot = { ...s };
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
  session.writes = session.writes
    .then(() =>
      query(
        `INSERT INTO racingcoach."BroadcastDirectorEvents" (session_key, seq, event_id, phase, source, video_id, category, transition_at, return_at, live_at, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [
          snapshot.sessionKey,
          snapshot.seq,
          snapshot.eventId,
          snapshot.phase,
          sourceOf(snapshot),
          snapshot.clip?.videoId ?? null,
          snapshot.clip?.category ?? null,
          iso(snapshot.transitionAt),
          iso(snapshot.returnAt),
          iso(snapshot.liveAt),
          JSON.stringify(snapshot),
        ]
      )
    )
    .catch((error) => console.error('Broadcast Director event write error:', error));
}

const sourceOf = (s: Pick<DirectorState, 'phase'>) => (s.phase === 'TRANSITION_TO_VIDEO' || s.phase === 'VIDEO_PLAYING' ? 'RECORDED_VIDEO' : 'LIVE_TRACK_MAP');

function historyUpdate(session: Session, sql: string, params: unknown[]): void {
  const id = session.historyId;
  if (!id) return;
  session.writes = session.writes
    .then(async () => {
      const rowId = await id;
      if (rowId != null) await query(sql, [rowId, ...params]);
    })
    .catch((error) => console.error('Broadcast Director history write error:', error));
}

async function pickVideo(session: Session, request: SelectionRequest, trigger: DirectorTrigger, settings: DirectorSettings): Promise<void> {
  let video: DirectorVideo | null = null;
  try {
    const feed = readDirectorFeed(session.driverId);
    video = selectVideo(await readPlayableVideos(), request, {
      settings,
      trackKey: session.trackKey,
      cars: feed?.cars ?? [],
      recentVideoIds: session.state.recentVideoIds,
      recentCategories: session.state.recentCategories,
    });
  } catch (error) {
    console.error('Broadcast Director selection error:', error);
  }
  const now = Date.now();
  if (video) log(session, `selected video ${video.id} (${video.category}, ${trigger})`);
  session.introText = null;
  session.failedViewers = new Set();
  if (video) {
    const chosen = video;
    session.historyId = query<{ id: string }>(
      `INSERT INTO racingcoach."BroadcastVideoHistory" (session_key, video_id, category, title, trigger) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [session.key, chosen.id, chosen.category, chosen.title, trigger]
    )
      .then((rows) => Number(rows[0].id))
      .catch((error) => {
        console.error('Broadcast Director history insert error:', error);
        return null;
      });
    session.selected = chosen;
  }
  run(session, clipSelected(session.state, video, trigger, settings, now), settings);
}

async function validate(session: Session, videoId: number, settings: DirectorSettings): Promise<void> {
  const clip = session.state.clip;
  let ok = false;
  try {
    const key = await readVideoStorageKey(videoId);
    ok = !!key && (await videoObjectSize(key)) !== null;
  } catch (error) {
    console.error('Broadcast Director file check error:', error);
  }
  if (!ok) log(session, `video ${videoId} failed its file check`);
  // Cancelled while it was being checked
  if (session.state.clip !== clip) return;
  run(session, clipValidated(session.state, ok, Date.now()), settings);
}

// Writes and voices the sequence's lines, then tells the Director how long they run
async function prepare(session: Session, settings: DirectorSettings): Promise<void> {
  const clip = session.state.clip;
  let prepared: PreparedLine[] | null = null;
  try {
    prepared = await prepareLines(session, settings);
  } catch (error) {
    console.error('Broadcast Director line preparation error:', error);
  }
  // Cancelled while it was being prepared: a later clip has its own lines
  if (session.state.clip !== clip) return;
  linesPrepared(session.state, prepared);
  if (prepared?.length) log(session, `prepared ${prepared.length} line(s)`);
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

// The facts about a clip, for the announcers: its own metadata only
export function clipFacts(video: DirectorVideo, secondsLong: number) {
  return {
    whatItIs: CATEGORY_FACTS[video.category],
    title: video.title,
    description: video.description || undefined,
    track: video.track ?? undefined,
    car: video.car ?? undefined,
    cameraPerspective: video.cameraPerspective || undefined,
    fromSession: video.sessionInfo || undefined,
    producerNotes: video.commentaryContext || undefined,
    secondsLong: Math.round(secondsLong),
    isRecordedNotLive: true,
  };
}

type Slot = { when: LineTiming; speaker: Announcer; maxSeconds: number; job: string; intensity: number };

// The lines of this clip's sequence: the Lead's introduction, the Color Announcer's during it when it's long enough and
// the Admin page allows it, and the Lead's handing back to the live race
export function plannedSlots(video: DirectorVideo, clipMs: number, settings: DirectorSettings): Slot[] {
  const slots: Slot[] = [
    {
      when: 'intro',
      speaker: 'lead',
      maxSeconds: 6,
      intensity: 2,
      job: 'In one short sentence, tell the viewers we are going to this recorded clip, saying what kind of camera or footage it is. Vary the wording from the recent commentary. Do not say what it shows beyond the facts, and never suggest it is live or from this race.',
    },
  ];
  if (settings.commentaryDuringVideo && clipMs >= MIN_CLIP_FOR_COMMENTARY_MS) {
    slots.push({
      when: 'during',
      speaker: 'color',
      maxSeconds: Math.max((clipMs - 2000) / 1000, 2),
      intensity: 1,
      job: 'While the clip plays, add one short remark from the clip\'s facts, or a general point about what this camera or perspective shows a viewer. You cannot see the video: never describe specific events, drivers, passes or crashes in it unless the facts state them.',
    });
  }
  if (settings.postVideoCommentary) {
    slots.push({ when: 'after', speaker: 'lead', maxSeconds: 3, intensity: 2, job: 'In a few words, hand back to the live race now the clip is over.' });
  }
  return slots;
}

async function writeLines(video: DirectorVideo, slots: Slot[], language: Language, session: Session, clipMs: number): Promise<Map<LineTiming, { text: string; spoken: string }>> {
  const out = new Map<LineTiming, { text: string; spoken: string }>();
  const feed = readDirectorFeed(session.driverId);
  const facts = clipFacts(video, clipMs / 1000);
  const fieldNames = feed?.fieldNames ?? [];
  const metadata = [video.title, video.description, video.sessionInfo, video.commentaryContext].join(' ');
  const numbers: number[] = [];
  const decimals: string[] = [];
  for (const value of Object.values(facts)) {
    if (typeof value === 'number') numbers.push(value);
    if (typeof value !== 'string') continue;
    for (const m of value.matchAll(/\d+(?:[.:]\d+)*/g)) {
      if (/[.:]/.test(m[0])) decimals.push(m[0]);
      else numbers.push(Number(m[0]));
    }
  }
  try {
    const plans: LinePlan[] = slots.map((s) => ({ speaker: s.speaker, intensity: s.intensity, maxSeconds: s.maxSeconds, job: s.job }));
    const { lines } = await withTimeout(
      raceAnnouncerLines({
        request: {
          event: { what: 'The producer is showing a recorded clip between moments of the live race. The lines are about the clip, not about race action.' },
          recordedClip: facts,
          session: { track: feed?.track ?? null },
        },
        plans,
        // Drivers in this session may not be named, as the clip isn't from it, unless its metadata names them
        facts: { allowedNames: fieldNames.filter((n) => metadata.includes(lastNameOf(n))), fieldNames, allowedNumbers: numbers, allowedDecimals: decimals },
        instructions: '',
        language,
      }),
      WRITE_TIMEOUT_MS
    );
    lines.forEach((line, i) => out.set(slots[i].when, { text: line.text, spoken: line.spoken }));
  } catch (error) {
    console.error('Broadcast Director AI lines error:', error);
  }
  // Fixed wording for the introduction and the hand back; a remark during the clip is left out without the AI
  const t = getDictionary(language).tv.director;
  const pick = (options: readonly string[]) => options[Math.floor(Math.random() * options.length)];
  if (!out.has('intro')) {
    const text = pick(t.intros[video.category]);
    out.set('intro', { text, spoken: text });
  }
  if (!out.has('after') && slots.some((s) => s.when === 'after')) {
    const text = pick(t.backToLive);
    out.set('after', { text, spoken: text });
  }
  return out;
}

async function prepareLines(session: Session, settings: DirectorSettings): Promise<PreparedLine[] | null> {
  const video = session.selected;
  const clip = session.state.clip;
  if (!video || !clip) return null;
  if (!(await getEnableAiFeatures())) return null;
  const viewers = [...session.viewers.values()].filter((v) => v.voices);
  if (viewers.length === 0) return null;
  const distinct = new Map<string, Voices>();
  for (const v of viewers) if (distinct.size < MAX_VOICES) distinct.set(voicesKey(v.voices!), v.voices!);
  const languages = [...new Set([...distinct.values()].map((v) => v.language))];
  const slots = plannedSlots(video, clip.durationMs, settings);

  const written = new Map(
    await Promise.all(languages.map(async (language) => [language, await writeLines(video, slots, language, session, clip.durationMs)] as const))
  );
  const prepared: PreparedLine[] = [];
  const voicing = new Map<string, Map<string, LineVoicing>>();
  for (const slot of slots) {
    const id = randomUUID();
    const perVoice = new Map<string, LineVoicing>();
    let longest = 0;
    await Promise.all(
      [...distinct.entries()].map(async ([key, voices]) => {
        const line = written.get(voices.language)?.get(slot.when);
        if (!line) return;
        try {
          const bytes = await withTimeout(
            synthesizeSpeech(line.spoken, slot.speaker === 'lead' ? voices.lead : voices.color, voices.language, voices.accent, ANNOUNCER_ROLES[slot.speaker], 'mp3', slot.intensity),
            SPEECH_TIMEOUT_MS
          );
          const ms = mp3DurationMs(bytes);
          if (!ms) throw new Error('speech was not an MP3');
          const audioId = randomUUID();
          runtime.audio.set(audioId, { bytes, expiresAt: Date.now() + AUDIO_KEPT_MS + clip.durationMs });
          const voice = slot.speaker === 'lead' ? voices.lead : voices.color;
          perVoice.set(key, { text: line.text, audioId, elevenLabs: speaksElevenLabs(voice, ANNOUNCER_ROLES[slot.speaker], voices.language, voices.accent) });
          longest = Math.max(longest, ms);
        } catch (error) {
          console.error('Broadcast Director speech error:', error);
          // This viewer has the words on screen, without the sound
          perVoice.set(key, { text: line.text, audioId: null, elevenLabs: false });
        }
      })
    );
    // Nobody could be given this line
    if (longest === 0) continue;
    voicing.set(id, perVoice);
    prepared.push({ id, when: slot.when, speaker: slot.speaker, durationMs: longest });
    if (slot.when === 'intro') session.introText = written.get(languages[0])?.get('intro')?.text ?? null;
  }
  if (session.state.clip !== clip) return null;
  session.voicing = voicing;
  if (session.introText) historyUpdate(session, 'UPDATE racingcoach."BroadcastVideoHistory" SET introduction_text = $2 WHERE id = $1', [session.introText]);
  return prepared;
}

function run(session: Session, effects: DirectorEffect[], settings: DirectorSettings): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'persist':
        persist(session);
        break;
      case 'select':
        void pickVideo(session, effect.request, effect.trigger, settings);
        break;
      case 'validate':
        void validate(session, effect.videoId, settings);
        break;
      case 'prepare':
        void prepare(session, settings);
        break;
      case 'playbackStarted':
        log(session, `playing video ${session.state.clip?.videoId}`);
        historyUpdate(session, `UPDATE racingcoach."BroadcastVideoHistory" SET status = 'playing', started_at = now() WHERE id = $1`, []);
        break;
      case 'finished':
        log(session, `clip ${effect.status}${effect.reason ? ` (${effect.reason})` : ''}`);
        historyUpdate(session, `UPDATE racingcoach."BroadcastVideoHistory" SET status = $2, failure_reason = $3, ended_at = now() WHERE id = $1`, [effect.status, effect.reason]);
        session.historyId = null;
        break;
    }
  }
}

function conditions(session: Session, now: number): RaceConditions {
  const feed = readDirectorFeed(session.driverId);
  session.sequenceSince = session.state.clip ? (session.sequenceSince ?? now) : null;
  // The followed driver went away: no new clip until there's a race to read again
  if (!feed) return { level: 1, blocked: true, critical: false };
  return raceConditions(feed.events, feed.context, now, session.sequenceSince);
}

async function tickAll(): Promise<void> {
  if (runtime.ticking) return;
  runtime.ticking = true;
  try {
    const now = Date.now();
    // The schedule is already with the viewers: a database hiccup mustn't stop the clock
    const settings = await refreshSettings().catch(() => runtime.settings ?? DEFAULT_DIRECTOR_SETTINGS);
    for (const [key, session] of runtime.sessions) {
      for (const [id, viewer] of session.viewers) if (now - viewer.lastSeen > VIEWER_GONE_MS) session.viewers.delete(id);
      if (session.viewers.size === 0) {
        run(session, endSession(session.state, now), settings);
        log(session, 'ended: no viewers');
        runtime.sessions.delete(key);
        continue;
      }
      run(session, directorTick(session.state, { now, settings, race: conditions(session, now), announcersBusyUntil: session.announcersBusyUntil }), settings);
    }
    for (const [id, audio] of runtime.audio) if (now > audio.expiresAt) runtime.audio.delete(id);
    if (runtime.sessions.size === 0 && runtime.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
  } finally {
    runtime.ticking = false;
  }
}

// A new session, or the one a restarted server was running
async function openSession(key: string, label: string, driverId: number, trackKey: string | null): Promise<Session | null> {
  const now = Date.now();
  let state = newDirector(key, now);
  let historyId: Promise<number | null> | null = null;
  try {
    const recent = await readRecentlyPlayed(RECENT_VIDEOS);
    state.recentVideoIds = recent.map((r) => r.videoId);
    state.recentCategories = recent.map((r) => r.category).slice(-2);
    const [saved] = await query<{ state: DirectorState; created_at: Date }>(
      'SELECT state, created_at FROM racingcoach."BroadcastDirectorEvents" WHERE session_key = $1 ORDER BY seq DESC LIMIT 1',
      [key]
    );
    if (saved && now - saved.created_at.getTime() < RECENT_RESTORE_MS) {
      const restored = restoreDirector(saved.state, now);
      state = restored.state;
      state.recentVideoIds = [...new Set([...recent.map((r) => r.videoId), ...state.recentVideoIds])].slice(-RECENT_VIDEOS);
      if (restored.lost) {
        await query(
          `UPDATE racingcoach."BroadcastVideoHistory" SET status = 'failed', failure_reason = 'serverRestarted', ended_at = now() WHERE session_key = $1 AND ended_at IS NULL`,
          [key]
        );
      }
      else if (state.clip) {
        const [unfinished] = await query<{ id: string }>(
          'SELECT id FROM racingcoach."BroadcastVideoHistory" WHERE session_key = $1 AND ended_at IS NULL ORDER BY selected_at DESC LIMIT 1',
          [key]
        );
        if (unfinished) historyId = Promise.resolve(Number(unfinished.id));
      }
      console.log(`Broadcast Director [${key}] picked up after a restart in ${state.phase}`);
    }
  } catch (error) {
    console.error('Broadcast Director restore error:', error);
  }
  const session: Session = {
    key,
    label,
    state,
    driverId,
    trackKey,
    viewers: new Map(),
    voicing: new Map(),
    announcersBusyUntil: 0,
    failedViewers: new Set(),
    historyId,
    introText: null,
    writes: Promise.resolve(),
    selected: null,
    sequenceSince: null,
  };
  runtime.sessions.set(key, session);
  persist(session);
  ensureTimer();
  return session;
}

async function loadVoices(viewer: Viewer, user: Pick<User, 'id' | 'preferredLanguage'>): Promise<void> {
  viewer.voicesAt = Date.now();
  try {
    const [announcers, coach] = await Promise.all([getRaceAnnouncerSettings(user.id), getCoachVoice(user.id)]);
    viewer.voices = { language: user.preferredLanguage, accent: coach.spanishAccent, lead: announcers.leadVoice, color: announcers.colorVoice };
    viewer.volumes = { lead: lineVolume(announcers.broadcast, 'lead'), color: lineVolume(announcers.broadcast, 'color') };
    viewer.announcersOff = announcers.broadcast.mode === 'off';
  } catch (error) {
    console.error('Broadcast Director voices error:', error);
  }
}

function snapshotFor(session: Session, viewer: Viewer | null): DirectorSnapshot {
  const s = session.state;
  const now = Date.now();
  const myVoices = viewer?.voices ? voicesKey(viewer.voices) : null;
  return {
    sessionKey: s.sessionKey,
    eventId: s.eventId,
    seq: s.seq,
    phase: s.phase,
    source: sourceOf(s),
    hold: commentaryHeld(s, now),
    clip: s.clip ? { ...s.clip, url: `/api/broadcast-videos/${s.clip.videoId}/media` } : null,
    transitionMs: s.transitionMs,
    transitionAt: s.transitionAt,
    playbackStartAt: s.transitionAt,
    returnAt: s.returnAt,
    liveAt: s.liveAt,
    lines: s.lines.map((line) => {
      const perVoice = session.voicing.get(line.id);
      // A viewer who joined after the lines were voiced gets the same language's, if any
      const sameLanguage = viewer?.voices ? [...(perVoice?.entries() ?? [])].find(([key]) => key.startsWith(`${viewer.voices!.language}|`))?.[1] : undefined;
      const voiced = (myVoices ? perVoice?.get(myVoices) : undefined) ?? sameLanguage;
      return {
        id: line.id,
        when: line.when,
        speaker: line.speaker,
        at: line.at,
        durationMs: line.durationMs,
        text: voiced?.text ?? '',
        audioUrl: voiced?.audioId && !viewer?.announcersOff ? `/api/tv/director/audio/${voiced.audioId}` : null,
        volume: viewer?.volumes[line.speaker] ?? 1,
        elevenLabs: voiced?.elevenLabs ?? false,
      };
    }),
  };
}

// The key of the session a TV is following: iRacing's subsession when it has one, else (offline, practice alone) that
// driver's own
export function directorSessionKey(sessionKey: string, driverId: number, subSessionId: number | null | undefined): string {
  return subSessionId && subSessionId > 0 ? sessionKey : `u${driverId}|${sessionKey}`;
}

// A TV's picture of the race asks for this each time: counts the TV as watching, and answers what it should show, or
// null when there's nothing for the Director to do (clips off, storage not set up)
export async function observeDirector(
  viewer: Pick<User, 'id' | 'preferredLanguage'>,
  session: { key: string; label: string; driverId: number; trackKey: string | null; offline: boolean }
): Promise<DirectorSnapshot | null> {
  if (session.offline) return null;
  let found = runtime.sessions.get(session.key);
  if (!found) {
    const settings = await getDirectorSettings();
    if (!settings.videosEnabled || !videoStorageConfigured()) return null;
    let loading = runtime.loading.get(session.key);
    if (!loading) {
      loading = openSession(session.key, session.label, session.driverId, session.trackKey).finally(() => runtime.loading.delete(session.key));
      runtime.loading.set(session.key, loading);
    }
    found = (await loading) ?? undefined;
    if (!found) return null;
  }
  const now = Date.now();
  let entry = found.viewers.get(viewer.id);
  if (!entry) {
    entry = { userId: viewer.id, driverId: session.driverId, lastSeen: now, voices: null, voicesAt: 0, volumes: { lead: 1, color: 1 }, announcersOff: false };
    found.viewers.set(viewer.id, entry);
  }
  entry.lastSeen = now;
  entry.driverId = session.driverId;
  found.driverId = session.driverId;
  found.trackKey = session.trackKey;
  if (now - entry.voicesAt > VOICES_MAX_AGE_MS) await loadVoices(entry, viewer);
  return snapshotFor(found, entry);
}

function sessionOfViewer(userId: number): Session | null {
  for (const session of runtime.sessions.values()) if (session.viewers.has(userId)) return session;
  return null;
}

// Whether the TV's own commentary waits right now, because a clip's sequence is under way (POST /api/tv/announcer)
export function commentaryHeldFor(userId: number): boolean {
  const session = sessionOfViewer(userId);
  return !!session && commentaryHeld(session.state, Date.now());
}

// The commentary this TV was just sent runs this long: no clip's introduction starts over it
export function noteCommentaryPlaying(userId: number, ms: number): void {
  const session = sessionOfViewer(userId);
  if (session) session.announcersBusyUntil = Math.max(session.announcersBusyUntil, Date.now()) + ms;
}

export function readDirectorAudio(id: string): Buffer | null {
  return runtime.audio.get(id)?.bytes ?? null;
}

// A TV's player gave up on the clip. The TV has already gone back to its map; the broadcast does once every TV has
export function reportClipFailed(userId: number, eventSeq: number, videoId: number): boolean {
  const session = sessionOfViewer(userId);
  const clip = session?.state.clip;
  if (!session || !clip || clip.videoId !== videoId) return false;
  session.failedViewers.add(userId);
  log(session, `viewer ${userId} couldn't play video ${videoId} (at ${eventSeq}); ${session.failedViewers.size} of ${session.viewers.size}`);
  if (session.failedViewers.size >= session.viewers.size) {
    run(session, videoFailed(session.state, Date.now()), runtime.settings ?? DEFAULT_DIRECTOR_SETTINGS);
  }
  return true;
}

export const directorViewerCount = () => [...runtime.sessions.values()].reduce((sum, s) => sum + s.viewers.size, 0);

// The Admin page

export type DirectorDashboardSession = {
  key: string;
  label: string;
  phase: DirectorState['phase'];
  source: string;
  seq: number;
  viewers: number;
  clip: { videoId: number; category: string; title: string; durationMs: number } | null;
  trigger: DirectorTrigger;
  lines: { when: LineTiming; speaker: Announcer; at: number; durationMs: number }[];
  announcersBusyMs: number;
  commentaryHeld: boolean;
  nextEligibleMs: number | null;
  raceLevel: number;
  raceBlocked: boolean;
  transitionAt: number | null;
  returnAt: number | null;
  serverNow: number;
};

export function directorSessions(): DirectorDashboardSession[] {
  const now = Date.now();
  const settings = runtime.settings;
  return [...runtime.sessions.values()].map((session) => {
    const s = session.state;
    const race = conditions(session, now);
    return {
      key: session.key,
      label: session.label,
      phase: s.phase,
      source: sourceOf(s),
      seq: s.seq,
      viewers: session.viewers.size,
      clip: s.clip ? { videoId: s.clip.videoId, category: s.clip.category, title: s.clip.title, durationMs: s.clip.durationMs } : null,
      trigger: s.trigger,
      lines: s.lines.map((l: ScheduledLine) => ({ when: l.when, speaker: l.speaker, at: l.at, durationMs: l.durationMs })),
      announcersBusyMs: Math.max(session.announcersBusyUntil - now, 0),
      commentaryHeld: commentaryHeld(s, now),
      nextEligibleMs: settings?.videosEnabled && settings.autoDirector ? Math.max(Math.max(nextClipDueAt(s, settings, race.level), s.nextCheckAt) - now, 0) : null,
      raceLevel: race.level,
      raceBlocked: race.blocked,
      transitionAt: s.transitionAt,
      returnAt: s.returnAt,
      serverNow: now,
    };
  });
}

export type DirectorCommand =
  | { action: 'play'; sessionKey: string; category?: DirectorVideo['category'] | null; videoId?: number | null }
  | { action: 'returnToLive'; sessionKey: string }
  | { action: 'skip'; sessionKey: string };

export type CommandResult = 'ok' | 'noSession' | 'busy' | 'nothingToSkip';

export async function directorCommand(command: DirectorCommand): Promise<CommandResult> {
  const session = runtime.sessions.get(command.sessionKey);
  if (!session) return 'noSession';
  const settings = await refreshSettings();
  const now = Date.now();
  switch (command.action) {
    case 'play':
      return requestClip(session.state, { category: command.category ?? null, videoId: command.videoId ?? null }) ? 'ok' : 'busy';
    case 'returnToLive':
      run(session, returnToLive(session.state, now), settings);
      return 'ok';
    case 'skip': {
      const effects = skipNext(session.state, now);
      run(session, effects, settings);
      return effects.length > 0 ? 'ok' : 'nothingToSkip';
    }
  }
}
