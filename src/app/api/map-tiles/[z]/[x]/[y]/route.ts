import { NextResponse } from 'next/server';
import { MAX_TILE_ZOOM, satelliteTileUrl } from '@/lib/mapTiles';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// One satellite imagery tile (Web Mercator z/x/y) for Lap Compare's track position maps, fetched from
// the provider in SATELLITE_TILE_URL (src/lib/mapTiles.ts). Signed-in users only, so the provider key
// can't be used through here by anyone else.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInMaps }, { status: 401 });
    }
    const { z, x, y } = await params;
    const [zoom, column, row] = [z, x, y].map(Number);
    const tiles = 2 ** zoom;
    if (
      ![zoom, column, row].every(Number.isInteger) ||
      zoom < 0 ||
      zoom > MAX_TILE_ZOOM ||
      column < 0 ||
      column >= tiles ||
      row < 0 ||
      row >= tiles
    ) {
      return NextResponse.json({ error: 'Tile not found' }, { status: 404 });
    }

    const url = satelliteTileUrl(zoom, column, row);
    if (!url) {
      return NextResponse.json({ error: 'Satellite imagery is not set up' }, { status: 404 });
    }
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!upstream.ok) {
      console.error(`Map tile ${zoom}/${column}/${row}: provider answered ${upstream.status}`);
      return NextResponse.json({ error: 'Tile unavailable' }, { status: 502 });
    }
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        // Imagery changes rarely; the browser keeps tiles for a week
        'Cache-Control': 'private, max-age=604800',
      },
    });
  } catch (error) {
    console.error('Map tile error:', error);
    return NextResponse.json({ error: 'Tile unavailable' }, { status: 502 });
  }
}
