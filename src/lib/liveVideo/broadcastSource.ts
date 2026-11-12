// The Broadcast Source Manager's rules (docs/live-video.md): which camera TV Broadcast Mode shows under any recorded
// clip, the live track map (TRACK_MAP) or the OBS live stream (OBS_LIVE), and when it changes. The Broadcast Director's
// recorded clips (src/lib/videoDirector.ts) are a third source (VIDEO_CLIP) that it keeps deciding on its own; a clip on
// screen covers whatever camera is chosen here, and the camera is back the moment the clip ends.
//
// Deterministic, with no I/O and no timers, like videoDirector.ts: src/lib/liveVideo/broadcastSourceRuntime.ts keeps one
// state per race session and calls sourceTick as TVs ask for their picture. Every switch is numbered (seq) and takes
// effect for every viewer at the same server time (switchAt), so a viewer only needs the latest snapshot. No imports,
// so client components and Node's tests use it directly (npm run test:live-video).

export type CameraSource = 'TRACK_MAP' | 'OBS_LIVE';
export type BroadcastSourceKind = CameraSource | 'VIDEO_CLIP';
export const CAMERA_SOURCES: readonly CameraSource[] = ['TRACK_MAP', 'OBS_LIVE'];

// The moments the automatic director has a preference for; 'spread' is the race with nothing in particular happening
export const MOMENT_KINDS = ['raceStart', 'closeBattle', 'overtake', 'incident', 'pitStop', 'finalLap', 'finish', 'spread'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
// Moments about particular cars: the OBS camera only suits them when it's known to be showing one of those cars
const CAR_MOMENTS: readonly MomentKind[] = ['closeBattle', 'overtake', 'incident', 'pitStop'];

export type TransitionStyle = 'cut' | 'fade';
// What the OBS camera shows. 'unknown': nothing is assumed, so it's only picked for moments about the whole race.
// 'streamDriver': the stream's own driver's car (an onboard or chase camera of the car the stream belongs to)
export type CameraSubject = 'unknown' | 'streamDriver';
export type SyncMode = 'auto' | 'manual';

export type LiveVideoSettings = {
  // The feature flag: off, nothing of the live video reaches any page and no Cloudflare call is made
  enabled: boolean;
  // Shown on the Live Racing page (map, video, split view) as well as the TV
  liveRacingEnabled: boolean;
  // Automatic: the director picks the camera from the race; off, the camera stays where an Admin put it
  autoMode: boolean;
  preferences: Record<MomentKind, CameraSource>;
  // A shot is held at least this long, unless a critical (P0) moment needs the other camera
  minShotSeconds: number;
  // No two switches closer than this, whatever happens
  cooldownSeconds: number;
  // How long a moment keeps its preferred camera
  momentSeconds: number;
  transition: TransitionStyle;
  fadeMs: number;
  // A switch is announced this far ahead, so every viewer (who hears of it within a second) cuts together
  switchLeadMs: number;
  // OBS offline: back to the track map (on), or the offline card in its place (off)
  fallbackToMap: boolean;
  // The stream has to be gone this long before it counts as offline (a reconnecting encoder)
  offlineGraceSeconds: number;
  cameraSubject: CameraSubject;
  // Automatic mode's rotation: OBS for obsSeconds, then the track map for mapSeconds, then (when the Broadcast
  // Director's rotation has clips) one of its clips, then OBS again; the cycle restarts each time a clip hands back.
  // Only a big moment (P0, or P1 toward OBS) changes the camera on its own meanwhile. Off: the moment preferences alone
  rotation: { enabled: boolean; obsSeconds: number; mapSeconds: number };
  sync: {
    // Synchronized broadcast: the map, leaderboard and graphics are shown on the video's delayed timeline
    enabled: boolean;
    // auto: the delay comes from the player (measured when the stream carries wall-clock times, else estimated);
    // manual: the configured offset alone
    mode: SyncMode;
    // Added to the automatic delay, or the whole delay in manual mode (ms; may be negative in auto mode)
    manualOffsetMs: number;
    // The longest delay a viewer buffers for; beyond it synchronization is reported as degraded
    maxBufferMs: number;
  };
  // OBS audio (the game's engine), 0-100, separate from the announcers and the clips
  obsVolume: number;
  // OBS audio is lowered to this share (0-1) while an announcer speaks
  duckLevel: number;
};

export const DEFAULT_LIVE_VIDEO_SETTINGS: LiveVideoSettings = {
  enabled: false,
  liveRacingEnabled: true,
  autoMode: true,
  preferences: {
    raceStart: 'OBS_LIVE',
    closeBattle: 'OBS_LIVE',
    overtake: 'OBS_LIVE',
    incident: 'OBS_LIVE',
    pitStop: 'TRACK_MAP',
    finalLap: 'OBS_LIVE',
    finish: 'OBS_LIVE',
    spread: 'TRACK_MAP',
  },
  minShotSeconds: 10,
  cooldownSeconds: 4,
  momentSeconds: 20,
  transition: 'fade',
  fadeMs: 400,
  switchLeadMs: 1200,
  fallbackToMap: true,
  offlineGraceSeconds: 4,
  cameraSubject: 'unknown',
  rotation: { enabled: true, obsSeconds: 30, mapSeconds: 30 },
  sync: { enabled: false, mode: 'auto', manualOffsetMs: 0, maxBufferMs: 45_000 },
  obsVolume: 60,
  duckLevel: 0.3,
};

// The longest delay any viewer may be asked to buffer (Cloudflare's standard HLS runs well under this)
export const MAX_SYNC_BUFFER_MS = 90_000;

const num = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

// What's saved, or sent by the Admin page, with anything missing or out of range as it was
export function parseLiveVideoSettings(raw: unknown, base: LiveVideoSettings = DEFAULT_LIVE_VIDEO_SETTINGS): LiveVideoSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const prefsIn = r.preferences && typeof r.preferences === 'object' ? (r.preferences as Record<string, unknown>) : {};
  const preferences = { ...base.preferences };
  for (const kind of MOMENT_KINDS) preferences[kind] = oneOf(prefsIn[kind], CAMERA_SOURCES, base.preferences[kind]);
  const syncIn = r.sync && typeof r.sync === 'object' ? (r.sync as Record<string, unknown>) : {};
  const rotationIn = r.rotation && typeof r.rotation === 'object' ? (r.rotation as Record<string, unknown>) : {};
  const maxBufferMs = num(syncIn.maxBufferMs, 5000, MAX_SYNC_BUFFER_MS, base.sync.maxBufferMs);
  const minShotSeconds = num(r.minShotSeconds, 2, 300, base.minShotSeconds);
  return {
    enabled: bool(r.enabled, base.enabled),
    liveRacingEnabled: bool(r.liveRacingEnabled, base.liveRacingEnabled),
    autoMode: bool(r.autoMode, base.autoMode),
    preferences,
    minShotSeconds,
    cooldownSeconds: Math.min(num(r.cooldownSeconds, 0, 120, base.cooldownSeconds), minShotSeconds),
    momentSeconds: num(r.momentSeconds, 3, 300, base.momentSeconds),
    transition: oneOf(r.transition, ['cut', 'fade'] as const, base.transition),
    fadeMs: num(r.fadeMs, 0, 3000, base.fadeMs),
    switchLeadMs: num(r.switchLeadMs, 0, 5000, base.switchLeadMs),
    fallbackToMap: bool(r.fallbackToMap, base.fallbackToMap),
    offlineGraceSeconds: num(r.offlineGraceSeconds, 0, 60, base.offlineGraceSeconds),
    cameraSubject: oneOf(r.cameraSubject, ['unknown', 'streamDriver'] as const, base.cameraSubject),
    rotation: {
      enabled: bool(rotationIn.enabled, base.rotation.enabled),
      obsSeconds: Math.round(num(rotationIn.obsSeconds, 10, 600, base.rotation.obsSeconds)),
      mapSeconds: Math.round(num(rotationIn.mapSeconds, 5, 300, base.rotation.mapSeconds)),
    },
    sync: {
      enabled: bool(syncIn.enabled, base.sync.enabled),
      mode: oneOf(syncIn.mode, ['auto', 'manual'] as const, base.sync.mode),
      manualOffsetMs: Math.round(num(syncIn.manualOffsetMs, -maxBufferMs, maxBufferMs, base.sync.manualOffsetMs)),
      maxBufferMs,
    },
    obsVolume: Math.round(num(r.obsVolume, 0, 100, base.obsVolume)),
    duckLevel: num(r.duckLevel, 0, 1, base.duckLevel),
  };
}

// A moment in the race the camera might follow, from the race events (src/lib/liveVideo/sourceMoments.ts)
export type Moment = {
  kind: MomentKind;
  // Server time of the event
  at: number;
  // 0 critical to 4 background, the Commentary Director's priority
  priority: number;
  // The car indexes involved; empty for the whole race
  cars: number[];
};

export type SourceMode = 'auto' | 'manual';

export type SourceState = {
  sessionKey: string;
  seq: number;
  source: CameraSource;
  // What was on before, shown until switchAt
  previous: CameraSource;
  switchAt: number;
  lastSwitchAt: number;
  mode: SourceMode;
  // The manual choice, while in manual mode
  manualSource: CameraSource | null;
  // Why the camera is what it is (a key of liveVideo.reasons in the dictionaries)
  reason: string;
  // OBS was wanted but isn't live, so the map is on instead
  fallback: boolean;
  // When the stream was last seen going down; null while it's live
  streamDownSince: number | null;
  streamLive: boolean;
  updatedAt: number;
  // Where the rotation's cycle starts when the Broadcast Director has given no clip's end to start it from
  cycleStart?: number;
  // The Admin page's Automatic setting as this session last saw it, and whether turning it off is what put the session
  // in manual mode (so turning it back on hands the session back to the automatic director)
  autoSetting?: boolean;
  heldBySetting?: boolean;
};

export function newSourceState(sessionKey: string, now: number, mode: SourceMode = 'auto'): SourceState {
  return {
    cycleStart: now,
    sessionKey,
    seq: 1,
    source: 'TRACK_MAP',
    previous: 'TRACK_MAP',
    switchAt: now,
    lastSwitchAt: 0,
    mode,
    manualSource: null,
    reason: 'start',
    fallback: false,
    // Not seen live yet: offline from the start, with no grace
    streamDownSince: 0,
    streamLive: false,
    updatedAt: now,
  };
}

export type SourceTickInput = {
  now: number;
  settings: LiveVideoSettings;
  // Cloudflare says the stream is live (an OBS encoder connected)
  streamLive: boolean;
  // The most important recent moment, or null
  moment: Moment | null;
  // The car indexes the OBS camera is known to show, or null when unknown
  subjectCars: number[] | null;
  // Server time the rotation's cycle (re)starts with OBS: when the Broadcast Director's latest clip hands back (its
  // return, which may still be ahead while a clip is scheduled or on screen), or null for none (state.cycleStart)
  rotationAnchor?: number | null;
};

// The rotation's camera at server time t: OBS for obsSeconds from the anchor, then the map for mapSeconds, over and
// over until the next clip restarts it. Before the anchor (a clip is covering the camera) OBS, so it's under the clip
// as it fades back
export function rotationCamera(rotation: Pick<LiveVideoSettings['rotation'], 'obsSeconds' | 'mapSeconds'>, anchor: number, t: number): CameraSource {
  const elapsed = t - anchor;
  if (elapsed < 0) return 'OBS_LIVE';
  const cycleMs = (rotation.obsSeconds + rotation.mapSeconds) * 1000;
  return elapsed % cycleMs < rotation.obsSeconds * 1000 ? 'OBS_LIVE' : 'TRACK_MAP';
}

// The share of the time the rotation keeps OBS on screen, with the Broadcast Director's clips of clipSeconds in its
// cycle (0 for none)
export const rotationObsShare = (rotation: Pick<LiveVideoSettings['rotation'], 'obsSeconds' | 'mapSeconds'>, clipSeconds: number) =>
  rotation.obsSeconds / (rotation.obsSeconds + rotation.mapSeconds + Math.max(clipSeconds, 0));

type Wanted = { source: CameraSource; reason: string; urgent: boolean };

// A moment's preferred camera, unless that's OBS and OBS may not be showing the cars it's about
function momentCamera(fresh: Moment, settings: LiveVideoSettings, subjectCars: number[] | null): Wanted {
  const preferred = settings.preferences[fresh.kind];
  const aboutCars = CAR_MOMENTS.includes(fresh.kind) && fresh.cars.length > 0;
  if (preferred === 'OBS_LIVE' && aboutCars && !(subjectCars && subjectCars.some((idx) => fresh.cars.includes(idx)))) {
    // OBS may well be showing something else: the map shows every car, so it can't miss the moment
    return { source: 'TRACK_MAP', reason: subjectCars ? 'cameraNotOnAction' : 'cameraSubjectUnknown', urgent: fresh.priority === 0 };
  }
  return { source: preferred, reason: fresh.kind, urgent: fresh.priority === 0 };
}

// What the camera should be now, before the shot rules, and why
export function desiredSource(state: SourceState, input: SourceTickInput): { source: CameraSource; reason: string; fallback: boolean; urgent: boolean } {
  const { now, settings, moment, subjectCars } = input;
  if (!settings.enabled) return { source: 'TRACK_MAP', reason: 'disabled', fallback: false, urgent: true };
  const offline = !input.streamLive && (state.streamDownSince == null || now - state.streamDownSince >= settings.offlineGraceSeconds * 1000);
  let wanted: Wanted;
  const fresh = moment && now - moment.at <= settings.momentSeconds * 1000 && now >= moment.at - 5000 ? moment : null;
  if (state.mode === 'manual' && state.manualSource) {
    wanted = { source: state.manualSource, reason: 'manual', urgent: true };
  } else if (settings.rotation.enabled) {
    // A big moment takes over: toward OBS when it's on the camera's car or the whole race (P0 or P1), toward the map
    // only when it's critical (P0), so the rotation's share of OBS is the least OBS gets
    const big = fresh && fresh.priority <= 1 ? momentCamera(fresh, settings, subjectCars) : null;
    if (big && fresh && (big.source === 'OBS_LIVE' || fresh.priority === 0)) {
      wanted = big;
    } else {
      // Worked out for when the switch lands (switchLeadMs ahead), so it's on the cycle's boundary
      const source = rotationCamera(settings.rotation, input.rotationAnchor ?? state.cycleStart ?? state.updatedAt, now + settings.switchLeadMs);
      wanted = { source, reason: source === 'OBS_LIVE' ? 'rotationObs' : 'rotationMap', urgent: true };
    }
  } else if (!fresh) {
    wanted = { source: settings.preferences.spread, reason: 'spread', urgent: false };
  } else {
    wanted = momentCamera(fresh, settings, subjectCars);
  }
  if (wanted.source === 'OBS_LIVE' && offline) {
    // The offline card stays only when the Admin turned the fallback off
    if (settings.fallbackToMap) return { source: 'TRACK_MAP', reason: 'obsOffline', fallback: true, urgent: true };
    return { ...wanted, fallback: false };
  }
  return { ...wanted, fallback: false };
}

// One step: follows the stream's state and moves the camera when the shot rules allow. Returns whether anything a
// viewer sees changed (the snapshot to send is new)
export function sourceTick(state: SourceState, input: SourceTickInput): boolean {
  const { now, settings } = input;
  let changed = false;
  if (input.streamLive !== state.streamLive) {
    state.streamLive = input.streamLive;
    state.streamDownSince = input.streamLive ? null : now;
    changed = true;
  }
  const wanted = desiredSource(state, input);
  if (wanted.fallback !== state.fallback) {
    state.fallback = wanted.fallback;
    changed = true;
  }
  if (wanted.source !== state.source) {
    const sinceSwitch = now - state.lastSwitchAt;
    // A manual choice, the feature turned off and OBS going away apply at once; the director's own choices wait for
    // the shot to have run its course, a critical moment only for the cooldown
    const forced = wanted.reason === 'manual' || wanted.reason === 'disabled' || wanted.reason === 'obsOffline';
    const allowed = forced || (sinceSwitch >= settings.cooldownSeconds * 1000 && (wanted.urgent || sinceSwitch >= settings.minShotSeconds * 1000));
    if (allowed) {
      state.previous = state.source;
      state.source = wanted.source;
      state.lastSwitchAt = now;
      state.switchAt = now + settings.switchLeadMs;
      state.reason = wanted.reason;
      state.seq += 1;
      changed = true;
    }
  } else if (wanted.reason !== state.reason && (wanted.reason === 'manual' || state.reason === 'manual' || state.reason === 'start')) {
    state.reason = wanted.reason;
    changed = true;
  }
  if (changed) {
    state.updatedAt = now;
    if (!state.seq) state.seq = 1;
  }
  return changed;
}

// An Admin's choice: a camera, held until they hand back to the automatic director
export function selectManual(state: SourceState, source: CameraSource, now: number): void {
  state.mode = 'manual';
  state.heldBySetting = false;
  state.manualSource = source;
  state.seq += 1;
  state.updatedAt = now;
}

export function selectAutomatic(state: SourceState, now: number): void {
  state.mode = 'auto';
  state.heldBySetting = false;
  state.manualSource = null;
  state.seq += 1;
  state.updatedAt = now;
}

// The Admin page's Automatic setting changing: off holds whatever's on as a manual choice; back on returns a session
// that setting held to the automatic director. Only a change acts, so a session's own Automatic or camera button
// always wins until the setting changes again. Returns whether the mode changed
export function followAutoSetting(state: SourceState, autoMode: boolean, now: number): boolean {
  const before = state.autoSetting;
  state.autoSetting = autoMode;
  if (before === autoMode) return false;
  if (!autoMode && state.mode === 'auto') {
    selectManual(state, state.source, now);
    state.heldBySetting = true;
    return true;
  }
  // Also a session saved before the setting was remembered (before undefined) that the old rule held on the map
  if (autoMode && state.mode === 'manual' && (state.heldBySetting || before === undefined)) {
    selectAutomatic(state, now);
    return true;
  }
  return false;
}

// After a restart: the camera, mode and numbering carry on, the stream's state is found again
export function restoreSourceState(saved: SourceState, now: number): SourceState {
  return { ...saved, cycleStart: saved.cycleStart ?? now, seq: saved.seq + 100, switchAt: Math.min(saved.switchAt, now), streamDownSince: saved.streamLive ? now : saved.streamDownSince, streamLive: false, updatedAt: now };
}

// What every viewer gets
export type SourceSnapshot = {
  sessionKey: string;
  seq: number;
  source: CameraSource;
  previous: CameraSource;
  switchAt: number;
  transition: TransitionStyle;
  fadeMs: number;
  mode: SourceMode;
  reason: string;
  fallback: boolean;
  updatedAt: number;
};

export function sourceSnapshot(state: SourceState, settings: Pick<LiveVideoSettings, 'transition' | 'fadeMs'>): SourceSnapshot {
  return {
    sessionKey: state.sessionKey,
    seq: state.seq,
    source: state.source,
    previous: state.previous,
    switchAt: state.switchAt,
    transition: settings.transition,
    fadeMs: settings.transition === 'cut' ? 0 : settings.fadeMs,
    mode: state.mode,
    reason: state.reason,
    fallback: state.fallback,
    updatedAt: state.updatedAt,
  };
}

// The camera a viewer shows at serverNow: the one before until the switch's time
export function cameraAt(snapshot: Pick<SourceSnapshot, 'source' | 'previous' | 'switchAt'>, serverNow: number): CameraSource {
  return serverNow >= snapshot.switchAt ? snapshot.source : snapshot.previous;
}

// What's on screen: a recorded clip covers the camera while it's showing
export function effectiveSource(camera: CameraSource, clipOnScreen: boolean): BroadcastSourceKind {
  return clipOnScreen ? 'VIDEO_CLIP' : camera;
}

// Whether a snapshot replaces the one a viewer has (another session's, or a newer one of this session's)
export function isNewerSource(current: Pick<SourceSnapshot, 'sessionKey' | 'seq'> | null, next: Pick<SourceSnapshot, 'sessionKey' | 'seq'>): boolean {
  return !current || current.sessionKey !== next.sessionKey || next.seq > current.seq;
}
