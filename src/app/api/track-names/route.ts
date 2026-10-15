import { NextResponse } from 'next/server';
import type { Track } from '@/lib/lapData';
import { getCurrentUser } from '@/lib/session';
import { readTracks, toLapTrack } from '@/lib/tracks';
import { apiText } from '@/lib/i18n/server';

// Track Data's tracks and focus areas (the same for every user), for the Racing tabs that measure
// laps against focus areas, in the shape toLapTrack (tracks.ts) describes.
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInTrackNames }, { status: 401 });
    }
    const tracks: Track[] = (await readTracks()).map(toLapTrack);
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error('Failed to load tracks:', error);
    return NextResponse.json({ error: t.failedLoadYourTracks }, { status: 500 });
  }
}
