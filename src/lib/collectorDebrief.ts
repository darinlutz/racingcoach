// The collector's in-session debrief: once a few laps of a session have uploaded, the collector asks for the
// average time through the track's first focus area and reads it out to the driver. Measured with
// areaStats, the same as Debrief Coach measures each lap's areas (debriefSession.ts).

import { en } from './i18n/dictionaries/en';
import { fmt, LANGUAGE_LOCALES, type Language } from './i18n/languages';
import { areaStats, lapSamplesFromText } from './lapData';
import type { TrackData } from './tracks';

export type CollectorDebrief = {
  // What the collector says and logs, e.g. "Area 1 average time was 12.3 seconds"
  message: string;
  area: { position: number; name: string };
  averageSeconds: number;
  laps: { lapNumber: number; seconds: number }[];
};

// Why there's no debrief; the collector logs it
export class CollectorDebriefError extends Error {}

export function firstAreaDebrief(
  track: TrackData,
  laps: { lapNumber: number; lapTimeSeconds: number; csv: string }[],
  // The message in the user's language: the dictionary's coachSpeech.areaAverage
  language: Language = 'en',
  template: string = en.coachSpeech.areaAverage
): CollectorDebrief {
  const area = [...track.areas].sort((a, b) => a.position - b.position)[0];
  if (!area) {
    throw new CollectorDebriefError(`${track.name} has no focus areas in Track Data`);
  }

  const measured = laps.flatMap((lap) => {
    const stats = areaStats(lapSamplesFromText(lap.csv), lap.lapTimeSeconds, area.startPoint, area.endPoint);
    return stats ? [{ lapNumber: lap.lapNumber, seconds: stats.seconds }] : [];
  });
  if (measured.length === 0) {
    throw new CollectorDebriefError(`None of the laps cover ${area.name}`);
  }

  const averageSeconds = measured.reduce((sum, lap) => sum + lap.seconds, 0) / measured.length;
  return {
    message: fmt(template, {
      n: area.position,
      seconds: averageSeconds.toLocaleString(LANGUAGE_LOCALES[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    }),
    area: { position: area.position, name: area.name },
    averageSeconds,
    laps: measured,
  };
}
