import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { readTargetLap } from '@/lib/targetLap';
import { targetLapIsOf, withTargetLap } from '@/lib/targetLapTargets';
import { findTrackByKey, readTracks, toLapTrack } from '@/lib/tracks';
import { getUserById } from '@/lib/users';

// The telemetry collector's overlay: the Track Data track for the track they're driving, with its
// focus areas, which the collector hands to TelemetryEngine.js as its TrackConfig. Authenticated with the
// upload key as a bearer token, like /api/collector/laps.
//   ?name=  iRacing's track name as the collector writes it, e.g. "Road Atlanta (Full Course)"
//   ?key=   iRacing's track key, e.g. "roadatlanta full", which finds the Track Data track (findTrackByKey)
// Answers { track: null } when there's no key or no such track in Track Data. Either way, units is the user's
// Preferred Units ("standard" or "metric"), which the overlay shows its distances and speeds in, and brakeBeeps
// is "Play beeps before braking" from the Account page (the collector's BrakeBeeps.cs).
// Each area's BrakepointTarget, MaxBrakeTarget and ThrottlePickupTarget (the overlay's Brake Point and Brake
// Pressure boxes, and the script's throttle pickup) come only from the user's Target Lap, never from Track Data's
// targets: where it first brakes in the area (feet from the start/finish line), its max brake there (%) and where
// the throttle comes back after that braking (feet), 0 for one it doesn't have. targetLap says whether they're set:
// "set", "none" (the user has no Target Lap) or "otherTrack" (its file name names another track); all targets are 0
// unless it's "set", and the collector asks the driver to pick a Target Lap and press Reload.
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
      return NextResponse.json({ track: null, units: user.units, brakeBeeps: user.brakeBeeps, targetLap: null });
    }

    // The Target Lap, unless its file name names another track (as for the brake beeps)
    const lap = await readTargetLap(userId);
    const target = lap && targetLapIsOf(lap, [name, track.name], true) ? lap : null;
    const targetLap = target ? 'set' : lap ? 'otherTrack' : 'none';
    // Feet as the overlay measures them: with iRacing's length of the track (sent with collector laps), or the lap's own
    const targeted = withTargetLap(toLapTrack(track), target);

    // The same names and order as a track in the Track Data text file (trackFile.ts), which is what
    // TelemetryEngine.js reads; targets that aren't set are 0
    const areas = track.areas.map((area, i) => {
      const targets = targeted.areas[i];
      return {
        name: area.name,
        start: area.startPoint,
        end: area.endPoint,
        BrakepointTarget: targets.brakepointTarget ?? 0,
        MaxBrakeTarget: targets.maxBrakeTarget ?? 0,
        ThrottlePickupTarget: targets.throttlePickupTarget ?? 0,
      };
    });
    return NextResponse.json({
      track: {
        TrackFileName: track.name,
        TrackLengthInFeet: track.lengthFeet ?? 0,
        areas,
      },
      units: user.units,
      brakeBeeps: user.brakeBeeps,
      targetLap,
    });
  } catch (error) {
    console.error('Collector track error:', error);
    return NextResponse.json({ error: 'Failed to load the track' }, { status: 500 });
  }
}
