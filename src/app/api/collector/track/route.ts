import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { sameTrackName } from '@/lib/lapData';
import { readTracks } from '@/lib/tracks';

// The telemetry collector's overlay: the user's Track Data track for the track they're driving, with its
// focus areas, which the collector hands to TelemetryEngine.js as its TrackConfig. Authenticated with the
// upload key as a bearer token, like /api/collector/laps.
//   ?name=  iRacing's track name as the collector writes it, e.g. "Road Atlanta (Full Course)"
// Answers { track: null } when the user has no such track in Track Data.
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const name = new URL(request.url).searchParams.get('name')?.trim();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Matched like recorded laps are on the Racing page (iRacing's names can differ slightly), or by track key
    const tracks = await readTracks(userId);
    const track =
      tracks.find((t) => sameTrackName(t.name, name)) ?? tracks.find((t) => t.key.toLowerCase() === name.toLowerCase());
    if (!track) {
      return NextResponse.json({ track: null });
    }

    // The same names and order as a track in the Track Data text file (trackFile.ts), which is what
    // TelemetryEngine.js reads; targets that aren't set are 0
    const areas = [...track.areas]
      .sort((a, b) => a.position - b.position)
      .map((area) => ({
        name: area.name,
        start: area.startPoint,
        end: area.endPoint,
        Notes: area.notes ?? '',
        BrakepointTarget: area.brakePointFeet ?? 0,
        MaxBrakeTarget: area.maxBrakePct ?? 0,
        ThrottlePickupTarget: area.throttlePointFeet ?? 0,
      }));
    return NextResponse.json({
      track: {
        TrackFileName: track.name,
        TrackLengthInFeet: track.lengthFeet ?? 0,
        Notes: track.notes ?? '',
        areas,
      },
    });
  } catch (error) {
    console.error('Collector track error:', error);
    return NextResponse.json({ error: 'Failed to load the track' }, { status: 500 });
  }
}
