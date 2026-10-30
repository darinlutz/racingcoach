import type { VideoCategory } from './broadcastVideoCategories';

// The Broadcast Director's rules (docs/broadcast-director.md): what TV Broadcast Mode shows, the live track map or a
// prerecorded clip, and when. Not to be confused with the Commentary Director (src/lib/broadcastDirector.ts), which picks
// what each listener's announcers say; this one is shared by everyone watching a race session.
//
// A deterministic state machine with no I/O and no timers: src/lib/videoDirectorRuntime.ts ticks it and carries out what
// it asks for (the effects: pick a clip, check its file, write the announcers' lines), feeding the answers back. Every
// time is an absolute server timestamp worked out once, when the sequence is scheduled, so viewers need only the latest
// snapshot to know what to show; none of them decides anything, and a viewer's own audio or video events never move the
// timeline. Type-only imports, so client components and Node's tests use it directly (npm run test:video-director).

export const DIRECTOR_PHASES = [
  'LIVE',
  'CLIP_SELECTED',
  'CLIP_PRELOADING',
  'INTRO_PENDING',
  'INTRO_PLAYING',
  'TRANSITION_TO_VIDEO',
  'VIDEO_PLAYING',
  'TRANSITION_TO_LIVE',
  'RECOVERY',
] as const;
export type DirectorPhase = (typeof DIRECTOR_PHASES)[number];
export type BroadcastSource = 'LIVE_TRACK_MAP' | 'RECORDED_VIDEO';

// How long viewers get to buffer a clip before its introduction can start
export const PRELOAD_MS = 3000;
// The introduction starts this far ahead of when it's announced, as viewers hear of it within a second (the stream's tick)
export const AUDIO_LEAD_MS = 1500;
const INTRO_TAIL_MS = 250;
// How long the announcers get to finish, and the introduction to be written and voiced, before the clip is given up
export const INTRO_WAIT_MS = 25_000;
// A line during the clip starts this long after the cut, and has to end this long before the clip does
const DURING_LEAD_MS = 500;
const DURING_TAIL_MS = 500;
const AFTER_LEAD_MS = 200;
export const RECOVERY_MS = 2000;
// After nothing could be shown, how long before looking again
export const RETRY_AFTER_MS = 30_000;
// A clip plays at most this long, whatever its timestamps say
export const MAX_CLIP_SECONDS = 60;
// Rotation: a clip is picked this long before its cut, so viewers can buffer it
export const ROTATION_LEAD_MS = 6000;
// How many recent clips and categories are avoided while there are alternatives
export const RECENT_VIDEOS = 5;
const RECENT_CATEGORIES = 2;
// The sequence holds normal commentary from when the introduction is next
const HELD_PHASES: readonly DirectorPhase[] = ['INTRO_PENDING', 'INTRO_PLAYING', 'TRANSITION_TO_VIDEO', 'VIDEO_PLAYING', 'TRANSITION_TO_LIVE'];
const CANCELLABLE_PHASES: readonly DirectorPhase[] = ['CLIP_SELECTED', 'CLIP_PRELOADING', 'INTRO_PENDING', 'INTRO_PLAYING'];

export type DirectorSettings = {
  videosEnabled: boolean;
  autoDirector: boolean;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  defaultClipSeconds: number;
  transitionMs: number;
  requireIntroduction: boolean;
  commentaryDuringVideo: boolean;
  postVideoCommentary: boolean;
  // Off mutes every clip; on lets a clip with Audio enabled be heard, ducked under the announcers
  videoAudio: boolean;
  // During a race, take turns between the map and footage on a fixed rhythm, with no announcer lines of its own
  rotationEnabled: boolean;
  rotationMapSeconds: number;
  rotationVideoSeconds: number;
  categoryEnabled: Partial<Record<VideoCategory, boolean>>;
  categoryWeights: Partial<Record<VideoCategory, number>>;
};

export const DEFAULT_DIRECTOR_SETTINGS: DirectorSettings = {
  videosEnabled: true,
  autoDirector: true,
  minIntervalSeconds: 120,
  maxIntervalSeconds: 240,
  defaultClipSeconds: 8,
  transitionMs: 300,
  requireIntroduction: true,
  commentaryDuringVideo: true,
  postVideoCommentary: true,
  videoAudio: false,
  rotationEnabled: true,
  rotationMapSeconds: 30,
  rotationVideoSeconds: 30,
  categoryEnabled: {},
  categoryWeights: {},
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// What's saved, or sent by the Admin page, with anything missing or out of range as it was
export function parseDirectorSettings(raw: unknown, base: DirectorSettings = DEFAULT_DIRECTOR_SETTINGS): DirectorSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof DirectorSettings) => (typeof r[key] === 'boolean' ? (r[key] as boolean) : (base[key] as boolean));
  const minIntervalSeconds = clampNumber(r.minIntervalSeconds, 10, 3600, base.minIntervalSeconds);
  const weights: Partial<Record<VideoCategory, number>> = { ...base.categoryWeights };
  for (const [key, value] of Object.entries((r.categoryWeights as object) ?? {})) weights[key as VideoCategory] = clampNumber(value, 0, 100, 1);
  const enabled: Partial<Record<VideoCategory, boolean>> = { ...base.categoryEnabled };
  for (const [key, value] of Object.entries((r.categoryEnabled as object) ?? {})) if (typeof value === 'boolean') enabled[key as VideoCategory] = value;
  return {
    videosEnabled: bool('videosEnabled'),
    autoDirector: bool('autoDirector'),
    minIntervalSeconds,
    maxIntervalSeconds: Math.max(clampNumber(r.maxIntervalSeconds, 10, 7200, base.maxIntervalSeconds), minIntervalSeconds),
    defaultClipSeconds: clampNumber(r.defaultClipSeconds, 1, MAX_CLIP_SECONDS, base.defaultClipSeconds),
    transitionMs: clampNumber(r.transitionMs, 0, 3000, base.transitionMs),
    requireIntroduction: bool('requireIntroduction'),
    commentaryDuringVideo: bool('commentaryDuringVideo'),
    postVideoCommentary: bool('postVideoCommentary'),
    videoAudio: bool('videoAudio'),
    rotationEnabled: bool('rotationEnabled'),
    rotationMapSeconds: clampNumber(r.rotationMapSeconds, 10, 600, base.rotationMapSeconds),
    rotationVideoSeconds: clampNumber(r.rotationVideoSeconds, 5, MAX_CLIP_SECONDS, base.rotationVideoSeconds),
    categoryEnabled: enabled,
    categoryWeights: weights,
  };
}

// A clip in the library that's ready to play, as the Director sees it
export type DirectorVideo = {
  id: number;
  title: string;
  description: string;
  category: VideoCategory;
  trackKey: string | null;
  track: string | null;
  car: string | null;
  durationSeconds: number;
  clipStartSeconds: number;
  clipEndSeconds: number | null;
  audioEnabled: boolean;
  priority: number;
  selectionWeight: number;
  cameraPerspective: string;
  sessionInfo: string;
  commentaryContext: string;
};

// How long a clip plays: its own end when it has one, else the default length, and never past the file's end
export function clipLengthSeconds(video: Pick<DirectorVideo, 'durationSeconds' | 'clipStartSeconds' | 'clipEndSeconds'>, settings: Pick<DirectorSettings, 'defaultClipSeconds'>): number {
  const available = Math.max(video.durationSeconds - video.clipStartSeconds, 0);
  const wanted = video.clipEndSeconds != null ? video.clipEndSeconds - video.clipStartSeconds : settings.defaultClipSeconds;
  return Math.min(Math.max(Math.min(wanted, available), 0), MAX_CLIP_SECONDS);
}

export type SelectionRequest = { category?: VideoCategory | null; videoId?: number | null };

export type SelectionContext = {
  settings: DirectorSettings;
  trackKey: string | null;
  // The cars in the session, by name
  cars: string[];
  recentVideoIds: number[];
  recentCategories: VideoCategory[];
};

const sameKey = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Which clips may play here: a clip tied to a track only plays at that track
export function eligibleVideos(videos: DirectorVideo[], context: SelectionContext): DirectorVideo[] {
  return videos.filter((v) => clipLengthSeconds(v, context.settings) > 0 && (!v.trackKey || sameKey(v.trackKey, context.trackKey)));
}

// SelectVideo: a clip for this request, or null when there's none, in which case nothing is announced. Picked at random
// by selection weight, category weight and priority, favouring this track's and this session's cars' footage, and
// avoiding the same category and the recent clips while there are alternatives.
export function selectVideo(videos: DirectorVideo[], request: SelectionRequest, context: SelectionContext, random: () => number = Math.random): DirectorVideo | null {
  const { settings } = context;
  let pool = eligibleVideos(videos, context);
  if (request.videoId != null) return pool.find((v) => v.id === request.videoId) ?? null;
  if (request.category) {
    pool = pool.filter((v) => v.category === request.category);
  } else {
    pool = pool.filter((v) => settings.categoryEnabled[v.category] !== false && (settings.categoryWeights[v.category] ?? 1) > 0 && v.selectionWeight > 0);
    const otherCategory = pool.filter((v) => !context.recentCategories.includes(v.category));
    if (otherCategory.length > 0) pool = otherCategory;
  }
  const unplayed = pool.filter((v) => !context.recentVideoIds.includes(v.id));
  if (unplayed.length > 0) pool = unplayed;
  else if (pool.length > 1) {
    // All played lately: anything but the very latest
    const latest = context.recentVideoIds[context.recentVideoIds.length - 1];
    pool = pool.filter((v) => v.id !== latest);
  }
  if (pool.length === 0) return null;
  const weightOf = (v: DirectorVideo) =>
    Math.max(v.selectionWeight, 0.0001) *
    (request.category ? 1 : (settings.categoryWeights[v.category] ?? 1)) *
    (1 + Math.max(v.priority, 0)) *
    (sameKey(v.trackKey, context.trackKey) ? 3 : 1) *
    (v.car && context.cars.some((car) => car.toLowerCase() === v.car!.toLowerCase()) ? 1.5 : 1);
  const total = pool.reduce((sum, v) => sum + weightOf(v), 0);
  let at = random() * total;
  for (const v of pool) {
    at -= weightOf(v);
    if (at <= 0) return v;
  }
  return pool[pool.length - 1];
}

export type ReservedClip = {
  videoId: number;
  category: VideoCategory;
  title: string;
  clipStartSeconds: number;
  durationMs: number;
  // The clip's own sound is heard (the Admin page allows it, and it was uploaded with it)
  audio: boolean;
  // Rotation: the footage repeats every lengthSeconds from clipStartSeconds, starting offsetSeconds in
  loop?: { offsetSeconds: number; lengthSeconds: number };
};

export type LineTiming = 'intro' | 'during' | 'after';

// A commentary line of the sequence: what it's for and how long its longest voicing runs; its words and audio, which
// differ by viewer language and voice, stay with the runtime
export type PreparedLine = { id: string; when: LineTiming; speaker: 'lead' | 'color'; durationMs: number };
export type ScheduledLine = PreparedLine & { at: number };

export type DirectorTrigger = 'auto' | 'manual';

export type DirectorState = {
  sessionKey: string;
  createdAt: number;
  // Numbers every change; a viewer ignores a snapshot older than one it has seen
  seq: number;
  eventId: string;
  phase: DirectorPhase;
  phaseSince: number;
  clip: ReservedClip | null;
  trigger: DirectorTrigger;
  // A clip is being picked, or its intro is being prepared
  selecting: boolean;
  preparing: boolean;
  prepared: PreparedLine[] | null;
  preloadUntil: number;
  introDeadline: number;
  recoverUntil: number;
  // The schedule, once there's one
  lines: ScheduledLine[];
  transitionMs: number;
  transitionAt: number | null;
  returnAt: number | null;
  liveAt: number | null;
  // Normal commentary stays held until this, as the last line of the sequence plays
  holdUntil: number;
  // Nothing is looked for before this, after finding nothing to show
  nextCheckAt: number;
  // When the last clip ended; the time between clips counts from this
  lastClipEndedAt: number | null;
  // Rotation: when the clip being picked or shown cuts in; null for a clip with the announcers' sequence
  rotationCutAt: number | null;
  // Rotation: how far (seconds) each clip has got, so a long file carries on rather than starting over
  rotationPlayed: Record<number, number>;
  manualRequest: SelectionRequest | null;
  reselect: boolean;
  recentVideoIds: number[];
  recentCategories: VideoCategory[];
  // Why the clip on screen was cut short, for its history
  cutStatus?: 'cutShort';
  cutReason?: string;
};

export function newDirector(sessionKey: string, now: number): DirectorState {
  return {
    sessionKey,
    createdAt: now,
    seq: 1,
    eventId: crypto.randomUUID(),
    phase: 'LIVE',
    phaseSince: now,
    clip: null,
    trigger: 'auto',
    selecting: false,
    preparing: false,
    prepared: null,
    preloadUntil: 0,
    introDeadline: 0,
    recoverUntil: 0,
    lines: [],
    transitionMs: DEFAULT_DIRECTOR_SETTINGS.transitionMs,
    transitionAt: null,
    returnAt: null,
    liveAt: null,
    holdUntil: 0,
    nextCheckAt: 0,
    lastClipEndedAt: null,
    rotationCutAt: null,
    rotationPlayed: {},
    manualRequest: null,
    reselect: false,
    recentVideoIds: [],
    recentCategories: [],
  };
}

// What the runtime is asked to do
export type DirectorEffect =
  | { type: 'select'; request: SelectionRequest; trigger: DirectorTrigger }
  | { type: 'validate'; videoId: number }
  | { type: 'prepare' }
  | { type: 'playbackStarted' }
  | { type: 'finished'; status: 'completed' | 'cutShort' | 'cancelled' | 'failed'; reason: string | null }
  | { type: 'persist' };

// How the race looks right now, from the Commentary Director's priorities and intensities (raceConditions in
// src/lib/videoDirectorConditions.ts)
export type RaceConditions = {
  // 1 calm to 5 race-deciding: the highest of the last few moments
  level: number;
  // Something important just happened, or the race is starting or ending: no clip now
  blocked: boolean;
  // A P0 moment since the sequence started: the broadcast goes back to it
  critical: boolean;
  // The race is under way with nothing critical just now, so the rotation runs (if it's turned on)
  rotating: boolean;
};

export type TickInput = {
  now: number;
  settings: DirectorSettings;
  race: RaceConditions;
  // When the audio already sent to the viewers should have finished
  announcersBusyUntil: number;
};

function go(state: DirectorState, phase: DirectorPhase, now: number, effects: DirectorEffect[]): void {
  state.phase = phase;
  state.phaseSince = now;
  state.seq += 1;
  state.eventId = crypto.randomUUID();
  effects.push({ type: 'persist' });
}

// When the next clip is due: the minimum time between clips when the race is quiet, up to the maximum as it livens up;
// in the rotation, the map's turn after the last one (its fade back counts, as the map shows from the start of that)
export function nextClipDueAt(
  state: Pick<DirectorState, 'lastClipEndedAt' | 'createdAt' | 'transitionMs'>,
  settings: Pick<DirectorSettings, 'minIntervalSeconds' | 'maxIntervalSeconds' | 'rotationMapSeconds'>,
  level: number,
  rotating = false
): number {
  if (rotating) return state.lastClipEndedAt == null ? state.createdAt + settings.rotationMapSeconds * 1000 : state.lastClipEndedAt - state.transitionMs + settings.rotationMapSeconds * 1000;
  const share = level <= 1 ? 0 : level === 2 ? 0.5 : 1;
  const seconds = settings.minIntervalSeconds + (settings.maxIntervalSeconds - settings.minIntervalSeconds) * share;
  return (state.lastClipEndedAt ?? state.createdAt) + seconds * 1000;
}

function autoClipDue(state: DirectorState, input: TickInput): boolean {
  const { now, settings, race } = input;
  if (!settings.videosEnabled || !settings.autoDirector) return false;
  if (settings.rotationEnabled && race.rotating) return now >= nextClipDueAt(state, settings, race.level, true) - ROTATION_LEAD_MS;
  return !race.blocked && race.level < 4 && now >= nextClipDueAt(state, settings, race.level);
}

function abandon(state: DirectorState, now: number, status: 'cancelled' | 'failed', reason: string, effects: DirectorEffect[]): void {
  effects.push({ type: 'finished', status, reason });
  state.clip = null;
  state.prepared = null;
  state.preparing = false;
  state.lines = [];
  state.transitionAt = null;
  state.returnAt = null;
  state.liveAt = null;
  state.holdUntil = 0;
  state.recoverUntil = now + RECOVERY_MS;
  state.nextCheckAt = now + RETRY_AFTER_MS;
  // Something's wrong: the next try waits as long as a clip would, rather than failing over and over
  if (status === 'failed') state.lastClipEndedAt = now;
  go(state, 'RECOVERY', now, effects);
}

// The whole sequence's times, worked out once from the lines as voiced: the introduction, then the cut, the clip, the
// return and the line after it. A line that wouldn't fit in the clip is left out
function schedule(state: DirectorState, now: number, settings: DirectorSettings, effects: DirectorEffect[]): void {
  const clip = state.clip!;
  const prepared = state.prepared ?? [];
  const intro = prepared.filter((l) => l.when === 'intro');
  const soonest = intro.length > 0 ? now + AUDIO_LEAD_MS : now + PRELOAD_MS / 2;
  const start = Math.max(soonest, state.rotationCutAt ?? 0);
  const lines: ScheduledLine[] = [];
  let at = start;
  for (const line of intro) {
    lines.push({ ...line, at });
    at += line.durationMs;
  }
  const transitionAt = at + (intro.length > 0 ? INTRO_TAIL_MS : 0);
  const returnAt = transitionAt + clip.durationMs;
  const liveAt = returnAt + settings.transitionMs;
  let duringAt = transitionAt + DURING_LEAD_MS;
  for (const line of prepared.filter((l) => l.when === 'during')) {
    if (duringAt + line.durationMs > returnAt - DURING_TAIL_MS) continue;
    lines.push({ ...line, at: duringAt });
    duringAt += line.durationMs;
  }
  let afterAt = liveAt + AFTER_LEAD_MS;
  for (const line of prepared.filter((l) => l.when === 'after')) {
    lines.push({ ...line, at: afterAt });
    afterAt += line.durationMs;
  }
  state.lines = lines;
  state.transitionMs = settings.transitionMs;
  state.transitionAt = transitionAt;
  state.returnAt = returnAt;
  state.liveAt = liveAt;
  state.holdUntil = afterAt;
  go(state, 'INTRO_PLAYING', now, effects);
}

function cutToLive(state: DirectorState, now: number, status: 'cutShort', reason: string, effects: DirectorEffect[]): void {
  state.returnAt = now;
  state.liveAt = now + state.transitionMs;
  // What the announcers had left for the clip isn't said over what brought it back
  state.lines = state.lines.filter((l) => l.at + l.durationMs <= now);
  state.holdUntil = 0;
  state.cutReason = reason;
  state.cutStatus = status;
  go(state, 'TRANSITION_TO_LIVE', now, effects);
}

// One step, called a few times a second; returns what the runtime should do
export function directorTick(state: DirectorState, input: TickInput): DirectorEffect[] {
  const { now, settings, race } = input;
  const effects: DirectorEffect[] = [];
  const rotating = settings.rotationEnabled && race.rotating;
  // Turned off: a skip's promise of another clip doesn't outlive that
  if (!settings.videosEnabled) state.reselect = false;
  switch (state.phase) {
    case 'LIVE': {
      if (state.selecting) break;
      if (state.manualRequest) {
        const request = state.manualRequest;
        state.manualRequest = null;
        state.selecting = true;
        state.rotationCutAt = rotating ? now : null;
        effects.push({ type: 'select', request, trigger: 'manual' });
      } else if (now >= state.nextCheckAt && settings.videosEnabled && (state.reselect || autoClipDue(state, input))) {
        state.reselect = false;
        state.selecting = true;
        state.rotationCutAt = rotating ? Math.max(nextClipDueAt(state, settings, race.level, true), now) : null;
        effects.push({ type: 'select', request: {}, trigger: 'auto' });
      }
      break;
    }
    case 'CLIP_SELECTED':
      // waiting for the file check (clipValidated); a check that never answers is given up on
      if (now > state.phaseSince + INTRO_WAIT_MS) abandon(state, now, 'failed', 'validationTimeout', effects);
      break;
    case 'CLIP_PRELOADING':
      if (race.critical) abandon(state, now, 'cancelled', 'liveAction', effects);
      else if (now >= state.preloadUntil && state.rotationCutAt != null) schedule(state, now, settings, effects);
      else if (now >= state.preloadUntil) {
        state.introDeadline = now + INTRO_WAIT_MS;
        go(state, 'INTRO_PENDING', now, effects);
      }
      break;
    case 'INTRO_PENDING':
      if (race.critical) {
        abandon(state, now, 'cancelled', 'liveAction', effects);
      } else if (now >= state.introDeadline) {
        abandon(state, now, 'failed', state.preparing ? 'introTimeout' : 'announcersBusy', effects);
      } else if (!state.preparing && now >= input.announcersBusyUntil) {
        const hasIntro = (state.prepared ?? []).some((l) => l.when === 'intro');
        if (!hasIntro && settings.requireIntroduction) abandon(state, now, 'failed', 'introUnavailable', effects);
        else schedule(state, now, settings, effects);
      }
      break;
    case 'INTRO_PLAYING':
      if (race.critical) abandon(state, now, 'cancelled', 'liveAction', effects);
      else if (now >= state.transitionAt!) {
        effects.push({ type: 'playbackStarted' });
        go(state, 'TRANSITION_TO_VIDEO', now, effects);
      }
      break;
    case 'TRANSITION_TO_VIDEO':
      if (race.critical) cutToLive(state, now, 'cutShort', 'liveAction', effects);
      else if (now >= state.transitionAt! + state.transitionMs) go(state, 'VIDEO_PLAYING', now, effects);
      break;
    case 'VIDEO_PLAYING':
      if (race.critical) cutToLive(state, now, 'cutShort', 'liveAction', effects);
      else if (now >= state.returnAt!) go(state, 'TRANSITION_TO_LIVE', now, effects);
      break;
    case 'TRANSITION_TO_LIVE':
      if (now >= state.liveAt!) {
        effects.push({ type: 'finished', status: state.cutStatus ?? 'completed', reason: state.cutReason ?? null });
        state.lastClipEndedAt = now;
        state.clip = null;
        state.prepared = null;
        state.transitionAt = null;
        state.returnAt = null;
        state.liveAt = null;
        state.cutStatus = undefined;
        state.cutReason = undefined;
        // the line after the clip keeps its place in lines until it has been said
        go(state, 'LIVE', now, effects);
      }
      break;
    case 'RECOVERY':
      if (now >= state.recoverUntil) go(state, 'LIVE', now, effects);
      break;
  }
  if (state.phase === 'LIVE' && state.lines.length > 0 && now >= state.holdUntil) {
    // Numbered, as viewers learn from it that normal commentary is free to go again
    state.lines = [];
    state.seq += 1;
    state.eventId = crypto.randomUUID();
  }
  return effects;
}

// Answers to the effects

export function clipSelected(state: DirectorState, video: DirectorVideo | null, trigger: DirectorTrigger, settings: DirectorSettings, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  state.selecting = false;
  if (!video) {
    // Nothing to show, so nothing is announced
    state.nextCheckAt = now + RETRY_AFTER_MS;
    return effects;
  }
  state.clip = {
    videoId: video.id,
    category: video.category,
    title: video.title,
    clipStartSeconds: video.clipStartSeconds,
    durationMs: Math.round(clipLengthSeconds(video, settings) * 1000),
    audio: settings.videoAudio && video.audioEnabled,
  };
  if (state.rotationCutAt != null) {
    // The whole of the file (or the part of it the clip's times mark), repeating if it's shorter than the footage's turn
    const end = Math.min(video.clipEndSeconds ?? video.durationSeconds, video.durationSeconds);
    const lengthSeconds = Math.max(end - video.clipStartSeconds, 0);
    const played = state.rotationPlayed ?? {};
    const offsetSeconds = (played[video.id] ?? 0) % lengthSeconds;
    state.clip.durationMs = settings.rotationVideoSeconds * 1000;
    state.clip.loop = { offsetSeconds, lengthSeconds };
    state.rotationPlayed = { ...played, [video.id]: offsetSeconds + settings.rotationVideoSeconds };
  }
  state.trigger = trigger;
  state.prepared = null;
  state.lines = [];
  state.recentVideoIds = [...state.recentVideoIds, video.id].slice(-RECENT_VIDEOS);
  state.recentCategories = [...state.recentCategories, video.category].slice(-RECENT_CATEGORIES);
  go(state, 'CLIP_SELECTED', now, effects);
  effects.push({ type: 'validate', videoId: video.id });
  return effects;
}

export function clipValidated(state: DirectorState, ok: boolean, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  if (state.phase !== 'CLIP_SELECTED') return effects;
  if (!ok) {
    abandon(state, now, 'failed', 'missingFile', effects);
    return effects;
  }
  if (state.rotationCutAt != null) {
    // No lines to prepare; the schedule goes out just ahead of the cut, as viewers hear of it within a second
    state.preloadUntil = Math.max(now + PRELOAD_MS, state.rotationCutAt - PRELOAD_MS / 2);
    state.prepared = [];
    go(state, 'CLIP_PRELOADING', now, effects);
    return effects;
  }
  state.preloadUntil = now + PRELOAD_MS;
  state.preparing = true;
  go(state, 'CLIP_PRELOADING', now, effects);
  effects.push({ type: 'prepare' });
  return effects;
}

export function linesPrepared(state: DirectorState, lines: PreparedLine[] | null): void {
  state.preparing = false;
  state.prepared = lines;
}

// Every viewer's player gave up on the clip. Before the cut, which is when a broken file shows up as it buffers, it's
// dropped without being announced; on screen, the broadcast leaves it
export function videoFailed(state: DirectorState, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  if (CANCELLABLE_PHASES.includes(state.phase)) {
    abandon(state, now, 'failed', 'playbackFailed', effects);
  } else if (state.phase === 'TRANSITION_TO_VIDEO' || state.phase === 'VIDEO_PLAYING') {
    effects.push({ type: 'finished', status: 'failed', reason: 'playbackFailed' });
    abandonPlaying(state, now, effects);
  }
  return effects;
}

function abandonPlaying(state: DirectorState, now: number, effects: DirectorEffect[]): void {
  state.clip = null;
  state.prepared = null;
  state.lines = [];
  state.transitionAt = null;
  state.returnAt = null;
  state.liveAt = null;
  state.holdUntil = 0;
  state.recoverUntil = now + RECOVERY_MS;
  state.nextCheckAt = now + RETRY_AFTER_MS;
  go(state, 'RECOVERY', now, effects);
}

// The Admin page's controls

// PLAY VIDEO NOW: the normal sequence, at the next tick; false while another clip is under way
export function requestClip(state: DirectorState, request: SelectionRequest): boolean {
  if (state.phase !== 'LIVE' && state.phase !== 'RECOVERY') return false;
  if (state.selecting || state.manualRequest) return false;
  state.manualRequest = request;
  state.nextCheckAt = 0;
  return true;
}

// RETURN TO LIVE: drops whatever is pending, or cuts out of the clip
export function returnToLive(state: DirectorState, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  state.manualRequest = null;
  state.reselect = false;
  if (CANCELLABLE_PHASES.includes(state.phase)) abandon(state, now, 'cancelled', 'returnToLive', effects);
  else if (state.phase === 'TRANSITION_TO_VIDEO' || state.phase === 'VIDEO_PLAYING') cutToLive(state, now, 'cutShort', 'returnToLive', effects);
  state.holdUntil = 0;
  if (state.phase === 'LIVE') state.lines = [];
  return effects;
}

// SKIP NEXT VIDEO: drops the clip picked but not yet on screen, and the Director picks another after recovering
export function skipNext(state: DirectorState, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  if (!CANCELLABLE_PHASES.includes(state.phase)) return effects;
  abandon(state, now, 'cancelled', 'skipped', effects);
  state.reselect = true;
  state.nextCheckAt = 0;
  return effects;
}

// The running race ended, or everybody left
export function endSession(state: DirectorState, now: number): DirectorEffect[] {
  const effects: DirectorEffect[] = [];
  if (state.clip) effects.push({ type: 'finished', status: 'cancelled', reason: 'sessionEnded' });
  state.clip = null;
  state.lines = [];
  state.holdUntil = 0;
  go(state, 'LIVE', now, effects);
  return effects;
}

// After a restart: a clip still on screen carries on, as every viewer can rejoin it, with its commentary gone; anything
// earlier had audio only this server knew about, so it's dropped. Returns the state and what became of the clip
export function restoreDirector(saved: DirectorState, now: number): { state: DirectorState; lost: boolean } {
  const state: DirectorState = { ...saved, selecting: false, preparing: false, prepared: null, manualRequest: null, reselect: false, lines: [], holdUntil: 0 };
  // Well past anything viewers can have seen, as the last few numbers before the restart may not have been saved
  state.seq += 100;
  state.eventId = crypto.randomUUID();
  const onScreen = (saved.phase === 'TRANSITION_TO_VIDEO' || saved.phase === 'VIDEO_PLAYING' || saved.phase === 'TRANSITION_TO_LIVE') && (saved.liveAt ?? 0) > now;
  if (onScreen) return { state, lost: false };
  const lost = !!saved.clip;
  state.phase = 'LIVE';
  state.phaseSince = now;
  state.clip = null;
  state.transitionAt = null;
  state.returnAt = null;
  state.liveAt = null;
  // Give a broken sequence time to clear rather than starting one at once
  if (lost) state.nextCheckAt = now + RETRY_AFTER_MS;
  return { state, lost };
}

// The rotation has no lines of its own, so commentary carries on over it
export const commentaryHeld = (state: Pick<DirectorState, 'phase' | 'holdUntil'> & Partial<Pick<DirectorState, 'rotationCutAt'>>, now: number) =>
  state.rotationCutAt == null && (HELD_PHASES.includes(state.phase) || now < state.holdUntil);

// What's on screen at this moment, by the schedule
export function sourceAt(state: Pick<DirectorState, 'transitionAt' | 'returnAt'>, now: number): BroadcastSource {
  return state.transitionAt != null && state.returnAt != null && now >= state.transitionAt && now < state.returnAt ? 'RECORDED_VIDEO' : 'LIVE_TRACK_MAP';
}

// What every viewer gets, the same for all but the lines' words and audio
export type DirectorSnapshot = {
  sessionKey: string;
  eventId: string;
  seq: number;
  phase: DirectorPhase;
  source: BroadcastSource;
  // Whether normal commentary is being held
  hold: boolean;
  clip: (ReservedClip & { url: string }) | null;
  transitionMs: number;
  transitionAt: number | null;
  playbackStartAt: number | null;
  returnAt: number | null;
  liveAt: number | null;
  // text and audioUrl are in the viewer's language and voices; volume is their announcer volume, 0-1; elevenLabs says
  // the line plays over the engine bed (src/lib/engineBed.ts), which each TV mixes itself as the line plays
  lines: { id: string; when: LineTiming; speaker: 'lead' | 'color'; at: number; durationMs: number; text: string; audioUrl: string | null; volume: number; elevenLabs: boolean }[];
};

// The player's side: where in the file a viewer should be at this moment, joining late or not

// How far (seconds) into the file the clip should be now, or null when it isn't on screen
export function expectedVideoTime(snapshot: Pick<DirectorSnapshot, 'clip' | 'playbackStartAt' | 'returnAt'>, serverNow: number): number | null {
  if (!snapshot.clip || snapshot.playbackStartAt == null || snapshot.returnAt == null) return null;
  if (serverNow < snapshot.playbackStartAt || serverNow >= snapshot.returnAt) return null;
  const elapsed = (serverNow - snapshot.playbackStartAt) / 1000;
  const { clipStartSeconds, loop } = snapshot.clip;
  return loop ? clipStartSeconds + (loop.offsetSeconds + elapsed) % loop.lengthSeconds : clipStartSeconds + elapsed;
}

// Where in the file the clip waits for its cut
export const clipCueSeconds = (clip: Pick<ReservedClip, 'clipStartSeconds' | 'loop'>) => clip.clipStartSeconds + (clip.loop?.offsetSeconds ?? 0);

// Off by more than this (seconds), a player jumps; by less than the nudge, it's left alone; between them it speeds up or
// slows down a little until it's back
export const SEEK_DRIFT_S = 0.75;
export const NUDGE_DRIFT_S = 0.2;

export function playbackCorrection(actual: number, expected: number): { seekTo: number | null; rate: number } {
  const drift = expected - actual;
  if (Math.abs(drift) > SEEK_DRIFT_S) return { seekTo: expected, rate: 1 };
  if (Math.abs(drift) > NUDGE_DRIFT_S) return { seekTo: null, rate: drift > 0 ? 1.05 : 0.95 };
  return { seekTo: null, rate: 1 };
}

// The difference between this browser's clock and the server's, from each picture's server time as it arrives. A
// message can only arrive late, so the largest difference seen is the one with the least delay in it
export function nextClockOffset(previous: number | null, serverAt: number, localNow: number): number {
  const sample = serverAt - localNow;
  return previous == null ? sample : Math.max(previous, sample);
}

// Whether this snapshot replaces the one a viewer has: a different session's, or a newer one of this session's
export function isNewerSnapshot(current: Pick<DirectorSnapshot, 'sessionKey' | 'seq'> | null, next: Pick<DirectorSnapshot, 'sessionKey' | 'seq'>): boolean {
  return !current || current.sessionKey !== next.sessionKey || next.seq > current.seq;
}

// A short clip's line may start this late for a viewer who only just joined; any later and it isn't played
export const LATE_LINE_MS = 1200;

// MP3 audio's length in ms, from its frames (no decoding), for the timeline; null when it isn't an MP3
export function mp3DurationMs(bytes: Uint8Array): number | null {
  const BITRATES: Record<number, number[]> = {
    // MPEG-1 Layer III, MPEG-2/2.5 Layer III
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  };
  const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let at = 0;
  // An ID3v2 tag first
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    at = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f);
  }
  let seconds = 0;
  let frames = 0;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) {
      if (frames > 0) break;
      at += 1;
      continue;
    }
    const version = (bytes[at + 1] >> 3) & 3;
    const layer = (bytes[at + 1] >> 1) & 3;
    const bitrate = BITRATES[version === 3 ? 3 : 2][(bytes[at + 2] >> 4) & 15] * 1000;
    const rate = RATES[version]?.[(bytes[at + 2] >> 2) & 3];
    if (layer !== 1 || !bitrate || !rate) {
      if (frames > 0) break;
      at += 1;
      continue;
    }
    const padding = (bytes[at + 2] >> 1) & 1;
    const samples = version === 3 ? 1152 : 576;
    seconds += samples / rate;
    at += Math.floor(((samples / 8) * bitrate) / rate) + padding;
    frames += 1;
  }
  return frames > 0 ? Math.round(seconds * 1000) : null;
}
