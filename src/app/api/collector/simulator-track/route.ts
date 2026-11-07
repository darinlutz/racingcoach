import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { query } from '@/lib/db';
import { resolveSimulatorTrack } from '@/lib/simulatorMappings';
import { acceptsLapsFrom, DEFAULT_SIMULATOR } from '@/lib/simulators';
import { ensureUserSchema } from '@/lib/users';

// Which Track Data track another simulator's track is, for the collector's live features (the In-Car AI Coach, brake
// beeps, overlays and Live Racing), which find the track by its Track Data key like iRacing's. The mapping is the Coach
// page's Simulator Mapping (simulatorMappings.ts); the track is recorded there as seen, so a Coach can map it.
// Authenticated with the upload key as a bearer token, like /api/collector/track.
//   ?simulator=  the simulator's id, e.g. "acc" (not iRacing, whose key is Track Data's already)
//   ?key=        its own id of the track, e.g. "spa"
//   ?name=       its name of the track (optional; the key otherwise)
// Answers { track: null } when it isn't mapped; otherwise track has trackKey, trackName and lengthFeet (Track Data's,
// null when unknown).
export async function GET(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const simulator = params.get('simulator')?.trim().toLowerCase() ?? '';
    const key = params.get('key')?.trim() ?? '';
    if (!key || !simulator || simulator === DEFAULT_SIMULATOR || !acceptsLapsFrom(simulator)) {
      return NextResponse.json({ error: 'A supported simulator other than iRacing and its track key are required' }, { status: 400 });
    }
    const name = params.get('name')?.trim() || key;
    await ensureUserSchema();
    const site = await resolveSimulatorTrack(simulator, key.slice(0, 200), name.slice(0, 200));
    if (!site.trackKey) return NextResponse.json({ track: null });
    const [row] = await query<{ track_length_feet: string | number | null }>(
      `SELECT track_length_feet FROM racingcoach."Tracks" WHERE lower(track_key) = lower($1) LIMIT 1`,
      [site.trackKey]
    );
    return NextResponse.json({
      track: {
        trackKey: site.trackKey,
        trackName: site.trackName,
        lengthFeet: row?.track_length_feet == null ? null : Math.round(Number(row.track_length_feet)),
      },
    });
  } catch (error) {
    console.error('Collector simulator track error:', error);
    return NextResponse.json({ error: 'Failed to look up the track' }, { status: 500 });
  }
}
