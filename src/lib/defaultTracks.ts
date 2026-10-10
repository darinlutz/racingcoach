import type { PoolClient } from 'pg';

// The tracks and focus areas every account starts with. They are seeded once into racingcoach."Tracks"
// and "TrackFocusAreas", which belong to no user; each user gets their own copy in "UsersTracks" and
// "UsersFocusAreas" on sign-up (copyDefaultTracks) and can edit or delete it from the Track Data tab.
//
// key is the iRacing track key (lowercase) and name the name Garage 61 puts in its CSV file names.
// Areas are in order around the lap; start/end are fractions of a lap (LapDistPct). The brake and
// on-throttle points are feet from the start/finish line and maxBrakePct a percent; null means no
// target is set.

export type DefaultFocusArea = {
  name: string;
  start: number;
  end: number;
  notes: string | null;
  brakePointFeet: number | null;
  maxBrakePct: number | null;
  throttlePointFeet: number | null;
};

export type DefaultTrack = {
  key: string;
  name: string;
  lengthFeet: number;
  notes: string | null;
  areas: DefaultFocusArea[];
};

// An area with no targets set
const area = (name: string, start: number, end: number, notes: string | null = null): DefaultFocusArea => ({
  name,
  start,
  end,
  notes,
  brakePointFeet: null,
  maxBrakePct: null,
  throttlePointFeet: null,
});

// An area with its brake point, max brake pressure and on-throttle point
const targeted = (
  name: string,
  start: number,
  end: number,
  notes: string | null,
  brakePointFeet: number,
  maxBrakePct: number,
  throttlePointFeet: number
): DefaultFocusArea => ({ name, start, end, notes, brakePointFeet, maxBrakePct, throttlePointFeet });

export const DEFAULT_TRACKS: DefaultTrack[] = [
  {
    key: 'monza full',
    name: 'Autodromo Nazionale Monza (Grand Prix)',
    lengthFeet: 19006,
    notes: null,
    areas: [
      area('T 1&2', 0.12, 0.19),
      area('T4&5', 0.3, 0.4),
      area('T 7', 0.48, 0.51),
      area('T 8', 0.65, 0.72),
      area('T 11', 0.85, 0.92),
    ],
  },
  {
    key: 'barber 2026',
    name: 'Barber Motorsports Park',
    lengthFeet: 12566,
    notes: null,
    areas: [
      area('T2-T3', 0.07, 0.19),
      area('T5', 0.25, 0.34),
      area('T7-9', 0.43, 0.52),
      area('T12-13', 0.7, 0.78),
      area('T17', 0.89, 0.93),
    ],
  },
  {
    key: 'spa 2024 up',
    name: 'Circuit de Spa-Francorchamps (Grand Prix Pits)',
    lengthFeet: 22966,
    notes: null,
    areas: [],
  },
  {
    key: 'cota gp',
    name: 'Circuit of the Americas (Grand Prix)',
    lengthFeet: 18087,
    notes: null,
    areas: [
      targeted('T 1', 0.04, 0.08, null, 480, 84, 1048),
      area('T 3', 0.24, 0.31),
      area('T 4', 0.48, 0.56),
      area('T 5', 0.56, 0.64),
      area('T 6', 0.75, 0.85),
    ],
  },
  {
    key: 'zandvoort 2023 gp',
    name: 'Circuit Zandvoort (Grand Prix)',
    lengthFeet: 13973,
    notes: null,
    areas: [
      targeted('T1', 0.02, 0.1, null, 692, 85, 1260),
      targeted('T3', 0.17, 0.21, 'Banked', 2477, 37, 2723),
      targeted('T 7', 0.35, 0.42, 'Carry speed', 4980, 35, 5489),
      targeted('T 10', 0.55, 0.6, 'Exit speed important', 7841, 38, 8297),
      targeted('12', 0.69, 0.76, 'Final complex', 9724, 78, 10371),
      targeted('T 13', 0.79, 0.82, 'Final complex', 11099, 50, 11362),
    ],
  },
  {
    key: 'fuji gp',
    name: 'Fuji International Speedway (Grand Prix)',
    lengthFeet: 14960,
    notes: null,
    areas: [],
  },
  {
    key: 'indianapolis 2022 road',
    name: 'Indianapolis Motor Speedway (Road Course)',
    lengthFeet: 12878,
    notes: null,
    areas: [
      area('T 1', 0.11, 0.21),
      area('T 4-5', 0.24, 0.31),
      area('T 7', 0.48, 0.56),
      area('T 8-10', 0.56, 0.64),
      area('T 12-14', 0.75, 0.85),
    ],
  },
  {
    key: 'misano gp',
    name: 'Misano World Circuit Marco Simoncelli (Grand Prix)',
    lengthFeet: 13781,
    notes: null,
    areas: [],
  },
  {
    key: 'twinring fullrc',
    name: 'Mobility Resort Motegi (Grand Prix)',
    lengthFeet: 15752,
    notes: null,
    areas: [
      targeted('T 1&2', 0.02, 0.09, null, 450, 81, 1011),
      targeted('T 3&4', 0.16, 0.25, null, 2673, 90, 3126),
      targeted('T 5', 0.31, 0.36, null, 4978, 90, 5458),
      targeted('T 7', 0.44, 0.52, null, 7131, 76, 7537),
      targeted('T 9', 0.54, 0.58, null, 8654, 75, 9010),
      targeted('T 10', 0.63, 0.69, null, 10081, 90, 10502),
      targeted('T 11', 0.8, 0.86, null, 12744, 85, 13260),
      targeted('12-14', 0.89, 0.94, null, 14028, 63, 14487),
    ],
  },
  {
    key: 'roadatlanta full',
    name: 'Road Atlanta (Full Course)',
    lengthFeet: 13411,
    notes: 'Focus on T4, T6 and T10. T10 exit is critical.',
    areas: [
      targeted('T 1', 0.07, 0.14, 'Entry and rotation', 984, 56, 1483),
      targeted('Early Esses', 0.16, 0.28, 'Be smooth, carry speed', 2417, 85, 2799),
      targeted('T 5', 0.28, 0.37, 'Be smooth, carry speed', 4282, 63, 4619),
      targeted('T 6&7', 0.45, 0.55, 'Focus on EXIT', 6129, 74, 7034),
      targeted('T 10&11', 0.81, 0.9, 'Exit critical', 11007, 82, 11627),
    ],
  },
  {
    key: 'sachsenring',
    name: 'Sachsenring',
    lengthFeet: 12046,
    notes: null,
    areas: [
      area('T1', 0.11, 0.18),
      area('Omega', 0.23, 0.29),
      area('T8', 0.5, 0.54),
      area('Sachs', 0.79, 0.87),
      area('T13', 0.91, 0.96),
    ],
  },
  {
    key: 'sebring international',
    name: 'Sebring International Raceway (International)',
    lengthFeet: 19754,
    notes: null,
    areas: [],
  },
  {
    key: 'thebend gt',
    name: 'Shell V-Power Motorsport Park at The Bend (GT Circuit)',
    lengthFeet: 25492,
    notes: null,
    areas: [
      area('1-5', 0.01, 0.13),
      area('7-10', 0.16, 0.29),
      area('17-18', 0.43, 0.51),
      area('25-30', 0.65, 0.79),
      area('31-35', 0.8, 0.99),
    ],
  },
  {
    key: 'silverstone 2019 gp',
    name: 'Silverstone Circuit (Grand Prix)',
    lengthFeet: 19325,
    notes: 'Focus on T1, T9 and the 10-14 complex.',
    areas: [
      area('3-5', 0.13, 0.21, 'Prioritize exit'),
      area('6-8', 0.31, 0.41, 'Good exit is key'),
      area('T9', 0.5, 0.56, 'Look at MIN speed'),
      area('10-14', 0.61, 0.73, 'Exit speed important, settle car'),
      area('T15', 0.82, 0.89, 'Compare brake traces here'),
    ],
  },
  {
    key: 'suzuka grandprix',
    name: 'Suzuka International Racing Course (Grand Prix)',
    lengthFeet: 19050,
    notes: null,
    areas: [
      area('T1', 0.07, 0.15),
      area('Esses', 0.18, 0.29),
      area('Hairpin', 0.47, 0.52),
      area('Spoon', 0.63, 0.72),
      area('Chicane', 0.89, 0.96),
    ],
  },
];

// Fills racingcoach."Tracks" and "TrackFocusAreas" with DEFAULT_TRACKS. Runs once, on the caller's
// transaction, when the Tracks table is first created; after that the tables are the source of truth.
export async function seedDefaultTracks(client: PoolClient): Promise<void> {
  for (const track of DEFAULT_TRACKS) {
    const { rows } = await client.query(
      `INSERT INTO racingcoach."Tracks" (track_key, track_name, track_length_feet, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [track.key, track.name, track.lengthFeet, track.notes]
    );
    for (const [i, a] of track.areas.entries()) {
      await client.query(
        `INSERT INTO racingcoach."TrackFocusAreas"
           (track_id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rows[0].id, i + 1, a.name, a.start, a.end, a.notes, a.brakePointFeet, a.maxBrakePct, a.throttlePointFeet]
      );
    }
  }
}

// Copies every track in racingcoach."Tracks" and its "TrackFocusAreas" into one user's "UsersTracks"
// and "UsersFocusAreas", or every user's when userId is null (the one-time backfill when Tracks is first
// seeded). A track the user already has (same key or name) is skipped along with its areas. Runs on
// the caller's transaction.
export async function copyDefaultTracks(client: PoolClient, userId: number | null): Promise<void> {
  await client.query(
    `WITH copied AS (
       INSERT INTO racingcoach."UsersTracks" (user_id, track_key, track_name, track_length_feet, notes)
       SELECT u.id, t.track_key, t.track_name, t.track_length_feet, t.notes
       FROM racingcoach."Users" u CROSS JOIN racingcoach."Tracks" t
       WHERE $1::int IS NULL OR u.id = $1
       ON CONFLICT DO NOTHING
       RETURNING id, track_key
     )
     INSERT INTO racingcoach."UsersFocusAreas"
       (track_id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet)
     SELECT c.id, f.position, f.name, f.start_point, f.end_point, f.notes,
            f.brake_point_feet, f.max_brake_pct, f.throttle_point_feet
     FROM copied c
     JOIN racingcoach."Tracks" t ON lower(t.track_key) = lower(c.track_key)
     JOIN racingcoach."TrackFocusAreas" f ON f.track_id = t.id`,
    [userId]
  );
}
