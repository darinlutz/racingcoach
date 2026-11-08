// What the satellite tile proxy (/api/map-tiles/[z]/[x]/[y]) may fetch from the imagery provider, which bills per
// tile: a shared cache, so a track's tiles are fetched once for everyone, and daily budgets of fetches (cache
// misses only) per user and for the whole site, so no account can scrape imagery on the site's key. Counted in this
// server's memory, like the other abuse guards (one web instance); a restart starts the day's counts over.
// MAP_TILE_DAILY_LIMIT_PER_USER and MAP_TILE_DAILY_LIMIT override the defaults.

const DEFAULT_PER_USER = 3_000;
const DEFAULT_TOTAL = 100_000;
const CACHE_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const tileLimits = () => ({
  perUser: limitFromEnv('MAP_TILE_DAILY_LIMIT_PER_USER', DEFAULT_PER_USER),
  total: limitFromEnv('MAP_TILE_DAILY_LIMIT', DEFAULT_TOTAL),
});

type Tile = { body: ArrayBuffer; contentType: string; at: number };

const cache = new Map<string, Tile>();
let cacheBytes = 0;

export function cachedTile(key: string, now = Date.now()): Tile | null {
  const tile = cache.get(key);
  if (!tile) return null;
  if (now - tile.at > CACHE_TTL_MS) {
    cache.delete(key);
    cacheBytes -= tile.body.byteLength;
    return null;
  }
  // Most recently used last, so the oldest is dropped first
  cache.delete(key);
  cache.set(key, tile);
  return tile;
}

export function cacheTile(key: string, body: ArrayBuffer, contentType: string, now = Date.now()): void {
  if (body.byteLength > CACHE_BYTES / 64) return;
  const old = cache.get(key);
  if (old) {
    cache.delete(key);
    cacheBytes -= old.body.byteLength;
  }
  cache.set(key, { body, contentType, at: now });
  cacheBytes += body.byteLength;
  for (const [oldest, tile] of cache) {
    if (cacheBytes <= CACHE_BYTES) break;
    cache.delete(oldest);
    cacheBytes -= tile.body.byteLength;
  }
}

// Fetches counted today (UTC), per user and in all
let day = '';
const perUser = new Map<number, number>();
let total = 0;

function rollDay(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    perUser.clear();
    total = 0;
  }
}

// Takes one fetch from the user's and the site's budgets for today; false (nothing taken) when either is used up
export function takeTileFetch(userId: number, now = Date.now()): 'ok' | 'user' | 'site' {
  rollDay(now);
  const limits = tileLimits();
  if (total >= limits.total) return 'site';
  const used = perUser.get(userId) ?? 0;
  if (used >= limits.perUser) return 'user';
  perUser.set(userId, used + 1);
  total += 1;
  return 'ok';
}

// Gives a fetch back when the provider didn't answer with a tile
export function returnTileFetch(userId: number): void {
  const used = perUser.get(userId) ?? 0;
  if (used > 0) perUser.set(userId, used - 1);
  if (total > 0) total -= 1;
}

// For tests
export function resetTileBudget(): void {
  day = '';
  perUser.clear();
  total = 0;
  cache.clear();
  cacheBytes = 0;
}

// Tiles fetched from the provider so far today (UTC), for the spend monitor (src/lib/spendMonitor.ts)
export function tileFetchesToday(now = Date.now()): number {
  rollDay(now);
  return total;
}
