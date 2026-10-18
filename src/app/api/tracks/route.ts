import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { backfillTrackBounds } from '@/lib/collectorLaps';
import { readTracks } from '@/lib/tracks';
import { apiText } from '@/lib/i18n/server';

// Track Data's tracks and focus areas, the same for every signed-in user. Read only.
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInTracks }, { status: 401 });
    }
    // Once per server start: tracks driven before their bounds were kept get them from stored laps
    await backfillTrackBounds();
    return NextResponse.json({ tracks: await readTracks() });
  } catch (error) {
    console.error('Read tracks error:', error);
    return NextResponse.json({ error: t.failedLoadTracks }, { status: 500 });
  }
}
