import { NextResponse } from 'next/server';
import { google3dTilesKey, satelliteAttribution } from '@/lib/mapTiles';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// Whether satellite imagery is set up for Lap Compare's track position maps, and its credit line.
// Without it the maps draw the lines on a plain background. google3dKey is the browser key for
// Lap Compare's 3D view (Google's Photorealistic 3D Tiles), null when it isn't set up.
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInMaps }, { status: 401 });
    }
    const attribution = satelliteAttribution();
    return NextResponse.json({ available: attribution !== null, attribution, google3dKey: google3dTilesKey() });
  } catch (error) {
    console.error('Map tile settings error:', error);
    return NextResponse.json({ error: t.failedMapSettings }, { status: 500 });
  }
}
