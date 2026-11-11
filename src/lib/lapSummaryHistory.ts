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

// The user's latest summaries of this kind at this track, newest last, so the next one isn't written the same way
// (src/lib/coachingGuidance.ts). Expired summaries are left out, like every read. Never throws: no summaries then.
export async function readRecentLapSummaries(userId: number, kind: LapSummaryKind, track: string, limit = 2): Promise<string[]> {
  try {
    await ensureUserSchema();
    const rows = await query<{ summary: string }>(
      `SELECT summary FROM racingcoach."LapSummaries"
       WHERE user_id = $1 AND kind = $2 AND lower(track) = lower($3) AND expires_at > now()
       ORDER BY created_at DESC LIMIT $4`,
      [userId, kind, track, limit]
    );
    return rows.reverse().map((row) => row.summary);
  } catch (error) {
    console.error('Failed to read recent lap summaries:', error);
    return [];
  }
}
