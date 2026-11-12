// What the camera's rotation (broadcastSourceRuntime.ts) and the Broadcast Director's clip rotation
// (videoDirectorRuntime.ts) tell each other about one race session, so the two make one cycle: OBS, the track map, a
// clip, then OBS again (docs/live-video.md). In this server's memory, by the session key both use, and never imported
// by either the other way round. Each side's word goes stale when it stops ticking (nobody watching, or turned off).

const STALE_MS = 10_000;

type CameraRotation = { obsSeconds: number; mapSeconds: number; at: number };
type ClipAnchor = { anchor: number; at: number };

const store = globalThis as unknown as { liveVideoRotation?: { camera: Map<string, CameraRotation>; clips: Map<string, ClipAnchor> } };
const links = (store.liveVideoRotation ??= { camera: new Map(), clips: new Map() });

// The camera side: its rotation is running for this session (automatic, OBS live), or not (null)
export function noteCameraRotation(key: string, rotation: { obsSeconds: number; mapSeconds: number } | null, now: number): void {
  if (rotation) links.camera.set(key, { ...rotation, at: now });
  else links.camera.delete(key);
}

// The Director's side: the camera's rotation, when it's running, whose OBS and map turns come between its clips
export function cameraRotation(key: string, now: number): { obsSeconds: number; mapSeconds: number } | null {
  const r = links.camera.get(key);
  if (!r || now - r.at > STALE_MS) return null;
  return { obsSeconds: r.obsSeconds, mapSeconds: r.mapSeconds };
}

// The Director's side: when its latest clip hands back to the camera (the return of one scheduled or on screen, which
// may be ahead), else when it started; null for none
export function noteClipAnchor(key: string, anchor: number | null, now: number): void {
  if (anchor == null) links.clips.delete(key);
  else links.clips.set(key, { anchor, at: now });
}

export function clipAnchor(key: string, now: number): number | null {
  const c = links.clips.get(key);
  if (!c || now - c.at > STALE_MS) return null;
  return c.anchor;
}
