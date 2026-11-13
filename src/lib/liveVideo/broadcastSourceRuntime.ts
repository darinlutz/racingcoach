import { liveSessionOf, watchableDrivers } from '../liveRacing';
import { enabledStreams, getLiveVideoSettings, type LiveStream } from '../liveVideoDb';
import { meteredServicesOn } from '../meteredServices';
import type { User } from '../users';
import type { LiveVideoSettings } from './broadcastSource';
import { cachedHealth, playbackFor, streamConfig, streamHealth, type Playback } from './cloudflareStream';
import { noteObsLive } from './rotationLink';
import type { StreamStatus } from './streamRules';

// The live video each TV gets with its picture of the race (docs/live-video.md): the OBS stream of the session it
// follows, which TV Broadcast Mode always shows beside the track map. Nothing is chosen here any more: the Broadcast
// Director alone decides what the map's panel shows (the map, or a recorded clip). One entry per race session a TV
// watches, in this server's memory (one web instance, docs/tv-broadcast.md), for the Admin page's list of broadcasts;
// the session key is the Broadcast Director's, which is told when the session's OBS stream is live (rotationLink.ts).
//
// Which stream: the followed driver's own, else the stream of another driver in the same iRacing subsession, and only
// one the TV's account may watch on the Live Racing page (watchableDrivers); the same rule as the Live Racing page, so
// no new entitlement is invented. Off (the Admin's switch), or with the paid-services emergency stop on, no stream is
// offered and no Cloudflare request is made.

const VIEWER_GONE_MS = 20_000;

type Viewer = { key: string; userId: number; lastSeen: number };
type Session = {
  key: string;
  label: string;
  viewers: Map<string, Viewer>;
  stream: { id: number; name: string; status: StreamStatus } | null;
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
  liveVideoBroadcasts?: { sessions: Map<string, Session>; reports: Map<string, TvVideoReport> };
};
const runtime = (store.liveVideoBroadcasts ??= { sessions: new Map(), reports: new Map() });

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
  // The session's OBS stream, live or not; null when there's none for it (the map then has the whole width)
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

// A TV's picture of the race asks for this each time: counts the TV as watching and answers its stream, or null when
// live video is off
export async function observeLiveVideo(
  viewer: Pick<User, 'id' | 'role'>,
  viewerKey: string,
  session: { key: string; label: string; driverId: number; offline: boolean }
): Promise<TvLiveVideo | null> {
  const settings = await getLiveVideoSettings();
  if (!(await liveVideoOn(settings))) return null;
  let found = runtime.sessions.get(session.key);
  if (!found) {
    found = { key: session.key, label: session.label, viewers: new Map(), stream: null };
    runtime.sessions.set(session.key, found);
  }
  const now = Date.now();
  found.label = session.label;
  found.viewers.set(viewerKey, { key: viewerKey, userId: viewer.id, lastSeen: now });
  for (const [key, v] of found.viewers) if (now - v.lastSeen > VIEWER_GONE_MS) found.viewers.delete(key);
  for (const [key, s] of runtime.sessions) if (s !== found && [...s.viewers.values()].every((v) => now - v.lastSeen > VIEWER_GONE_MS)) runtime.sessions.delete(key);

  const [streams, allowed] = await Promise.all([enabledStreams(), watchableDrivers(viewer)]);
  const chosen = session.offline ? null : streamFor(streams, session.driverId, allowed);
  const stream = chosen ? await viewerStream(chosen) : null;
  found.stream = stream ? { id: stream.id, name: stream.name, status: stream.status } : null;
  noteObsLive(session.key, stream?.status === 'LIVE', now);
  return { stream, sync: settings.sync, obsVolume: settings.obsVolume, duckLevel: settings.duckLevel };
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
  // The OBS stream its TVs show beside the map, or null for none
  stream: { id: number; name: string; status: StreamStatus } | null;
};

export function liveVideoSessions(): LiveVideoSessionView[] {
  const now = Date.now();
  return [...runtime.sessions.values()]
    .map((s) => ({
      key: s.key,
      label: s.label,
      viewers: [...s.viewers.values()].filter((v) => now - v.lastSeen <= VIEWER_GONE_MS).length,
      stream: s.stream,
    }))
    .filter((s) => s.viewers > 0);
}

export const tvReports = (): TvVideoReport[] => [...runtime.reports.values()].sort((a, b) => b.at - a.at);
