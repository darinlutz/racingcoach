import type { PoolClient } from 'pg';
import { isUniqueViolation, query, transaction } from './db';
import { ensureUserSchema } from './users';

// The Admin page's Track and Focus Area Maintenance section (src/components/TrackMaintenance.tsx): every
// track in racingcoach."Tracks" (with or without focus areas, unlike readTracks), adding tracks, and adding,
// editing and deleting their "TrackFocusAreas". Focus areas stay numbered from 1 in order around the lap by
// start point, so positions are renumbered after every change.

export type MaintenanceFocusArea = {
  id: number;
  position: number;
  name: string;
  startPoint: number;
  endPoint: number;
  notes: string | null;
  brakePointFeet: number | null;
  maxBrakePct: number | null;
  throttlePointFeet: number | null;
};

export type MaintenanceTrack = {
  id: number;
  key: string;
  name: string;
  numberOfCorners: number | null;
  areas: MaintenanceFocusArea[];
};

// What the admin types for a focus area. Brake and throttle points are in feet, as stored.
export type FocusAreaInput = {
  name: string;
  startPoint: number;
  endPoint: number;
  notes: string | null;
  brakePointFeet: number | null;
  maxBrakePct: number | null;
  throttlePointFeet: number | null;
};

export type TrackInput = { key: string; name: string; numberOfCorners: number | null };

export class TrackMaintenanceError extends Error {
  constructor(
    public reason: 'track-not-found' | 'area-not-found' | 'duplicate-track'
  ) {
    super(reason);
  }
}

export async function listTracksForMaintenance(): Promise<MaintenanceTrack[]> {
  await ensureUserSchema();
  const [tracks, areas] = await Promise.all([
    query(`SELECT id, track_key, track_name, number_of_corners FROM racingcoach."Tracks" ORDER BY lower(track_name)`),
    query(
      `SELECT id, track_id, position, name, start_point, end_point, notes,
              brake_point_feet, max_brake_pct, throttle_point_feet
       FROM racingcoach."TrackFocusAreas" ORDER BY track_id, position`
    ),
  ]);
  const byTrack = new Map<number, MaintenanceFocusArea[]>();
  for (const a of areas) {
    const list = byTrack.get(a.track_id as number) ?? [];
    list.push(toArea(a));
    byTrack.set(a.track_id as number, list);
  }
  return tracks.map((t) => ({
    id: t.id as number,
    key: t.track_key as string,
    name: t.track_name as string,
    numberOfCorners: t.number_of_corners as number | null,
    areas: byTrack.get(t.id as number) ?? [],
  }));
}

export async function createTrack(input: TrackInput): Promise<MaintenanceTrack> {
  await ensureUserSchema();
  try {
    // Categorized like categorizeTracks (trackCorners.ts)
    const [row] = await query(
      `INSERT INTO racingcoach."Tracks" (track_key, track_name, number_of_corners, track_category)
       VALUES ($1, $2, $3::int, CASE
         WHEN $2 ~* '(dirt|rally)' THEN 'Dirt'
         WHEN $3::int <= 4 THEN 'Oval'
         ELSE 'Road Course' END)
       RETURNING id, track_key, track_name, number_of_corners`,
      [input.key, input.name, input.numberOfCorners]
    );
    return {
      id: row.id as number,
      key: row.track_key as string,
      name: row.track_name as string,
      numberOfCorners: row.number_of_corners as number | null,
      areas: [],
    };
  } catch (error) {
    if (isUniqueViolation(error)) throw new TrackMaintenanceError('duplicate-track');
    throw error;
  }
}

// Each returns the track's focus areas after the change, renumbered
export async function addFocusArea(trackId: number, input: FocusAreaInput): Promise<MaintenanceFocusArea[]> {
  await ensureUserSchema();
  return transaction(async (client) => {
    const areas = await lockAreas(client, trackId);
    const [{ id }] = (await client.query('SELECT nextval(pg_get_serial_sequence(\'racingcoach."TrackFocusAreas"\', \'id\')) AS id')).rows;
    return rewriteAreas(client, trackId, [...areas, { ...input, id: Number(id), position: 0 }]);
  });
}

export async function updateFocusArea(trackId: number, areaId: number, input: FocusAreaInput): Promise<MaintenanceFocusArea[]> {
  await ensureUserSchema();
  return transaction(async (client) => {
    const areas = await lockAreas(client, trackId);
    if (!areas.some((a) => a.id === areaId)) throw new TrackMaintenanceError('area-not-found');
    return rewriteAreas(client, trackId, areas.map((a) => (a.id === areaId ? { ...input, id: a.id, position: a.position } : a)));
  });
}

export async function deleteFocusArea(trackId: number, areaId: number): Promise<MaintenanceFocusArea[]> {
  await ensureUserSchema();
  return transaction(async (client) => {
    const areas = await lockAreas(client, trackId);
    if (!areas.some((a) => a.id === areaId)) throw new TrackMaintenanceError('area-not-found');
    return rewriteAreas(client, trackId, areas.filter((a) => a.id !== areaId));
  });
}

// Locks the track row, so two admins' changes to the same track don't interleave, and reads its areas
async function lockAreas(client: PoolClient, trackId: number): Promise<MaintenanceFocusArea[]> {
  const track = await client.query('SELECT id FROM racingcoach."Tracks" WHERE id = $1 FOR UPDATE', [trackId]);
  if (track.rowCount === 0) throw new TrackMaintenanceError('track-not-found');
  const { rows } = await client.query(
    `SELECT id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet
     FROM racingcoach."TrackFocusAreas" WHERE track_id = $1 ORDER BY position`,
    [trackId]
  );
  return rows.map(toArea);
}

// Replaces the track's focus areas with `areas`, keeping their ids and numbering them 1-8 by start point.
// Delete and re-insert, because (track_id, position) is unique and positions can't go below 1 to swap.
async function rewriteAreas(client: PoolClient, trackId: number, areas: MaintenanceFocusArea[]): Promise<MaintenanceFocusArea[]> {
  const sorted = [...areas].sort((a, b) => a.startPoint - b.startPoint || a.endPoint - b.endPoint);
  await client.query('DELETE FROM racingcoach."TrackFocusAreas" WHERE track_id = $1', [trackId]);
  const result: MaintenanceFocusArea[] = [];
  for (const [i, a] of sorted.entries()) {
    const { rows } = await client.query(
      `INSERT INTO racingcoach."TrackFocusAreas"
         (id, track_id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet`,
      [a.id, trackId, i + 1, a.name, a.startPoint, a.endPoint, a.notes, a.brakePointFeet, a.maxBrakePct, a.throttlePointFeet]
    );
    result.push(toArea(rows[0]));
  }
  await client.query('UPDATE racingcoach."Tracks" SET updated_at = now() WHERE id = $1', [trackId]);
  return result;
}

function toArea(a: Record<string, unknown>): MaintenanceFocusArea {
  return {
    id: a.id as number,
    position: a.position as number,
    name: a.name as string,
    startPoint: a.start_point as number,
    endPoint: a.end_point as number,
    notes: a.notes as string | null,
    brakePointFeet: a.brake_point_feet as number | null,
    maxBrakePct: a.max_brake_pct as number | null,
    throttlePointFeet: a.throttle_point_feet as number | null,
  };
}

// Checks a request body's focus area, or null when it isn't valid. Brake and throttle points are feet.
export function parseFocusAreaInput(body: unknown): FocusAreaInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const startPoint = Number(b.startPoint);
  const endPoint = Number(b.endPoint);
  if (!name || name.length > 100) return null;
  if (!Number.isFinite(startPoint) || !Number.isFinite(endPoint)) return null;
  if (startPoint < 0 || endPoint > 1 || startPoint >= endPoint) return null;
  const optionalInt = (value: unknown, max: number): number | null | undefined => {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
  };
  const brakePointFeet = optionalInt(b.brakePointFeet, 1_000_000);
  const maxBrakePct = optionalInt(b.maxBrakePct, 100);
  const throttlePointFeet = optionalInt(b.throttlePointFeet, 1_000_000);
  if (brakePointFeet === undefined || maxBrakePct === undefined || throttlePointFeet === undefined) return null;
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 2000) : null;
  return { name, startPoint, endPoint, notes, brakePointFeet, maxBrakePct, throttlePointFeet };
}

export function parseTrackInput(body: unknown): TrackInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const key = typeof b.key === 'string' ? b.key.trim() : '';
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!key || !name || key.length > 200 || name.length > 200) return null;
  let numberOfCorners: number | null = null;
  if (b.numberOfCorners !== null && b.numberOfCorners !== undefined && b.numberOfCorners !== '') {
    const n = Number(b.numberOfCorners);
    if (!Number.isInteger(n) || n <= 0 || n > 1000) return null;
    numberOfCorners = n;
  }
  return { key, name, numberOfCorners };
}

// The API dictionary's message and the status for each error (the routes under src/app/api/admin/tracks/)
export function maintenanceErrorReply(reason: TrackMaintenanceError['reason']) {
  return {
    'track-not-found': { key: 'trackNotFound', status: 404 },
    'area-not-found': { key: 'focusAreaNotFound', status: 404 },
    'duplicate-track': { key: 'duplicateTrack', status: 409 },
  }[reason] as {
    key: 'trackNotFound' | 'focusAreaNotFound' | 'duplicateTrack';
    status: number;
  };
}
