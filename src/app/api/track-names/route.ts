import { NextResponse } from 'next/server';
import type { Track } from '@/lib/lapData';
import { getCurrentUser } from '@/lib/session';
import { readTracks } from '@/lib/tracks';

// The signed-in user's tracks and focus areas from Track Data, for the Racing tabs that measure
// laps against focus areas. `name` is the track key and `fileName` the name Garage 61 puts in its CSV
// file names; start/end are fractions of a lap and the targets are null when not set.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to use your tracks from Track Data' }, { status: 401 });
    }
    const tracks: Track[] = (await readTracks(user.id)).map((track) => ({
      name: track.key,
      fileName: track.name,
      lengthFeet: track.lengthFeet,
      areas: track.areas.map((area) => ({
        name: area.name,
        start: area.startPoint,
        end: area.endPoint,
        brakepointTarget: area.brakePointFeet,
        maxBrakeTarget: area.maxBrakePct,
        throttlePickupTarget: area.throttlePointFeet,
      })),
    }));
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error('Failed to load tracks:', error);
    return NextResponse.json({ error: 'Failed to load your tracks' }, { status: 500 });
  }
}
