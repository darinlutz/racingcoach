import { areaStats, brakeFeet, lapSamplesFromText, sameTrackName, type Track } from './lapData';
import { readTargetLap, targetLapTrackName } from './targetLap';
import { lapCsvTrackLengthFeet } from './trackLengths';

// The focus areas' targets (brakepoint, max brake pressure, throttle pickup) everywhere they're used: the overlay,
// the brake beeps, Debrief Coach, Multi-Lap Analysis and the In-Car AI Coach. They only ever come from the user's
// Target Lap (src/lib/targetLap.ts), never from Track Data, so without a Target Lap of the track there are none.

export type TargetLap = { fileName: string; csv: string };

// A Track with its areas' targets from the Target Lap: where it first brakes in each area (feet from the
// start/finish line), its max brake there (%), and where the throttle comes back after that braking (feet); null
// for one it doesn't have, and all null without a lap. Feet need the track's length: iRacing's (Track Data's
// lengthFeet) or the lap's own.
export function withTargetLap(track: Track, lap: TargetLap | null): Track {
  const samples = lap ? lapSamplesFromText(lap.csv) : null;
  const lengthFeet = lap ? (track.lengthFeet ?? lapCsvTrackLengthFeet(lap.csv)) : null;
  const feet = (pct: number | null | undefined) => (pct != null && lengthFeet ? brakeFeet(pct, lengthFeet) : null);
  return {
    ...track,
    areas: track.areas.map((area) => {
      const stats = samples && area.start !== null && area.end !== null ? areaStats(samples, 1, area.start, area.end) : null;
      return {
        ...area,
        brakepointTarget: feet(stats?.brakePct),
        maxBrakeTarget: stats ? Math.round(stats.maxBrake * 100) : null,
        throttlePickupTarget: feet(stats?.throttlePct),
      };
    }),
  };
}

// Whether a Target Lap is of a track: its file name names the track, or doesn't follow the Garage 61 / RacingCoach
// naming (then it can't be told, and it's taken as this track when `unnamedMatches`)
export function targetLapIsOf(lap: TargetLap, trackNames: string[], unnamedMatches: boolean): boolean {
  const lapTrack = targetLapTrackName(lap.fileName);
  return lapTrack === null ? unnamedMatches : trackNames.some((name) => sameTrackName(lapTrack, name));
}

// The user's tracks (lapData shape) with targets from their Target Lap on the track it's of, and none on the others
export async function tracksWithTargetLap(userId: number, tracks: Track[]): Promise<Track[]> {
  const lap = await readTargetLap(userId);
  return tracks.map((track) => withTargetLap(track, lap && targetLapIsOf(lap, [track.fileName], false) ? lap : null));
}
