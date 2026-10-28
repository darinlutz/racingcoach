import { z } from 'zod';
import { query } from './db';
import { canSeeAllLaps, ROLES } from './roles';
import { OUTLINE_POINTS, type TrackOutline } from './trackOutlines';
import { ensureUserSchema, getUserById, type User } from './users';

// Live Racing: where each driver running the telemetry collector is right now, for the Live Racing page
// (src/app/live-racing/) and the collector's Live Racing tab. The collector posts the driver's live position and
// lap details twice a second while they're in the car (POST /api/collector/live), every few seconds otherwise.
//
// The positions are kept in this server's memory only, never in the database: they're out of date within seconds,
// and a restart only loses the last few. That assumes the site runs as one server instance; with more, each would
// see only the drivers whose collectors reach it, and this would have to move to shared storage (e.g. Postgres
// or Redis).
//
// Who can watch a driver (watchableDrivers): the driver themselves; Coaches and Admins, who can watch everyone (as
// they can open everyone's laps, canSeeAllLaps); everyone signed in can watch Coaches (as they can open Coaches'
// laps); and the accounts a driver added on the Live Racing page (racingcoach."LiveRacingWatchers"), e.g. friends.

// The collector's live update. Speeds in m/s, pedals 0-1, times in seconds, pct is LapDistPct (0-1)
export const liveUpdateSchema = z.object({
  track: z.string().trim().min(1).max(200),
  trackKey: z.string().trim().min(1).max(200).nullish(),
  car: z.string().trim().min(1).max(200),
  sessionType: z.string().trim().min(1).max(100).nullish(),
  onTrack: z.boolean(),
  onPitRoad: z.boolean().nullish(),
  lap: z.number().int().min(-1).max(100_000).nullish(),
  pct: z.number().min(0).max(1).nullish(),
  speed: z.number().min(0).max(200).nullish(),
  gear: z.number().int().min(-1).max(20).nullish(),
  rpm: z.number().min(0).max(30_000).nullish(),
  throttle: z.number().min(0).max(1).nullish(),
  brake: z.number().min(0).max(1).nullish(),
  currentLapTime: z.number().min(-1).max(86_400).nullish(),
  lastLapTime: z.number().min(-1).max(86_400).nullish(),
  bestLapTime: z.number().min(-1).max(86_400).nullish(),
  deltaToBest: z.number().min(-3600).max(3600).nullish(),
  position: z.number().int().min(0).max(1000).nullish(),
  incidents: z.number().int().min(0).max(10_000).nullish(),
  // The collector's approximate outline (meters east and north), sent while the track has no saved one
  outline: z
    .object({
      kind: z.literal('meters'),
      points: z.array(z.tuple([z.number().min(-1e6).max(1e6), z.number().min(-1e6).max(1e6)])).length(OUTLINE_POINTS),
    })
    .nullish(),
});

export type LiveUpdate = z.infer<typeof liveUpdateSchema>;

type LiveEntry = {
  userId: number;
  driver: string;
  update: Omit<LiveUpdate, 'outline'>;
  receivedAt: number;
  // The collector's approximate outline, and the track key it's for
  outline: TrackOutline | null;
  outlineTrackKey: string | null;
};

// After this long without an update a driver is shown as offline, and after EXPIRE_MS left out
export const STALE_MS = 15_000;
const EXPIRE_MS = 5 * 60_000;
// A page that asked for a driver within this long counts as watching them
const WATCHING_MS = 10_000;

// Kept on globalThis so the dev server's reloads don't lose it
const store = globalThis as unknown as {
  liveRacing?: { entries: Map<number, LiveEntry>; viewers: Map<number, Map<number, number>> };
};
const live = (store.liveRacing ??= { entries: new Map(), viewers: new Map() });

function expire(now: number) {
  for (const [userId, entry] of live.entries) if (now - entry.receivedAt > EXPIRE_MS) live.entries.delete(userId);
}

// Records a driver's live update; returns how many others are watching them right now and whether the collector
// should send its approximate outline (the track has none saved, and this driver hasn't sent one for it)
export function recordLiveUpdate(
  user: Pick<User, 'id' | 'userName' | 'role'>,
  update: LiveUpdate,
  savedOutline: boolean
): { watchers: number; needsOutline: boolean } {
  const now = Date.now();
  expire(now);
  const previous = live.entries.get(user.id);
  const { outline, ...rest } = update;
  const trackKey = update.trackKey?.toLowerCase() ?? null;
  let kept = previous && previous.outlineTrackKey === trackKey ? previous.outline : null;
  if (outline) kept = outline;
  live.entries.set(user.id, {
    userId: user.id,
    driver: user.userName,
    update: rest,
    receivedAt: now,
    outline: kept,
    outlineTrackKey: kept ? trackKey : null,
  });
  return { watchers: watcherCount(user.id, now), needsOutline: !!trackKey && !savedOutline && !kept };
}

// The collector stopped (closed, or iRacing closed)
export function clearLiveUpdate(userId: number): void {
  live.entries.delete(userId);
}

function watcherCount(driverId: number, now: number): number {
  const viewers = live.viewers.get(driverId);
  if (!viewers) return 0;
  let count = 0;
  for (const [viewerId, at] of viewers) {
    if (now - at > WATCHING_MS) viewers.delete(viewerId);
    else if (viewerId !== driverId) count++;
  }
  return count;
}

// Who this viewer may watch: everyone, or these driver IDs
export async function watchableDrivers(viewer: Pick<User, 'id' | 'role'>): Promise<'all' | Set<number>> {
  if (canSeeAllLaps(viewer.role)) return 'all';
  await ensureUserSchema();
  const rows = await query<{ id: number }>(
    `SELECT user_id AS id FROM racingcoach."LiveRacingWatchers" WHERE watcher_id = $1
     UNION SELECT id FROM racingcoach."Users" WHERE role = $2`,
    [viewer.id, ROLES.coach]
  );
  return new Set([viewer.id, ...rows.map((r) => r.id)]);
}

export type LiveDriver = Omit<LiveUpdate, 'outline'> & {
  userId: number;
  driver: string;
  isMe: boolean;
  // Milliseconds since the collector's last update; offline once past STALE_MS
  ageMs: number;
  offline: boolean;
  // The collector sent an approximate outline of this driver's track (GET /api/live/outline?driver= gives it)
  hasApproximateOutline: boolean;
};

// The live drivers this viewer may watch, each counted as watched by them
export async function readLiveDrivers(viewer: Pick<User, 'id' | 'role'>): Promise<LiveDriver[]> {
  const now = Date.now();
  expire(now);
  if (live.entries.size === 0) return [];
  const allowed = await watchableDrivers(viewer);
  const drivers: LiveDriver[] = [];
  for (const entry of live.entries.values()) {
    if (allowed !== 'all' && !allowed.has(entry.userId)) continue;
    let viewers = live.viewers.get(entry.userId);
    if (!viewers) live.viewers.set(entry.userId, (viewers = new Map()));
    viewers.set(viewer.id, now);
    const ageMs = now - entry.receivedAt;
    drivers.push({
      ...entry.update,
      userId: entry.userId,
      driver: entry.driver,
      isMe: entry.userId === viewer.id,
      ageMs,
      offline: ageMs > STALE_MS,
      hasApproximateOutline: !!entry.outline,
    });
  }
  return drivers.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.driver.localeCompare(b.driver));
}

// A driver's approximate outline of the track with this key, if this viewer may watch them
export async function readApproximateOutline(
  viewer: Pick<User, 'id' | 'role'>,
  driverId: number,
  trackKey: string
): Promise<TrackOutline | null> {
  const entry = live.entries.get(driverId);
  if (!entry?.outline || entry.outlineTrackKey !== trackKey.toLowerCase()) return null;
  const allowed = await watchableDrivers(viewer);
  return allowed === 'all' || allowed.has(driverId) ? entry.outline : null;
}

export type LiveWatcher = { id: number; userName: string; emailAddress: string };

// The accounts this driver lets watch them
export async function readWatchers(driverId: number): Promise<LiveWatcher[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; user_name: string; email_address: string }>(
    `SELECT u.id, u.user_name, u.email_address FROM racingcoach."LiveRacingWatchers" w
     JOIN racingcoach."Users" u ON u.id = w.watcher_id
     WHERE w.user_id = $1 ORDER BY lower(u.user_name)`,
    [driverId]
  );
  return rows.map((r) => ({ id: r.id, userName: r.user_name, emailAddress: r.email_address }));
}

// The drivers who let this account watch them
export async function readSharedWithMe(viewerId: number): Promise<{ id: number; userName: string }[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; user_name: string }>(
    `SELECT u.id, u.user_name FROM racingcoach."LiveRacingWatchers" w
     JOIN racingcoach."Users" u ON u.id = w.user_id
     WHERE w.watcher_id = $1 ORDER BY lower(u.user_name)`,
    [viewerId]
  );
  return rows.map((r) => ({ id: r.id, userName: r.user_name }));
}

// Lets the account with this email address watch the driver
export async function addWatcher(
  driverId: number,
  emailAddress: string
): Promise<{ status: 'added' | 'already' | 'self' | 'notFound'; watcher?: LiveWatcher }> {
  await ensureUserSchema();
  const [target] = await query<{ id: number; user_name: string; email_address: string }>(
    'SELECT id, user_name, email_address FROM racingcoach."Users" WHERE lower(email_address) = lower($1) LIMIT 1',
    [emailAddress.trim()]
  );
  if (!target) return { status: 'notFound' };
  if (target.id === driverId) return { status: 'self' };
  const watcher = { id: target.id, userName: target.user_name, emailAddress: target.email_address };
  const inserted = await query(
    `INSERT INTO racingcoach."LiveRacingWatchers" (user_id, watcher_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING watcher_id`,
    [driverId, target.id]
  );
  return { status: inserted.length > 0 ? 'added' : 'already', watcher };
}

export async function removeWatcher(driverId: number, watcherId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."LiveRacingWatchers" WHERE user_id = $1 AND watcher_id = $2', [driverId, watcherId]);
}

// The account behind a collector's live update, cached a minute (the name and role shown with its position)
const recentUsers = new Map<number, { user: Pick<User, 'id' | 'userName' | 'role'>; until: number }>();
export async function liveUser(userId: number): Promise<Pick<User, 'id' | 'userName' | 'role'> | null> {
  const cached = recentUsers.get(userId);
  if (cached && cached.until > Date.now()) return cached.user;
  const user = await getUserById(userId);
  if (!user) {
    recentUsers.delete(userId);
    return null;
  }
  const entry = { id: user.id, userName: user.userName, role: user.role };
  recentUsers.set(userId, { user: entry, until: Date.now() + 60_000 });
  return entry;
}
