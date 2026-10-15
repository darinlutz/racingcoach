import { query } from './db';
import { sameTrackName, type Track } from './lapData';
import { readTrackLengths } from './trackLengths';
import { ensureUserSchema } from './users';

// Track Data: the tracks in racingcoach."Tracks" and their "TrackFocusAreas" (created by ensureUserSchema
// and seeded from DEFAULT_TRACKS), shared by every user. Focus areas are numbered 1-8 in order around the
// lap (by start point). Only tracks with focus areas are Track Data; the layouts appended from
// TracksNumberOfCorners have none.

export const MAX_FOCUS_AREAS = 8;

export type FocusArea = {
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

export type TrackData = {
  id: number;
  name: string;
  // The iRacing track key (e.g. "monza full")
  key: string;
  // iRacing's length, from the collector's laps of the track (trackLengths.ts); null without any
  lengthFeet: number | null;
  notes: string | null;
  areas: FocusArea[];
};

export async function readTracks(): Promise<TrackData[]> {
  await ensureUserSchema();
  const tracks = await query(
    `SELECT t.id, t.track_key, t.track_name, t.notes FROM racingcoach."Tracks" t
     WHERE EXISTS (SELECT 1 FROM racingcoach."TrackFocusAreas" f WHERE f.track_id = t.id)
     ORDER BY lower(t.track_name)`
  );
  const areas = await query(
    `SELECT id, track_id, position, name, start_point, end_point, notes,
            brake_point_feet, max_brake_pct, throttle_point_feet
     FROM racingcoach."TrackFocusAreas" ORDER BY track_id, position`
  );
  const lengths = await readTrackLengths();
  // Matched like findTrackByName: the collector's track names are iRacing's
  const lengthFeet = (name: string, key: string) => {
    const found =
      lengths.find((l) => sameTrackName(name, l.track)) ?? lengths.find((l) => l.track.toLowerCase() === key.toLowerCase());
    return found ? Math.round(found.lengthFeet) : null;
  };
  return tracks.map((t) => ({
    id: t.id as number,
    name: t.track_name as string,
    key: t.track_key as string,
    lengthFeet: lengthFeet(t.track_name as string, t.track_key as string),
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

// The track for a track name from iRacing (the collector's), matched like recorded laps are on the Racing
// page (iRacing's names can differ slightly from Track Data's), or by track key
export function findTrackByName(tracks: TrackData[], name: string): TrackData | undefined {
  return tracks.find((t) => sameTrackName(t.name, name)) ?? tracks.find((t) => t.key.toLowerCase() === name.toLowerCase());
}

// A Track Data track in the shape the lap measuring code (lapData.ts) takes. `name` is the track key and
// `fileName` the name Garage 61 puts in its CSV file names; targets that aren't set are null.
export function toLapTrack(track: TrackData): Track {
  return {
    name: track.key,
    fileName: track.name,
    lengthFeet: track.lengthFeet,
    areas: track.areas.map((area) => ({
      name: area.name,
      start: area.startPoint,
      end: area.endPoint,
      brakepointTarget: area.brakePointFeet,
      maxBrakeTarget: area.maxBrakePct,
      throttlePickupTarget: area.throttlePointFeet,
    })),
  };
}
