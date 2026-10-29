import { NextResponse } from 'next/server';
import { satelliteAttribution } from '@/lib/mapTiles';
import { getCurrentUser } from '@/lib/session';
import { getTvSession } from '@/lib/tvAuth';
import { apiText } from '@/lib/i18n/server';

// Whether satellite imagery is set up for Lap Compare's track position maps, and its credit line.
// Without it the maps draw the lines on a plain background. Signed-in users and paired TVs (src/lib/tvAuth.ts).
export async function GET() {
  const t = await apiText();
  try {
    const user = (await getCurrentUser()) ?? (await getTvSession())?.user ?? null;
    if (!user) {
      return NextResponse.json({ error: t.logInMaps }, { status: 401 });
    }
    const attribution = satelliteAttribution();
    return NextResponse.json({ available: attribution !== null, attribution });
  } catch (error) {
    console.error('Map tile settings error:', error);
    return NextResponse.json({ error: t.failedMapSettings }, { status: 500 });
  }
}
