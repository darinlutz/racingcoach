import type { PoolClient } from 'pg';

// The GT3 cars every account starts with in racingcoach."CarData" (from GT3_Car_Data.xlsx). Each
// user gets their own copy on sign-up and can edit or delete them from the Car Data tab.

export type DefaultCar = {
  name: string;
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
];

// Inserts DEFAULT_CARS for one user, or for every user when userId is null (the one-time backfill
// when the CarData table is first created). Runs on the caller's transaction.
export async function seedDefaultCars(client: PoolClient, userId: number | null): Promise<void> {
  const column = <K extends keyof DefaultCar>(key: K) => DEFAULT_CARS.map((c) => c[key]);
  await client.query(
    `INSERT INTO racingcoach."CarData"
       (user_id, car_name, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
        displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes)
     SELECT u.id, c.*
     FROM racingcoach."Users" u
     CROSS JOIN unnest($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::int[], $6::int[],
                       $7::float8[], $8::int[], $9::int[], $10::int[], $11::text[])
       AS c(car_name, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
            displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes)
     WHERE $12::int IS NULL OR u.id = $12
     ON CONFLICT DO NOTHING`,
    [
      column('name'),
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
      userId,
    ]
  );
}
