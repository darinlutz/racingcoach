import { carRpmLimit } from './carData';
import { readCollectorLapsByClientId } from './collectorLaps';
import type { DebriefSession } from './debriefCoach';
import { measureDebriefSession } from './debriefSession';
import type { InCarLap } from './inCarCoach';
import { lapSamplesFromText } from './lapData';
import { readTargetLap } from './targetLap';
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
};

export async function measureCollectorSession(userId: number, clientLapIds: string[]): Promise<CollectorSession | null> {
  const all = clientLapIds.length > 0 ? await readCollectorLapsByClientId(userId, clientLapIds) : [];
  if (all.length === 0) return null;
  // One session is one track; the newest lap's
  const trackName = all[all.length - 1].track;
  const laps = all.filter((lap) => lap.track === trackName).map((lap) => ({ ...lap, id: lap.clientLapId.slice(-4) }));
  const userTrack = findTrackByKey(await readTracks(), all[all.length - 1].trackKey);
  const targetLap = userTrack ? await readTargetLap(userId) : null;
  const session = userTrack
    ? measureDebriefSession(
        withTargetLap(toLapTrack(userTrack), targetLap && targetLapIsOf(targetLap, [trackName, userTrack.name], true) ? targetLap : null),
        laps[0].car,
        laps.map((lap) => ({ id: lap.id, lapSeconds: lap.lapTimeSeconds, samples: lapSamplesFromText(lap.csv) }))
      )
    : null;
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
    carRpmLimit: await carRpmLimit(userId, laps[0].car).catch(() => null),
  };
}
