import { z } from 'zod';
import { query, transaction } from './db';
import { ensureUserSchema } from './users';

// Each user's own tracks and focus areas in racingcoach."Tracks" and "FocusAreas" (created by
// ensureUserSchema). A track is saved whole: its details plus its focus areas, which replace the old
// ones and are numbered 1-8 in order around the lap (by start point).

export const MAX_FOCUS_AREAS = 8;

const optionalText = z
  .string()
  .max(1000)
  .transform((s) => s.trim() || null)
  .nullable();
const feet = z.number().int().min(0).max(200000).nullable();

export const focusAreaInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Every focus area needs a name').max(100),
    startPoint: z.number().min(0).max(1),
    endPoint: z.number().min(0).max(1),
    notes: optionalText,
    brakePointFeet: feet,
    maxBrakePct: z.number().int().min(0).max(100).nullable(),
    throttlePointFeet: feet,
  })
  .refine((a) => a.startPoint < a.endPoint, { message: 'A focus area must start before it ends' });

export const trackInputSchema = z.object({
  name: z.string().trim().min(1, 'Track name is required').max(200),
  // The iRacing track key (e.g. "monza full"); the name is used when it is left blank
  key: z.string().trim().max(200),
  lengthFeet: z.number().int().min(1).max(200000).nullable(),
  notes: optionalText,
  areas: z.array(focusAreaInputSchema).max(MAX_FOCUS_AREAS, `A track can have at most ${MAX_FOCUS_AREAS} focus areas`),
});

export type TrackInput = z.infer<typeof trackInputSchema>;
export type FocusArea = z.infer<typeof focusAreaInputSchema> & { id: number; position: number };
export type UserTrack = Omit<TrackInput, 'areas'> & { id: number; areas: FocusArea[] };

export class TrackNotFoundError extends Error {
  constructor() {
    super('Track not found');
  }
}

export async function readTracks(userId: number): Promise<UserTrack[]> {
  await ensureUserSchema();
  const tracks = await query(
    `SELECT id, track_key, track_name, track_length_feet, notes FROM racingcoach."Tracks"
     WHERE user_id = $1 ORDER BY lower(track_name)`,
    [userId]
  );
  const areas = await query(
    `SELECT f.id, f.track_id, f.position, f.name, f.start_point, f.end_point, f.notes,
            f.brake_point_feet, f.max_brake_pct, f.throttle_point_feet
     FROM racingcoach."FocusAreas" f JOIN racingcoach."Tracks" t ON t.id = f.track_id
     WHERE t.user_id = $1 ORDER BY f.track_id, f.position`,
    [userId]
  );
  return tracks.map((t) => ({
    id: t.id as number,
    name: t.track_name as string,
    key: t.track_key as string,
    lengthFeet: t.track_length_feet as number | null,
    notes: t.notes as string | null,
    areas: areas
      .filter((a) => a.track_id === t.id)
      .map((a) => ({
        id: a.id as number,
        position: a.position as number,
        name: a.name as string,
        startPoint: a.start_point as number,
        endPoint: a.end_point as number,
        notes: a.notes as string | null,
        brakePointFeet: a.brake_point_feet as number | null,
        maxBrakePct: a.max_brake_pct as number | null,
        throttlePointFeet: a.throttle_point_feet as number | null,
      })),
  }));
}

type Client = Parameters<Parameters<typeof transaction>[0]>[0];

async function replaceAreas(client: Client, trackId: number, areas: TrackInput['areas']) {
  await client.query('DELETE FROM racingcoach."FocusAreas" WHERE track_id = $1', [trackId]);
  const ordered = [...areas].sort((a, b) => a.startPoint - b.startPoint);
  for (const [i, a] of ordered.entries()) {
    await client.query(
      `INSERT INTO racingcoach."FocusAreas"
         (track_id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [trackId, i + 1, a.name, a.startPoint, a.endPoint, a.notes, a.brakePointFeet, a.maxBrakePct, a.throttlePointFeet]
    );
  }
}

// Throws a unique violation (see isUniqueViolation) when the user already has a track with that name or key
export async function addTrack(userId: number, track: TrackInput): Promise<number> {
  await ensureUserSchema();
  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO racingcoach."Tracks" (user_id, track_key, track_name, track_length_feet, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, track.key || track.name, track.name, track.lengthFeet, track.notes]
    );
    await replaceAreas(client, rows[0].id, track.areas);
    return rows[0].id as number;
  });
}

// Only updates the track if it belongs to this user
export async function updateTrack(userId: number, id: number, track: TrackInput): Promise<void> {
  await ensureUserSchema();
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE racingcoach."Tracks" SET track_key = $3, track_name = $4, track_length_feet = $5, notes = $6, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, track.key || track.name, track.name, track.lengthFeet, track.notes]
    );
    if (!rowCount) throw new TrackNotFoundError();
    await replaceAreas(client, id, track.areas);
  });
}

export const referencePointsInputSchema = z.object({
  // The Reference Points tab's track: its key and name, as /api/track-names returns them
  trackKey: z.string().trim().max(200),
  trackName: z.string().trim().max(200),
  areas: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        brakePointFeet: z.number().nullable(),
        maxBrakePct: z.number().nullable(),
        throttlePointFeet: z.number().nullable(),
      })
    )
    .min(1)
    .max(50),
});

export type ReferencePointsInput = z.infer<typeof referencePointsInputSchema>;

// Overwrites the brake point, max brake pressure and on-throttle point of the user's matching focus
// areas (matched by name, ignoring case) on the track matching the key or name. A value the
// measurement did not find (null) leaves the saved one alone.
export async function saveReferencePoints(
  userId: number,
  input: ReferencePointsInput
): Promise<{ track: string; saved: string[]; notFound: string[] }> {
  await ensureUserSchema();
  return transaction(async (client) => {
    const { rows: tracks } = await client.query(
      `SELECT id, track_name FROM racingcoach."Tracks"
       WHERE user_id = $1 AND (lower(track_key) = lower($2) OR lower(track_name) = lower($3))
       ORDER BY (lower(track_key) = lower($2)) DESC LIMIT 1`,
      [userId, input.trackKey, input.trackName]
    );
    if (tracks.length === 0) throw new TrackNotFoundError();

    const feet = (v: number | null) => (v === null ? null : Math.max(0, Math.round(v)));
    const pct = (v: number | null) => (v === null ? null : Math.min(100, Math.max(0, Math.round(v))));
    const saved: string[] = [];
    const notFound: string[] = [];
    for (const area of input.areas) {
      const { rowCount } = await client.query(
        `UPDATE racingcoach."FocusAreas"
         SET brake_point_feet = COALESCE($3, brake_point_feet),
             max_brake_pct = COALESCE($4, max_brake_pct),
             throttle_point_feet = COALESCE($5, throttle_point_feet)
         WHERE track_id = $1 AND lower(name) = lower($2)`,
        [tracks[0].id, area.name, feet(area.brakePointFeet), pct(area.maxBrakePct), feet(area.throttlePointFeet)]
      );
      (rowCount ? saved : notFound).push(area.name);
    }
    await client.query('UPDATE racingcoach."Tracks" SET updated_at = now() WHERE id = $1', [tracks[0].id]);
    return { track: tracks[0].track_name as string, saved, notFound };
  });
}

// Only deletes the track if it belongs to this user; its focus areas go with it
export async function deleteTrack(userId: number, id: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."Tracks" WHERE id = $1 AND user_id = $2', [id, userId]);
}
