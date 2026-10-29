import { NextResponse } from 'next/server';
import { satelliteAttribution } from '@/lib/mapTiles';
import { getCurrentUser } from '@/lib/session';
import { getTvSession } from '@/lib/tvAuth';
import { authenticateCollectorCached } from '@/lib/collectorKeys';
import { apiText } from '@/lib/i18n/server';

// Whether satellite imagery is set up for Lap Compare's track position maps, and its credit line.
// Without it the maps draw the lines on a plain background. Signed-in users, paired TVs (src/lib/tvAuth.ts) and the
// telemetry collector's Live Racing tab (upload key, TrackMapView.cs).
export async function GET(request: Request) {
  const t = await apiText();
  try {
    const user = (await getCurrentUser())?.id ?? (await getTvSession())?.user.id ?? (await authenticateCollectorCached(request));
    if (user == null) {
      return NextResponse.json({ error: t.logInMaps }, { status: 401 });
    }
    const attribution = satelliteAttribution();
    return NextResponse.json({ available: attribution !== null, attribution });
  } catch (error) {
    console.error('Map tile settings error:', error);
    return NextResponse.json({ error: t.failedMapSettings }, { status: 500 });
  }
}
