import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CollectorDebriefError, firstAreaDebrief } from '@/lib/collectorDebrief';
import { authenticateCollector } from '@/lib/collectorKeys';
import { readCollectorLapsByClientId } from '@/lib/collectorLaps';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { findTrackByName, readTracks } from '@/lib/tracks';
import { getUserById } from '@/lib/users';

const bodySchema = z.object({ clientLapIds: z.array(z.uuid()).min(1).max(20) });

// The telemetry collector's in-session debrief: the average time through the track's first focus area over
// laps it has uploaded (by clientLapId), which it reads out to the driver. Authenticated with the upload key
// as a bearer token, like /api/collector/laps. Answers { message, area, averageSeconds, laps }, or 422 with
// an error when it can't be worked out (e.g. the track isn't in Track Data).
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { clientLapIds: [uuid, ...] }' }, { status: 400 });
    }

    const laps = await readCollectorLapsByClientId(userId, parsed.data.clientLapIds);
    if (laps.length === 0) {
      return NextResponse.json({ error: 'None of those laps have been uploaded' }, { status: 404 });
    }
    const trackName = laps[0].track;
    const track = findTrackByName(await readTracks(), trackName);
    if (!track) {
      return NextResponse.json({ error: `${trackName} isn't in your Track Data` }, { status: 422 });
    }

    // Said in the user's Preferred Language
    const language = (await getUserById(userId))?.preferredLanguage ?? DEFAULT_LANGUAGE;
    return NextResponse.json(
      firstAreaDebrief(
        track,
        laps.filter((lap) => lap.track === trackName),
        language,
        getDictionary(language).coachSpeech.areaAverage
      )
    );
  } catch (error) {
    if (error instanceof CollectorDebriefError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error('Collector debrief error:', error);
    return NextResponse.json({ error: 'Failed to work out the debrief' }, { status: 500 });
  }
}
