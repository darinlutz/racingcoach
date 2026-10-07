import { query } from './db';
import {
  fetchMe,
  fetchPlanning,
  fetchSchedule,
  fetchSeries,
  type Planning,
  type Series,
} from './iRacePlan';
import type { RaceEvent } from './raceTrends';
import { ensureUserSchema } from './users';

// Race & Qualy Trends data. Each user connects their own iRacePlan API key; their completed races are
// copied into racingcoach."RaceResults" so the tab loads instantly and only new races are fetched later.
// iRacePlan's schedule lists every race in one call, but each result needs its own (slow) request, so a
// sync fetches at most SYNC_BATCH results and the browser calls it again until nothing is left.

const SYNC_BATCH = 60;
const CONCURRENCY = 4;
// A race without a result yet may still be processed by iRacing; older ones are recorded as having none
const RESULT_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const HISTORY_START = new Date('2008-01-01T00:00:00Z');

export class NotConnectedError extends Error {
  constructor() {
    super('Connect your iRacePlan account first');
  }
}

export type Connection = { iracingName: string; iracingCustomerId: number; syncedAt: string | null };

export async function readConnection(userId: number): Promise<Connection | null> {
  await ensureUserSchema();
  const [row] = await query(
    'SELECT iracing_name, iracing_customer_id, synced_at FROM racingcoach."IRacePlanConnections" WHERE user_id = $1',
    [userId]
  );
  if (!row) return null;
  return {
    iracingName: row.iracing_name as string,
    iracingCustomerId: row.iracing_customer_id as number,
    syncedAt: row.synced_at ? (row.synced_at as Date).toISOString() : null,
  };
}

// Checks the key with iRacePlan, then saves it with the iRacing profile it belongs to. A different
// iRacing profile than before starts the race history over.
export async function connect(userId: number, apiKey: string): Promise<Connection> {
  await ensureUserSchema();
  const { user } = await fetchMe(apiKey);
  const profile = user.iracing_profile;
  if (!profile) throw new Error('Your iRacePlan account is not linked to an iRacing profile yet');

  const [previous] = await query(
    'SELECT iracing_customer_id FROM racingcoach."IRacePlanConnections" WHERE user_id = $1',
    [userId]
  );
  if (previous && previous.iracing_customer_id !== profile.customer_id) {
    await query('DELETE FROM racingcoach."RaceResults" WHERE user_id = $1', [userId]);
  }
  await query(
    `INSERT INTO racingcoach."IRacePlanConnections" (user_id, api_key, iracing_customer_id, iracing_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET api_key = EXCLUDED.api_key,
       iracing_customer_id = EXCLUDED.iracing_customer_id, iracing_name = EXCLUDED.iracing_name, connected_at = now()`,
    [userId, apiKey, profile.customer_id, profile.display_name]
  );
  return (await readConnection(userId)) as Connection;
}

// Forgets the key; the synced races stay so the trends still show
export async function disconnect(userId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."IRacePlanConnections" WHERE user_id = $1', [userId]);
}

// iRacePlan names sessions after the series, which usually matches its series list exactly
function categoryFinder(series: Series[]) {
  const byName = new Map(series.map((s) => [s.name.toLowerCase(), s.category?.name ?? null]));
  return (name: string) => {
    const lower = name.toLowerCase();
    if (byName.has(lower)) return byName.get(lower) ?? null;
    const partial = series.find((s) => lower.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(lower));
    return partial?.category?.name ?? null;
  };
}

const position = (value: number | null | undefined) => (value === null || value === undefined || value < 0 ? null : value + 1);
const lapSeconds = (value: number | null | undefined) => (value && value > 0 ? value / 10000 : null);
const rating = (value: number | null | undefined) => (value === null || value === undefined || value < 0 ? null : value);

async function saveResult(userId: number, customerId: number, planning: Planning, category: string | null) {
  const driver = planning.result?.driver_participations.find((d) => d.driver.iracing_id === customerId);
  const result = planning.result;
  await query(
    `INSERT INTO racingcoach."RaceResults" (user_id, iraceplan_planning_id, start_time, series, category, track, car,
       team_race, has_result, old_irating, new_irating, old_safety_rating, new_safety_rating, start_position,
       finish_position, laps_complete, laps_led, incidents, best_lap_seconds, average_lap_seconds, reason_out)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT (user_id, iraceplan_planning_id) DO NOTHING`,
    [
      userId,
      planning.id,
      planning.session.start_at,
      planning.session.name,
      category,
      planning.track.name,
      planning.car,
      planning.type === 'team',
      Boolean(driver),
      rating(driver?.old_irating),
      rating(driver?.new_irating),
      driver?.old_safety_rating ?? null,
      driver?.new_safety_rating ?? null,
      position(result?.starting_position_in_class),
      position(result?.finish_position_in_class),
      driver?.laps_completed ?? null,
      driver?.laps_led ?? null,
      driver?.incidents ?? null,
      lapSeconds(driver?.best_lap_time),
      lapSeconds(driver?.average_lap),
      result?.reason_out ?? null,
    ]
  );
}

// Runs `fn` over `items`, at most `limit` at a time
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

export type SyncProgress = { total: number; loaded: number; remaining: number; failed: number };

// Fetches up to SYNC_BATCH completed races that are not stored yet, newest first
export async function syncRaceResults(userId: number): Promise<SyncProgress> {
  await ensureUserSchema();
  const [conn] = await query(
    'SELECT api_key, iracing_customer_id FROM racingcoach."IRacePlanConnections" WHERE user_id = $1',
    [userId]
  );
  if (!conn) throw new NotConnectedError();
  const apiKey = conn.api_key as string;
  const customerId = conn.iracing_customer_id as number;

  const races = (await fetchSchedule(apiKey, HISTORY_START, new Date(Date.now() + 24 * 60 * 60 * 1000)))
    .filter((r) => r.status === 'completed')
    .sort((a, b) => b.start_at.localeCompare(a.start_at));
  const stored = new Set(
    (await query('SELECT iraceplan_planning_id FROM racingcoach."RaceResults" WHERE user_id = $1', [userId])).map(
      (row) => Number(row.iraceplan_planning_id)
    )
  );
  const missing = races.filter((r) => !stored.has(r.id));
  const batch = missing.slice(0, SYNC_BATCH);

  const findCategory = batch.length > 0 ? categoryFinder(await fetchSeries(apiKey)) : () => null;
  let failed = 0;
  let waiting = 0;
  await eachLimited(batch, CONCURRENCY, async (race) => {
    try {
      const planning = await fetchPlanning(apiKey, race.id);
      // Leave recent races without a result for the next sync
      if (!planning.result && Date.now() - Date.parse(race.start_at) < RESULT_GRACE_MS) {
        waiting++;
        return;
      }
      await saveResult(userId, customerId, planning, findCategory(planning.session.name));
    } catch (error) {
      failed++;
      console.error(`iRacePlan planning ${race.id} failed:`, error);
    }
  });

  const remaining = missing.length - batch.length + failed;
  if (remaining === 0) {
    await query('UPDATE racingcoach."IRacePlanConnections" SET synced_at = now() WHERE user_id = $1', [userId]);
  }
  return { total: races.length, loaded: races.length - remaining - waiting, remaining, failed };
}

// The user's synced races that have a result for them, oldest first
export async function readRaceEvents(userId: number): Promise<RaceEvent[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT iraceplan_planning_id, start_time, series, category, track, car, old_irating, new_irating,
            old_safety_rating, new_safety_rating, start_position, finish_position, laps_complete, incidents
     FROM racingcoach."RaceResults" WHERE user_id = $1 AND has_result ORDER BY start_time`,
    [userId]
  );
  return rows.map((row) => ({
    eventId: Number(row.iraceplan_planning_id),
    startTime: (row.start_time as Date).toISOString(),
    series: row.series as string,
    track: row.track as string,
    category: (row.category as string | null) ?? 'Other',
    car: row.car as string,
    oldIRating: row.old_irating as number | null,
    newIRating: row.new_irating as number | null,
    oldSafetyRating: row.old_safety_rating as number | null,
    newSafetyRating: row.new_safety_rating as number | null,
    startPosition: row.start_position as number | null,
    finishPosition: row.finish_position as number | null,
    incidents: (row.incidents as number | null) ?? 0,
    lapsComplete: (row.laps_complete as number | null) ?? 0,
  }));
}
