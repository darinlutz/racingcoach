import { carRpmLimit } from './carData';
import { readCollectorLapsByClientId } from './collectorLaps';
import type { DebriefSession } from './debriefCoach';
import { measureDebriefSession } from './debriefSession';
import type { InCarLap } from './inCarCoach';
import { lapSamplesFromText } from './lapData';
import { readTargetLap } from './targetLap';
import { lapSurfaceTemp, tireWarmup, type TireWarmup } from './tireWarmup';
import { targetLapIsOf, withTargetLap } from './targetLapTargets';
import { findTrackByKey, readTracks, toLapTrack } from './tracks';

// The laps of a collector session uploaded so far (by clientLapId, oldest first) measured in the track's focus areas,
// as Debrief Coach does, for the In-Car AI Coach's lap feedback and the Race Engineer. The areas' targets come only
// from the Target Lap (targetLapTargets.ts). Null when none of the laps have been uploaded.
export type CollectorSession = {
  track: string;
  car: string;
  laps: InCarLap[];
  // null when the track isn't in Track Data
  session: DebriefSession | null;
  // The car's rev limit from the user's Car Data, for get_shifting_points
  carRpmLimit: number | null;
  // Whether the newest lap's tires are still cold (src/lib/tireWarmup.ts)
  tires: TireWarmup | null;
};

export async function measureCollectorSession(userId: number, clientLapIds: string[]): Promise<CollectorSession | null> {
  const all = clientLapIds.length > 0 ? await readCollectorLapsByClientId(userId, clientLapIds) : [];
  if (all.length === 0) return null;
  // One session is one track; the newest lap's
  const trackName = all[all.length - 1].track;
  const sameTrack = all.filter((lap) => lap.track === trackName);
  // Named by iRacing's lap number ("Lap 3"), or by order when two share one
  const unique = new Set(sameTrack.map((lap) => lap.lapNumber)).size === sameTrack.length;
  const laps = sameTrack.map((lap, i) => ({ ...lap, id: `Lap ${unique ? lap.lapNumber : i + 1}` }));
  const userTrack = findTrackByKey(await readTracks(), all[all.length - 1].trackKey);
  const targetLap = userTrack ? await readTargetLap(userId) : null;
  const samples = laps.map((lap) => lapSamplesFromText(lap.csv));
  const session = userTrack
    ? measureDebriefSession(
        withTargetLap(toLapTrack(userTrack), targetLap && targetLapIsOf(targetLap, [trackName, userTrack.name], true) ? targetLap : null),
        laps[0].car,
        laps.map((lap, i) => ({ id: lap.id, lapSeconds: lap.lapTimeSeconds, samples: samples[i] }))
      )
    : null;
  const tires = tireWarmup(
    laps.map((lap, i) => ({
      lapNumber: lap.lapNumber,
      lapSeconds: lap.lapTimeSeconds,
      completedAt: lap.completedAt,
      surfaceC: samples[i] ? lapSurfaceTemp(samples[i]!.tireTemps, samples[i]!.tireLayers) : null,
    }))
  );
  return {
    track: trackName,
    car: laps[0].car,
    laps: laps.map((lap) => ({
      id: lap.id,
      lapNumber: lap.lapNumber,
      lapSeconds: lap.lapTimeSeconds,
      incidents: lap.incidents,
      offTrack: lap.offTrack,
    })),
    session,
    carRpmLimit: await carRpmLimit(laps[0].car).catch(() => null),
    tires,
  };
}
