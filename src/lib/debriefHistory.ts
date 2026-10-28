import { query } from './db';
import type { Debrief, DebriefSession } from './debriefCoach';
import { ensureUserSchema } from './users';

// Saved Debrief Coach runs (racingcoach."DebriefSessions"), so a user's debriefs outlive the Racing
// page and the Discord bot's /coach debrief can show them. They hold measurements of the user's laps, so they expire
// like laps (lapRetentionDb.ts), counted from when the run was saved.

export async function saveDebrief(userId: number, session: DebriefSession, debrief: Debrief): Promise<void> {
  await ensureUserSchema();
  const bestLapSeconds = Math.min(...session.laps.map((lap) => lap.lapTime));
  await query(
    `INSERT INTO racingcoach."DebriefSessions" (user_id, track, car, lap_count, best_lap_seconds, session, debrief, expires_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, racingcoach.lap_expires_at(now(), membership_level)
     FROM racingcoach."Users" WHERE id = $1`,
    [userId, session.track, session.car, session.laps.length, bestLapSeconds, JSON.stringify(session), JSON.stringify(debrief)]
  );
}
