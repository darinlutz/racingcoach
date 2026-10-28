import { query, withClient } from './db';
import { runLapRetentionJob, type LapRetentionRunResult } from './lapRetentionDb';
import { ensureUserSchema } from './users';

// Runs the lap retention cleanup (lapRetentionDb.ts) inside the web server: a minute after it starts, then every
// hour (src/instrumentation.ts starts it). Several instances can run it; the job's advisory lock lets one through at
// a time. Reads never return an expired lap, so a late or failed run only delays the deletion, never the expiry.
//
// LAP_RETENTION_MODE=delete deletes expired laps; anything else (the default) is a dry run, which only counts what's
// due (the Admin page shows the counts) until the deletion is approved and switched on.

const FIRST_RUN_DELAY_MS = 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

export const lapRetentionDryRun = () => process.env.LAP_RETENTION_MODE !== 'delete';

export async function runLapRetention(): Promise<LapRetentionRunResult | null> {
  await ensureUserSchema();
  const dryRun = lapRetentionDryRun();
  try {
    const result = await withClient((client) => runLapRetentionJob(client, { dryRun }));
    if (result) {
      console.log(
        `Lap retention run ${result.runId}${dryRun ? ' (dry run)' : ''}: ${result.membershipsEnded} memberships ended, ` +
          `${result.lapsDeleted}/${result.lapsDue} expired laps and ${result.debriefsDeleted}/${result.debriefsDue} ` +
          `expired debriefs deleted, ${result.tombstonesPurged} tombstones purged`
      );
    }
    return result;
  } catch (error) {
    // The message only: never a row's contents
    console.error('Lap retention run failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

const globalForRetention = globalThis as typeof globalThis & { lapRetentionTimer?: NodeJS.Timeout };

export function startLapRetentionSchedule(): void {
  if (globalForRetention.lapRetentionTimer || !process.env.DATABASE_URL) return;
  globalForRetention.lapRetentionTimer = setTimeout(function tick() {
    void runLapRetention().finally(() => {
      globalForRetention.lapRetentionTimer = setTimeout(tick, INTERVAL_MS).unref();
    });
  }, FIRST_RUN_DELAY_MS).unref();
}

// The latest cleanup runs, newest first, for the Admin page
export type LapRetentionRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  membershipsEnded: number;
  lapsDue: number;
  lapsDeleted: number;
  debriefsDue: number;
  debriefsDeleted: number;
  error: string | null;
};

export async function readLapRetentionRuns(limit = 24): Promise<LapRetentionRun[]> {
  await ensureUserSchema();
  const rows = await query<{
    id: string;
    started_at: Date;
    finished_at: Date | null;
    dry_run: boolean;
    memberships_ended: number;
    laps_due: number;
    laps_deleted: number;
    debriefs_due: number;
    debriefs_deleted: number;
    error: string | null;
  }>(
    `SELECT id, started_at, finished_at, dry_run, memberships_ended, laps_due, laps_deleted, debriefs_due,
            debriefs_deleted, error
     FROM racingcoach."LapRetentionRuns" ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    dryRun: row.dry_run,
    membershipsEnded: row.memberships_ended,
    lapsDue: row.laps_due,
    lapsDeleted: row.laps_deleted,
    debriefsDue: row.debriefs_due,
    debriefsDeleted: row.debriefs_deleted,
    error: row.error,
  }));
}
