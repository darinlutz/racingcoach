import { NextResponse } from 'next/server';
import { satelliteAttribution } from '@/lib/mapTiles';
import { getCurrentUser } from '@/lib/session';

// Whether satellite imagery is set up for Lap Compare's track position maps, and its credit line.
// Without it the maps draw the lines on a plain background.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to see track maps' }, { status: 401 });
    }
    const attribution = satelliteAttribution();
    return NextResponse.json({ available: attribution !== null, attribution });
  } catch (error) {
    console.error('Map tile settings error:', error);
    return NextResponse.json({ error: 'Failed to load map settings' }, { status: 500 });
  }
}
