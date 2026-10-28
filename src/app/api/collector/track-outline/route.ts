import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { backfillTrackBounds } from '@/lib/collectorLaps';
import { readLiveTrack } from '@/lib/trackOutlines';

// The collector's Live Racing tab: the outline of the track being driven (src/lib/trackOutlines.ts) and its Track
// Data focus areas. Authenticated with the upload key as a bearer token, like /api/collector/track.
//   ?key=  iRacing's track key, e.g. "roadatlanta full"
// Answers { track: null } when there's no track with that key; otherwise track has its name, lengthFeet (null when
// unknown), outline ({ kind: "latlon", points: [[lat, lon], ...] }, point i at LapDistPct i / points.length; null
// until a clean lap of the track has been uploaded with track positions) and areas ({ name, start, end } as shares
// of the lap).
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const key = new URL(request.url).searchParams.get('key')?.trim();
    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    await backfillTrackBounds(); // tracks driven before outlines were kept
    return NextResponse.json({ track: await readLiveTrack(key) });
  } catch (error) {
    console.error('Collector track outline error:', error);
    return NextResponse.json({ error: 'Failed to load the track outline' }, { status: 500 });
  }
}
