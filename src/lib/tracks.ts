import { query } from './db';
import { sameTrackName, type Track } from './lapData';
import type { TrackBounds } from './trackLocations';
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
};

export type TrackData = {
  id: number;
  name: string;
  // The iRacing track key (e.g. "monza full")
  key: string;
  // iRacing's length, sent by the collector with its laps of the track (trackLengths.ts); null without any
  lengthFeet: number | null;
  // "Road Course", "Oval" or "Dirt" (categorizeTracks in trackCorners.ts); null when not set
  category: string | null;
  // Where the track is, for Track Data's satellite picture (trackLocations.ts): iRacing's location, and the
  // extent of a lap's track positions; null until laps of the track give them
  location: { latitude: number; longitude: number } | null;
  bounds: TrackBounds | null;
  areas: FocusArea[];
};

export async function readTracks(): Promise<TrackData[]> {
  await ensureUserSchema();
  const tracks = await query(
    `SELECT t.id, t.track_key, t.track_name, t.track_length_feet, t.track_category,
       t.track_latitude, t.track_longitude, t.track_south, t.track_west, t.track_north, t.track_east FROM racingcoach."Tracks" t
     WHERE EXISTS (SELECT 1 FROM racingcoach."TrackFocusAreas" f WHERE f.track_id = t.id)
     ORDER BY lower(t.track_name)`
  );
  const areas = await query(
    `SELECT id, track_id, position, name, start_point, end_point
     FROM racingcoach."TrackFocusAreas" ORDER BY track_id, position`
  );
  return tracks.map((t) => ({
    id: t.id as number,
    name: t.track_name as string,
    key: t.track_key as string,
    lengthFeet: t.track_length_feet == null ? null : Math.round(Number(t.track_length_feet)),
    category: t.track_category as string | null,
    location:
      t.track_latitude == null || t.track_longitude == null
        ? null
        : { latitude: Number(t.track_latitude), longitude: Number(t.track_longitude) },
    bounds:
      t.track_south == null
        ? null
        : { south: Number(t.track_south), west: Number(t.track_west), north: Number(t.track_north), east: Number(t.track_east) },
    areas: areas
      .filter((a) => a.track_id === t.id)
      .map((a) => ({
        id: a.id as number,
        position: a.position as number,
        name: a.name as string,
        startPoint: a.start_point as number,
        endPoint: a.end_point as number,
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
// `fileName` the name Garage 61 puts in its CSV file names. The targets are null: they only come from the user's
// Target Lap, which withTargetLap (targetLapTargets.ts) adds.
export function toLapTrack(track: TrackData): Track {
  return {
    name: track.key,
    fileName: track.name,
    lengthFeet: track.lengthFeet,
    areas: track.areas.map((area) => ({
      name: area.name,
      start: area.startPoint,
      end: area.endPoint,
      brakepointTarget: null,
      maxBrakeTarget: null,
      throttlePickupTarget: null,
    })),
  };
}
