// Builds the Debrief Coach's session data in the browser: every lap measured in every focus area.

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
  type Track,
} from '@/lib/lapData';

// Short lap ID shown in the app and used by the agent, e.g. "ab12"
export const lapId = (lap: LapFile) => lap.fileId.slice(-4);

export async function buildDebriefSession(track: Track, laps: LapFile[]): Promise<DebriefSession> {
  const samples = await Promise.all(laps.map((lap) => readLapSamples(lap.file)));

  const areas = track.areas.flatMap((area) => {
    const { start, end } = area;
    if (start === null || end === null) return [];

    const measured = laps.flatMap((lap, i) => {
      const lapSeconds = lapTimeToSeconds(lap.lapTime);
      const stats = areaStats(samples[i], lapSeconds, start, end);
      const trace = areaTrace(samples[i], lapSeconds, start, end);
      return stats && trace ? [{ lap, stats, trace }] : [];
    });

    // The driving line is compared with the fastest lap through the area that has track positions
    const reference = measured
      .filter((m) => m.trace.positions)
      .reduce<(typeof measured)[number] | null>((best, m) => (!best || m.stats.seconds < best.stats.seconds ? m : best), null);

    const runs = measured.map(({ lap, stats, trace }) => ({
      lap: lapId(lap),
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
        lineReference: reference ? lapId(reference.lap) : null,
        runs,
      },
    ];
  });

  return {
    track: track.fileName,
    car: laps[0].carName,
    laps: laps.map((lap) => ({ id: lapId(lap), lapTime: lapTimeToSeconds(lap.lapTime) })),
    areas,
  };
}
