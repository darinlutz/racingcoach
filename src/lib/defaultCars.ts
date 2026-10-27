import type { PoolClient } from 'pg';
import type { RacingDiscipline } from './racingDisciplines';

// The cars every account starts with (the GT3 cars from GT3_Car_Data.xlsx, then one of each other
// discipline). They are seeded once into racingcoach."Cars"; each user gets their own copy in "CarsUsers"
// on sign-up (copyDefaultCars) and can edit or delete them from the Car Data tab.

export type DefaultCar = {
  name: string;
  racingDiscipline: RacingDiscipline;
  lengthIn: number;
  widthIn: number;
  wheelbaseIn: number;
  dryWeightLbs: number;
  wetWeightLbs: number;
  displacementLiters: number;
  rpmLimit: number;
  torqueLbFt: number;
  powerBhp: number;
  notes: string;
};

export const DEFAULT_CARS: DefaultCar[] = [
  {
    name: 'Porsche 911 GT3 R (992)',
    racingDiscipline: 'Sports Car',
    lengthIn: 181.8,
    widthIn: 80.7,
    wheelbaseIn: 98.7,
    dryWeightLbs: 2755,
    wetWeightLbs: 3300,
    displacementLiters: 4.2,
    rpmLimit: 9500,
    torqueLbFt: 375,
    powerBhp: 565,
    notes:
      'Rear-engine 4.2L flat-six (NA), highest rev limit (9,500) and power in the field. Shortest wheelbase; rear weight bias gives class-leading traction and braking stability. Aero is strong on the rear but the nose can go light at high speed. Desirable: superb corner exits, late braking, great on kerbs and in the wet. Undesirable: lift-off/trail-brake oversteer is snappy, needs patient rotation on entry, and mid-corner understeer if you rush it. Rewards a precise, experienced driver.',
  },
  {
    name: 'Mercedes-AMG GT3 2020',
    racingDiscipline: 'Sports Car',
    lengthIn: 185.4,
    widthIn: 80.3,
    wheelbaseIn: 103.5,
    dryWeightLbs: 2910,
    wetWeightLbs: 3175,
    displacementLiters: 6.2,
    rpmLimit: 7800,
    torqueLbFt: 460,
    powerBhp: 500,
    notes:
      "Front-mid 6.2L NA V8 with a long hood and heavy front weight. Big low-end torque with a low 7,800 rpm limit, so it's short-shifted and lugs well out of slow corners. Stable, low-drag aero and good top speed. Desirable: very forgiving, rides kerbs and bumps well, easy on tires, excellent beginner and endurance car. Undesirable: lazy rotation and understeer in tight, slow corners; its bulk shows in quick direction changes and hairpins.",
  },
  {
    name: 'Ford Mustang GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 195.5,
    widthIn: 80.5,
    wheelbaseIn: 109,
    dryWeightLbs: 2900,
    wetWeightLbs: 3260,
    displacementLiters: 5.4,
    rpmLimit: 8250,
    torqueLbFt: 431,
    powerBhp: 516,
    notes:
      'Front-mid 5.4L NA V8 (Coyote-based) with the second-longest body in the field and a long 109 in wheelbase. Long, stable platform with efficient aero and strong straight-line speed. Desirable: very planted in high-speed corners and under braking, predictable at the limit, good traction from the linear V8. Undesirable: slow to turn in and understeers in tight hairpins and chicanes; its length makes it cumbersome at twisty, slow tracks. Best suited to fast, flowing circuits with long straights.',
  },
  {
    name: 'Lamborghini Huracan GT3 EVO',
    racingDiscipline: 'Sports Car',
    lengthIn: 179,
    widthIn: 81,
    wheelbaseIn: 104,
    dryWeightLbs: 2833,
    wetWeightLbs: 3262,
    displacementLiters: 5.2,
    rpmLimit: 8500,
    torqueLbFt: 400,
    powerBhp: 500,
    notes:
      'Mid-engine 5.2L NA V10 revving to 8,500. Short, wide car with a compact wheelbase, giving quick turn-in and strong rotation. Aero is solid with good downforce balance. Desirable: agile in slow and medium corners, strong braking, excellent in chicanes and direction changes. Undesirable: can be nervous and snap-oversteer on corner exit or over kerbs, is setup-sensitive, and punishes rough inputs. Rewards an aggressive, precise driver more than a beginner.',
  },
  {
    name: 'McLaren 720S GT3 EVO',
    racingDiscipline: 'Sports Car',
    lengthIn: 183.6,
    widthIn: 80.3,
    wheelbaseIn: 106.1,
    dryWeightLbs: 2932,
    wetWeightLbs: 3293,
    displacementLiters: 4.0,
    rpmLimit: 8000,
    torqueLbFt: 492,
    powerBhp: 520,
    notes:
      'Mid-engine 4.0L twin-turbo V8 with the most torque in the field (492 lb-ft) and a carbon tub. Aero-heavy design with strong downforce that shines in fast corners. Desirable: excellent high-speed cornering, strong acceleration off mid-speed corners, good braking. Undesirable: turbo torque can overwhelm the rears on slow exits, and it can feel pointy and less stable over bumps and kerbs. Best on fast, smooth, flowing tracks; demands throttle discipline in slow sections.',
  },
  {
    name: 'Acura NSX GT3 EVO 22',
    racingDiscipline: 'Sports Car',
    lengthIn: 189,
    widthIn: 80.5,
    wheelbaseIn: 104,
    dryWeightLbs: 2910,
    wetWeightLbs: 3274,
    displacementLiters: 3.5,
    rpmLimit: 7500,
    torqueLbFt: 457,
    powerBhp: 520,
    notes:
      "Mid-engine 3.5L twin-turbo V6 (race car drops the road car's hybrid). Balanced mid-engine chassis with good mechanical grip and aero stability. Desirable: neutral handling, strong braking and traction, rotates well without being snappy, easy to drive consistently. Undesirable: lower rev limit (7,500) and smaller engine can leave it short of top speed on long straights, so it may struggle on power tracks depending on BoP. A good all-rounder that suits technical, twisty circuits.",
  },
  {
    name: 'Aston Martin Vantage GT3 EVO',
    racingDiscipline: 'Sports Car',
    lengthIn: 179,
    widthIn: 80.7,
    wheelbaseIn: 109,
    dryWeightLbs: 2932,
    wetWeightLbs: 3286,
    displacementLiters: 4.0,
    rpmLimit: 7000,
    torqueLbFt: 472,
    powerBhp: 535,
    notes:
      'Front-mid 4.0L twin-turbo V8 with a long 109 in wheelbase and a 7,000 rpm limit (joint-lowest with the BMW). Broad torque (472 lb-ft) and a short body with long wheelbase give it a stable, planted feel. Desirable: very predictable, forgiving at the limit, strong traction and braking stability, gentle on tires, good for long stints. Undesirable: some understeer in slow corners and less agile than mid-engine cars in quick direction changes. A confidence-inspiring car that suits consistent drivers.',
  },
  {
    name: 'Audi R8 LMS EVO II GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 181,
    widthIn: 78.62,
    wheelbaseIn: 106.3,
    dryWeightLbs: 2910,
    wetWeightLbs: 3260,
    displacementLiters: 5.2,
    rpmLimit: 8500,
    torqueLbFt: 410,
    powerBhp: 518,
    notes:
      'Mid-engine 5.2L NA V10 (shares its roots with the Lamborghini). The narrowest car in the field, with a mid-length wheelbase. Desirable: sharp turn-in, strong rotation and braking, excellent in slow and medium corners, rides kerbs well, and its narrow body helps in traffic. Undesirable: can snap on throttle or lift-off at the limit and needs a smooth right foot; less stable than front-engine cars in fast sweepers. A popular all-rounder for drivers who like a car that turns.',
  },
  {
    name: 'BMW M4 GT3 EVO',
    racingDiscipline: 'Sports Car',
    lengthIn: 197.4,
    widthIn: 79.6,
    wheelbaseIn: 114.8,
    dryWeightLbs: 2833,
    wetWeightLbs: 3111,
    displacementLiters: 3.0,
    rpmLimit: 7000,
    torqueLbFt: 475,
    powerBhp: 500,
    notes:
      'Front-mid 3.0L twin-turbo inline-six. Longest body and wheelbase in the field and the lightest wet weight. Very stable aero platform with strong high-speed downforce. Desirable: extremely forgiving and predictable, excellent traction and braking stability, easy on tires, a top pick for beginners and endurance racing. Undesirable: slow to rotate in tight hairpins, and its size is a handicap on narrow, twisty tracks. Shines on fast, flowing circuits.',
  },
  {
    name: 'Chevrolet Corvette Z06 GT3.R',
    racingDiscipline: 'Sports Car',
    lengthIn: 182,
    widthIn: 81,
    wheelbaseIn: 107,
    dryWeightLbs: 2943,
    wetWeightLbs: 3294,
    displacementLiters: 5.5,
    rpmLimit: 8000,
    torqueLbFt: 430,
    powerBhp: 520,
    notes:
      'Front-mid 5.5L NA flat-plane V8 revving to 8,000. Wide body, well-balanced front-mid layout with efficient aero and good straight-line speed. Desirable: stable and predictable, strong traction and braking, good tire life, confident in high-speed corners. Undesirable: a bit lazy on turn-in and prone to understeer in slow, tight corners compared with mid-engine cars. A strong choice for consistent drivers and power tracks.',
  },
  {
    name: 'Ferrari 296 GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 179.7,
    widthIn: 80.7,
    wheelbaseIn: 104.7,
    dryWeightLbs: 2976,
    wetWeightLbs: 3325,
    displacementLiters: 3.0,
    rpmLimit: 8000,
    torqueLbFt: 490,
    powerBhp: 524,
    notes:
      'Mid-engine 3.0L twin-turbo 120° V6 with strong torque (490 lb-ft). Heaviest car in the field, but with low center of gravity and very efficient aero. Desirable: excellent braking and turn-in, strong rotation while staying more forgiving than most mid-engine cars, good traction and high-speed stability. Undesirable: turbo torque needs managing on slow exits, and its weight shows in quick direction changes. A strong all-rounder that suits most tracks.',
  },
  {
    name: 'Next Gen NASCAR Cup Series Chevrolet Camaro ZL1',
    racingDiscipline: 'Oval',
    lengthIn: 193,
    widthIn: 78,
    wheelbaseIn: 110,
    dryWeightLbs: 3210,
    wetWeightLbs: 3530,
    displacementLiters: 5.86,
    rpmLimit: 9100,
    torqueLbFt: 470,
    powerBhp: 650,
    notes:
      'Front-engine 5.86L NA pushrod V8 with 650 bhp and 470 lb-ft, revving to 9,100. Big, heavy stock car (3,530 lbs wet) on a 110 in wheelbase with little downforce, so the car moves around underneath you and the air around other cars changes its balance a lot. Desirable: stable on banking and in the draft, strong drive off the corner from the torque, and durable enough to lean on in traffic. Undesirable: slow to change direction, gets tight in dirty air and loose on exit if you hurry the throttle, and the brakes and tires fade quickly on road courses. Rewards patience, a smooth right foot and planning moves a lap ahead.',
  },
  {
    name: "Legends Ford '34 Coupe",
    racingDiscipline: 'Oval',
    lengthIn: 124,
    widthIn: 60,
    wheelbaseIn: 73,
    dryWeightLbs: 1050,
    wetWeightLbs: 1260,
    displacementLiters: 0.89,
    rpmLimit: 12100,
    torqueLbFt: 76,
    powerBhp: 130,
    notes:
      "Front-engine 890cc motorcycle four revving to 12,100, with 130 bhp and only 76 lb-ft. Tiny, light car (1,260 lbs wet) on a very short 73 in wheelbase with a solid rear axle and no aero. Desirable: rotates eagerly, cheap on mistakes at low speed, and a great teacher of car control and pack racing. Undesirable: twitchy and loose on entry and over bumps, spins easily on a lift or a rough throttle, and has very little braking grip. Rewards a smooth, precise driver who catches slides early and carries momentum.",
  },
  {
    name: 'BMW M4 G82 GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 191.5,
    widthIn: 82.4,
    wheelbaseIn: 112.4,
    dryWeightLbs: 3377,
    wetWeightLbs: 3621,
    displacementLiters: 3,
    rpmLimit: 7450,
    torqueLbFt: 480,
    powerBhp: 530,
    notes:
      'Front-mid 3.0L twin-turbo inline-six with strong torque (480 lb-ft) and a 7,450 rpm limit. Long 112.4 in wheelbase and the heaviest wet weight here (3,621 lbs), with modest GT4 aero, ABS and traction control. Desirable: very stable under braking, pulls hard out of slow corners, and forgiving at the limit. Undesirable: the weight makes it understeer on entry when overdriven, it is slow to change direction, and the tires overheat over a long stint. Rewards braking a little early, getting it rotated before the apex and a patient throttle.',
  },
  {
    name: 'Global Mazda MX-5 Cup',
    racingDiscipline: 'Sports Car',
    lengthIn: 153.9,
    widthIn: 68,
    wheelbaseIn: 91,
    dryWeightLbs: 2150,
    wetWeightLbs: 2224,
    displacementLiters: 2,
    rpmLimit: 7500,
    torqueLbFt: 151,
    powerBhp: 181,
    notes:
      'Front-mid 2.0L NA four with 181 bhp and 151 lb-ft, revving to 7,500. Short, light car (91 in wheelbase, 2,224 lbs wet) with no aero and soft suspension that rolls a lot. Desirable: a pure momentum car that teaches trail braking, weight transfer and smooth inputs, with close racing in the draft. Undesirable: so little power that any scrub or lift costs time for the whole straight, and the rear can come around on lift-off when trail braking hard. Rewards minimal steering, high minimum speeds and never slowing more than needed.',
  },
  {
    name: 'Dallara P217 LMP2',
    racingDiscipline: 'Prototype',
    lengthIn: 186.8,
    widthIn: 74.8,
    wheelbaseIn: 118.5,
    dryWeightLbs: 2094,
    wetWeightLbs: 2384,
    displacementLiters: 4.2,
    rpmLimit: 8500,
    torqueLbFt: 355,
    powerBhp: 540,
    notes:
      'Mid-engine 4.2L NA V8 with 540 bhp and 355 lb-ft, revving to 8,500. Light carbon prototype (2,384 lbs wet) on a long 118.5 in wheelbase, with far more downforce than a GT car. Desirable: huge grip in fast corners, very late braking, and a stable, consistent platform over a stint. Undesirable: much less grip in slow corners where the aero is not working, sensitive to kerbs and ride height, and loses front grip behind other cars. Rewards full commitment in high-speed corners, trusting the aero and braking hard then releasing smoothly.',
  },
  {
    name: 'Porsche 963 GTP',
    racingDiscipline: 'Prototype',
    lengthIn: 200.8,
    widthIn: 78.7,
    wheelbaseIn: 124,
    dryWeightLbs: 2271,
    wetWeightLbs: 2616,
    displacementLiters: 4.6,
    rpmLimit: 8158,
    torqueLbFt: 497,
    powerBhp: 671,
    notes:
      'Mid-engine 4.6L twin-turbo V8 hybrid with 671 bhp and 497 lb-ft. Long, high-downforce prototype on a 124 in wheelbase, heavier than an LMP2 (2,616 lbs wet) because of the hybrid system. Desirable: enormous high-speed grip and braking, strong traction out of corners, and very stable in fast sweepers. Undesirable: regenerative braking changes the brake balance, so the rears can lock on entry, and the length and weight make it slow to rotate in tight corners. Rewards a smooth brake release, getting the car turned early and managing the hybrid over a lap.',
  },
  {
    name: 'Mercedes-AMG F1 W12 E Performance',
    racingDiscipline: 'Formula Car',
    lengthIn: 224,
    widthIn: 78.7,
    wheelbaseIn: 146.6,
    dryWeightLbs: 1836,
    wetWeightLbs: 2078,
    displacementLiters: 1.6,
    rpmLimit: 13000,
    torqueLbFt: 530,
    powerBhp: 1050,
    notes:
      'Mid-engine 1.6L turbo V6 hybrid with 1,050 bhp, 530 lb-ft and a 13,000 rpm limit. The lightest (2,078 lbs wet) and longest (146.6 in wheelbase) car here, with extreme downforce. Desirable: unmatched braking, cornering speed and acceleration, and lots of adjustment from brake bias, differential and energy settings. Undesirable: needs heat in the tires and brakes, loses grip quickly behind other cars, and wheelspin limits the throttle in slow corners. Rewards very hard, late braking with a precise release, committed fast corners and careful energy management.',
  },
  {
    name: 'Toyota GR86',
    racingDiscipline: 'Sports Car',
    lengthIn: 167.9,
    widthIn: 69.9,
    wheelbaseIn: 106.7,
    dryWeightLbs: 2860,
    wetWeightLbs: 2996,
    displacementLiters: 2.4,
    rpmLimit: 7500,
    torqueLbFt: 188,
    powerBhp: 220,
    notes:
      'Front-engine 2.4L NA flat-four with 220 bhp and 188 lb-ft, revving to 7,500. Low center of gravity, rear-wheel drive and no aero, but fairly heavy for its power (2,996 lbs wet). Desirable: a balanced, playful chassis that rotates willingly and teaches weight transfer, with close racing. Undesirable: little power to make up for mistakes, the rear steps out on lift-off or early throttle, and the tires overheat when slid. Rewards smooth inputs, carrying speed and keeping the car straight on exit.',
  },
];

// The cars added to DEFAULT_CARS with the racing_discipline column. Databases seeded before it get them
// once, from addRacingDisciplines
const CARS_ADDED_WITH_DISCIPLINES = [
  'Next Gen NASCAR Cup Series Chevrolet Camaro ZL1',
  "Legends Ford '34 Coupe",
  'BMW M4 G82 GT4',
  'Global Mazda MX-5 Cup',
  'Dallara P217 LMP2',
  'Porsche 963 GTP',
  'Mercedes-AMG F1 W12 E Performance',
  'Toyota GR86',
];

// Fills racingcoach."Cars" with DEFAULT_CARS (or some of them). Runs once, on the caller's transaction,
// when the Cars table is first created; after that the table is the source of truth.
export async function seedDefaultCars(client: PoolClient, cars: DefaultCar[] = DEFAULT_CARS): Promise<void> {
  const column = <K extends keyof DefaultCar>(key: K) => cars.map((c) => c[key]);
  await client.query(
    `INSERT INTO racingcoach."Cars"
       (car_name, racing_discipline, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
        displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes)
     SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::float8[], $6::int[], $7::int[],
                          $8::float8[], $9::int[], $10::int[], $11::int[], $12::text[])
     ON CONFLICT DO NOTHING`,
    [
      column('name'),
      column('racingDiscipline'),
      column('lengthIn'),
      column('widthIn'),
      column('wheelbaseIn'),
      column('dryWeightLbs'),
      column('wetWeightLbs'),
      column('displacementLiters'),
      column('rpmLimit'),
      column('torqueLbFt'),
      column('powerBhp'),
      column('notes'),
    ]
  );
}

// Copies every car in racingcoach."Cars" (or only the ones named) into one user's "CarsUsers", or every
// user's when userId is null (the one-time backfills). A car the user already has (same name) is skipped.
// Runs on the caller's transaction.
export async function copyDefaultCars(client: PoolClient, userId: number | null, names?: string[]): Promise<void> {
  await client.query(
    `INSERT INTO racingcoach."CarsUsers"
       (user_id, car_name, racing_discipline, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
        displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes)
     SELECT u.id, c.car_name, c.racing_discipline, c.length_in, c.width_in, c.wheelbase_in, c.dry_weight_lbs,
            c.wet_weight_lbs, c.displacement_liters, c.rpm_limit, c.torque_lb_ft, c.power_bhp, c.notes
     FROM racingcoach."Users" u CROSS JOIN racingcoach."Cars" c
     WHERE ($1::int IS NULL OR u.id = $1) AND ($2::text[] IS NULL OR c.car_name = ANY($2))
     ON CONFLICT DO NOTHING`,
    [userId, names ?? null]
  );
}

// Runs once, on the caller's transaction, when racing_discipline is added to a database seeded before it:
// the GT3 cars already there become Sports Cars (in Cars and every user's copy; cars users added
// themselves stay without one), and the cars added with the column go into Cars and every user's CarsUsers.
export async function addRacingDisciplines(client: PoolClient): Promise<void> {
  const gt3Names = DEFAULT_CARS.filter((c) => !CARS_ADDED_WITH_DISCIPLINES.includes(c.name)).map((c) => c.name.toLowerCase());
  for (const table of ['"Cars"', '"CarsUsers"']) {
    await client.query(
      `UPDATE racingcoach.${table} SET racing_discipline = 'Sports Car'
       WHERE racing_discipline IS NULL AND lower(car_name) = ANY($1)`,
      [gt3Names]
    );
  }
  await seedDefaultCars(client, DEFAULT_CARS.filter((c) => CARS_ADDED_WITH_DISCIPLINES.includes(c.name)));
  await copyDefaultCars(client, null, CARS_ADDED_WITH_DISCIPLINES);
}
