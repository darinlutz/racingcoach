import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { lapSamplesFromText } from '@/lib/lapData';
import { readTargetLap, targetLapTrackName } from '@/lib/targetLap';
import { findTrackByKey, namesSameTrack, readTracks } from '@/lib/tracks';
import { getUserById } from '@/lib/users';

// The telemetry collector's Target Telemetry window (and older collectors' Target Steering window):
// the brake, throttle and steering traces of the user's Target Lap (src/lib/targetLap.ts), to scroll past as they drive. Authenticated with the upload key as a
// bearer token, like /api/collector/track.
//   ?track=  iRacing's track name as the collector writes it, e.g. "Road Atlanta (Full Course)" (optional)
//   ?key=    iRacing's track key, e.g. "roadatlanta full" (optional), which finds the Track Data track (findTrackByKey)
// Answers { targetLap: null } when the user has no Target Lap; otherwise targetLap has its file name, the track
// its file name names (null when it doesn't follow the Garage 61 / RacingCoach naming), whether that's the track
// being driven (null when either is unknown), and pcts (LapDistPct, unwrapped so it keeps increasing past the
// start/finish line) with brakes and throttles (0-1), steerings (SteeringWheelAngle in radians, positive to the
// left) and speeds (m/s; Brake Practice's game times its beeps with them) per sample, and gearChanges, where it changed gear: { pct, from, gear } (pct unwrapped like pcts; empty when the
// lap file has no Gear column; neutral and reverse are skipped, so a shift through neutral is one change). trackLengthFeet is iRacing's length of the track, sent with collector laps of it (0 when there are none, or there's no such
// track), and units the user's Preferred Units.

export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (userId === null || !user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const trackName = params.get('track')?.trim() || null;

    const track = findTrackByKey(await readTracks(), params.get('key'));
    const trackLengthFeet = track?.lengthFeet ?? 0;
    const lap = await readTargetLap(userId);
    if (!lap) {
      return NextResponse.json({ targetLap: null, trackLengthFeet, units: user.units });
    }

    const { pcts, brakes, throttles, steerings, speeds, gears } = lapSamplesFromText(lap.csv);
    const lapTrack = targetLapTrackName(lap.fileName);
    return NextResponse.json({
      targetLap: {
        fileName: lap.fileName,
        track: lapTrack,
        sameTrack: lapTrack && trackName ? namesSameTrack(lapTrack, trackName, track) : null,
        // Rounded, as a lap is several thousand samples
        pcts: pcts.map((pct) => Math.round(pct * 1e6) / 1e6),
        brakes: brakes.map((brake) => Math.round(Math.min(Math.max(brake, 0), 1) * 1000) / 1000),
        throttles: throttles.map((throttle) => Math.round(Math.min(Math.max(throttle, 0), 1) * 1000) / 1000),
        steerings: steerings.map((steering) => Math.round(steering * 10000) / 10000),
        speeds: speeds.map((speed) => Math.round(speed * 100) / 100),
        gearChanges: gearChanges(pcts, gears),
      },
      trackLengthFeet,
      units: user.units,
    });
  } catch (error) {
    console.error('Collector target lap error:', error);
    return NextResponse.json({ error: 'Failed to load the Target Lap' }, { status: 500 });
  }
}

// Where the lap went into another forward gear, after the gear it started in
function gearChanges(pcts: number[], gears: number[]): { pct: number; from: number; gear: number }[] {
  const changes: { pct: number; from: number; gear: number }[] = [];
  let current: number | null = null;
  for (let i = 0; i < gears.length; i++) {
    const gear = gears[i];
    if (!Number.isFinite(gear) || gear < 1) continue;
    if (current !== null && gear !== current) {
      changes.push({ pct: Math.round(pcts[i] * 1e6) / 1e6, from: current, gear });
    }
    current = gear;
  }
  return changes;
}
