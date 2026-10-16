import { query } from './db';
import { sameTrackName, type Track } from './lapData';
import { ensureUserSchema } from './users';

// Track Data: the tracks in racingcoach."Tracks" and their "TrackFocusAreas" (created by ensureUserSchema
// and seeded from DEFAULT_TRACKS), shared by every user. Focus areas are numbered from 1 in order around
// the lap (by start point), as many as a track needs. Only tracks with focus areas are Track Data; the layouts appended from
// TracksNumberOfCorners have none.

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
  // iRacing's length, sent by the collector with its laps of the track (trackLengths.ts); null without any
  lengthFeet: number | null;
  notes: string | null;
  areas: FocusArea[];
};

export async function readTracks(): Promise<TrackData[]> {
  await ensureUserSchema();
  const tracks = await query(
    `SELECT t.id, t.track_key, t.track_name, t.notes, t.track_length_feet FROM racingcoach."Tracks" t
     WHERE EXISTS (SELECT 1 FROM racingcoach."TrackFocusAreas" f WHERE f.track_id = t.id)
     ORDER BY lower(t.track_name)`
  );
  const areas = await query(
    `SELECT id, track_id, position, name, start_point, end_point, notes,
            brake_point_feet, max_brake_pct, throttle_point_feet
     FROM racingcoach."TrackFocusAreas" ORDER BY track_id, position`
  );
  return tracks.map((t) => ({
    id: t.id as number,
    name: t.track_name as string,
    key: t.track_key as string,
    lengthFeet: t.track_length_feet == null ? null : Math.round(Number(t.track_length_feet)),
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

// The Track Data track for a track the collector is driving or uploaded laps of, by iRacing's track key
// (WeekendInfo.TrackName, e.g. "twinring fullrc") against "Tracks".track_key, never by name: iRacing can name a
// layout differently from Track Data ("Mobility Resort Motegi (Full Road Course)" vs "(Grand Prix)"). Without a
// key (collectors before 1.29.0, and their laps) there's no track.
export function findTrackByKey(tracks: TrackData[], key: string | null | undefined): TrackData | undefined {
  const k = key?.trim().toLowerCase();
  return k ? tracks.find((t) => t.key.toLowerCase() === k) : undefined;
}

// Whether a lap file's track name (e.g. a Target Lap's, from Garage 61) is the track being driven: the name the
// collector gave, or the Track Data track found for it (which can be named differently)
export function namesSameTrack(fileTrack: string, driving: string, track: TrackData | undefined): boolean {
  return sameTrackName(fileTrack, driving) || (!!track && sameTrackName(fileTrack, track.name));
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
