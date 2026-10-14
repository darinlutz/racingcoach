import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { areaStats, lapSamplesFromText, sameTrackName } from '@/lib/lapData';
import { readTargetLap, targetLapTrackName } from '@/lib/targetLap';
import { findTrackByName, readTracks } from '@/lib/tracks';
import { getUserById } from '@/lib/users';

// The telemetry collector's "Play beeps before braking" (BrakeBeeps.cs): where the user's Target Lap first brakes
// in each focus area of the track being driven, or without a Target Lap, the focus areas' target brakepoints from
// Track Data. Authenticated with the upload key as a bearer token, like /api/collector/track.
//   ?track=  iRacing's track name as the collector writes it, e.g. "Road Atlanta (Full Course)"
// Answers enabled ("Play beeps before braking" on the Account page), trackLengthFeet (Track Data's, 0 when it isn't
// set or there's no such track), targetLap (its file name, the track that names, or null when the user has none),
// sameTrack (false when the Target Lap's file name names another track; null when it doesn't say) and
// brakepoints, per focus area in Track Data order: with a Target Lap, where its first braking zone in the area
// starts as pct, a fraction of a lap (areas it doesn't brake in left out); without one, the area's target
// brakepoint from Track Data as feet from the start/finish line (areas without one left out). Brakepoints are empty when beeps are off, there's no such track, or the Target Lap is from another track.
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    const user = userId === null ? null : await getUserById(userId);
    if (userId === null || !user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const trackName = new URL(request.url).searchParams.get('track')?.trim();
    if (!trackName) {
      return NextResponse.json({ error: 'track is required' }, { status: 400 });
    }

    const track = findTrackByName(await readTracks(userId), trackName);
    const lap = user.brakeBeeps ? await readTargetLap(userId) : null;
    const lapTrack = lap ? targetLapTrackName(lap.fileName) : null;
    const sameTrack = lapTrack ? sameTrackName(lapTrack, trackName) : null;

    const brakepoints: { area: string; pct?: number; feet?: number }[] = [];
    if (track && user.brakeBeeps && !lap) {
      // No Target Lap: Track Data's targets, which the collector turns into lap fractions with the track's length
      // (iRacing's when Track Data has none)
      for (const area of [...track.areas].sort((a, b) => a.position - b.position)) {
        if (area.brakePointFeet) brakepoints.push({ area: area.name, feet: area.brakePointFeet });
      }
    } else if (track && lap && sameTrack !== false) {
      const samples = lapSamplesFromText(lap.csv);
      for (const area of [...track.areas].sort((a, b) => a.position - b.position)) {
        // brakePct is where Brake first goes over 0% inside the area: its first braking zone. Unwrapped, so back
        // to 0-1 around the start/finish line
        const brakePct = areaStats(samples, 1, area.startPoint, area.endPoint)?.brakePct;
        if (brakePct != null) brakepoints.push({ area: area.name, pct: ((brakePct % 1) + 1) % 1 });
      }
    }

    return NextResponse.json({
      enabled: user.brakeBeeps,
      trackLengthFeet: track?.lengthFeet ?? 0,
      targetLap: lap ? { fileName: lap.fileName, track: lapTrack } : null,
      sameTrack,
      brakepoints,
    });
  } catch (error) {
    console.error('Collector brake beeps error:', error);
    return NextResponse.json({ error: 'Failed to load the brakepoints' }, { status: 500 });
  }
}
