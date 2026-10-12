// Builds the Debrief Coach's session data: every lap measured in every focus area. The browser builds it from
// dropped or recorded lap files (buildDebriefSession); the In-Car AI Coach builds it on the server from the
// collector's uploaded CSVs (measureDebriefSession).

import { brakingDetail, lineDetail, steeringDetail } from '@/lib/areaInputs';
import type { DebriefSession } from '@/lib/debriefCoach';
import {
  areaStats,
  areaTrace,
  brakeFeet,
  lapTimeToSeconds,
  MPH_PER_METER_PER_SECOND,
  readLapSamples,
  type LapFile,
  type LapSamples,
  type Track,
} from '@/lib/lapData';

// Short lap ID shown in the app and used by the agent, e.g. "ab12"
export const lapId = (lap: LapFile) => lap.fileId.slice(-4);

export type MeasuredLap = { id: string; lapSeconds: number; samples: LapSamples };

export async function buildDebriefSession(track: Track, laps: LapFile[]): Promise<DebriefSession> {
  const samples = await Promise.all(laps.map((lap) => readLapSamples(lap.file)));
  return measureDebriefSession(
    track,
    laps[0].carName,
    laps.map((lap, i) => ({ id: lapId(lap), lapSeconds: lapTimeToSeconds(lap.lapTime), samples: samples[i] }))
  );
}

export function measureDebriefSession(track: Track, car: string, laps: MeasuredLap[]): DebriefSession {
  const areas = track.areas.flatMap((area) => {
    const { start, end } = area;
    if (start === null || end === null) return [];

    const measured = laps.flatMap((lap) => {
      const stats = areaStats(lap.samples, lap.lapSeconds, start, end);
      const trace = areaTrace(lap.samples, lap.lapSeconds, start, end);
      return stats && trace ? [{ lap, stats, trace }] : [];
    });

    // The driving line is compared with the fastest lap through the area that has track positions
    const reference = measured
      .filter((m) => m.trace.positions)
      .reduce<(typeof measured)[number] | null>((best, m) => (!best || m.stats.seconds < best.stats.seconds ? m : best), null);

    const runs = measured.map(({ lap, stats, trace }) => ({
      lap: lap.id,
      seconds: stats.seconds,
      brakeFeet: stats.brakePct === null || !track.lengthFeet ? null : brakeFeet(stats.brakePct, track.lengthFeet),
      maxBrakePct: stats.maxBrake * 100,
      minSpeedMph: stats.minSpeed * MPH_PER_METER_PER_SECOND,
      exitSpeedMph: stats.exitSpeed * MPH_PER_METER_PER_SECOND,
      braking: brakingDetail(trace, track.lengthFeet),
      steering: steeringDetail(trace),
      line: reference ? lineDetail(trace, reference.trace) : null,
    }));

    return [
      {
        name: area.name,
        range: `${(start * 100).toFixed(0)}%-${(end * 100).toFixed(0)}%`,
        brakepointTarget: area.brakepointTarget,
        maxBrakeTarget: area.maxBrakeTarget,
        lineReference: reference ? reference.lap.id : null,
        runs,
      },
    ];
  });

  return {
    track: track.fileName,
    car,
    laps: laps.map((lap) => ({ id: lap.id, lapTime: lap.lapSeconds })),
    areas,
  };
}
