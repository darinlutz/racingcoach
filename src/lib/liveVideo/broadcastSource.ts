// Live video's settings (docs/live-video.md), saved in "SiteSettings" (key live_video) from the Admin page's Live Video
// & Broadcast Control. There's no camera to choose any more: TV Broadcast Mode always shows the OBS live video beside
// the track map, and the Broadcast Director's recorded clips (src/lib/videoDirector.ts) take the map's panel in turn
// with the map. No imports, so client components and Node's tests use it directly (npm run test:live-video).

// What a TV's map panel shows, for its diagnostics: the live track map, or a recorded clip over it
export type MapPanelSource = 'TRACK_MAP' | 'VIDEO_CLIP';

export type SyncMode = 'auto' | 'manual';

export type LiveVideoSettings = {
  // The feature flag: off, nothing of the live video reaches any page and no Cloudflare call is made
  enabled: boolean;
  // Shown on the Live Racing page (map, video, split view) as well as the TV
  liveRacingEnabled: boolean;
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
  // OBS audio is lowered to this share (0-1) while an announcer speaks or a recorded clip plays
  duckLevel: number;
};

export const DEFAULT_LIVE_VIDEO_SETTINGS: LiveVideoSettings = {
  enabled: false,
  liveRacingEnabled: true,
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

// What's saved, or sent by the Admin page, with anything missing or out of range as it was. Settings saved while the
// site still chose a camera (autoMode, rotation, preferences, ...) are read without them
export function parseLiveVideoSettings(raw: unknown, base: LiveVideoSettings = DEFAULT_LIVE_VIDEO_SETTINGS): LiveVideoSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const syncIn = r.sync && typeof r.sync === 'object' ? (r.sync as Record<string, unknown>) : {};
  const maxBufferMs = num(syncIn.maxBufferMs, 5000, MAX_SYNC_BUFFER_MS, base.sync.maxBufferMs);
  return {
    enabled: bool(r.enabled, base.enabled),
    liveRacingEnabled: bool(r.liveRacingEnabled, base.liveRacingEnabled),
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
