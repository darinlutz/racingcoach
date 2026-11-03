import { query } from './db';
import { ensureUserSchema } from './users';

// Saved AI lap summaries (racingcoach."LapSummaries"): Lap Compare's, Multi-Lap Analysis's and Stint Analysis's. They
// hold measurements of the user's laps, so they expire like laps (lapRetentionDb.ts), counted from when they were saved.

export type LapSummaryKind = 'lap' | 'multiLap' | 'stint';

export async function saveLapSummary(
  userId: number,
  kind: LapSummaryKind,
  track: string,
  input: string,
  summary: string
): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."LapSummaries" (user_id, kind, track, input, summary, expires_at)
     SELECT $1, $2, $3, $4, $5, racingcoach.lap_expires_at(now(), membership_level)
     FROM racingcoach."Users" WHERE id = $1`,
    [userId, kind, track, input, summary]
  );
}
