import pg from 'pg';

// The bot's connection to the RacingCoach database, set up like the website's src/lib/db.ts:
// DATABASE_URL as-is, with every connection defaulting to the racingcoach schema.
// The website creates the tables; the bot only reads them.

const DB_SCHEMA = 'racingcoach';

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({ connectionString, options: `-c search_path=${DB_SCHEMA}` });
  }
  return pool;
}

export async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

export async function closeDb() {
  if (pool) await pool.end();
}

// The RacingCoach account linked to a Discord user with the Account page's Connect Discord
// button, or null when they haven't linked one.
export async function getLinkedUser(discordUserId) {
  const [row] = await query(
    `SELECT u.id, u.user_name, u.account_status
     FROM racingcoach."DiscordConnections" d
     JOIN racingcoach."Users" u ON u.id = d.user_id
     WHERE d.discord_user_id = $1`,
    [discordUserId],
  );
  if (!row) return null;
  return { id: row.id, userName: row.user_name, accountStatus: row.account_status };
}

// The user's most recent races with a result, newest first. They are synced from iRacePlan into
// racingcoach."RaceResults" by the website's Race Trends page (src/lib/raceHistory.ts).
// Positions are 1-based, lap times in seconds, and null means iRacePlan didn't report the value.
export async function getRecentRaces(userId, limit) {
  const rows = await query(
    `SELECT start_time, series, track, car, start_position, finish_position, incidents,
            old_irating, new_irating, best_lap_seconds, average_lap_seconds
     FROM racingcoach."RaceResults"
     WHERE user_id = $1 AND has_result
     ORDER BY start_time DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    startTime: row.start_time,
    series: row.series,
    track: row.track,
    car: row.car,
    startPosition: row.start_position,
    finishPosition: row.finish_position,
    incidents: row.incidents ?? 0,
    oldIRating: row.old_irating,
    newIRating: row.new_irating,
    bestLapSeconds: row.best_lap_seconds,
    averageLapSeconds: row.average_lap_seconds,
  }));
}

// The user's most recent saved Debrief Coach runs, newest first. The website saves one each time a
// signed-in user runs Debrief Coach (src/lib/debriefHistory.ts). `debrief` is the coach's
// { headline, fixes: [{ area, timeGainSeconds, problem, fix, evidence }], keepDoing }.
export async function getRecentDebriefs(userId, limit) {
  const rows = await query(
    `SELECT track, car, lap_count, best_lap_seconds, debrief, created_at
     FROM racingcoach."DebriefSessions"
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    track: row.track,
    car: row.car,
    lapCount: row.lap_count,
    bestLapSeconds: row.best_lap_seconds,
    debrief: row.debrief,
    createdAt: row.created_at,
  }));
}

// The user's most recent saved Debrief Coach run, or null
export async function getLatestDebrief(userId) {
  const [latest] = await getRecentDebriefs(userId, 1);
  return latest ?? null;
}
