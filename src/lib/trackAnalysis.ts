import { query } from './db';
import { ensureUserSchema } from './users';

// The tracks Racecar Analysis knows (racecar_analysis_rag.py, sent by /api/racecar-analysis): Track Data's tracks,
// the ones with focus areas, with their details from racingcoach."Tracks". Their average speed, typical lap time and
// notes are kept by Coaches and Admins in Track and Focus Area Maintenance. null where a track has no value.

export type AnalysisTrack = {
  name: string;
  // The iRacing track key (e.g. "monza full")
  key: string;
  category: string | null;
  lengthFeet: number | null;
  numberOfCorners: number | null;
  averageSpeedMph: number | null;
  typicalLapSeconds: number | null;
  notes: string | null;
};

export async function readTracksForAnalysis(): Promise<AnalysisTrack[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT t.track_name, t.track_key, t.track_category, t.track_length_feet, t.number_of_corners,
       t.average_speed_mph, t.typical_lap_seconds, t.analysis_notes
     FROM racingcoach."Tracks" t
     WHERE EXISTS (SELECT 1 FROM racingcoach."TrackFocusAreas" f WHERE f.track_id = t.id)
     ORDER BY lower(t.track_name)`
  );
  return rows.map((t) => ({
    name: t.track_name as string,
    key: t.track_key as string,
    category: t.track_category as string | null,
    lengthFeet: t.track_length_feet == null ? null : Math.round(Number(t.track_length_feet)),
    numberOfCorners: t.number_of_corners as number | null,
    averageSpeedMph: t.average_speed_mph == null ? null : Number(t.average_speed_mph),
    typicalLapSeconds: t.typical_lap_seconds == null ? null : Number(t.typical_lap_seconds),
    notes: t.analysis_notes as string | null,
  }));
}
