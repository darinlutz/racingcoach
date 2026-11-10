import type { EngineeringRecord, KnowledgeSource } from './knowledgeTypes.ts';

// The Race Engineering knowledge base's wet-weather records: original explanations of how a car, its tires and its
// driver behave on a damp, wet or drying track, written for RacingCoach (no text copied from manuals or books). Like
// the starter corpus (starterCorpus.ts, which adds these to STARTER_CORPUS), every record is 'ai_drafted' and must be
// reviewed by a person on the Admin page before it's marked 'reviewed'.
//
// Every record has the 'wetWeather' component: retrieval (retrieval.ts) only lets these records in when the weather
// context says the track is damp, wet or drying, or the question is about rain, so dry-weather answers are unchanged.
// None states a crossover temperature, lap-time threshold, water depth, pressure or click count, and none says one
// setup direction is always right in the rain: each adjustment gives the conditions where it helps and what it costs.
// The few iRacing facts here come from iRacing's own 2024 Season 2 release notes (WET_WEATHER_SOURCES), which
// introduced rain and the Tempest weather system.
//
// What the laps record: Brake, Throttle, SteeringWheelAngle, Gear, RPM, Speed, ABSActive, LatAccel, LongAccel,
// YawRate, VelocityX/VelocityY, tire carcass temperatures (and surface temperatures from .ibt files), pressures and
// ride heights. There is no traction-control activity channel, so TC intervention is only ever inferred. The weather
// context (track wetness, precipitation, declared wet, fitted tire compound, track temperature) comes from the
// collector's live data, not the lap files of older collectors.

const IRACING_RAIN_NOTES = 'iracing-2024s2-release-notes';

export const WET_WEATHER_SOURCES: KnowledgeSource[] = [
  {
    key: IRACING_RAIN_NOTES,
    title: '2024 Season 2 Release Notes [2024.03.05.01] (rain and the Tempest weather system)',
    url: 'https://support.iracing.com/support/solutions/articles/31000172630-2024-season-2-release-notes-2024-03-05-01-',
    kind: 'simulator_manual',
    license: 'public-docs-link-only',
    publisher: 'iRacing.com Motorsport Simulations',
  },
];

const ORIGINAL = 'racingcoach-original';

type Draft = Omit<EngineeringRecord, 'version' | 'verification' | 'sources' | 'drivingCorrections' | 'constraints' | 'cars'> &
  Partial<Pick<EngineeringRecord, 'version' | 'drivingCorrections' | 'constraints' | 'cars' | 'sources'>>;

const rec = (draft: Draft): EngineeringRecord => ({
  version: 1,
  verification: 'ai_drafted',
  sources: [ORIGINAL],
  drivingCorrections: [],
  constraints: [],
  cars: [],
  ...draft,
});

const anyCar = { simulators: ['any'] as EngineeringRecord['simulators'], carClasses: ['any'] as EngineeringRecord['carClasses'] };
const iracing = { simulators: ['iracing'] as EngineeringRecord['simulators'], carClasses: ['any'] as EngineeringRecord['carClasses'] };
const gt3 = { simulators: ['any'] as EngineeringRecord['simulators'], carClasses: ['GT3'] as EngineeringRecord['carClasses'] };

const WEATHER_FIRST = 'Check the weather context first: the fitted tire compound, track wetness and whether rain is increasing or easing.';

export const WET_WEATHER_CORPUS: EngineeringRecord[] = [
  // ---------------------------------------------------------------- A. wet vehicle dynamics
  rec({
    id: 'wet-grip-friction-circle',
    title: 'Wet grip and the friction circle',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'vehicleDynamics', 'tires'],
    phases: ['braking', 'entry', 'mid', 'exit'],
    symptoms: ['lowGrip', 'understeer', 'oversteer'],
    summary:
      'Water between the tire and the road lowers the friction the tire can produce, so the whole friction circle ' +
      'shrinks: less braking, less cornering and less traction, and less of any combination of them. The shape ' +
      'matters as much as the size: on a slippery surface the tire gives less warning before it slides, and combining ' +
      'braking with cornering, or throttle with cornering, uses up the smaller circle sooner. A demand that was well ' +
      'inside the circle in the dry can be outside it in the wet. Grip also varies more from place to place, so the ' +
      'limit is not one number for the lap but a different one in each corner, and it moves as the rain and the ' +
      'track change.',
    causes: [
      'Water film lowering tire-road friction (conditions)',
      'Combined braking and steering, or throttle and steering, asking more than the smaller circle allows (driving)',
      'Grip that differs between corners and between laps (conditions)',
    ],
    telemetryIndicators: [
      'Lower peak LatAccel and LongAccel than in dry laps of the same car and track',
      'YawRate that stops following SteeringWheelAngle at lower speeds than in the dry',
      'ABSActive on at lower Brake pressure than in the dry',
      'Track wetness and precipitation in the weather context above dry',
    ],
    adjustments: [],
    drivingCorrections: [
      'Ask for one thing at a time more often: finish most of the braking before adding steering, and most of the steering before adding throttle.',
      'Find the limit again in each corner rather than assuming the dry reference applies.',
    ],
    constraints: ['Lap times and brakepoints from dry laps are not targets in the wet; compare wet laps with wet laps.', WEATHER_FIRST],
  }),
  rec({
    id: 'wet-weight-transfer',
    title: 'Weight transfer on a slippery surface',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'vehicleDynamics', 'driving'],
    phases: ['braking', 'entry', 'exit'],
    symptoms: ['lowGrip', 'brakingInstability', 'snapOversteer'],
    summary:
      'Load still moves forward under braking, rearward under power and outward in a corner in the wet, but each ' +
      'transfer now takes the unloaded axle closer to its smaller limit. A sudden lift, a stab of brake or an abrupt ' +
      'release unloads one axle quickly, and with little grip in reserve that axle slides. Smooth, progressive inputs ' +
      'keep the load changes slow enough for the tires to follow, which is why the wet rewards gradual inputs more ' +
      'than the dry does. Less load transfer happens overall because the accelerations are lower, so the car can ' +
      'feel lazier to respond and drivers tend to overdrive it to get the response they are used to.',
    causes: [
      'Abrupt brake release or throttle lift unloading the rear or front (driving)',
      'Sharp steering input while the car is still pitched forward (driving)',
      'Dampers that let the load move faster than the wet tires can react (setup)',
    ],
    telemetryIndicators: [
      'Brake falling from high to zero over very few samples before turn-in',
      'Throttle dropping sharply mid-corner followed by a YawRate spike',
      'LongAccel changing quickly just before a slide',
    ],
    adjustments: [
      { parameter: 'bumpDamping', direction: 'slightly softer, where the car is very nervous over load changes', effect: 'slows the transfer so the tires keep up', tradeoff: 'a lazier response and more pitch and roll; can let the car run lower and bottom in the dry parts of the lap' },
      { parameter: 'reboundDamping', direction: 'slightly softer at the end that lets go when unloaded', effect: 'keeps that end in contact longer as load leaves it', tradeoff: 'less control of body movement; the car can wallow and feel vague' },
    ],
    drivingCorrections: [
      'Release the brake gradually rather than letting go of it.',
      'Avoid lifting sharply mid-corner; if speed must come off, roll off the throttle progressively.',
    ],
    constraints: ['Damper changes are garage changes; on a fixed setup only the driving corrections apply.'],
  }),
  rec({
    id: 'wet-aquaplaning',
    title: 'Aquaplaning (hydroplaning) and standing water',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'vehicleDynamics'],
    phases: ['straight', 'braking', 'mid'],
    symptoms: ['aquaplaning', 'lowGrip'],
    summary:
      'When a tire meets more water than its tread and contact patch can push aside, a wedge of water builds in front ' +
      'of it and lifts part or all of the contact patch off the road. Steering and braking then do little or nothing ' +
      'until the tire touches down again. The risk rises with speed, with water depth and with tread that cannot ' +
      'clear water (slicks have none), and falls with load on the tire. Standing water collects in dips, along ' +
      'kerbs, at the bottom of slopes and where drainage is poor, so it is usually the same places lap after lap and ' +
      'grows as the rain continues. A tire that aquaplanes with steering applied grips again pointing where the ' +
      'wheels are, which is what throws a car off the road when it touches down.',
    causes: [
      'Too much speed through standing water for the tire (driving)',
      'Slick tires on a track with water on it (tire choice)',
      'Worn wet tires with less tread depth to clear water (tires)',
      'Steering or braking while the tire is off the surface (driving)',
    ],
    telemetryIndicators: [
      'RPM rising with no matching rise in Speed (the driven wheels losing contact) at the same place each lap',
      'YawRate and LatAccel not following SteeringWheelAngle on a straight or gentle curve',
      'ABSActive on with little deceleration in LongAccel',
      'Track wetness rising, precipitation high, and slick tires fitted, in the weather context',
    ],
    adjustments: [],
    drivingCorrections: [
      'Slow down before the standing water rather than in it, and go through it with the wheels as straight as possible.',
      'If the car aquaplanes, keep the steering where it is or straighten it, stay off the brakes and ease the throttle gently; do not make a correction that will act when the tires grip again.',
      'Move the line a little to miss the puddle when that is possible without a bigger cost elsewhere.',
    ],
    constraints: ['Setup changes cannot stop aquaplaning; speed through the water and the tire choice are what control it.', WEATHER_FIRST],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),
  rec({
    id: 'wet-tire-temperature-pressure',
    title: 'Tire temperature and pressure in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['coldTires', 'lowGrip', 'tireOverheating'],
    summary:
      'Water cools tires, and the lower grip means less sliding energy goes into them, so tires usually run cooler in ' +
      'the wet and take longer to come up to temperature after the pits or a caution. Cooler tires also run lower ' +
      'pressures, because pressure rises with temperature. A wet tire is made to work at lower temperatures than a ' +
      'slick; a slick in the wet is often too cold to work at all. The reverse happens as the track dries: a wet ' +
      'tire on a drying surface heats quickly, its soft tread moves and overheats. Watch the trend of the ' +
      'temperatures, not a fixed number: what counts is whether they are rising, falling or steady compared with the ' +
      'laps before, and how evenly they sit across each tire.',
    causes: [
      'Water cooling the tires (conditions)',
      'Slower laps putting less energy into the tires (conditions)',
      'A drying line heating wet tires (conditions)',
    ],
    telemetryIndicators: [
      'Carcass temperatures LFtempCL..RRtempCR and surface temperatures LFtempL..RRtempR rising, falling or steady over a stint',
      'Pressures LFpressure..RRpressure following the temperatures',
      'Track temperature and track wetness in the weather context',
    ],
    adjustments: [
      { parameter: 'tirePressure', direction: 'set for the pressures the tires will reach in the conditions expected, not the dry ones', effect: 'puts the contact patch in its working window when the tires are at temperature', tradeoff: 'if the track dries or the rain gets heavier than expected the pressures will be wrong the other way' },
    ],
    drivingCorrections: ['After the pits or a caution, build the pace over the first lap rather than driving at the limit straight away.'],
    constraints: ['No universal wet tire temperature or pressure exists: it depends on the car, the compound and the simulator.', 'Live laps only have carcass temperatures from the pits; surface temperatures come from .ibt files after the stint.'],
  }),
  rec({
    id: 'wet-tread-water-evacuation',
    title: 'Wet tire tread and water evacuation',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['aquaplaning', 'tireCrossover', 'tireWear'],
    summary:
      'A wet tire\'s grooves give the water under the contact patch somewhere to go, so the rubber between them can ' +
      'touch the road. That is why it resists aquaplaning and why a slick, with no grooves, cannot clear standing ' +
      'water. The tread blocks between the grooves move more than a slick\'s solid surface, so a wet tire feels ' +
      'softer and less precise, and on a dry surface those blocks squirm, heat and wear quickly. Wet compounds are ' +
      'usually softer to work at low temperatures. As a wet tire wears, its grooves get shallower and it clears less ' +
      'water. iRacing models tires lifting water from the track and channelling it through their tread, with grip ' +
      'that depends on the surface roughness and how wet it is.',
    causes: [],
    telemetryIndicators: ['Fitted tire compound in the weather context', 'Track wetness and precipitation', 'Surface temperatures rising quickly on wet tires as the track dries'],
    adjustments: [],
    drivingCorrections: [],
    constraints: ['Not every car in iRacing has a wet tire; check the compounds available for the car.'],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),
  rec({
    id: 'wet-aero-vs-mechanical',
    title: 'Aerodynamic and mechanical grip in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'aero', 'suspension', 'vehicleDynamics'],
    phases: ['mid', 'entry', 'exit'],
    symptoms: ['lowGrip', 'understeer', 'oversteer', 'aeroInstability'],
    summary:
      'Downforce still pushes the tires onto the road in the rain, and because it grows with speed it matters most in ' +
      'fast corners. But the tire can turn that load into less grip on a wet surface, and corners are taken slower, ' +
      'so downforce gives less than in the dry and mechanical grip (how the suspension keeps the tires loaded and in ' +
      'contact) makes up a larger share in slow corners. Spray from cars ahead and a wet surface can also change how ' +
      'the car feels at speed. This is why wet setups often look for more mechanical compliance and sometimes more ' +
      'wing, but neither is right everywhere: more wing costs straight-line speed, and a softer car can be slow to ' +
      'respond and run low.',
    causes: [],
    telemetryIndicators: ['Balance (understeer or oversteer) different in fast and slow corners', 'Speed at the minimum of each corner compared across corners'],
    adjustments: [
      { parameter: 'rearWing', direction: 'more, where the car is loose in fast wet corners', effect: 'more rear load and stability at speed', tradeoff: 'more drag and less top speed; little help in slow corners; can add understeer at speed' },
      { parameter: 'frontSplitter', direction: 'adjust to keep the aero balance where the rear wing moved it, where the car has one', effect: 'keeps the balance at speed', tradeoff: 'changes balance in fast corners only' },
    ],
    drivingCorrections: [],
    constraints: ['Wing and splitter are garage changes; not available on a fixed setup.', 'Do not assume more downforce is always faster in the rain: it depends on how much of the lap is fast corners and how wet the track is.'],
  }),
  rec({
    id: 'wet-rain-intensity-track-temperature',
    title: 'Rain intensity, track wetness and track temperature',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'vehicleDynamics'],
    phases: ['any'],
    symptoms: ['lowGrip', 'tireCrossover', 'coldTires'],
    summary:
      'How much rain is falling and how much water is on the track are different things. Water builds up while rain ' +
      'falls faster than it drains and evaporates, and goes on draining after the rain stops, so the track can get ' +
      'wetter for a while after the rain eases and stays wet after it stops. A warmer track and wind dry it faster; a ' +
      'cool track, cloud and night slow drying. Light rain on a dry, rubbered track can be very slippery before ' +
      'there is much water. iRacing\'s dynamic track tracks water and moisture on the surface: water accumulates, ' +
      'drains and evaporates, and the surface properties change with it. Its Precipitation value is measured at the ' +
      'start/finish line, so other parts of the track can be wetter or drier than it says. In static weather the ' +
      'track stays the same lap after lap.',
    causes: [],
    telemetryIndicators: [
      'Precipitation and track wetness in the weather context, and their trend over the last minutes',
      'Declared wet flag',
      'Track temperature trend',
      'Lap times of consecutive laps in the same conditions',
    ],
    adjustments: [],
    drivingCorrections: ['When the rain gets heavier, expect less grip in the same places next lap and back the entry speed off before finding the limit again.'],
    constraints: [
      'The trend of the weather is a projection from recent samples, not iRacing\'s forecast, which it does not share with apps.',
      'Precipitation in iRacing is the amount at the start/finish line, not across the whole lap.',
    ],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),

  // ---------------------------------------------------------------- B. technique
  rec({
    id: 'wet-braking-technique',
    title: 'Braking in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'braking', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['brakeLocking', 'absIntervention', 'brakingInstability', 'lowGrip'],
    summary:
      'With less grip the car needs more distance to slow, so braking starts earlier. The peak pressure the tires can ' +
      'use is lower, and a sudden hit of the pedal locks or triggers ABS before the load has moved forward. Build the ' +
      'pressure quickly but not instantly, so the front tires are loaded before the peak, then hold a lower peak than ' +
      'in the dry. Release smoothly: dropping the brake suddenly unloads the front and can send the rear wide in the ' +
      'wet. Trail braking still helps the car turn, but the tire has less to share between braking and cornering, so ' +
      'there is usually less brake left on at turn-in.',
    causes: [
      'Braking point carried over from dry laps (driving)',
      'Pressure applied too suddenly (driving)',
      'Peak pressure higher than the wet tires can use (driving)',
      'Brake released abruptly at turn-in (driving)',
    ],
    telemetryIndicators: [
      'Brake rising from zero to its peak in very few samples',
      'ABSActive on for most of the braking zone, or immediately at the start of it',
      'LongAccel no stronger, or weaker, while Brake is higher',
      'Brake still high when SteeringWheelAngle is large at turn-in',
    ],
    adjustments: [],
    drivingCorrections: [
      'Brake earlier, with a slightly lower peak, and build to it rather than stamping on the pedal.',
      'Release the brake progressively into the turn, with less brake still on at turn-in than in the dry.',
      'Use the braking zone to feel the grip: if ABS is working hard or a wheel locks, back the peak off next lap.',
    ],
    constraints: [WEATHER_FIRST],
  }),
  rec({
    id: 'wet-steering-entry-speed',
    title: 'Steering and entry speed in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving'],
    phases: ['entry', 'mid'],
    symptoms: ['understeer', 'lowGrip'],
    summary:
      'Turn the wheel smoothly and progressively, and only as far as the front tires can use: on a wet surface the ' +
      'front tire\'s peak grip comes at a smaller slip angle range and falls off sooner, so adding steering past it ' +
      'only scrubs speed and makes the understeer worse. Carry less speed to the turn-in point than in the dry and let ' +
      'the car rotate before adding throttle. A slightly earlier, gentler turn-in with a less sharp steering input ' +
      'spreads the cornering load and asks less of the front at any one moment.',
    causes: ['Entry speed too high for the wet grip (driving)', 'Steering added quickly or beyond the front\'s grip (driving)'],
    telemetryIndicators: [
      'SteeringWheelAngle still rising while YawRate flattens or falls',
      'SteeringWheelAngle larger than in other laps of the same corner with no more LatAccel',
      'Minimum Speed reached after the apex',
    ],
    adjustments: [],
    drivingCorrections: [
      'Turn in a little earlier and more gently, with less steering lock.',
      'If the front slides, unwind a little rather than adding lock.',
      'Lower the entry speed first, then build it up a lap at a time.',
    ],
    constraints: [],
  }),
  rec({
    id: 'wet-throttle-traction-gears',
    title: 'Throttle, wheelspin and gear choice in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving', 'tractionControl'],
    phases: ['exit', 'mid'],
    symptoms: ['poorTraction', 'tcIntervention', 'oversteer'],
    summary:
      'The rear tires can put down much less torque on a wet surface, so throttle has to come in later and more ' +
      'gradually, especially while the car is still turning. A higher gear than in the dry gives less torque at the ' +
      'wheels for the same throttle, which can make the power easier to control out of slow corners; the cost is ' +
      'less engine braking and slower pick-up, and it does not suit every car or corner. Short-shifting on the exit ' +
      'does the same. Traction control helps but does not replace a smooth throttle: when it cuts in hard it costs ' +
      'drive and heats the rear tires.',
    causes: [
      'Throttle applied while still at large steering angle (driving)',
      'Throttle applied too quickly (driving)',
      'Low gear giving more wheel torque than the wet surface can take (driving)',
    ],
    telemetryIndicators: [
      'RPM rising faster than Speed on corner exit (wheelspin)',
      'YawRate rising with Throttle while SteeringWheelAngle is unchanged or unwinding',
      'Throttle reaching full while SteeringWheelAngle is still large',
      'Gear lower than other laps through the same exit',
    ],
    adjustments: [],
    drivingCorrections: [
      'Squeeze the throttle in as the steering unwinds, and reach full throttle later than in the dry.',
      'Try one gear higher out of the slowest corners and compare the exit speed.',
      'Short-shift on exits where the rear steps out under power.',
    ],
    constraints: ['A higher gear is only better where the engine still pulls cleanly in it; check the exit speed rather than assuming.'],
  }),
  rec({
    id: 'wet-grip-changes',
    title: 'Recognising changes in grip between corners and laps',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving'],
    phases: ['any'],
    symptoms: ['lowGrip', 'tireCrossover'],
    summary:
      'In the wet the grip is not the same around the lap or from one lap to the next: some corners collect water, ' +
      'some dry first, shade and trees keep parts wet, and the amount of rain changes. Use the first laps, and each ' +
      'lap after a change in the rain, to test the grip at each corner: brake a little earlier, feel how the car ' +
      'responds, then move the braking and entry later step by step. When the rain gets heavier, back off before the ' +
      'grip goes; when it eases, expect grip to come back first on the racing line where cars clear the water. Lap ' +
      'times that improve quickly lap after lap are usually the track drying, not only the driver.',
    causes: [],
    telemetryIndicators: [
      'Minimum Speed and braking point of the same corner changing lap by lap',
      'Lap times improving or falling away with the precipitation and track wetness trend',
      'ABSActive or wheelspin appearing in corners where it did not happen before',
    ],
    adjustments: [],
    drivingCorrections: [
      'Re-check the grip in each corner whenever the rain changes, rather than driving to last lap\'s marks.',
      'Compare like with like: judge a change against laps in the same conditions.',
    ],
    constraints: [WEATHER_FIRST],
  }),

  // ---------------------------------------------------------------- C. lines
  rec({
    id: 'wet-line-selection',
    title: 'Choosing a wet racing line',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving'],
    phases: ['braking', 'entry', 'mid', 'exit'],
    symptoms: ['lowGrip', 'understeer', 'aquaplaning'],
    summary:
      'The dry line is coated with rubber and oil, which can be more slippery than clean asphalt when wet, and painted ' +
      'lines and kerbs are often very slippery. That is why drivers sometimes brake, turn and accelerate off the dry ' +
      'line in the rain, looking for clean, rougher asphalt. It is not always faster: off the line can collect more ' +
      'water or debris, it can make the corner tighter, and as the track dries the racing line dries first and ' +
      'becomes the fastest again. Find out corner by corner: try a slightly different line for braking or the apex, ' +
      'and keep it only where the laps show more speed or less time. Avoid standing water and painted surfaces ' +
      'under braking and power wherever possible.',
    causes: [
      'Rubbered-in racing line slippery when wet (conditions)',
      'Painted lines and kerbs with little wet grip (conditions)',
      'Standing water on the usual line (conditions)',
    ],
    telemetryIndicators: [
      'Minimum Speed and exit Speed of a corner compared between laps on different lines (from track positions)',
      'ABSActive or wheelspin at the same place on the line each lap',
      'Time through the focus area compared between lines',
    ],
    adjustments: [],
    drivingCorrections: [
      'Try a different line in one corner at a time, and compare the corner time with the same conditions.',
      'Keep off kerbs and painted lines under braking and power.',
      'Move back to the dry line as it dries: it usually comes back first.',
    ],
    constraints: ['Never assume the outside or off-line path is faster in the rain; it varies by track, corner and how wet it is.', 'Driving lines need track positions, which live laps get only after the stint.'],
  }),

  // ---------------------------------------------------------------- D. wet braking and brake bias
  rec({
    id: 'wet-brake-bias',
    title: 'Brake bias in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'braking', 'abs'],
    phases: ['braking', 'entry'],
    symptoms: ['brakingInstability', 'brakeLocking', 'absIntervention', 'understeer', 'oversteer'],
    summary:
      'Rain does not by itself mean moving brake bias rearward. With less grip, less load moves forward under braking, ' +
      'so the rear can do a larger share of the work, and some drivers move the bias rearward to use it and to help ' +
      'the car rotate. But the rear locking first is what makes a car spin under braking, and that is easier on a ' +
      'wet surface, so a more forward bias can be the safer and faster choice when the rear is unstable. The right ' +
      'way depends on the car, where the bias is now, whether the car has ABS and how it behaves, and what the laps ' +
      'show: fronts locking or ABS working on the front and understeer on entry point one way, the rear stepping out ' +
      'or locking under braking the other. Change it a small step at a time and check.',
    causes: [
      'Front tires saturated under braking: bias may be too far forward for the conditions (setup)',
      'Rear unstable or locking under braking: bias may be too far rearward for the conditions (setup)',
      'Driving inputs (sudden pressure, late release) looking like a bias problem (driving)',
    ],
    telemetryIndicators: [
      'ABSActive on with understeer on entry and SteeringWheelAngle large: front-limited',
      'YawRate rising under braking with little steering: rear-limited',
      'Brake pressure peak and how quickly it is applied',
      'In-car brake bias setting in the live data',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'forward a small step when the rear is unstable or locking under braking', effect: 'more stability on the brakes', tradeoff: 'more entry understeer and front locking or ABS' },
      { parameter: 'brakeBias', direction: 'rearward a small step when the fronts lock or understeer on entry and the rear is stable', effect: 'more rotation and less front saturation', tradeoff: 'the rear locks or steps out sooner, which is harder to catch in the wet' },
    ],
    drivingCorrections: ['Before changing the bias, make sure the pressure is built progressively and released smoothly: sudden inputs look like a bias problem.'],
    constraints: [
      'In iRacing many cars show the in-car bias as an offset from the setup, not a percentage.',
      'Never recommend a bias direction from the rain alone; it needs the car and the evidence.',
    ],
  }),
  rec({
    id: 'dx-wet-rear-instability-braking',
    title: 'Rear instability under braking in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'braking', 'abs', 'differential', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['brakingInstability', 'oversteer', 'brakeLocking'],
    summary:
      'The rear moves around or steps out while braking on a wet surface. With little grip the rear tires reach their ' +
      'limit sooner when load moves forward, and a rear lock, an abrupt downshift, or turning while braking hard can ' +
      'start a slide. Check the inputs first: a sudden pedal, downshifts with engine braking before the car is ' +
      'settled, and steering while at peak pressure are common causes. Then consider the bias and, where the car ' +
      'has adjustable coast locking, how much the differential resists the rear wheels turning at different speeds.',
    causes: [
      'Brake applied too suddenly, or turning while still at peak pressure (driving)',
      'Downshifting too early, the engine braking locking the rear (driving)',
      'Brake bias too far rearward for the wet grip (setup)',
      'Differential coast locking holding the rear wheels together on entry (setup)',
      'Standing water under one side of the car (conditions)',
    ],
    telemetryIndicators: [
      'YawRate rising under braking while SteeringWheelAngle is small or opposite',
      'Gear dropping and RPM jumping while Brake is high',
      'ABSActive cycling with LongAccel uneven',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'forward a small step', effect: 'less rear braking, more stability', tradeoff: 'more entry understeer and front locking' },
      { parameter: 'diffRamps', direction: 'less coast locking, where the car has ramps', effect: 'lets the rear wheels turn at different speeds off throttle, steadier on entry in some cars', tradeoff: 'can make some cars more nervous on entry; the effect depends on the car\'s differential' },
      { parameter: 'abs', direction: 'more intervention, where the car has adjustable ABS', effect: 'holds the rear off locking', tradeoff: 'longer braking distances when the system works hard' },
    ],
    drivingCorrections: [
      'Build the pressure progressively and keep the car straighter while braking hardest.',
      'Downshift a little later and more gently so engine braking arrives once the car is settled.',
    ],
    constraints: ['On a fixed setup only brake bias and ABS (where the car has them) can change.', WEATHER_FIRST],
  }),
  rec({
    id: 'dx-wet-abs-intervention',
    title: 'Excessive ABS intervention in the rain',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'abs', 'braking', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['absIntervention', 'brakeLocking', 'lowGrip'],
    summary:
      'ABS working for most of the braking zone in the wet means the pedal is asking for more than the tires can give. ' +
      'ABS keeps steering control but, working hard, usually stops the car in a longer distance than braking just ' +
      'below the limit, and it hides how much grip there really is. Lower the peak pressure a little and build it ' +
      'more progressively; if it still works hard, consider the ABS setting or bias where the car has them. ABS ' +
      'activity is recorded in the laps (ABSActive), so this can be measured rather than guessed.',
    causes: [
      'Brake pressure above what the wet tires can use (driving)',
      'Pressure applied before the load has moved forward (driving)',
      'ABS setting too permissive or too intrusive for the conditions (setup)',
      'Bias putting one axle at its limit first (setup)',
    ],
    telemetryIndicators: [
      'ABSActive on for most samples of the braking zone',
      'ABSActive starting within the first samples of Brake rising',
      'LongAccel not increasing when Brake does',
    ],
    adjustments: [
      { parameter: 'abs', direction: 'a setting with more intervention if wheels still lock, or less if it cuts in too early and the car stops poorly, where the car has adjustable ABS', effect: 'matches the system to the wet grip', tradeoff: 'more intervention lengthens braking; less risks locking' },
      { parameter: 'brakeBias', direction: 'a small step away from the axle that triggers ABS first, when the laps show which', effect: 'spreads the braking more evenly', tradeoff: 'moves the limit to the other axle' },
    ],
    drivingCorrections: ['Brake earlier with a slightly lower peak, built progressively, so ABS only touches at the peak.'],
    constraints: ['Not every car has ABS; without it the same symptom shows as locking.', WEATHER_FIRST],
  }),
  rec({
    id: 'wet-brake-diagnosis-front-rear',
    title: 'Diagnosing too much front or rear braking demand in the wet',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'braking', 'abs'],
    phases: ['braking', 'entry'],
    symptoms: ['brakeLocking', 'brakingInstability', 'understeer', 'absIntervention'],
    summary:
      'Front-limited braking shows as the car going straight on: steering added with little turn, front locking or ABS ' +
      'with understeer at turn-in. Rear-limited braking shows as rotation the driver did not ask for: the car yaws ' +
      'under braking with little steering, or the rear locks on downshifts. Braking while steering makes both worse, ' +
      'because the tire shares its smaller wet grip between the two. Brakes also run cooler in the rain, so they can ' +
      'bite differently from lap to lap until they are up to temperature, especially after a caution or the pits.',
    causes: [
      'Front demand too high: bias forward, or braking too hard while turning (setup or driving)',
      'Rear demand too high: bias rearward, early downshifts, engine braking (setup or driving)',
      'Cold brakes after the pits or a caution (conditions)',
    ],
    telemetryIndicators: [
      'SteeringWheelAngle rising with YawRate flat under braking: front-limited',
      'YawRate rising under braking with small SteeringWheelAngle: rear-limited',
      'ABSActive during the part of braking with steering applied',
    ],
    adjustments: [],
    drivingCorrections: ['Do more of the braking in a straight line, and keep less pressure on once steering is applied.'],
    constraints: ['Brake temperatures are not in the lap files; infer cold brakes from the context (after the pits or a caution).'],
  }),

  // ---------------------------------------------------------------- E. setup
  rec({
    id: 'wet-setup-suspension',
    title: 'Wet setup: anti-roll bars, springs and dampers',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'antiRollBars', 'springs', 'dampers', 'suspension'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['lowGrip', 'understeer', 'oversteer'],
    summary:
      'A softer car often finds more grip in the wet because the tires stay loaded more evenly over the surface and the ' +
      'load moves more slowly, which suits tires with little grip in reserve. But softer is not always right: lower ' +
      'cornering forces mean the car rolls less anyway, a soft car responds slowly in quick changes of direction, it ' +
      'runs lower and can bottom, and if the track dries a soft wet setup can be slow and overheat the tires. Change ' +
      'the balance with the bars first (the end made softer gains relative grip), then springs and dampers only for ' +
      'a clear reason.',
    causes: [],
    telemetryIndicators: ['Balance by corner phase from the Rotation Model', 'Ride heights LFrideHeight..RRrideHeight for bottoming', 'Response in quick direction changes (YawRate against SteeringWheelAngle)'],
    adjustments: [
      { parameter: 'antiRollBarFront', direction: 'softer when the car understeers mid-corner in the wet', effect: 'more front grip', tradeoff: 'slower response, more roll; can tip the car to oversteer on exit' },
      { parameter: 'antiRollBarRear', direction: 'softer when the rear lacks grip on exit', effect: 'more rear traction', tradeoff: 'more understeer, slower rotation' },
      { parameter: 'springs', direction: 'softer, only where the car feels skittish over the wet surface', effect: 'keeps the tires in contact over bumps and changes in grip', tradeoff: 'more pitch and roll, lower ride height under load, less precise; worse as the track dries' },
      { parameter: 'bumpDamping', direction: 'softer for a more compliant car', effect: 'smoother load changes', tradeoff: 'less control, more body movement' },
    ],
    drivingCorrections: [],
    constraints: ['Garage changes only; not on a fixed setup.', 'Do not assume softer suspension is always faster in the rain.'],
  }),
  rec({
    id: 'wet-setup-ride-height-aero',
    title: 'Wet setup: ride height, rake and downforce',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'rideHeight', 'aero'],
    phases: ['mid', 'straight'],
    symptoms: ['aquaplaning', 'lowGrip', 'aeroInstability', 'bottoming'],
    summary:
      'Some teams raise the car in heavy rain so the floor is further from standing water and a softer setup does not ' +
      'bottom. That costs downforce on cars that depend on their floor, changes the aero balance with the rake, and ' +
      'does not stop the tires aquaplaning. More wing gives more load at speed when the car is loose in fast wet ' +
      'corners, at the cost of straight-line speed. Whether either helps depends on the car, how much of the lap is ' +
      'fast corners and how wet the track is.',
    causes: [],
    telemetryIndicators: ['Ride heights LFrideHeight..RRrideHeight at speed', 'Speed on the straights', 'Balance in fast corners'],
    adjustments: [
      { parameter: 'rideHeight', direction: 'higher, where the car bottoms or runs into standing water with the floor', effect: 'clearance from bumps and water', tradeoff: 'less floor downforce, higher centre of gravity, and a rake change moves the aero balance' },
      { parameter: 'rearWing', direction: 'more, where the rear is loose at speed', effect: 'rear stability', tradeoff: 'drag; little benefit in slow corners' },
    ],
    drivingCorrections: [],
    constraints: ['Garage changes only.', 'Do not assume higher ride height or more downforce is always right in the rain.'],
  }),
  rec({
    id: 'wet-diff-adjustments',
    title: 'Wet-weather differential adjustments',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'differential'],
    phases: ['entry', 'exit'],
    symptoms: ['poorTraction', 'oversteer', 'understeer', 'brakingInstability'],
    summary:
      'A limited-slip differential decides how much the rear wheels are held to the same speed. On power, more locking ' +
      'drives both wheels and can give more traction, but on a wet surface it can also break both wheels loose at ' +
      'once and push the car straight or snap it round. Less power-side locking lets the inside wheel spin first, ' +
      'which can be easier to control but wastes drive. Off throttle, more coast locking steadies the car on entry but ' +
      'resists rotation; less helps it turn but can make it nervous. Preload affects both, most at low torque. The ' +
      'right direction depends on the car\'s differential and which problem the laps show.',
    causes: [],
    telemetryIndicators: ['RPM rising faster than Speed on exit', 'YawRate on entry off throttle', 'Rotation Model oversteer on power or on entry'],
    adjustments: [
      { parameter: 'diffPreload', direction: 'less, where the car will not rotate on entry or the inside wheel is not the problem on exit', effect: 'easier rotation', tradeoff: 'less stability and drive in some cars' },
      { parameter: 'diffPreload', direction: 'more, where the car is nervous on entry and through low-grip transitions', effect: 'more stability', tradeoff: 'more understeer and both wheels can let go together under power' },
      { parameter: 'diffRamps', direction: 'less power-side locking when both rear wheels spin together on exit', effect: 'more progressive breakaway', tradeoff: 'less drive when the grip is there' },
    ],
    drivingCorrections: [],
    constraints: ['Not every car has an adjustable differential, and the ones that do differ; the direction must match what the laps show.'],
  }),
  rec({
    id: 'wet-tc-tuning',
    title: 'Traction control in the rain',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tractionControl'],
    phases: ['exit', 'mid'],
    symptoms: ['tcIntervention', 'poorTraction', 'oversteer'],
    summary:
      'More traction control intervention lets the driver apply throttle with more confidence on a wet surface, and ' +
      'most drivers use more of it in the rain than in the dry. Too much cuts power the tires could use, slowing the ' +
      'exit and making the car feel flat; too little lets the rear spin and step out. As the track dries, less is ' +
      'usually needed. A smooth throttle matters more than the setting: TC working all the way out of every corner ' +
      'heats the rear tires and costs drive.',
    causes: [],
    telemetryIndicators: [
      'RPM against Speed on exit (wheelspin, or a cut in RPM as the system intervenes)',
      'Exit Speed compared at different TC settings in the same conditions',
      'There is no TC activity channel in the laps: intervention is inferred, not measured',
    ],
    adjustments: [
      { parameter: 'tractionControl', direction: 'more intervention when the rear spins up or steps out on wet exits', effect: 'controls wheelspin', tradeoff: 'less drive and exit speed when it cuts in too much' },
      { parameter: 'tractionControl', direction: 'less intervention as the track dries or when the exits feel flat', effect: 'more drive', tradeoff: 'more wheelspin if the grip is not there' },
    ],
    drivingCorrections: ['Apply the throttle progressively whatever the setting; let the TC catch mistakes rather than do the work.'],
    constraints: ['Not every car has traction control, or an adjustable one.', 'Change one click at a time and compare a few laps.'],
  }),
  rec({
    id: 'wet-setup-tires-alignment-engine',
    title: 'Wet setup: tire pressures, camber, toe and engine maps',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'alignment'],
    phases: ['any'],
    symptoms: ['lowGrip', 'coldTires', 'poorTraction'],
    summary:
      'Wet tires run cooler and lower pressures, so starting pressures are often set for the temperatures the wet ' +
      'tires will reach rather than the dry ones; how much depends on the car and compound, with no universal number. ' +
      'Lower cornering forces mean less camber is used in the wet, so some setups reduce it to put more of the ' +
      'tread flat on the road under braking and traction; the cost is less grip if the track dries. Toe changes ' +
      'stability and response: more toe-in at the rear steadies the car, at the cost of drag and tire heat. Where an ' +
      'engine map or throttle map is adjustable, a softer response can make the power easier to meter on a wet ' +
      'exit, at the cost of drive when the grip is there.',
    causes: [],
    telemetryIndicators: ['Pressures LFpressure..RRpressure against the laps before', 'Temperature spread across each tire (inside, middle, outside)', 'RPM against Speed on exit'],
    adjustments: [
      { parameter: 'tirePressure', direction: 'set for the wet working temperatures the car reaches', effect: 'contact patch in the working window', tradeoff: 'wrong as the track dries or the rain changes' },
      { parameter: 'camber', direction: 'less negative, where the wet cornering forces do not use it', effect: 'more tread flat under braking and traction', tradeoff: 'less cornering grip if the track dries' },
      { parameter: 'toe', direction: 'more rear toe-in where the rear is nervous', effect: 'stability', tradeoff: 'drag and tire heat, slower rotation' },
      { parameter: 'engineMap', direction: 'a softer response map, where the car has one', effect: 'easier power on wet exits', tradeoff: 'less drive when grip is available' },
    ],
    drivingCorrections: [],
    constraints: ['Pressures, camber and toe are garage changes; engine maps are in-car on some cars.', 'No universal wet pressure or camber exists.'],
  }),
  rec({
    id: 'wet-fixed-setup',
    title: 'A fixed setup in the rain',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'braking', 'abs', 'tractionControl', 'driving'],
    phases: ['any'],
    symptoms: ['lowGrip', 'understeer', 'oversteer', 'brakingInstability', 'poorTraction'],
    summary:
      'On a fixed setup the chassis cannot change for the rain, so the gains are in driving and in the adjustments ' +
      'available from the cockpit: brake bias, ABS, traction control and an engine map where the car has them. Start ' +
      'with the driving (earlier, progressive braking, smoother release, gentler steering, later throttle), then use ' +
      'the in-car settings to tune what the laps show: TC for wheelspin on exit, ABS for locking or heavy ' +
      'intervention, brake bias for an unstable or front-locking car on entry, a small step at a time.',
    causes: [],
    telemetryIndicators: ['ABSActive in braking zones', 'RPM against Speed on exit', 'Rotation Model balance by phase'],
    adjustments: [
      { parameter: 'brakeBias', direction: 'a small step forward or rearward depending on whether the rear or the front is the limit', effect: 'changes entry stability and rotation', tradeoff: 'the other axle reaches its limit sooner' },
      { parameter: 'tractionControl', direction: 'more intervention for wet exits', effect: 'controls wheelspin', tradeoff: 'cuts power, and so drive out of the corner, whenever it intervenes more than the grip needs' },
      { parameter: 'abs', direction: 'adjust where the car locks or ABS works too hard', effect: 'steadier braking', tradeoff: 'longer stops with more intervention' },
      { parameter: 'engineMap', direction: 'a softer map where the car has one', effect: 'easier throttle', tradeoff: 'less acceleration where the grip would have taken more, e.g. as the track dries' },
    ],
    drivingCorrections: ['Make the driving changes first; the in-car settings fine-tune what is left.'],
    constraints: ['Never suggest garage changes on a fixed setup.', 'Only the in-car adjustments the car actually has.'],
  }),

  // ---------------------------------------------------------------- F. tires and crossovers
  rec({
    id: 'wet-when-wets',
    title: 'When wet tires are the right choice',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireCrossover', 'aquaplaning', 'lowGrip'],
    summary:
      'Wet tires are for a track with water on it: they clear water, work at low temperatures and resist aquaplaning. ' +
      'Slicks are faster as long as the surface is dry enough that they can reach temperature and there is no ' +
      'standing water on the line. In between, on a damp or drying track, the choice depends on how much of the lap ' +
      'is wet, whether it is getting wetter or drier, how long is left, and how long a stop takes. The evidence is the ' +
      'laps themselves: lap times on each tire compared in the same conditions, other cars\' times on the other ' +
      'compound, the track wetness and the rain trend.',
    causes: [],
    telemetryIndicators: ['Fitted tire compound', 'Track wetness, precipitation and their trend', 'Lap times against cars on the other compound', 'Tire temperatures'],
    adjustments: [],
    drivingCorrections: [],
    constraints: ['There is no universal wetness level or lap time at which to change tires.', 'In iRacing rain tires are changed like any other compound change at a stop, and not every car has them.'],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),
  rec({
    id: 'dx-wet-tire-mismatch-slicks',
    title: 'Slick tires on a wet track',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireCrossover', 'lowGrip', 'aquaplaning', 'understeer', 'oversteer'],
    summary:
      'When the track is properly wet and the car is on slicks, the tires are the problem: they cannot clear water, ' +
      'stay too cold to work and aquaplane, so the car slides at both ends whatever the setup. Suspension or ' +
      'differential changes cannot make up for it, and chasing the handling with the setup will make the car wrong ' +
      'once the right tires are fitted. Deal with the tires first: decide whether to pit for wets from the wetness, ' +
      'the rain trend and the time left, and meanwhile drive to the grip there is.',
    causes: ['Slick tires fitted on a wet track (tire choice)'],
    telemetryIndicators: [
      'Fitted tire compound dry while track wetness is wet and precipitation is above zero',
      'Lap times falling away lap after lap as the track gets wetter',
      'Tire temperatures falling',
      'Slides at both ends: understeer on entry and oversteer on exit in the same laps',
    ],
    adjustments: [],
    drivingCorrections: [
      'Drive well below the dry limit, avoid standing water and kerbs, and plan the stop for wet tires.',
    ],
    constraints: ['Do not recommend setup changes to fix handling on slicks in significant rain; the tire choice comes first.', 'A damp track can still favour slicks; check how wet it is and the trend.'],
  }),
  rec({
    id: 'dx-wet-wets-overheating-drying',
    title: 'Wet tires overheating on a drying track',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireOverheating', 'tireWear', 'tireCrossover'],
    summary:
      'As the track dries, wet tires lose the water that cooled them, and their soft, grooved tread squirms on dry ' +
      'asphalt, heats up and wears quickly. The car moves around more, the grip falls and lap times stop improving ' +
      'or get worse while the track is getting faster. Running through the remaining wet patches (on the straights, ' +
      'off the line where it is safe) cools the tires; the lasting answer is usually slicks, once the track is dry ' +
      'enough for them to work. Judge the temperatures by their trend and against the laps before, not a fixed number.',
    causes: ['Wet tires on a surface that has dried (conditions and tire choice)', 'Driving the dry line, where the wet tires heat most (driving)'],
    telemetryIndicators: [
      'Surface or carcass temperatures (LFtempL.., LFtempCL..) rising lap after lap on wet tires',
      'Track wetness falling and precipitation at zero in the weather context',
      'Lap times stopping improving while other cars on slicks go faster',
      'More sliding: Rotation Model events rising',
    ],
    adjustments: [],
    drivingCorrections: [
      'Use the wet patches to cool the tires where that is safe, and avoid wheelspin and sliding that heat them.',
      'Plan the stop for slicks from the drying trend and the time left.',
    ],
    constraints: ['No universal temperature says the wets are overheating; compare with the stint\'s earlier laps.', 'Live laps have tire surface temperatures only after the .ibt is read.'],
  }),
  rec({
    id: 'wet-slicks-damp',
    title: 'Slick tires on a damp track',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'driving'],
    phases: ['any'],
    symptoms: ['lowGrip', 'coldTires', 'tireCrossover'],
    summary:
      'On a damp track with no standing water, slicks can still be the faster tire once they have temperature, ' +
      'especially as a dry line appears. They are very slippery while cold, and off the dry line, so the first laps ' +
      'and any wet patches need care. Keep them working: build heat with braking and traction on the dry line, keep ' +
      'off the wet parts under load, and watch whether the track is drying or getting wetter.',
    causes: [],
    telemetryIndicators: ['Tire temperatures rising or falling', 'Lap times against cars on wet tires', 'Track wetness trend'],
    adjustments: [],
    drivingCorrections: ['Stay on the drying line, and treat damp patches like ice under braking and power.'],
    constraints: [WEATHER_FIRST],
  }),
  rec({
    id: 'dx-wet-crossover-slicks-to-wets',
    title: 'Crossover: from slicks to wet tires',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireCrossover', 'lowGrip', 'aquaplaning'],
    summary:
      'Changing from slicks to wets is worth it when the time lost on slicks for the rest of the stint is more than ' +
      'the stop costs. The signs: the rain is increasing or steady and the track is getting wetter, lap times on ' +
      'slicks are falling away, the car aquaplanes or slides at both ends, and cars already on wets are lapping ' +
      'faster. Stopping early in a shower that is about to pass can cost a second stop; stopping late costs time on ' +
      'every lap and risks going off. With little time left, staying out can be right.',
    causes: [],
    telemetryIndicators: [
      'Precipitation increasing and track wetness rising over the last minutes',
      'Own lap times on slicks against laps before and against cars on wets',
      'Tire temperatures falling on slicks',
      'Aquaplaning or slides in more corners each lap',
    ],
    adjustments: [],
    drivingCorrections: [],
    constraints: ['No universal wetness level or lap time triggers the change; weigh the trend, the gap to cars on wets and the time left.', 'iRacing does not share its forecast with apps: the trend is a projection from recent conditions.'],
  }),
  rec({
    id: 'dx-wet-crossover-wets-to-slicks',
    title: 'Crossover: from wet tires to slicks',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireCrossover', 'tireOverheating', 'tireWear'],
    summary:
      'Changing from wets to slicks is worth it when the track has dried enough that slicks will reach temperature and ' +
      'grip on the line, and the time gained over the rest of the stint is more than the stop and the first slow laps ' +
      'on cold slicks. The signs: the rain has stopped and the track wetness is falling, a dry line is appearing, the ' +
      'wets are overheating and lap times on them have stopped improving, and cars that changed to slicks are faster ' +
      'once warm. Too early and the slicks will not work and may aquaplane in what water is left; too late and the ' +
      'wets lose time every lap and wear out.',
    causes: [],
    telemetryIndicators: [
      'Precipitation at or near zero and track wetness falling',
      'Wet tire temperatures rising lap after lap',
      'Lap times on wets flattening while the track gets faster',
      'Cars on slicks lapping faster once warm',
    ],
    adjustments: [],
    drivingCorrections: ['On the first laps on slicks, stay on the dry line and build temperature before pushing.'],
    constraints: ['Do not recommend slicks without evidence the track is drying; rain easing is not the track being dry.', 'No universal threshold for the change.'],
  }),
  rec({
    id: 'wet-no-wet-tires',
    title: 'A car without wet tires in the rain',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'driving'],
    phases: ['any'],
    symptoms: ['lowGrip', 'aquaplaning', 'tireCrossover'],
    summary:
      'When the car has no wet tire to change to, the tire choice is not an option: the driver has to manage the grip ' +
      'there is with driving and the adjustments the car allows. Expect much less grip in the wet on slicks or an ' +
      'all-weather tire, more aquaplaning in standing water, and tires that struggle for temperature. Drive to the ' +
      'conditions, avoid water and painted surfaces, and use in-car settings (TC, ABS, bias) where the car has them.',
    causes: [],
    telemetryIndicators: ['Compounds available for the car (no wet compound)', 'Track wetness and precipitation', 'Tire temperatures'],
    adjustments: [],
    drivingCorrections: ['Brake earlier and more gently, carry less entry speed, be patient with the throttle, and keep away from standing water.'],
    constraints: ['Never suggest changing to wet tires when the car has none.', 'In iRacing rain is only possible in sessions with rain-ready cars, but a car\'s own tire options still decide what it can fit.'],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),

  // ---------------------------------------------------------------- handling diagnosis in the wet
  rec({
    id: 'dx-wet-entry-understeer',
    title: 'Corner-entry understeer in the wet (GT3)',
    authority: 'car_class',
    ...gt3,
    components: ['wetWeather', 'braking', 'driving', 'antiRollBars'],
    phases: ['braking', 'entry'],
    symptoms: ['understeer', 'lowGrip'],
    summary:
      'On wet tires in the rain the car will not turn in. First check the driving: in the wet the usual cause is too ' +
      'much speed at turn-in or too much brake still on while steering, so the front tires, with less grip, are asked ' +
      'for braking and cornering together. Then check the conditions: a slippery rubbered or painted line at the ' +
      'turn-in, or water on it. Only when the laps show it in every lap with the inputs smooth is it the setup: brake ' +
      'bias, coast locking and front roll stiffness, each with its tradeoff in the wet.',
    causes: [
      'Too much entry speed for the wet grip (driving)',
      'Brake still high at turn-in (driving)',
      'Steering added beyond what the front can use (driving)',
      'Slippery line or water at the turn-in (conditions)',
      'Brake bias too far forward for the wet (setup)',
      'Front anti-roll bar too stiff for the wet (setup)',
    ],
    telemetryIndicators: [
      'Brake still high when SteeringWheelAngle is large at turn-in',
      'SteeringWheelAngle rising while YawRate flattens on entry',
      'ABSActive on during the turn-in',
      'Rotation Model understeer on ENTRY, on the brakes',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'rearward a small step, only if the rear is stable under braking', effect: 'frees the front to turn', tradeoff: 'rear locking and instability come sooner in the wet' },
      { parameter: 'antiRollBarFront', direction: 'softer', effect: 'more front grip on entry', tradeoff: 'slower response; can add exit oversteer' },
      { parameter: 'diffRamps', direction: 'less coast locking, where the car has ramps', effect: 'more rotation off throttle', tradeoff: 'less stability on entry' },
    ],
    drivingCorrections: [
      'Brake earlier and release more progressively, with less brake on as the steering goes in.',
      'Lower the entry speed and turn in a little earlier and more gently.',
      'Try a turn-in point off the rubbered line if it is slippery.',
    ],
    constraints: ['On a fixed setup only brake bias (and ABS) can change.', WEATHER_FIRST],
  }),
  rec({
    id: 'dx-wet-exit-oversteer',
    title: 'Corner-exit oversteer in the wet (GT3)',
    authority: 'car_class',
    ...gt3,
    components: ['wetWeather', 'tractionControl', 'differential', 'driving'],
    phases: ['exit'],
    symptoms: ['oversteer', 'poorTraction', 'tcIntervention'],
    summary:
      'On wet tires the rear steps out as the power goes down. Check the driving first: throttle applied too early or ' +
      'too quickly while the car still has steering lock, or full throttle in a low gear. Then the conditions: paint, ' +
      'kerbs or water on the exit. Then the in-car settings (more TC, a softer engine map) and, on an open setup, ' +
      'the differential and rear roll stiffness.',
    causes: [
      'Throttle applied with steering still large (driving)',
      'Throttle applied too quickly (driving)',
      'Low gear giving too much wheel torque (driving)',
      'Kerbs, paint or water on the exit (conditions)',
      'TC set too low for the wet (setup)',
      'Differential power locking breaking both wheels loose (setup)',
    ],
    telemetryIndicators: [
      'Throttle rising while SteeringWheelAngle is still large',
      'RPM rising faster than Speed on exit',
      'YawRate rising with Throttle while steering unwinds or goes opposite',
      'Rotation Model POWER_ON oversteer',
    ],
    adjustments: [
      { parameter: 'tractionControl', direction: 'more intervention', effect: 'catches the wheelspin', tradeoff: 'cuts power, and so drive out of the corner, whenever it intervenes more than the grip needs' },
      { parameter: 'diffRamps', direction: 'less power-side locking, where the car has ramps', effect: 'more progressive breakaway', tradeoff: 'less drive when grip is there' },
      { parameter: 'antiRollBarRear', direction: 'softer', effect: 'more rear traction', tradeoff: 'more understeer' },
      { parameter: 'engineMap', direction: 'a softer map, where the car has one', effect: 'gentler power delivery', tradeoff: 'less acceleration where the grip would have taken more, e.g. as the track dries' },
    ],
    drivingCorrections: [
      'Delay full throttle until the steering is unwinding, and squeeze it in.',
      'Try one gear higher, or short-shift, out of slow corners.',
    ],
    constraints: ['On a fixed setup only TC, ABS, bias and an engine map (where the car has them) can change.', WEATHER_FIRST],
  }),
  rec({
    id: 'dx-wet-tc-intervention',
    title: 'Excessive traction-control intervention in the rain',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tractionControl', 'driving'],
    phases: ['exit'],
    symptoms: ['tcIntervention', 'poorTraction'],
    summary:
      'The car feels flat and slow on exit, with the engine cutting, because traction control is catching wheelspin ' +
      'all the way out of the corner. Usually the throttle is coming in too early or too fast for the wet grip, or the ' +
      'gear is too low; sometimes the setting is higher than the conditions need, especially as the track dries. ' +
      'There is no TC channel in the lap files, so this is inferred from RPM against speed and the exit speed.',
    causes: ['Throttle too early or too fast (driving)', 'Gear too low (driving)', 'TC setting higher than the conditions need (setup)'],
    telemetryIndicators: ['RPM held or cut back while Throttle is high on exit', 'Exit Speed lower than other laps with similar inputs', 'Throttle at full while SteeringWheelAngle is still large'],
    adjustments: [
      { parameter: 'tractionControl', direction: 'less intervention when the track is drying and the rear is stable', effect: 'more drive', tradeoff: 'more wheelspin if grip is lower than it feels' },
    ],
    drivingCorrections: ['Squeeze the throttle in more gradually and try a higher gear; the TC should only touch at the limit.'],
    constraints: ['TC activity is not recorded in the laps; never say it was measured.'],
  }),
  rec({
    id: 'dx-wet-aquaplaning',
    title: 'Instability through standing water',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires', 'driving'],
    phases: ['straight', 'braking', 'mid'],
    symptoms: ['aquaplaning', 'snapOversteer', 'lowGrip'],
    summary:
      'The car goes light, wanders or snaps sideways at the same place each lap: usually standing water. The tires ' +
      'lift off the surface, then grip again suddenly. Slow down before the water, cross it straight and without ' +
      'braking or big throttle, or move the line to miss it. On slicks in standing water the fix is wet tires; no ' +
      'setup change prevents aquaplaning.',
    causes: ['Standing water on the line (conditions)', 'Speed through the water (driving)', 'Slick or worn tires (tire choice)', 'Steering or braking in the water (driving)'],
    telemetryIndicators: [
      'RPM jumping with no rise in Speed at the same place each lap',
      'YawRate spike without SteeringWheelAngle change on a straight or gentle curve',
      'ABSActive with little deceleration',
      'Track wetness high or rising in the weather context',
    ],
    adjustments: [],
    drivingCorrections: [
      'Lift slightly before the water and cross it with the wheels straight.',
      'If the car aquaplanes, hold the steering steady, stay off the brakes and wait for grip.',
    ],
    constraints: ['Setup changes cannot fix aquaplaning.', WEATHER_FIRST],
  }),

  // ---------------------------------------------------------------- G. racecraft
  rec({
    id: 'wet-racecraft-visibility-traffic',
    title: 'Racecraft in the rain: spray, visibility and following',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving'],
    phases: ['straight', 'braking'],
    symptoms: ['lowGrip'],
    summary:
      'Spray from the car ahead hides the track and the braking point, so leave a bigger gap, especially into braking ' +
      'zones where the car ahead may brake earlier than expected. Following directly behind also puts the car in the ' +
      'other car\'s water. Overtaking is often easier off the usual line, where the following driver can brake on ' +
      'cleaner asphalt, but braking off-line is only better where that surface really grips more. Traffic in low grip ' +
      'needs room: avoid side-by-side moves through standing water, and expect others to lose the car.',
    causes: [],
    telemetryIndicators: ['Gaps to cars ahead and behind in the live data', 'Braking points next to the car ahead'],
    adjustments: [],
    drivingCorrections: [
      'Leave more room behind cars in spray, and pick a braking marker you can see.',
      'Set up passes by getting a better exit, and brake off-line only where it grips.',
    ],
    constraints: [],
  }),
  rec({
    id: 'wet-racecraft-starts-pits',
    title: 'Rain starts, restarts and pit entry and exit',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'driving', 'tires'],
    phases: ['straight', 'exit', 'braking'],
    symptoms: ['poorTraction', 'coldTires', 'lowGrip'],
    summary:
      'At a wet start or restart the tires and brakes are cold and the grip low, so the first corners are where cars ' +
      'go off: be smooth with the throttle off the line (a higher gear can help), brake earlier for the first corners ' +
      'and expect spray. Pit entry and exit lanes are often painted and slippery; brake earlier for the pit entry and ' +
      'leave the pits gently on cold tires. After a caution the tires have cooled, so the first lap needs care too.',
    causes: [],
    telemetryIndicators: ['Wheelspin (RPM against Speed) at the start', 'Tire temperatures after the pits or a caution', 'Session flags and state in the live data'],
    adjustments: [],
    drivingCorrections: [
      'Feed the throttle in gently off the line and out of the pits.',
      'Brake earlier for the first corners and the pit entry.',
    ],
    constraints: [],
  }),
  rec({
    id: 'wet-pit-strategy',
    title: 'Weather pit strategy',
    authority: 'general_principle',
    ...anyCar,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['tireCrossover'],
    summary:
      'Changing weather makes tire strategy a balance of the time lost in the stop, the time gained or lost per lap on ' +
      'each tire, and how long is left. Watch the trend of the rain and the track wetness, and the lap times of cars ' +
      'that have already changed. A stop under a caution costs less. Without a forecast, decisions rest on what the ' +
      'track is doing and the direction it is moving, so leave margin for the weather to change again.',
    causes: [],
    telemetryIndicators: ['Precipitation and track wetness trend', 'Laps and time remaining', 'Lap times of cars on other compounds', 'Caution flags'],
    adjustments: [],
    drivingCorrections: [],
    constraints: ['iRacing shows a forecast in the sim but does not share it with apps; the trend here is a projection, not a forecast.', 'No fixed rule decides the stop; it depends on the stop time, the gap and the time left.'],
  }),
  rec({
    id: 'wet-iracing-tempest',
    title: 'Rain in iRacing (Tempest)',
    authority: 'simulator_specific',
    ...iracing,
    components: ['wetWeather', 'tires'],
    phases: ['any'],
    symptoms: ['lowGrip', 'tireCrossover'],
    summary:
      'iRacing added rain with its Tempest weather system in its 2024 Season 2 release. Rain is only possible on ' +
      'asphalt road courses, in sessions with rain-ready cars, which have updated tires or a rain tire compound; rain ' +
      'tires are changed like any other compound at a stop. Weather can be static (the track stays the same lap after ' +
      'lap, even when rain effects show), forecasted or a timeline. With dynamic weather the track\'s water builds, ' +
      'drains and evaporates and the grip follows; tires lift water and channel it through their tread, with grip ' +
      'depending on the surface roughness and wetness. The live Precipitation value is the amount at the start/finish ' +
      'line. The sim shows a forecast in its Weather tab, but it is not in the telemetry or session info apps read.',
    causes: [],
    telemetryIndicators: ['Weather type (static or dynamic) from session info', 'Precipitation, track wetness and declared wet in the live data', 'Fitted tire compound and the compounds available for the car'],
    adjustments: [],
    drivingCorrections: [],
    constraints: ['Not every iRacing car has a rain tire.', 'In static weather the track does not dry or get wetter.'],
    sources: [ORIGINAL, IRACING_RAIN_NOTES],
  }),
];
