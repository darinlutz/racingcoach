import type { PoolClient } from 'pg';

// Racecar Analysis's track details for the Track Data tracks that had them in Track_Information.xlsx, which this
// replaces. Filled in once, by track key, when racingcoach.'Tracks' gets its average_speed_mph, typical_lap_seconds
// and analysis_notes columns (ensureUserSchema); after that the table is the source of truth, kept by Coaches and
// Admins in the Coach page's Track and Focus Area Maintenance. The length and corners only fill a track's own when
// it has none (the collector's iRacing length replaces the length with the next lap).

export type DefaultTrackAnalysis = {
  key: string;
  lengthFeet: number;
  numberOfCorners: number;
  averageSpeedMph: number;
  typicalLapSeconds: number;
  notes: string;
};

export const DEFAULT_TRACK_ANALYSIS: DefaultTrackAnalysis[] = [
  {
    key: 'indianapolis 2022 road',
    lengthFeet: 12878,
    numberOfCorners: 14,
    averageSpeedMph: 102.7,
    typicalLapSeconds: 85.5,
    notes:
      'Medium-low downforce. The long front straight and banked oval section give very high top speeds, followed by hard braking into Turn 1. The infield is tight and slow, with stop-and-go chicanes and 90-degree corners. Traction and clean exits matter more than mid-corner speed. Braking stability is key, and Turn 1 is the main overtaking spot.',
  },
  {
    key: 'twinring fullrc',
    lengthFeet: 15752,
    numberOfCorners: 14,
    averageSpeedMph: 98.5,
    typicalLapSeconds: 109,
    notes:
      'Low-medium downforce. A stop-and-go layout with two long straights (one runs under the bridge) and several slow hairpins and 90-degree corners. It\'s all about heavy, stable braking and strong traction out of slow corners. Overtaking chances come under braking at the end of each straight. Hard on brakes; rear tires overheat from the repeated traction zones.',
  },
  {
    key: 'monza full',
    lengthFeet: 19006,
    numberOfCorners: 11,
    averageSpeedMph: 122.3,
    typicalLapSeconds: 106,
    notes:
      'Lowest downforce of the calendar. The highest top speeds, with long straights and slipstream battles. Very heavy braking into the tight chicanes (Rettifilo, Roggia, Ascari) calls for kerb-hopping and good car stability. The Lesmos and Parabolica are medium-to-fast corners where exit speed carries onto the straights. Trim wing and lean on the tow.',
  },
  {
    key: 'roadatlanta full',
    lengthFeet: 13411,
    numberOfCorners: 12,
    averageSpeedMph: 118,
    typicalLapSeconds: 77.5,
    notes:
      'Medium downforce with big elevation changes. The fast, blind, uphill Esses need commitment and a well-balanced car. A long back straight gives high top speed into heavy braking at the Turn 10 chicane. The fast downhill Turn 12 under the bridge leads onto the front straight. Bumpy; the car needs to ride the kerbs well.',
  },
  {
    key: 'sachsenring',
    lengthFeet: 12046,
    numberOfCorners: 13,
    averageSpeedMph: 105.3,
    typicalLapSeconds: 78,
    notes:
      'High downforce, with a tight and twisty layout of short straights and mostly left-hand corners. The slow, technical infield rewards mechanical grip and rotation. The fast, blind, downhill \'Waterfall\' (T11) needs confidence and stability. Low top speeds and limited overtaking make qualifying crucial. The left front tire takes a heavy load.',
  },
  {
    key: 'silverstone 2019 gp',
    lengthFeet: 19325,
    numberOfCorners: 18,
    averageSpeedMph: 110.3,
    typicalLapSeconds: 119.5,
    notes:
      'Medium-high downforce. A fast, flowing circuit whose Maggotts-Becketts-Chapel high-speed esses reward aero grip and quick changes of direction. The Hangar and Wellington straights provide good top speed and overtaking under braking into Stowe and Brooklands. Copse and Stowe are fast sweepers. The slower Loop/Luffield complex tests traction. Tire wear is high.',
  },
  {
    key: 'barber 2026',
    lengthFeet: 12566,
    numberOfCorners: 16,
    averageSpeedMph: 103.9,
    typicalLapSeconds: 82.5,
    notes:
      'Medium-high downforce. A technical, flowing, rollercoaster-like track with lots of elevation change and few long straights. It mixes medium-speed sweepers with the tight Charlotte\'s Web hairpin. Top speeds stay moderate. Rhythm and precise lines matter more than power. Overtaking is difficult, and the constant loading is hard on tires.',
  },
  {
    key: 'suzuka grandprix',
    lengthFeet: 19050,
    numberOfCorners: 17,
    averageSpeedMph: 107.8,
    typicalLapSeconds: 120.5,
    notes:
      'Medium-high downforce on a figure-eight layout. The S-Curves demand rhythm and aero grip. Degner and the hairpin are slower, and Spoon is a long, fast corner. The long back straight through 130R gives the top speed of the lap, then heavy braking into the Casio Triangle chicane. Narrow with little room for error; it rewards a balanced car.',
  },
  {
    key: 'zandvoort 2023 gp',
    lengthFeet: 13973,
    numberOfCorners: 14,
    averageSpeedMph: 102.4,
    typicalLapSeconds: 93,
    notes:
      'High downforce. A narrow, undulating, old-school circuit with banked corners at Hugenholtz (T3) and the final Arie Luyendyk turn. There are few straights, so top speeds are modest, and blowing sand reduces grip. Fast, flowing sections through the dunes need a stable car. Overtaking is very hard; Tarzan (T1) is the main braking zone to pass.',
  },
  {
    key: 'thebend gt',
    lengthFeet: 25492,
    numberOfCorners: 35,
    averageSpeedMph: 99.3,
    typicalLapSeconds: 175,
    notes:
      'Medium downforce as a compromise. The longest lap (35 corners) mixes several long straights with high top speeds, tight hairpins, 90-degree corners and fast sweepers. Heavy braking zones reward stability and good traction on exit. Wide and fairly flat with lots of runoff. The long lap makes consistency and tire management important.',
  },
];

// On the caller's transaction (ensureUserSchema). Tracks not in Tracks are skipped.
export async function seedTrackAnalysis(client: PoolClient): Promise<void> {
  for (const track of DEFAULT_TRACK_ANALYSIS) {
    await client.query(
      `UPDATE racingcoach."Tracks" SET
         average_speed_mph = $2, typical_lap_seconds = $3, analysis_notes = $4,
         track_length_feet = COALESCE(track_length_feet, $5), number_of_corners = COALESCE(number_of_corners, $6),
         updated_at = now()
       WHERE lower(track_key) = lower($1)`,
      [track.key, track.averageSpeedMph, track.typicalLapSeconds, track.notes, track.lengthFeet, track.numberOfCorners]
    );
  }
}
