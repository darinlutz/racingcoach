// Lap telemetry retention in the database (the rules are in lapRetentionRules.ts): the columns, SQL functions and
// trigger that keep each lap's expiry, and the cleanup job that deletes expired laps. No imports but the
// dependency-free rules, so scripts/lap-retention-db.test.mjs runs this exact code against a test database.
//
// - "CollectorLaps".completed_at is the retention clock's start (lapCompletedAt) and expires_at the first instant the
//   lap is no longer available; "DebriefSessions" (saved Debrief Coach runs, measured from laps) use created_at and
//   their own expires_at. Every read filters on expires_at > now(), so an expired lap is gone even before the
//   cleanup job deletes it.
// - New rows get expires_at from the owner's level when they're saved. A change of "Users".membership_level, by
//   any route (Stripe, the Admin page, a paid period ending), re-stamps the owner's unexpired rows through the
//   users_membership_lap_retention trigger (restampExpiresAt); expired rows are never touched, so nothing comes back.
// - The cleanup job (runLapRetentionJob, hourly from lapRetention.ts) ends lapsed memberships, then deletes expired
//   rows in small batches, each its own statement, leaving a tombstone in "ExpiredLaps" so the collector can't upload
//   a deleted lap again. Tombstones carry no telemetry and go once the lap would be past MAX_RETENTION_DAYS anyway.
import { ACCOUNT_STATUS, MEMBERSHIP_LEVEL } from './accountStatus.ts';
import { FALLBACK_RETENTION_DAYS, GOLD_GRACE_DAYS, MAX_RETENTION_DAYS, RETENTION_DAYS } from './lapRetentionRules.ts';

// The part of pg's Client and PoolClient used here
export type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

// Whole days as an exact interval (24-hour days, so a daylight saving change in the session's time zone can't move it)
const hours = (days: string | number) => `make_interval(hours => (${days}) * 24)`;

const daysCase = Object.entries(RETENTION_DAYS)
  .map(([level, days]) => `WHEN ${quote(level)} THEN ${days}`)
  .join(' ');
const rankCase = `CASE level WHEN ${quote(MEMBERSHIP_LEVEL.gold)} THEN 2 WHEN ${quote(MEMBERSHIP_LEVEL.silver)} THEN 1 ELSE 0 END`;

// Statements run by ensureUserSchema (users.ts) once "Users", "CollectorLaps" and "DebriefSessions" exist, inside its
// transaction. Every one can run again; the backfill only fills rows without an expiry.
export const LAP_RETENTION_SCHEMA: string[] = [
  `CREATE OR REPLACE FUNCTION racingcoach.lap_retention_days(level TEXT) RETURNS INTEGER
   LANGUAGE sql IMMUTABLE AS $$ SELECT LEAST(CASE level ${daysCase} ELSE ${FALLBACK_RETENTION_DAYS} END, ${MAX_RETENTION_DAYS}) $$`,
  `CREATE OR REPLACE FUNCTION racingcoach.lap_level_rank(level TEXT) RETURNS INTEGER
   LANGUAGE sql IMMUTABLE AS $$ SELECT ${rankCase} $$`,
  `CREATE OR REPLACE FUNCTION racingcoach.lap_expires_at(completed TIMESTAMPTZ, level TEXT) RETURNS TIMESTAMPTZ
   LANGUAGE sql IMMUTABLE AS $$ SELECT completed + ${hours('racingcoach.lap_retention_days(level)')} $$`,
  // restampExpiresAt, for a row that hasn't expired (the trigger only passes those)
  `CREATE OR REPLACE FUNCTION racingcoach.lap_restamp(
     completed TIMESTAMPTZ, expires TIMESTAMPTZ, upgrade BOOLEAN, level TEXT, grace_until TIMESTAMPTZ
   ) RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE AS $$
     SELECT CASE WHEN upgrade THEN GREATEST(expires, racingcoach.lap_expires_at(completed, level))
       ELSE LEAST(expires, GREATEST(racingcoach.lap_expires_at(completed, level),
                                    LEAST(COALESCE(grace_until, '-infinity'::timestamptz), completed + ${hours(MAX_RETENTION_DAYS)})))
     END $$`,
  `ALTER TABLE racingcoach."CollectorLaps" ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE racingcoach."CollectorLaps" ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE racingcoach."DebriefSessions" ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  // Laps from before retention: completed when the collector said, unless that's after the upload (a wrong clock)
  `UPDATE racingcoach."CollectorLaps" SET completed_at = LEAST(recorded_at, uploaded_at) WHERE completed_at IS NULL`,
  `UPDATE racingcoach."CollectorLaps" l SET expires_at = racingcoach.lap_expires_at(l.completed_at, u.membership_level)
   FROM racingcoach."Users" u WHERE u.id = l.user_id AND l.expires_at IS NULL`,
  `UPDATE racingcoach."DebriefSessions" d SET expires_at = racingcoach.lap_expires_at(d.created_at, u.membership_level)
   FROM racingcoach."Users" u WHERE u.id = d.user_id AND d.expires_at IS NULL`,
  // Cheap once set: Postgres skips the check when the column is already NOT NULL
  `ALTER TABLE racingcoach."CollectorLaps" ALTER COLUMN completed_at SET NOT NULL, ALTER COLUMN expires_at SET NOT NULL`,
  `ALTER TABLE racingcoach."DebriefSessions" ALTER COLUMN expires_at SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS collector_laps_expires_at_idx ON racingcoach."CollectorLaps" (expires_at)`,
  `CREATE INDEX IF NOT EXISTS debrief_sessions_expires_at_idx ON racingcoach."DebriefSessions" (expires_at)`,
  // Laps the cleanup job deleted, so the same lap (user and collector ID) is refused if uploaded again
  `CREATE TABLE IF NOT EXISTS racingcoach."ExpiredLaps" (
     user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     client_lap_id UUID NOT NULL,
     completed_at TIMESTAMPTZ NOT NULL,
     expired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, client_lap_id)
   )`,
  // One row per cleanup run, for the Admin page; counts only, never telemetry
  `CREATE TABLE IF NOT EXISTS racingcoach."LapRetentionRuns" (
     id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     finished_at TIMESTAMPTZ,
     dry_run BOOLEAN NOT NULL,
     memberships_ended INTEGER NOT NULL DEFAULT 0,
     laps_due INTEGER NOT NULL DEFAULT 0,
     laps_deleted INTEGER NOT NULL DEFAULT 0,
     debriefs_due INTEGER NOT NULL DEFAULT 0,
     debriefs_deleted INTEGER NOT NULL DEFAULT 0,
     tombstones_purged INTEGER NOT NULL DEFAULT 0,
     error TEXT
   )`,
  // Re-stamps the owner's unexpired laps and debriefs when their level changes. A Gold membership that ended
  // (Canceled, or Expired after a failed renewal) keeps Gold's period until GOLD_GRACE_DAYS after its paid period.
  `CREATE OR REPLACE FUNCTION racingcoach.restamp_lap_retention() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     upgrade BOOLEAN := racingcoach.lap_level_rank(NEW.membership_level) > racingcoach.lap_level_rank(OLD.membership_level);
     grace_until TIMESTAMPTZ;
   BEGIN
     IF OLD.membership_level = ${quote(MEMBERSHIP_LEVEL.gold)} AND NOT upgrade
        AND NEW.account_status IN (${quote(ACCOUNT_STATUS.canceled)}, ${quote(ACCOUNT_STATUS.expired)})
        AND NEW.subscription_end_date ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN
       grace_until := NEW.subscription_end_date::timestamptz + ${hours(GOLD_GRACE_DAYS)};
     END IF;
     UPDATE racingcoach."CollectorLaps"
       SET expires_at = racingcoach.lap_restamp(completed_at, expires_at, upgrade, NEW.membership_level, grace_until)
       WHERE user_id = NEW.id AND expires_at > now();
     UPDATE racingcoach."DebriefSessions"
       SET expires_at = racingcoach.lap_restamp(created_at, expires_at, upgrade, NEW.membership_level, grace_until)
       WHERE user_id = NEW.id AND expires_at > now();
     RETURN NULL;
   END $$`,
  `DROP TRIGGER IF EXISTS users_membership_lap_retention ON racingcoach."Users"`,
  `CREATE TRIGGER users_membership_lap_retention AFTER UPDATE OF membership_level ON racingcoach."Users"
   FOR EACH ROW WHEN (OLD.membership_level IS DISTINCT FROM NEW.membership_level)
   EXECUTE FUNCTION racingcoach.restamp_lap_retention()`,
];

// Ends Silver and Gold memberships whose paid period is over: back to Bronze, and Subscribed becomes Expired (a
// canceled one stays Canceled). $1 is now as an ISO string (subscription_end_date is ISO text), $2 one user's id or
// NULL for everyone. getUserById runs it for the user it loads, and the cleanup job for everyone, so a member who
// never comes back still drops to Bronze, and their laps to Bronze's period, on time.
export const END_LAPSED_MEMBERSHIPS_SQL = `
  UPDATE racingcoach."Users"
  SET account_status = CASE WHEN account_status = ${quote(ACCOUNT_STATUS.subscribed)} THEN ${quote(ACCOUNT_STATUS.expired)} ELSE account_status END,
      membership_level = ${quote(MEMBERSHIP_LEVEL.bronze)}
  WHERE ($2::integer IS NULL OR id = $2) AND subscription_end_date < $1
    AND (account_status = ${quote(ACCOUNT_STATUS.subscribed)}
         OR (account_status = ${quote(ACCOUNT_STATUS.canceled)} AND membership_level <> ${quote(MEMBERSHIP_LEVEL.bronze)}))`;

const LOCK_KEY = "hashtext('racingcoach_lap_retention')";

export type LapRetentionRunResult = {
  runId: number;
  dryRun: boolean;
  membershipsEnded: number;
  lapsDue: number;
  lapsDeleted: number;
  debriefsDue: number;
  debriefsDeleted: number;
  tombstonesPurged: number;
};

export const DEFAULT_BATCH_SIZE = 100;

// One cleanup run on the client's connection (not inside a transaction: each statement commits on its own, so a
// batch holds its row locks only briefly and a run cut short keeps what it finished). Answers null without doing
// anything when another run holds the lock (another server instance, or the previous hour's still going). In a dry
// run, it only counts what's due. A run that fails is recorded with its error message and the error is thrown;
// running again picks up where it stopped.
export async function runLapRetentionJob(
  client: Queryable,
  options: { dryRun: boolean; batchSize?: number }
): Promise<LapRetentionRunResult | null> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const { rows: lock } = await client.query(`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`);
  if (!lock[0]?.locked) return null;
  let runId: number | null = null;
  try {
    const { rows: run } = await client.query(
      'INSERT INTO racingcoach."LapRetentionRuns" (dry_run) VALUES ($1) RETURNING id',
      [options.dryRun]
    );
    runId = Number(run[0].id);
    const result: LapRetentionRunResult = {
      runId,
      dryRun: options.dryRun,
      membershipsEnded: 0,
      lapsDue: 0,
      lapsDeleted: 0,
      debriefsDue: 0,
      debriefsDeleted: 0,
      tombstonesPurged: 0,
    };

    const ended = await client.query(END_LAPSED_MEMBERSHIPS_SQL, [new Date().toISOString(), null]);
    result.membershipsEnded = ended.rowCount ?? 0;

    // The absolute ceiling, whatever wrote the row (e.g. data restored from a backup or changed by hand)
    await client.query(
      `UPDATE racingcoach."CollectorLaps" SET expires_at = completed_at + ${hours(MAX_RETENTION_DAYS)}
       WHERE expires_at > completed_at + ${hours(MAX_RETENTION_DAYS)}`
    );
    await client.query(
      `UPDATE racingcoach."DebriefSessions" SET expires_at = created_at + ${hours(MAX_RETENTION_DAYS)}
       WHERE expires_at > created_at + ${hours(MAX_RETENTION_DAYS)}`
    );

    const { rows: due } = await client.query(
      `SELECT (SELECT count(*) FROM racingcoach."CollectorLaps" WHERE expires_at <= now()) AS laps,
              (SELECT count(*) FROM racingcoach."DebriefSessions" WHERE expires_at <= now()) AS debriefs`
    );
    result.lapsDue = Number(due[0].laps);
    result.debriefsDue = Number(due[0].debriefs);

    if (!options.dryRun) {
      // The tombstone and the delete are one statement, so a lap is never deleted without one
      for (;;) {
        const deleted = await client.query(
          `WITH doomed AS (
             SELECT id, user_id, client_lap_id, completed_at FROM racingcoach."CollectorLaps"
             WHERE expires_at <= now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
           ), tombstones AS (
             INSERT INTO racingcoach."ExpiredLaps" (user_id, client_lap_id, completed_at)
             SELECT user_id, client_lap_id, completed_at FROM doomed ON CONFLICT DO NOTHING
           )
           DELETE FROM racingcoach."CollectorLaps" l USING doomed WHERE l.id = doomed.id`,
          [batchSize]
        );
        result.lapsDeleted += deleted.rowCount ?? 0;
        if ((deleted.rowCount ?? 0) < batchSize) break;
      }
      for (;;) {
        const deleted = await client.query(
          `DELETE FROM racingcoach."DebriefSessions" WHERE id IN (
             SELECT id FROM racingcoach."DebriefSessions" WHERE expires_at <= now()
             ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)`,
          [batchSize]
        );
        result.debriefsDeleted += deleted.rowCount ?? 0;
        if ((deleted.rowCount ?? 0) < batchSize) break;
      }
      // Past MAX_RETENTION_DAYS an upload is refused anyway (lapExpiresAt), so the tombstone isn't needed
      const purged = await client.query(
        `DELETE FROM racingcoach."ExpiredLaps" WHERE completed_at + ${hours(MAX_RETENTION_DAYS)} <= now()`
      );
      result.tombstonesPurged = purged.rowCount ?? 0;
      await client.query(`DELETE FROM racingcoach."LapRetentionRuns" WHERE started_at < now() - interval '365 days'`);
    }

    await client.query(
      `UPDATE racingcoach."LapRetentionRuns" SET finished_at = now(), memberships_ended = $2, laps_due = $3,
         laps_deleted = $4, debriefs_due = $5, debriefs_deleted = $6, tombstones_purged = $7 WHERE id = $1`,
      [
        runId,
        result.membershipsEnded,
        result.lapsDue,
        result.lapsDeleted,
        result.debriefsDue,
        result.debriefsDeleted,
        result.tombstonesPurged,
      ]
    );
    return result;
  } catch (error) {
    if (runId !== null) {
      const message = error instanceof Error ? error.message : String(error);
      await client
        .query('UPDATE racingcoach."LapRetentionRuns" SET finished_at = now(), error = $2 WHERE id = $1', [
          runId,
          message.slice(0, 500),
        ])
        .catch(() => {});
    }
    throw error;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}
