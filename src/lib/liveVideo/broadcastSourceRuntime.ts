import { readDirectorFeed, liveSessionOf, watchableDrivers } from '../liveRacing';
import { enabledStreams, getLiveVideoSettings, purgeSourceStates, readSourceState, saveSourceState, type LiveStream } from '../liveVideoDb';
import { meteredServicesOn } from '../meteredServices';
import type { User } from '../users';
import {
  followAutoSetting,
  newSourceState,
  restoreSourceState,
  selectAutomatic,
  selectManual,
  sourceSnapshot,
  sourceTick,
  type CameraSource,
  type LiveVideoSettings,
  type SourceSnapshot,
  type SourceState,
} from './broadcastSource';
import { cachedHealth, playbackFor, streamConfig, streamHealth, type Playback } from './cloudflareStream';
import { clipAnchor, noteCameraRotation } from './rotationLink';
import { currentMoment } from './sourceMoments';
import type { StreamStatus } from './streamRules';

// The Broadcast Source Manager at work (rules in broadcastSource.ts): one camera state per race session a TV watches,
// in this server's memory like the Broadcast Director's (one web instance, docs/tv-broadcast.md), ticked as the TVs
// ask for their picture (about once a second each), so nothing runs while nobody watches. Each change is written to
// "BroadcastSourceStates", so an Admin's manual choice survives a restart. The session key is the Broadcast Director's,
// so the camera and the recorded clips belong to the same broadcast.
//
// Which stream: the followed driver's own, else the stream of another driver in the same iRacing subsession, and only
// one the TV's account may watch on the Live Racing page (watchableDrivers); the same rule as the Live Racing page, so
// no new entitlement is invented. Off (the Admin's switch), or with the paid-services emergency stop on, no stream is
// offered and no Cloudflare request is made.

const TICK_MIN_MS = 250;
const VIEWER_GONE_MS = 20_000;
const RESTORE_MS = 15 * 60_000;
const PERSIST_DEBOUNCE_MS = 1000;

type Viewer = { key: string; userId: number; lastSeen: number };
type Session = {
  key: string;
  label: string;
  driverId: number;
  state: SourceState;
  lastTick: number;
  viewers: Map<string, Viewer>;
  streamId: number | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
};

// What a TV's metrics report said (POST /api/tv/live-video/report), for the Admin page's diagnostics
export type TvVideoReport = {
  viewer: string;
  userId: number;
  at: number;
  status: string;
  latencyMs: number | null;
  latencyBasis: 'measured' | 'estimated' | 'none';
  appliedDelayMs: number;
  delayBasis: string;
  syncErrorMs: number | null;
  bufferMs: number | null;
  timelineSpanMs: number;
  lateSamples: number;
  outOfOrder: number;
  duplicates: number;
  droppedFrames: number | null;
  stalls: number;
  commentaryWaitMs: number | null;
  degraded: boolean;
};

const store = globalThis as unknown as {
  liveVideoSources?: { sessions: Map<string, Session>; loading: Map<string, Promise<Session>>; reports: Map<string, TvVideoReport>; purgedAt: number };
};
const runtime = (store.liveVideoSources ??= { sessions: new Map(), loading: new Map(), reports: new Map(), purgedAt: 0 });

export type ViewerStream = {
  id: number;
  ownerId: number;
  ownerName: string;
  name: string;
  status: StreamStatus;
  // Only while the stream is live, so a viewer's player never asks for a manifest that isn't there
  playback: Playback | null;
  interruptions: number;
};

// What the TV gets in its picture (TvFocus.liveVideo)
export type TvLiveVideo = {
  source: SourceSnapshot;
  stream: ViewerStream | null;
  sync: LiveVideoSettings['sync'];
  obsVolume: number;
  duckLevel: number;
};

async function liveVideoOn(settings: LiveVideoSettings): Promise<boolean> {
  if (!settings.enabled || !streamConfig().customerCode) return false;
  // The emergency stop stops delivery minutes too
  return meteredServicesOn().catch(() => false);
}

async function viewerStream(stream: LiveStream): Promise<ViewerStream> {
  const health = await streamHealth(stream.inputId).catch(() => cachedHealth(stream.inputId));
  const status = health?.status ?? 'UNKNOWN';
  return {
    id: stream.id,
    ownerId: stream.userId,
    ownerName: stream.userName,
    name: stream.name,
    status,
    playback: status === 'LIVE' ? playbackFor(stream.inputId, health, stream.requireSigned) : null,
    interruptions: health?.interruptions ?? 0,
  };
}

// The stream for the session the TV follows: the followed driver's, else one from another driver in the same race
function streamFor(streams: LiveStream[], driverId: number, allowed: 'all' | Set<number>): LiveStream | null {
  const may = (s: LiveStream) => allowed === 'all' || allowed.has(s.userId);
  const own = streams.find((s) => s.userId === driverId && may(s));
  if (own) return own;
  const sub = liveSessionOf(driverId)?.subSessionId;
  if (!sub) return null;
  return streams.find((s) => may(s) && liveSessionOf(s.userId)?.subSessionId === sub) ?? null;
}

function persist(session: Session) {
  if (session.persistTimer) return;
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null;
    saveSourceState(session.state).catch((error) => console.error('Live video source save error:', error));
  }, PERSIST_DEBOUNCE_MS);
  session.persistTimer.unref?.();
}

async function openSession(key: string, label: string, driverId: number, settings: LiveVideoSettings): Promise<Session> {
  const now = Date.now();
  let state = newSourceState(key, now, settings.autoMode ? 'auto' : 'manual');
  state.autoSetting = settings.autoMode;
  state.heldBySetting = !settings.autoMode;
  try {
    const saved = await readSourceState(key, RESTORE_MS);
    if (saved) state = restoreSourceState(saved, now);
  } catch (error) {
    console.error('Live video source restore error:', error);
  }
  if (now - runtime.purgedAt > 60 * 60_000) {
    runtime.purgedAt = now;
    purgeSourceStates().catch(() => undefined);
  }
  const session: Session = { key, label, driverId, state, lastTick: 0, viewers: new Map(), streamId: null, persistTimer: null };
  runtime.sessions.set(key, session);
  return session;
}

function tick(session: Session, settings: LiveVideoSettings, stream: ViewerStream | null, now: number): void {
  if (now - session.lastTick < TICK_MIN_MS) return;
  session.lastTick = now;
  // The Admin switched automatic direction off (whatever's on stays, as a manual choice) or back on
  const modeChanged = followAutoSetting(session.state, settings.autoMode, now);
  const feed = readDirectorFeed(session.driverId);
  const moment = feed ? currentMoment(feed.events, feed.context, now, settings.momentSeconds * 1000) : null;
  const ownerIdx = stream ? liveSessionOf(stream.ownerId)?.carIdx ?? null : null;
  const subjectCars = settings.cameraSubject === 'streamDriver' && ownerIdx != null ? [ownerIdx] : null;
  const streamLive = stream?.status === 'LIVE';
  // The rotation runs while the director is automatic and OBS is live; the Broadcast Director then fits its clips
  // between the map's turn and the next OBS turn, and its clips' returns restart the cycle
  const rotating = settings.rotation.enabled && session.state.mode === 'auto' && streamLive;
  noteCameraRotation(session.key, rotating ? settings.rotation : null, now);
  const rotationAnchor = rotating ? clipAnchor(session.key, now) : null;
  const before = session.state.source;
  const changed = sourceTick(session.state, { now, settings, streamLive, moment, subjectCars, rotationAnchor });
  if (changed || modeChanged) {
    if (before !== session.state.source) console.log(`Live video [${session.key}]: ${before} -> ${session.state.source} (${session.state.reason})`);
    persist(session);
  }
}

// A TV's picture of the race asks for this each time: counts the TV as watching and answers its camera and stream, or
// null when live video is off
export async function observeLiveVideo(
  viewer: Pick<User, 'id' | 'role'>,
  viewerKey: string,
  session: { key: string; label: string; driverId: number; offline: boolean }
): Promise<TvLiveVideo | null> {
  const settings = await getLiveVideoSettings();
  if (!(await liveVideoOn(settings))) return null;
  let found = runtime.sessions.get(session.key);
  if (!found) {
    let loading = runtime.loading.get(session.key);
    if (!loading) {
      loading = openSession(session.key, session.label, session.driverId, settings).finally(() => runtime.loading.delete(session.key));
      runtime.loading.set(session.key, loading);
    }
    found = await loading;
  }
  const now = Date.now();
  found.driverId = session.driverId;
  found.label = session.label;
  found.viewers.set(viewerKey, { key: viewerKey, userId: viewer.id, lastSeen: now });
  for (const [key, v] of found.viewers) if (now - v.lastSeen > VIEWER_GONE_MS) found.viewers.delete(key);
  for (const [key, s] of runtime.sessions) if (s !== found && [...s.viewers.values()].every((v) => now - v.lastSeen > VIEWER_GONE_MS)) runtime.sessions.delete(key);

  const [streams, allowed] = await Promise.all([enabledStreams(), watchableDrivers(viewer)]);
  const chosen = session.offline ? null : streamFor(streams, session.driverId, allowed);
  const stream = chosen ? await viewerStream(chosen) : null;
  found.streamId = chosen?.id ?? null;
  tick(found, settings, stream, now);
  return { source: sourceSnapshot(found.state, settings), stream, sync: settings.sync, obsVolume: settings.obsVolume, duckLevel: settings.duckLevel };
}

// The Live Racing page: the streams of every driver this viewer may watch, live or not
export async function liveRacingStreams(viewer: Pick<User, 'id' | 'role'>): Promise<{ streams: ViewerStream[]; settings: Pick<LiveVideoSettings, 'sync' | 'obsVolume' | 'duckLevel'> } | null> {
  const settings = await getLiveVideoSettings();
  if (!settings.liveRacingEnabled || !(await liveVideoOn(settings))) return null;
  const [streams, allowed] = await Promise.all([enabledStreams(), watchableDrivers(viewer)]);
  const mine = streams.filter((s) => allowed === 'all' || allowed.has(s.userId));
  return { streams: await Promise.all(mine.map(viewerStream)), settings: { sync: settings.sync, obsVolume: settings.obsVolume, duckLevel: settings.duckLevel } };
}

export function recordTvReport(report: TvVideoReport): void {
  runtime.reports.set(report.viewer, report);
  const now = Date.now();
  for (const [key, r] of runtime.reports) if (now - r.at > 5 * 60_000) runtime.reports.delete(key);
}

// The Admin page

export type LiveVideoSessionView = {
  key: string;
  label: string;
  viewers: number;
  streamId: number | null;
  source: SourceSnapshot;
  serverNow: number;
};

export function liveVideoSessions(settings: LiveVideoSettings): LiveVideoSessionView[] {
  const now = Date.now();
  return [...runtime.sessions.values()].map((s) => ({
    key: s.key,
    label: s.label,
    viewers: [...s.viewers.values()].filter((v) => now - v.lastSeen <= VIEWER_GONE_MS).length,
    streamId: s.streamId,
    source: sourceSnapshot(s.state, settings),
    serverNow: now,
  }));
}

export const tvReports = (): TvVideoReport[] => [...runtime.reports.values()].sort((a, b) => b.at - a.at);

export type SourceCommand = { sessionKey: string; action: 'select'; source: CameraSource } | { sessionKey: string; action: 'auto' };

export function sourceCommand(command: SourceCommand): 'ok' | 'noSession' {
  const session = runtime.sessions.get(command.sessionKey);
  if (!session) return 'noSession';
  const now = Date.now();
  if (command.action === 'select') selectManual(session.state, command.source, now);
  else selectAutomatic(session.state, now);
  // Applies at once rather than at the next TV's picture
  session.lastTick = 0;
  persist(session);
  return 'ok';
}
