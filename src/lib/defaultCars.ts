import type { PoolClient } from 'pg';
import type { RacingDiscipline } from './racingDisciplines';

// The cars the site starts with (GT3 cars, then a few of each other discipline). They are
// seeded once into racingcoach."Cars", when that table is first created; after that the table is the source of truth,
// kept by Coaches and Admins in the Cars tab, so a car added here doesn't reach an existing database.

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
  {
    name: "NASCAR O'Reilly Chevrolet Camaro",
    racingDiscipline: 'Oval',
    lengthIn: 195,
    widthIn: 71,
    wheelbaseIn: 110,
    dryWeightLbs: 3430,
    wetWeightLbs: 3596,
    displacementLiters: 5.86,
    rpmLimit: 9000,
    torqueLbFt: 500,
    powerBhp: 675,
    notes:
      "Front-engine 5.86L (358 ci) pushrod V8 with 675 bhp and 500 lb-ft, revving to 9,000. Heavy steel tube-frame stock car (3,596 lbs wet) with less downforce than a Cup car, so it slides more and the driver does more of the work. Desirable: plenty of power, a big draft for passing, and a car that tells you clearly when it's at the limit. Undesirable: tight in the center on entry and loose on exit as the rear tires wear, and it loses front grip in dirty air behind other cars. Rewards a smooth entry that keeps the rolling speed up through the center, patient throttle on exit, and saving the tires over a long run.",
  },
  {
    name: 'ARCA Chevrolet SS',
    racingDiscipline: 'Oval',
    lengthIn: 194,
    widthIn: 77,
    wheelbaseIn: 110,
    dryWeightLbs: 3125,
    wetWeightLbs: 3450,
    displacementLiters: 6.49,
    rpmLimit: 8000,
    torqueLbFt: 525,
    powerBhp: 700,
    notes:
      'Front-engine 6.49L pushrod V8 with 700 bhp and 525 lb-ft, revving to 8,000. A wide, heavy steel tube-frame stock car (3,450 lbs wet) with modest downforce and hard tires, so grip is limited and the car moves around. Desirable: lots of torque off the corners, a forgiving, predictable slide, and an ideal step up to learn stock car racecraft and drafting. Undesirable: slow to change direction, pushes up the track if you over-drive the entry, and the long runs wear the right-side tires. Rewards lifting early and rolling the corner rather than braking deep, hitting the bottom of the track, and smooth, gradual throttle on exit.',
  },
  {
    name: 'NASCAR Truck Chevrolet Silverado',
    racingDiscipline: 'Oval',
    lengthIn: 192,
    widthIn: 75,
    wheelbaseIn: 110,
    dryWeightLbs: 3330,
    wetWeightLbs: 3600,
    displacementLiters: 5.86,
    rpmLimit: 8000,
    torqueLbFt: 520,
    powerBhp: 680,
    notes:
      'Front-engine 5.86L (358 ci) pushrod V8 with 680 bhp and 520 lb-ft, revving to 8,000. The heaviest car here (3,600 lbs wet), with a tall, boxy body that makes far more drag than a stock car. Desirable: the huge drag gives a powerful draft and big closing rates, so passing in packs is easy, and the weight makes it stable and predictable. Undesirable: any lift or scrub costs speed for the whole straight, it gets tight in dirty air, and the weight wears out tires and brakes. Rewards keeping momentum, a smooth, minimal-steering line, lifting rather than braking where possible, and timing runs in the draft.',
  },
  {
    name: 'Porsche 718 Cayman GT4 Clubsport',
    racingDiscipline: 'Sports Car',
    lengthIn: 175.4,
    widthIn: 70,
    wheelbaseIn: 97.5,
    dryWeightLbs: 2934,
    wetWeightLbs: 3166,
    displacementLiters: 3.8,
    rpmLimit: 7800,
    torqueLbFt: 313,
    powerBhp: 425,
    notes:
      'Mid-engine 3.8L NA flat-six with 425 bhp and 313 lb-ft, revving to 7,800. Short 97.5 in wheelbase with the weight in the middle and little aero, so it rotates eagerly but has modest grip and power. Desirable: sharp turn-in, strong braking and traction, and a car that rewards trail braking into the apex. Undesirable: snappy lift-off oversteer when the rear goes light mid-corner, and too little power to make up for a slow exit. Rewards a smooth release of the brake to rotate the car, early, progressive throttle, and carrying speed rather than braking late.',
  },
  {
    name: 'BMW M8 GTE',
    racingDiscipline: 'Sports Car',
    lengthIn: 196,
    widthIn: 87.5,
    wheelbaseIn: 113,
    dryWeightLbs: 2896,
    wetWeightLbs: 3044,
    displacementLiters: 4,
    rpmLimit: 7000,
    torqueLbFt: 515,
    powerBhp: 592,
    notes:
      'Front-mid 4.0L twin-turbo V8 with 592 bhp and 515 lb-ft and a low 7,000 rpm limit. A big, long and very wide car on a 113 in wheelbase, with more downforce than a GT3 car and no ABS. Desirable: very stable under braking and in fast corners, and huge torque that pulls hard out of slow corners. Undesirable: without ABS the fronts lock if you hit the brake too hard, it understeers in tight, slow corners, and the turbo torque can spin the rears on exit. Rewards threshold braking with a smooth release, getting the car turned before the throttle, and short-shifting to manage wheelspin.',
  },
  {
    name: 'Cadillac V-Series.R GTP',
    racingDiscipline: 'Prototype',
    lengthIn: 201,
    widthIn: 78.7,
    wheelbaseIn: 124,
    dryWeightLbs: 2270,
    wetWeightLbs: 2535,
    displacementLiters: 5.5,
    rpmLimit: 8770,
    torqueLbFt: 463,
    powerBhp: 675,
    notes:
      'Mid-engine 5.5L NA V8 hybrid with 675 bhp and 463 lb-ft, revving to 8,770; the only GTP without turbos. Long, high-downforce prototype on a 124 in wheelbase (2,535 lbs wet). Desirable: a linear, predictable throttle that makes traction easy to judge, enormous high-speed grip and braking, and stability in fast sweepers. Undesirable: regenerative braking changes the brake balance, so the rears can lock on entry, and the length makes it slow to rotate in tight corners. Rewards a smooth brake release, getting the car turned early, using the revs out of slow corners and managing the hybrid over a lap.',
  },
  {
    name: 'Super Formula SF23 - Toyota',
    racingDiscipline: 'Formula Car',
    lengthIn: 206,
    widthIn: 75,
    wheelbaseIn: 123,
    dryWeightLbs: 1322,
    wetWeightLbs: 1477,
    displacementLiters: 2,
    rpmLimit: 9400,
    torqueLbFt: 354,
    powerBhp: 550,
    notes:
      'Mid-engine 2.0L turbo four with 550 bhp and 354 lb-ft, revving to 9,400, with a push-to-pass Overtake System. The lightest car here (1,477 lbs wet), with high downforce designed to lose less grip when following another car. Desirable: extreme cornering speed and braking, quick changes of direction, and close racing. Undesirable: needs heat in the tires and brakes, snaps on cold tires or over kerbs, and the light car gets loose with wheelspin out of slow corners. Rewards very hard, late braking with a quick, precise release, full commitment in fast corners and smart use of the Overtake System.',
  },
];

// Fills racingcoach."Cars" with DEFAULT_CARS. A car already there (same name) is left alone. Runs on the caller's
// transaction.
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

// Runs once, on the caller's transaction, when "CarsUsers" is about to be dropped: the owner's copy of each car replaces
// the one in Cars, and cars the owner added join it. A car the owner deleted stays in Cars.
export async function mergeOwnerCars(client: PoolClient, ownerEmail: string): Promise<void> {
  await client.query('ALTER TABLE racingcoach."CarsUsers" ADD COLUMN IF NOT EXISTS racing_discipline TEXT');
  await client.query(
    `INSERT INTO racingcoach."Cars"
       (car_name, racing_discipline, length_in, width_in, wheelbase_in, dry_weight_lbs, wet_weight_lbs,
        displacement_liters, rpm_limit, torque_lb_ft, power_bhp, notes)
     SELECT c.car_name, c.racing_discipline, c.length_in, c.width_in, c.wheelbase_in, c.dry_weight_lbs,
            c.wet_weight_lbs, c.displacement_liters, c.rpm_limit, c.torque_lb_ft, c.power_bhp, c.notes
     FROM racingcoach."CarsUsers" c JOIN racingcoach."Users" u ON u.id = c.user_id
     WHERE lower(u.email_address) = $1
     ON CONFLICT (lower(car_name)) DO UPDATE SET
       car_name = EXCLUDED.car_name, racing_discipline = EXCLUDED.racing_discipline, length_in = EXCLUDED.length_in,
       width_in = EXCLUDED.width_in, wheelbase_in = EXCLUDED.wheelbase_in, dry_weight_lbs = EXCLUDED.dry_weight_lbs,
       wet_weight_lbs = EXCLUDED.wet_weight_lbs, displacement_liters = EXCLUDED.displacement_liters,
       rpm_limit = EXCLUDED.rpm_limit, torque_lb_ft = EXCLUDED.torque_lb_ft, power_bhp = EXCLUDED.power_bhp,
       notes = EXCLUDED.notes, updated_at = now()`,
    [ownerEmail]
  );
}

// ACC's cars that have a picture (public/assets/carPics, from the gt-car-art-gallery project), named like ACC's
// (AccCars.cs) without the model year. Rev limits are ACC's (AccCars.cs); the rest are the real cars' published
// figures, approximate. Added to Cars once, by addAccCars.
export const ACC_DEFAULT_CARS: DefaultCar[] = [
  {
    name: 'Alpine A110 GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 164.6,
    widthIn: 72.8,
    wheelbaseIn: 95.3,
    dryWeightLbs: 2315,
    wetWeightLbs: 2535,
    displacementLiters: 1.8,
    rpmLimit: 6450,
    torqueLbFt: 310,
    powerBhp: 345,
    notes:
      'Mid-engine 1.8L turbo four, the lightest and smallest car in GT4, with a short wheelbase and a low rev limit (6,450). Desirable: very agile, rotates easily on entry, brakes late and carries speed through slow and medium corners. Undesirable: down on power on the straights, nervous over kerbs and on lift-off, and the short wheelbase can snap if you overdrive the entry. Rewards precise trail braking, using the rotation to get the car turned early, and an early, clean throttle.',
  },
  {
    name: 'Aston Martin Vantage V12 GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 172.6,
    widthIn: 79.1,
    wheelbaseIn: 102.4,
    dryWeightLbs: 2756,
    wetWeightLbs: 3050,
    displacementLiters: 6,
    rpmLimit: 7750,
    torqueLbFt: 450,
    powerBhp: 550,
    notes:
      'Front-mid 6.0L NA V12 with a broad, smooth torque curve. A first-generation GT3 car with less downforce than newer cars, so it moves around more. Desirable: strong, predictable power out of slow corners, stable under braking, and a car that tells you clearly where the limit is. Undesirable: heavy nose and understeer in tight corners, lazy changes of direction, and a rear that slides under power on worn tires. Rewards a patient entry, getting it rotated before the apex and feeding in the throttle smoothly.',
  },
  {
    name: 'Audi R8 LMS GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 174.3,
    widthIn: 76.4,
    wheelbaseIn: 104.3,
    dryWeightLbs: 3197,
    wetWeightLbs: 3420,
    displacementLiters: 5.2,
    rpmLimit: 8650,
    torqueLbFt: 406,
    powerBhp: 495,
    notes:
      'Mid-engine 5.2L NA V10, close to the road car, and the heaviest car in GT4. High-revving with a strong top end. Desirable: very stable at speed and under braking, good traction, and forgiving for a mid-engine car. Undesirable: its weight shows in slow corners and quick direction changes, it understeers when rushed and is hard on the front tires. Rewards braking in a straight line, a slower entry for a fast exit and using the revs.',
  },
  {
    name: 'Bentley Continental GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 191.9,
    widthIn: 80.7,
    wheelbaseIn: 112.2,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 4,
    rpmLimit: 7400,
    torqueLbFt: 480,
    powerBhp: 550,
    notes:
      'Front-engine 4.0L twin-turbo V8 in a big, long car with a long wheelbase. Lots of low-end torque. Desirable: very stable in fast corners and under braking, strong out of slow corners, rides kerbs well and is easy on tires over a stint. Undesirable: its size and length make it lazy in tight corners and chicanes, with understeer on entry and mid-corner. Rewards a V-shaped line: brake in a straight line, rotate the car early and drive it out on the torque.',
  },
  {
    name: 'BMW M6 GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 194.6,
    widthIn: 80.6,
    wheelbaseIn: 114.2,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 4.4,
    rpmLimit: 7100,
    torqueLbFt: 516,
    powerBhp: 585,
    notes:
      'Front-engine 4.4L twin-turbo V8, the longest wheelbase in GT3, with huge torque and a low 7,100 rpm limit. Desirable: rock stable at high speed and under braking, very strong traction and top speed, and a forgiving car for long races. Undesirable: slow to turn in tight corners, understeer when the entry is rushed, and its size makes chicanes and hairpins hard work. Rewards early, firm braking, patience to the apex and short shifting to use the torque.',
  },
  {
    name: 'Chevrolet Camaro GT4 R',
    racingDiscipline: 'Sports Car',
    lengthIn: 188.3,
    widthIn: 74.7,
    wheelbaseIn: 110.7,
    dryWeightLbs: 3086,
    wetWeightLbs: 3310,
    displacementLiters: 6.2,
    rpmLimit: 7500,
    torqueLbFt: 455,
    powerBhp: 450,
    notes:
      'Front-engine 6.2L NA V8 with big torque in a large, heavy body. Desirable: strong pull out of slow corners and on the straights, stable under braking and easy to drive for a long stint. Undesirable: understeer in slow and medium corners, a heavy feel in quick direction changes, and a rear that steps out if you use all the torque too early. Rewards a slow-in, fast-out approach, rotating it on the brakes and squeezing the throttle on exit.',
  },
  {
    name: 'Emil Frey Jaguar G3',
    racingDiscipline: 'Sports Car',
    lengthIn: 189,
    widthIn: 78.7,
    wheelbaseIn: 108.3,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 5,
    rpmLimit: 8750,
    torqueLbFt: 420,
    powerBhp: 550,
    notes:
      'Front-engine 5.0L NA V8 built by Emil Frey Racing on the Jaguar XK, with a high 8,750 rpm limit and a famous sound. Desirable: very stable under braking and in fast corners, strong top speed and easy on tires. Undesirable: a heavy nose that understeers in slow corners, little low-end torque, and lazy changes of direction. Rewards keeping the revs up, a smooth line that carries speed, and getting the car turned before the throttle.',
  },
  {
    name: 'Ferrari 488 Challenge Evo',
    racingDiscipline: 'Sports Car',
    lengthIn: 179.8,
    widthIn: 76.9,
    wheelbaseIn: 104.3,
    dryWeightLbs: 2932,
    wetWeightLbs: 3150,
    displacementLiters: 3.9,
    rpmLimit: 8000,
    torqueLbFt: 516,
    powerBhp: 670,
    notes:
      'Mid-engine 3.9L twin-turbo V8 one-make car with 670 bhp, more than a GT3 car, but much less downforce and ABS. Desirable: huge power, very strong braking, and close racing in an equal field. Undesirable: the turbo torque spins the rears out of slow corners, it slides at high speed with little aero, and it punishes lift-off mid-corner. Rewards smooth, progressive throttle, using the ABS to brake late and a tidy line that keeps the car straight on exit.',
  },
  {
    name: 'Ginetta G55 GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 169.3,
    widthIn: 74.8,
    wheelbaseIn: 99.2,
    dryWeightLbs: 2425,
    wetWeightLbs: 2650,
    displacementLiters: 3.7,
    rpmLimit: 7200,
    torqueLbFt: 310,
    powerBhp: 360,
    notes:
      'Front-mid 3.7L NA V6 in a light, purpose-built race car (not a road car) with a short wheelbase. Desirable: light and nimble, quick to turn in, and good on brakes and tires. Undesirable: a lively rear on lift-off and over kerbs, little power on long straights, and a car that is easy to overdrive. Rewards carrying minimum speed, smooth inputs and a precise line.',
  },
  {
    name: 'Honda NSX GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 181.6,
    widthIn: 80.3,
    wheelbaseIn: 103.5,
    dryWeightLbs: 2756,
    wetWeightLbs: 3050,
    displacementLiters: 3.5,
    rpmLimit: 7500,
    torqueLbFt: 470,
    powerBhp: 550,
    notes:
      'Mid-engine 3.5L twin-turbo V6 (rear-wheel drive, unlike the hybrid road car). Desirable: very good rotation in slow and medium corners, strong braking and good traction. Undesirable: the first version is nervous at high speed and on lift-off, with a rear that can step out in fast direction changes. Rewards an aggressive, rotated entry in slow corners, smooth inputs in fast ones and a patient throttle.',
  },
  {
    name: 'Honda NSX GT3 Evo',
    racingDiscipline: 'Sports Car',
    lengthIn: 181.6,
    widthIn: 80.3,
    wheelbaseIn: 103.5,
    dryWeightLbs: 2756,
    wetWeightLbs: 3050,
    displacementLiters: 3.5,
    rpmLimit: 7650,
    torqueLbFt: 470,
    powerBhp: 550,
    notes:
      'Mid-engine 3.5L twin-turbo V6, the 2019 update of the NSX GT3 with revised aero, cooling and engine. Desirable: keeps the agile, rotating nature and gains stability at high speed, so it is easier to drive hard. Undesirable: still sensitive to the setup and kerbs, and the rear can get light on lift-off. Rewards trail braking to rotate it on entry, carrying speed through medium corners and a clean, early throttle.',
  },
  {
    name: 'KTM X-Bow GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 172.4,
    widthIn: 75.4,
    wheelbaseIn: 95.7,
    dryWeightLbs: 2315,
    wetWeightLbs: 2535,
    displacementLiters: 2.5,
    rpmLimit: 6500,
    torqueLbFt: 295,
    powerBhp: 360,
    notes:
      'Mid-engine 2.5L turbo five (Audi) in a light carbon chassis, with the most downforce in GT4 and a short wheelbase. Desirable: superb in fast and medium corners, very late braking and quick changes of direction. Undesirable: slow on the straights, twitchy on lift-off and over kerbs, and less forgiving at the limit. Rewards carrying high corner speed, trusting the aero and a precise, committed line.',
  },
  {
    name: 'Lamborghini Gallardo G3 Reiter',
    racingDiscipline: 'Sports Car',
    lengthIn: 171,
    widthIn: 78.7,
    wheelbaseIn: 100.8,
    dryWeightLbs: 2756,
    wetWeightLbs: 3050,
    displacementLiters: 5.2,
    rpmLimit: 8650,
    torqueLbFt: 398,
    powerBhp: 550,
    notes:
      'Mid-engine 5.2L NA V10, the Reiter Engineering Gallardo R-EX GT3, with a short wheelbase and a high rev limit. Desirable: agile and quick to turn in, strong braking and a sharp throttle response. Undesirable: an older aero package, so it slides at high speed, a snappy rear on lift-off and in fast direction changes, and hard on the rear tires. Rewards smooth hands, a calm entry, keeping the revs up and a progressive throttle.',
  },
  {
    name: 'Lamborghini Huracan ST Evo2',
    racingDiscipline: 'Sports Car',
    lengthIn: 179.1,
    widthIn: 78.3,
    wheelbaseIn: 103.1,
    dryWeightLbs: 2800,
    wetWeightLbs: 3020,
    displacementLiters: 5.2,
    rpmLimit: 8650,
    torqueLbFt: 417,
    powerBhp: 620,
    notes:
      'Mid-engine 5.2L NA V10, the Super Trofeo one-make car, with more power than a GT3 car, less downforce and no ABS. Desirable: strong power and a sharp throttle, good traction and quick changes of direction. Undesirable: easy to lock the fronts without ABS, a rear that slides on lift-off and at high speed, and very sensitive to brake pressure. Rewards careful threshold braking with a smooth release, a tidy entry and patient throttle.',
  },
  {
    name: 'Lexus RCF GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 185.2,
    widthIn: 78.7,
    wheelbaseIn: 107.5,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 5.4,
    rpmLimit: 7750,
    torqueLbFt: 400,
    powerBhp: 550,
    notes:
      'Front-engine 5.4L NA V8 with a long wheelbase. Desirable: very stable under braking and in fast corners, easy on tires and a forgiving car to race in traffic. Undesirable: a lazy turn-in and understeer in slow corners, and its weight shows in chicanes. Rewards braking in a straight line, rotating it before the apex and a smooth, early throttle on the long torque curve.',
  },
  {
    name: 'Maserati GranTurismo MC GT4',
    racingDiscipline: 'Sports Car',
    lengthIn: 194.2,
    widthIn: 75.4,
    wheelbaseIn: 115.8,
    dryWeightLbs: 3086,
    wetWeightLbs: 3310,
    displacementLiters: 4.7,
    rpmLimit: 7000,
    torqueLbFt: 384,
    powerBhp: 460,
    notes:
      'Front-mid 4.7L NA V8 in the longest car in GT4, with the longest wheelbase. Desirable: very stable at high speed and under braking, predictable and gentle at the limit, and strong on long straights. Undesirable: slow to change direction, understeer in slow corners, and its size makes tight sections hard work. Rewards early braking, a patient entry that gets it turned before the throttle, and a smooth, flowing line.',
  },
  {
    name: 'McLaren 650S GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 178.5,
    widthIn: 80.5,
    wheelbaseIn: 105.1,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 3.8,
    rpmLimit: 7500,
    torqueLbFt: 442,
    powerBhp: 500,
    notes:
      'Mid-engine 3.8L twin-turbo V8 on a carbon tub. Desirable: excellent braking and strong high-speed downforce, with quick, accurate turn-in and good top speed. Undesirable: a nervous rear on lift-off and over kerbs, turbo torque that can light up the rears in slow corners, and sensitive to ride height. Rewards late, hard braking with a precise release, staying off high kerbs and a progressive throttle.',
  },
  {
    name: 'Nissan GTR Nismo GT3',
    racingDiscipline: 'Sports Car',
    lengthIn: 188.2,
    widthIn: 80.2,
    wheelbaseIn: 109.4,
    dryWeightLbs: 2866,
    wetWeightLbs: 3150,
    displacementLiters: 3.8,
    rpmLimit: 7500,
    torqueLbFt: 470,
    powerBhp: 550,
    notes:
      'Front-engine 3.8L twin-turbo V6 (rear-wheel drive, unlike the road car) with a heavy nose. Desirable: stable under braking and at high speed, strong turbo torque out of corners, and easy to drive consistently. Undesirable: understeer in slow and medium corners, a heavy feel in changes of direction, and hard on the front tires. Rewards braking early and straight, a slower entry for a better exit and short shifting on the torque.',
  },
];

// Adds ACC_DEFAULT_CARS to Cars once (a car already there by name is left alone), recorded in SiteSettings so a car a
// Coach or Admin deletes later doesn't come back. Runs on the caller's transaction, after SiteSettings exists.
export async function addAccCars(client: PoolClient): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO racingcoach."SiteSettings" (key, value) VALUES ('cars_added_acc', 'true') ON CONFLICT (key) DO NOTHING`
  );
  if (rowCount) await seedDefaultCars(client, ACC_DEFAULT_CARS);
}
