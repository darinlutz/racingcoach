// What the live video (broadcastSourceRuntime.ts) tells the Broadcast Director (videoDirectorRuntime.ts) about one race
// session: that its OBS stream is live on the TVs. The Director then takes turns between the track map and its recorded
// clips outside races too (practice, qualifying), as the OBS video beside them keeps the session on screen
// (docs/live-video.md). In this server's memory, by the session key both use. The word goes stale when the TVs stop
// asking (nobody watching, or live video turned off).

const STALE_MS = 10_000;

const store = globalThis as unknown as { liveVideoObs?: Map<string, number> };
const live = (store.liveVideoObs ??= new Map());

export function noteObsLive(key: string, isLive: boolean, now: number): void {
  if (isLive) live.set(key, now);
  else live.delete(key);
}

export function obsLive(key: string, now: number): boolean {
  const at = live.get(key);
  return at != null && now - at <= STALE_MS;
}
