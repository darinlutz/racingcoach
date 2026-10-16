import { NextResponse } from 'next/server';
import type { Track } from '@/lib/lapData';
import { getCurrentUser } from '@/lib/session';
import { tracksWithTargetLap } from '@/lib/targetLapTargets';
import { readTracks, toLapTrack } from '@/lib/tracks';
import { apiText } from '@/lib/i18n/server';

// Track Data's tracks and focus areas (the same for every user), for the Racing tabs that measure
// laps against focus areas, in the shape toLapTrack (tracks.ts) describes. The areas' targets come from the user's
// Target Lap on the track it's of (targetLapTargets.ts), and are null on every other track.
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInTrackNames }, { status: 401 });
    }
    const tracks: Track[] = await tracksWithTargetLap(user.id, (await readTracks()).map(toLapTrack));
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error('Failed to load tracks:', error);
    return NextResponse.json({ error: t.failedLoadYourTracks }, { status: 500 });
  }
}
