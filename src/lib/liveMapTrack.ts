import { backfillTrackBounds } from './collectorLaps';
import { readApproximateOutline } from './liveRacing';
import { readLiveTrack, type LiveTrack } from './trackOutlines';
import type { User } from './users';

// A Live Racing map's track (src/lib/trackOutlines.ts), for the Live Racing page (GET /api/live/outline) and TV
// Broadcast Mode (GET /api/tv/outline): its name, length, outline and focus areas by iRacing's track key; without a
// saved outline, the approximate one of a driver on that track the viewer may watch (approximate: true). Null when
// neither exists.
export type MapTrack = Omit<LiveTrack, 'name'> & { name: string | null; approximate: boolean };

export async function readMapTrack(viewer: Pick<User, 'id' | 'role'>, trackKey: string, driverId: number | null): Promise<MapTrack | null> {
  await backfillTrackBounds(); // tracks driven before outlines were kept
  const track = await readLiveTrack(trackKey);
  if (track?.outline) return { ...track, approximate: false };
  const outline = driverId ? await readApproximateOutline(viewer, driverId, trackKey) : null;
  if (!outline) return track && { ...track, approximate: false };
  return { name: track?.name ?? null, lengthFeet: track?.lengthFeet ?? null, areas: track?.areas ?? [], outline, approximate: true };
}
