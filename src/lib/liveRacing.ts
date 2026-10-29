import { z } from 'zod';
import { flagCodeForFlair } from './countryFlags';
import { query } from './db';
import { WEATHER_SAMPLE_MS, TREND_MS, weatherSample, weatherTrend, type WeatherSample, type WeatherTrend } from './liveWeather';
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
//
// Each update also has the field: every car in the driver's session (iRacing's CarIdx telemetry covers all of them),
// so a watcher sees the whole race, not just RacingCoach.app drivers. Its drivers' names, cars and classes come only
// when they change, or when this server doesn't have them (needsField), and are kept with the driver's live state.
// Anyone who may watch the driver sees their field, other drivers' names included, as anyone spectating in iRacing
// would.
//
// Watchers can also message a driver (queueDriverMessage, the page's Message Driver box): the message waits here
// until the driver's collector's next live update, whose answer carries it, and the collector says it in the
// driver's In-Car AI Coach voice. Only collectors that say they take messages (acceptsMessages, from 1.53.0) get them.

const lapSeconds = z.number().min(0).max(86_400).nullish();

// A car in the field as it is now; idx is iRacing's car index, rate its pace round the lap (laps per second)
const fieldCarSchema = z.object({
  idx: z.number().int().min(0).max(255),
  pct: z.number().min(0).max(1).nullish(),
  rate: z.number().min(0).max(0.1).nullish(),
  lap: z.number().int().min(0).max(100_000).nullish(),
  lapsDone: z.number().int().min(0).max(100_000).nullish(),
  position: z.number().int().min(1).max(1000).nullish(),
  classPosition: z.number().int().min(1).max(1000).nullish(),
  onPitRoad: z.boolean().nullish(),
  offTrack: z.boolean().nullish(),
  lastLapTime: lapSeconds,
  bestLapTime: lapSeconds,
  // In a race, the time behind the leader; otherwise iRacing's fastest lap time
  f2Time: lapSeconds,
  gear: z.number().int().min(-1).max(20).nullish(),
});

// A car's details from session info: driver, car number, car, class and class color ("#ffda59"), iRating, license,
// and the flair the driver picked in iRacing, normally their country (from collectors from 1.54.0)
const fieldDriverSchema = z.object({
  idx: z.number().int().min(0).max(255),
  name: z.string().trim().min(1).max(100),
  number: z.string().trim().max(10).nullish(),
  car: z.string().trim().max(200).nullish(),
  carClass: z.string().trim().max(100).nullish(),
  classColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
  iRating: z.number().int().min(0).max(20_000).nullish(),
  license: z.string().trim().max(20).nullish(),
  flair: z.string().trim().max(100).nullish(),
});

// The weather now (src/lib/liveWeather.ts says what each value is), from collectors from 1.54.0
const weatherSchema = z.object({
  type: z.string().trim().max(50).nullish(),
  airTemp: z.number().min(-200).max(300).nullish(),
  trackTemp: z.number().min(-200).max(300).nullish(),
  humidity: z.number().min(0).max(1).nullish(),
  windSpeed: z.number().min(0).max(200).nullish(),
  windDir: z.number().min(-1000).max(1000).nullish(),
  skies: z.number().int().min(0).max(3).nullish(),
  precipitation: z.number().min(0).max(1).nullish(),
  wetness: z.number().int().min(0).max(20).nullish(),
  declaredWet: z.boolean().nullish(),
  solarAltitude: z.number().min(-1000).max(1000).nullish(),
});

// The driver's inputs 20 times a second: [SessionTime, throttle 0-1, brake 0-1, steering (radians, + left), gear,
// speed (m/s), delta to best (s)]
const inputSampleSchema = z.tuple([
  z.number().min(0).max(1e7),
  z.number().min(0).max(1).nullable(),
  z.number().min(0).max(1).nullable(),
  z.number().min(-20).max(20).nullable(),
  z.number().int().min(-1).max(20).nullable(),
  z.number().min(0).max(200).nullable(),
  z.number().min(-3600).max(3600).nullable(),
]);

export type InputSample = z.infer<typeof inputSampleSchema>;
// How much of the driver's inputs the server keeps, in seconds of SessionTime
const INPUTS_KEPT_S = 12;

export type FieldCarUpdate = z.infer<typeof fieldCarSchema>;
// countryCode: the flag-icons code of the driver's flair (src/lib/countryFlags.ts), or null
export type FieldDriverDetails = z.infer<typeof fieldDriverSchema> & { countryCode: string | null };

// The collector's live update. Speeds in m/s, pedals 0-1, times in seconds, pct is LapDistPct (0-1)
export const liveUpdateSchema = z.object({
  track: z.string().trim().min(1).max(200),
  trackKey: z.string().trim().min(1).max(200).nullish(),
  car: z.string().trim().min(1).max(200),
  sessionType: z.string().trim().min(1).max(100).nullish(),
  // The session's name (e.g. "RACE", "HEAT 1"), iRacing's SessionFlags bits (src/lib/raceFlags.ts), its
  // SessionState and the weather now (from collectors from 1.54.0)
  sessionName: z.string().trim().min(1).max(100).nullish(),
  sessionFlags: z.number().int().min(0).max(0xffffffff).nullish(),
  sessionState: z.number().int().min(0).max(20).nullish(),
  weather: weatherSchema.nullish(),
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
  // Steering wheel angle in radians, + left
  steering: z.number().min(-20).max(20).nullish(),
  // The session's time and laps left, and its laps in all; null when unlimited (from collectors from 1.53.0)
  sessionTimeRemain: z.number().min(0).max(604_800).nullish(),
  sessionLapsRemain: z.number().int().min(0).max(100_000).nullish(),
  sessionLapsTotal: z.number().int().min(1).max(100_000).nullish(),
  // The collector says watchers' messages to the driver (from 1.53.0)
  acceptsMessages: z.boolean().nullish(),
  // The inputs since the last update (from collectors from 1.52.0)
  inputs: z.array(inputSampleSchema).max(200).nullish(),
  // The collector's approximate outline (meters east and north), sent while the track has no saved one
  outline: z
    .object({
      kind: z.literal('meters'),
      points: z.array(z.tuple([z.number().min(-1e6).max(1e6), z.number().min(-1e6).max(1e6)])).length(OUTLINE_POINTS),
    })
    .nullish(),
  // Every car in the session (from collectors from 1.52.0); subSessionId 0 offline, myCarIdx the driver's own car
  field: z
    .object({
      subSessionId: z.number().int().min(0),
      myCarIdx: z.number().int().min(0).max(255).nullish(),
      cars: z.array(fieldCarSchema).max(100),
      drivers: z.array(fieldDriverSchema).max(100).nullish(),
    })
    .nullish(),
});

export type LiveUpdate = z.infer<typeof liveUpdateSchema>;

// A car in a driver's field: its live state with its details (null until the collector has sent them)
export type FieldCar = FieldCarUpdate & { details: FieldDriverDetails | null };

export type LiveField = { subSessionId: number; myCarIdx: number | null; cars: FieldCar[] };

// A watcher's message to the driver, waiting for their collector's next update
type DriverMessage = { from: string; text: string; at: number };
export const MAX_MESSAGE_CHARS = 200;
// At most this many messages wait for a driver, a watcher sends one every MESSAGE_INTERVAL_MS, and an undelivered one
// is dropped after MESSAGE_EXPIRE_MS (the collector stopped sending updates)
const MAX_QUEUED_MESSAGES = 5;
const MESSAGE_INTERVAL_MS = 2000;
const MESSAGE_EXPIRE_MS = 60_000;

type LiveEntry = {
  userId: number;
  driver: string;
  update: Omit<LiveUpdate, 'outline' | 'field' | 'inputs'>;
  field: LiveField | null;
  // The driver's inputs over the last INPUTS_KEPT_S seconds, oldest first
  inputs: InputSample[];
  // The field's car details, by car index, and the subsession they're for
  fieldDrivers: Map<number, FieldDriverDetails>;
  fieldSubSession: number | null;
  receivedAt: number;
  // The collector's approximate outline, and the track key it's for
  outline: TrackOutline | null;
  outlineTrackKey: string | null;
  // Watchers' messages for the collector's next update
  messages: DriverMessage[];
  // The weather every WEATHER_SAMPLE_MS over the last TREND_MS or so, oldest first, for the outlook; and the track
  // it's for
  weatherHistory: WeatherSample[];
  weatherTrack: string | null;
};

// After this long without an update a driver is shown as offline, and after EXPIRE_MS left out
export const STALE_MS = 15_000;
const EXPIRE_MS = 5 * 60_000;
// A page that asked for a driver within this long counts as watching them
const WATCHING_MS = 10_000;

// Kept on globalThis so the dev server's reloads don't lose it
const store = globalThis as unknown as {
  liveRacing?: {
    entries: Map<number, LiveEntry>;
    viewers: Map<number, Map<number, number>>;
    // When each watcher last sent a driver a message
    messagedAt?: Map<number, number>;
  };
};
const live = (store.liveRacing ??= { entries: new Map<number, LiveEntry>(), viewers: new Map<number, Map<number, number>>() });
const messagedAt = (live.messagedAt ??= new Map<number, number>());

function expire(now: number) {
  for (const [userId, entry] of live.entries) if (now - entry.receivedAt > EXPIRE_MS) live.entries.delete(userId);
}

// Records a driver's live update; returns how many others are watching them right now and whether the collector
// should send its approximate outline (the track has none saved, and this driver hasn't sent one for it)
export function recordLiveUpdate(
  user: Pick<User, 'id' | 'userName' | 'role'>,
  update: LiveUpdate,
  savedOutline: boolean
): { watchers: number; needsOutline: boolean; needsField: boolean; messages: { from: string; text: string }[] } {
  const now = Date.now();
  expire(now);
  const previous = live.entries.get(user.id);
  const { outline, field, inputs: newInputs, ...rest } = update;
  const trackKey = update.trackKey?.toLowerCase() ?? null;
  let kept = previous && previous.outlineTrackKey === trackKey ? previous.outline : null;
  if (outline) kept = outline;
  let fieldDrivers = previous?.fieldDrivers ?? new Map<number, FieldDriverDetails>();
  let fieldSubSession = previous?.fieldSubSession ?? null;
  if (field?.drivers) {
    fieldDrivers = new Map(field.drivers.map((d) => [d.idx, { ...d, countryCode: flagCodeForFlair(d.flair) }]));
    fieldSubSession = field.subSessionId;
  } else if (field && field.subSessionId !== fieldSubSession) {
    fieldDrivers = new Map();
    fieldSubSession = null;
  }
  let inputs: InputSample[] = previous?.inputs ?? [];
  if (newInputs?.length) {
    const latest = newInputs[newInputs.length - 1][0];
    // SessionTime starts again in a new session
    inputs = [...inputs.filter((s) => s[0] < newInputs[0][0]), ...newInputs].filter((s) => s[0] > latest - INPUTS_KEPT_S);
  } else if (!update.onTrack) {
    inputs = [];
  }
  const weatherTrack = trackKey ?? update.track;
  let weatherHistory = previous && previous.weatherTrack === weatherTrack ? previous.weatherHistory : [];
  if (update.weather) {
    const last = weatherHistory[weatherHistory.length - 1];
    if (!last || now - last.at >= WEATHER_SAMPLE_MS) {
      weatherHistory = [...weatherHistory, weatherSample(update.weather, now)].filter((s) => now - s.at <= TREND_MS + 2 * WEATHER_SAMPLE_MS);
    }
  }
  live.entries.set(user.id, {
    userId: user.id,
    driver: user.userName,
    update: rest,
    inputs,
    field: field
      ? {
          subSessionId: field.subSessionId,
          myCarIdx: field.myCarIdx ?? null,
          cars: field.cars.map((car) => ({ ...car, details: fieldDrivers.get(car.idx) ?? null })),
        }
      : null,
    fieldDrivers,
    fieldSubSession,
    receivedAt: now,
    outline: kept,
    outlineTrackKey: kept ? trackKey : null,
    // delivered with this answer
    messages: [],
    weatherHistory,
    weatherTrack,
  });
  const messages = update.acceptsMessages
    ? (previous?.messages ?? []).filter((m) => now - m.at <= MESSAGE_EXPIRE_MS).map(({ from, text }) => ({ from, text }))
    : [];
  return {
    watchers: watcherCount(user.id, now),
    needsOutline: !!trackKey && !savedOutline && !kept,
    needsField: !!field && fieldSubSession === null,
    messages,
  };
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

export type LiveDriver = Omit<LiveUpdate, 'outline' | 'field' | 'inputs'> & {
  userId: number;
  driver: string;
  isMe: boolean;
  // Milliseconds since the collector's last update; offline once past STALE_MS
  ageMs: number;
  offline: boolean;
  // The collector sent an approximate outline of this driver's track (GET /api/live/outline?driver= gives it)
  hasApproximateOutline: boolean;
  // Every car in the driver's session, with the driver's own as myCarIdx; null from collectors that don't send it
  field: LiveField | null;
  // The driver's inputs over the last few seconds, oldest first, the newest sampled ageMs ago; only for the driver
  // asked for (inputsFor), else null
  inputs: InputSample[] | null;
  // How the weather changed over the last few minutes (src/lib/liveWeather.ts), or null without enough of it
  weatherTrend: WeatherTrend | null;
};

// The live drivers this viewer may watch, each counted as watched by them, with the inputs of the driver inputsFor
export async function readLiveDrivers(viewer: Pick<User, 'id' | 'role'>, inputsFor?: number | null): Promise<LiveDriver[]> {
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
      field: entry.field,
      inputs: entry.userId === inputsFor ? entry.inputs : null,
      weatherTrend: entry.update.weather ? weatherTrend(entry.weatherHistory, weatherSample(entry.update.weather, entry.receivedAt)) : null,
    });
  }
  return drivers.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.driver.localeCompare(b.driver));
}

// A watcher's message to a live driver, said by their collector in the driver's In-Car AI Coach voice once its next
// update arrives (within a second in the car, a few seconds otherwise)
export async function queueDriverMessage(
  viewer: Pick<User, 'id' | 'role' | 'userName'>,
  driverId: number,
  text: string
): Promise<'queued' | 'notLive' | 'notAllowed' | 'collectorTooOld' | 'tooMany'> {
  const now = Date.now();
  expire(now);
  const allowed = await watchableDrivers(viewer);
  if (allowed !== 'all' && !allowed.has(driverId)) return 'notAllowed';
  const entry = live.entries.get(driverId);
  if (!entry || now - entry.receivedAt > STALE_MS) return 'notLive';
  if (!entry.update.acceptsMessages) return 'collectorTooOld';
  entry.messages = entry.messages.filter((m) => now - m.at <= MESSAGE_EXPIRE_MS);
  if (now - (messagedAt.get(viewer.id) ?? 0) < MESSAGE_INTERVAL_MS || entry.messages.length >= MAX_QUEUED_MESSAGES) {
    return 'tooMany';
  }
  messagedAt.set(viewer.id, now);
  entry.messages.push({ from: viewer.userName, text: text.slice(0, MAX_MESSAGE_CHARS), at: now });
  return 'queued';
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
