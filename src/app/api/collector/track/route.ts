import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { areaStats, brakeFeet, lapSamplesFromText } from '@/lib/lapData';
import { readTargetLap, targetLapTrackName } from '@/lib/targetLap';
import { lapCsvTrackLengthFeet } from '@/lib/trackLengths';
import { findTrackByKey, namesSameTrack, readTracks } from '@/lib/tracks';
import { getUserById } from '@/lib/users';

// The telemetry collector's overlay: the Track Data track for the track they're driving, with its
// focus areas, which the collector hands to TelemetryEngine.js as its TrackConfig. Authenticated with the
// upload key as a bearer token, like /api/collector/laps.
//   ?name=  iRacing's track name as the collector writes it, e.g. "Road Atlanta (Full Course)"
//   ?key=   iRacing's track key, e.g. "roadatlanta full", which finds the Track Data track (findTrackByKey)
// Answers { track: null } when there's no key or no such track in Track Data. Either way, units is the user's
// Preferred Units ("standard" or "metric"), which the overlay shows its distances and speeds in, and brakeBeeps
// is "Play beeps before braking" from the Account page (the collector's BrakeBeeps.cs).
// Each area's BrakepointTarget and MaxBrakeTarget (the overlay's Brake Point and Brake Pressure boxes) come from
// the user's Target Lap when they have one of this track, like the brake beeps: where it first brakes in the area
// (feet from the start/finish line) and its max brake there (%), 0 for an area it doesn't brake in. Only without
// a Target Lap of this track are they Track Data's targets.
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (userId === null || !user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const name = params.get('name')?.trim();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const track = findTrackByKey(await readTracks(), params.get('key'));
    if (!track) {
      return NextResponse.json({ track: null, units: user.units, brakeBeeps: user.brakeBeeps });
    }

    // The Target Lap, unless its file name names another track (as for the brake beeps)
    const lap = await readTargetLap(userId);
    const lapTrack = lap ? targetLapTrackName(lap.fileName) : null;
    const target = lap && (lapTrack === null || namesSameTrack(lapTrack, name, track)) ? lap : null;
    const samples = target ? lapSamplesFromText(target.csv) : null;
    // Feet as the overlay measures them: with the track's length from collector laps, or the lap's own
    const lengthFeet = target ? (track.lengthFeet ?? lapCsvTrackLengthFeet(target.csv)) : null;

    // The same names and order as a track in the Track Data text file (trackFile.ts), which is what
    // TelemetryEngine.js reads; targets that aren't set are 0
    const areas = [...track.areas]
      .sort((a, b) => a.position - b.position)
      .map((area) => {
        const stats = samples ? areaStats(samples, 1, area.startPoint, area.endPoint) : null;
        return {
          name: area.name,
          start: area.startPoint,
          end: area.endPoint,
          Notes: area.notes ?? '',
          BrakepointTarget: samples
            ? stats?.brakePct != null && lengthFeet ? brakeFeet(stats.brakePct, lengthFeet) : 0
            : (area.brakePointFeet ?? 0),
          MaxBrakeTarget: samples ? Math.round((stats?.maxBrake ?? 0) * 100) : (area.maxBrakePct ?? 0),
          ThrottlePickupTarget: area.throttlePointFeet ?? 0,
        };
      });
    return NextResponse.json({
      track: {
        TrackFileName: track.name,
        TrackLengthInFeet: track.lengthFeet ?? 0,
        Notes: track.notes ?? '',
        areas,
      },
      units: user.units,
      brakeBeeps: user.brakeBeeps,
    });
  } catch (error) {
    console.error('Collector track error:', error);
    return NextResponse.json({ error: 'Failed to load the track' }, { status: 500 });
  }
}
