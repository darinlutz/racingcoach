import { NextResponse } from 'next/server';
import { MAX_TILE_ZOOM, satelliteTileUrl } from '@/lib/mapTiles';
import { cachedTile, cacheTile, returnTileFetch, takeTileFetch } from '@/lib/mapTileBudget';
import { getCurrentUser } from '@/lib/session';
import { getTvSession } from '@/lib/tvAuth';
import { authenticateCollectorCached } from '@/lib/collectorKeys';
import { apiText } from '@/lib/i18n/server';

// One satellite imagery tile (Web Mercator z/x/y) for Lap Compare's track position maps, fetched from
// the provider in SATELLITE_TILE_URL (src/lib/mapTiles.ts). Signed-in users and paired TVs (TV Broadcast Mode's
// map, src/lib/tvAuth.ts) only, so the provider key can't be used through here by anyone else.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const t = await apiText();
  try {
    const user = (await getCurrentUser())?.id ?? (await getTvSession())?.user.id ?? (await authenticateCollectorCached(request));
    if (user == null) {
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
    // Imagery changes rarely; the browser keeps tiles for a week
    const headers = (contentType: string) => ({ 'Content-Type': contentType, 'Cache-Control': 'private, max-age=604800' });
    const key = `${zoom}/${column}/${row}`;
    const cached = cachedTile(key);
    if (cached) return new Response(cached.body, { headers: headers(cached.contentType) });

    // The provider bills per tile: only so many fetches a day per user and for the site (src/lib/mapTileBudget.ts)
    const budget = takeTileFetch(user);
    if (budget !== 'ok') {
      console.error(`Map tile ${key} refused: ${budget === 'user' ? `user ${user}'s` : "the site's"} daily tile budget is used up`);
      return NextResponse.json({ error: 'Tile limit reached for today' }, { status: 429, headers: { 'Retry-After': '3600' } });
    }
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((error) => {
      returnTileFetch(user);
      throw error;
    });
    if (!upstream.ok) {
      returnTileFetch(user);
      console.error(`Map tile ${key}: provider answered ${upstream.status}`);
      return NextResponse.json({ error: 'Tile unavailable' }, { status: 502 });
    }
    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    cacheTile(key, body, contentType);
    return new Response(body, { headers: headers(contentType) });
  } catch (error) {
    console.error('Map tile error:', error);
    return NextResponse.json({ error: 'Tile unavailable' }, { status: 502 });
  }
}
