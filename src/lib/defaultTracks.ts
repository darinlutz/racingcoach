import type { PoolClient } from 'pg';

// The tracks and focus areas of Track Data. They are seeded once into racingcoach."Tracks" and
// "TrackFocusAreas", which belong to no user and are shared by every user (read only on the Track Data page).
//
// key is the iRacing track key (lowercase) and name the name Garage 61 puts in its CSV file names.
// Areas are in order around the lap; start/end are fractions of a lap (LapDistPct). They have no brake or
// throttle targets: those come only from each driver's Target Lap (targetLapTargets.ts).

export type DefaultFocusArea = {
  name: string;
  start: number;
  end: number;
};

export type DefaultTrack = {
  key: string;
  name: string;
  areas: DefaultFocusArea[];
};

const area = (name: string, start: number, end: number): DefaultFocusArea => ({ name, start, end });

export const DEFAULT_TRACKS: DefaultTrack[] = [
  {
    key: 'monza full',
    name: 'Autodromo Nazionale Monza (Grand Prix)',
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
    areas: [],
  },
  {
    key: 'cota gp',
    name: 'Circuit of the Americas (Grand Prix)',
    areas: [
      area('T 1', 0.04, 0.08),
      area('T 3', 0.24, 0.31),
      area('T 4', 0.48, 0.56),
      area('T 5', 0.56, 0.64),
      area('T 6', 0.75, 0.85),
    ],
  },
  {
    key: 'zandvoort 2023 gp',
    name: 'Circuit Zandvoort (Grand Prix)',
    areas: [
      area('T1', 0.02, 0.1),
      area('T3', 0.17, 0.21),
      area('T 7', 0.35, 0.42),
      area('T 10', 0.55, 0.6),
      area('12', 0.69, 0.76),
      area('T 13', 0.79, 0.82),
    ],
  },
  {
    key: 'fuji gp',
    name: 'Fuji International Speedway (Grand Prix)',
    areas: [],
  },
  {
    key: 'indianapolis 2022 road',
    name: 'Indianapolis Motor Speedway (Road Course)',
    areas: [
      area('T 1&2', 0.1, 0.22),
      area('T 4', 0.24, 0.29),
      area('T 7', 0.47, 0.55),
      area('T 8&9', 0.55, 0.6),
      area('T 10', 0.6, 0.65),
      area('T 12', 0.74, 0.8),
      area('T 13', 0.8, 0.86),
    ],
  },
  {
    key: 'misano gp',
    name: 'Misano World Circuit Marco Simoncelli (Grand Prix)',
    areas: [],
  },
  {
    key: 'twinring fullrc',
    name: 'Mobility Resort Motegi (Grand Prix)',
    areas: [
      area('T 1&2', 0.02, 0.09),
      area('T 3&4', 0.16, 0.25),
      area('T 5', 0.31, 0.36),
      area('T 7', 0.44, 0.52),
      area('T 9', 0.54, 0.58),
      area('T 10', 0.63, 0.69),
      area('T 11', 0.8, 0.86),
      area('12-14', 0.89, 0.94),
    ],
  },
  {
    key: 'roadatlanta full',
    name: 'Road Atlanta (Full Course)',
    areas: [
      area('T 1', 0.07, 0.14),
      area('Early Esses', 0.16, 0.28),
      area('T 5', 0.28, 0.37),
      area('T 6&7', 0.45, 0.55),
      area('T 10&11', 0.81, 0.9),
    ],
  },
  {
    key: 'sachsenring',
    name: 'Sachsenring',
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
    areas: [],
  },
  {
    key: 'thebend gt',
    name: 'Shell V-Power Motorsport Park at The Bend (GT Circuit)',
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
    areas: [
      area('3-5', 0.13, 0.21),
      area('6-8', 0.31, 0.41),
      area('T9', 0.5, 0.56),
      area('10-14', 0.61, 0.73),
      area('T15', 0.82, 0.89),
    ],
  },
  {
    key: 'suzuka grandprix',
    name: 'Suzuka International Racing Course (Grand Prix)',
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
      `INSERT INTO racingcoach."Tracks" (track_key, track_name)
       VALUES ($1, $2) RETURNING id`,
      [track.key, track.name]
    );
    for (const [i, a] of track.areas.entries()) {
      await client.query(
        `INSERT INTO racingcoach."TrackFocusAreas"
           (track_id, position, name, start_point, end_point)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, i + 1, a.name, a.start, a.end]
      );
    }
  }
}
