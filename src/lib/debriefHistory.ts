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

// The fixes of the user's latest saved debriefs of this track and car, newest last, so the Debrief Coach doesn't give
// the same advice in the same words again (src/lib/coachingGuidance.ts). Expired runs are left out, like every read.
export async function readRecentDebriefAdvice(userId: number, track: string, car: string, limit = 3): Promise<string[]> {
  await ensureUserSchema();
  const rows = await query<{ debrief: Debrief }>(
    `SELECT debrief FROM racingcoach."DebriefSessions"
     WHERE user_id = $1 AND lower(track) = lower($2) AND lower(car) = lower($3) AND expires_at > now()
     ORDER BY created_at DESC LIMIT $4`,
    [userId, track, car, limit]
  );
  return rows
    .reverse()
    .flatMap((row) => (Array.isArray(row.debrief?.fixes) ? row.debrief.fixes : []))
    .map((fix) => `${fix.area}: ${fix.fix}`)
    .filter((text) => text.length > 2);
}
