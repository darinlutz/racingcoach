import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { collectorRaceResultSchema, saveCollectorRaceResult } from '@/lib/raceHistory';

// A race result from the telemetry collector, read from iRacing's session info when a race session ends
// (or the driver leaves it), for Race Trends. Authenticated with the upload key as a bearer token, like
// /api/collector/laps. Sending the same race (subSessionId and sessionNum) again replaces it, unless the
// stored result is already final and this one isn't; answers { stored }.
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }

    const parsed = collectorRaceResultSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `Invalid race result: ${parsed.error.issues[0]?.message}` }, { status: 400 });
    }

    return NextResponse.json({ stored: await saveCollectorRaceResult(userId, parsed.data) });
  } catch (error) {
    console.error('Collector race result error:', error);
    return NextResponse.json({ error: 'Failed to save the race result' }, { status: 500 });
  }
}
