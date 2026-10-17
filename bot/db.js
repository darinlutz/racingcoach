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
    `SELECT u.id, u.user_name, u.account_status, u.role
     FROM racingcoach."DiscordConnections" d
     JOIN racingcoach."Users" u ON u.id = d.user_id
     WHERE d.discord_user_id = $1`,
    [discordUserId],
  );
  if (!row) return null;
  // role is Admin, Coach or User (the website's src/lib/roles.ts)
  return { id: row.id, userName: row.user_name, accountStatus: row.account_status, role: row.role };
}

// The user's most recent races with a result, newest first. They are synced from iRacePlan, or uploaded
// by the telemetry collector, into racingcoach."RaceResults" (the website's src/lib/raceHistory.ts).
// Read like readRaceEvents there: a collector race iRacePlan also has is left out, and collector races get
// the next race's starting iRating as their new one. Positions are 1-based, lap times in seconds, and null
// means the value wasn't reported.
export async function getRecentRaces(userId, limit) {
  const rows = await query(
    `WITH races AS (
       SELECT r.* FROM racingcoach."RaceResults" r
       WHERE r.user_id = $1 AND r.has_result AND NOT (r.source = 'collector' AND EXISTS (
         SELECT 1 FROM racingcoach."RaceResults" p
         WHERE p.user_id = r.user_id AND p.source = 'iraceplan' AND p.has_result
           AND abs(extract(epoch FROM p.start_time - r.start_time)) <= 7200
           AND (p.old_irating IS NULL OR r.old_irating IS NULL OR p.old_irating = r.old_irating)
           AND (p.finish_position IS NULL OR r.finish_position IS NULL OR p.finish_position = r.finish_position)))
     )
     SELECT start_time, series, track, car, start_position, finish_position, incidents, old_irating,
            CASE WHEN new_irating IS NOT NULL OR source <> 'collector' THEN new_irating
                 WHEN official_race IS FALSE THEN old_irating
                 ELSE lead(old_irating) OVER (PARTITION BY coalesce(category, '') ORDER BY start_time) END AS new_irating,
            best_lap_seconds, average_lap_seconds
     FROM races
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
