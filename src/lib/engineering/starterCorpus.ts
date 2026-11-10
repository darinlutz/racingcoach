import type { EngineeringRecord, KnowledgeSource } from './knowledgeTypes.ts';
import { WET_WEATHER_CORPUS, WET_WEATHER_SOURCES } from './wetWeatherCorpus.ts';

// The Race Engineering knowledge base's starter corpus: original explanations of established vehicle dynamics and
// setup practice, written for RacingCoach (no text copied from manuals or books). Every record is 'ai_drafted': it was
// written with an AI model and must be reviewed by a person on the Admin page before it's marked 'reviewed'. Agents
// get drafted records as general engineering guidance, never as verified car data, and no record here states an
// exact setting, range or click count, as none is verified for any car.
//
// `npm run engineering:ingest` loads it into the database (scripts/engineeringKnowledge.mjs); retrieval also falls
// back to it when the database has no knowledge yet, so the agents have it either way. A changed record must get a
// higher version, or ingestion skips it as unchanged (content hashes catch edits too, but versions are what the
// Admin page shows).

export const STARTER_SOURCES: KnowledgeSource[] = [
  {
    key: 'racingcoach-original',
    title: 'RacingCoach engineering notes (original)',
    url: null,
    kind: 'original',
    license: 'original',
    publisher: 'Clarivex LLC',
  },
  // the public documents the wet-weather records link to (wetWeatherCorpus.ts)
  ...WET_WEATHER_SOURCES,
];

const ORIGINAL = ['racingcoach-original'];

type Draft = Omit<EngineeringRecord, 'version' | 'verification' | 'sources' | 'drivingCorrections' | 'constraints' | 'cars'> &
  Partial<Pick<EngineeringRecord, 'version' | 'drivingCorrections' | 'constraints' | 'cars'>>;

const rec = (draft: Draft): EngineeringRecord => ({
  version: 1,
  verification: 'ai_drafted',
  sources: ORIGINAL,
  drivingCorrections: [],
  constraints: [],
  cars: [],
  ...draft,
});

const anyCar = { simulators: ['any'] as EngineeringRecord['simulators'], carClasses: ['any'] as EngineeringRecord['carClasses'] };

export const STARTER_CORPUS: EngineeringRecord[] = [
  // ---------------------------------------------------------------- vehicle dynamics principles
  rec({
    id: 'vd-weight-transfer',
    title: 'Longitudinal and lateral weight transfer',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics'],
    phases: ['braking', 'entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer', 'brakingInstability'],
    summary:
      'Braking moves load to the front axle and acceleration moves it to the rear; cornering moves it to the outside ' +
      'tires. The total transfer depends on the car\'s mass, centre of gravity height, wheelbase and track width, and ' +
      'cannot be changed by springs or bars. Springs, anti-roll bars and dampers change how the lateral transfer is ' +
      'shared between the front and rear axles and how fast it happens. Because a tire\'s grip rises less than ' +
      'proportionally with load, the axle that carries more of the lateral load transfer loses grip relative to the ' +
      'other: more roll stiffness at the front gives more understeer, more at the rear gives more oversteer.',
    causes: [],
    telemetryIndicators: ['LongAccel (braking and acceleration load)', 'LatAccel (cornering load)', 'Brake and Throttle timing against SteeringWheelAngle'],
    adjustments: [],
    drivingCorrections: [
      'Smooth, progressive brake release and throttle application keep the load transfer gradual, so the tires are not overloaded suddenly.',
    ],
  }),
  rec({
    id: 'vd-slip-angle-grip',
    title: 'Slip angle, tire saturation and the friction circle',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics', 'tires'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer'],
    summary:
      'A tire makes cornering force by running at a slip angle. Force rises with slip angle up to a peak and then ' +
      'flattens or falls; past the peak the tire is saturated and more steering (front) or more yaw (rear) gives no more ' +
      'grip. A tire shares its grip between braking or driving and cornering (the friction circle): asking for braking ' +
      'and cornering at the same time leaves less of each. Understeer is the front axle reaching its limit first; ' +
      'oversteer is the rear axle reaching it first.',
    causes: [],
    telemetryIndicators: [
      'Front saturation: SteeringWheelAngle keeps increasing while YawRate and LatAccel stop rising',
      'Rear saturation: YawRate higher than the steering and speed would give, sideslip (VelocityY/VelocityX) growing, often with steering correction',
    ],
    adjustments: [],
    drivingCorrections: ['Adding steering past the point where yaw rate stops increasing only scrubs the front tires; unwind slightly and wait for the front to bite.'],
  }),
  rec({
    id: 'vd-yaw-rate',
    title: 'Yaw rate and sideslip as balance indicators',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer', 'snapOversteer'],
    summary:
      'For a given speed and steering angle a neutral car yaws at a predictable rate. A yaw rate below that expectation ' +
      'is understeer; above it is oversteer. Sideslip (the angle between where the car points and where it travels, from ' +
      'VelocityY and VelocityX) shows the rear stepping out. RacingCoach\'s Rotation Model uses exactly these signals, ' +
      'and needs a calibration for the car; without one it reports nothing rather than guessing.',
    causes: [],
    telemetryIndicators: ['YawRate against SteeringWheelAngle and Speed', 'Sideslip from VelocityY/VelocityX', 'Rotation Model understeer/oversteer events by phase'],
    adjustments: [],
    constraints: ['Only claim measured understeer or oversteer when the Rotation Model reports it for this car; otherwise it is the driver\'s description.'],
  }),
  rec({
    id: 'vd-mechanical-vs-aero',
    title: 'Mechanical grip versus aerodynamic grip',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics', 'aero', 'suspension'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer', 'aeroInstability'],
    summary:
      'Mechanical grip comes from the tires and how the suspension keeps them loaded evenly; it dominates in slow ' +
      'corners. Aerodynamic grip grows with the square of speed and dominates in fast corners. A balance problem that ' +
      'appears only in slow corners points to mechanical setup (springs, bars, differential, alignment); one that ' +
      'appears only in fast corners points to aero balance and ride height. A car can be balanced in one and not the ' +
      'other, so always ask which corners and at what speed.',
    causes: [],
    telemetryIndicators: ['Speed at the minimum of the corner', 'Whether the balance problem changes between slow and fast corners'],
    adjustments: [],
  }),
  rec({
    id: 'vd-transient',
    title: 'Transient behaviour: how fast the car responds',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics', 'dampers'],
    phases: ['entry', 'exit'],
    symptoms: ['understeer', 'oversteer', 'snapOversteer'],
    summary:
      'Steady-state balance is set by springs, bars and aero; how quickly the load moves while the car changes state ' +
      '(turn-in, brake release, throttle application, direction changes) is set largely by the low-speed dampers. A car ' +
      'that is balanced mid-corner but lazy on turn-in, or that snaps when the throttle is applied, has a transient ' +
      'problem rather than a steady-state one.',
    causes: [],
    telemetryIndicators: ['Delay between SteeringWheelAngle rising and YawRate rising at turn-in', 'Sudden YawRate spike shortly after Throttle starts rising'],
    adjustments: [],
  }),

  // ---------------------------------------------------------------- handling diagnosis
  rec({
    id: 'dx-entry-understeer',
    title: 'Corner-entry understeer',
    authority: 'general_principle',
    ...anyCar,
    components: ['braking', 'differential', 'antiRollBars', 'dampers', 'alignment', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['understeer'],
    summary:
      'The car will not turn in on the brakes or just after releasing them: steering goes in and the nose runs wide. ' +
      'The front tires are being asked for braking and cornering at once, or are not loaded enough when the driver ' +
      'turns. Check driving first: braking too late or too hard into the turn, releasing the brake abruptly (unloading ' +
      'the front) or turning in with too much speed all look like entry understeer and are not cured by setup.',
    causes: [
      'Too much speed at turn-in for the grip available (driving)',
      'Brake released too early or too abruptly, unloading the front tires (driving)',
      'Too much brake pressure still applied while turning (driving or brake bias too far forward)',
      'Brake bias too far forward, so the front tires are near locking while cornering',
      'Differential locking too much off throttle (coast), resisting rotation',
      'Front anti-roll bar too stiff, or rear too soft, for slow corners',
      'Front rebound / rear bump damping slowing the forward load transfer on corner entry',
      'Front tires too cold or too hot (outside their working window)',
    ],
    telemetryIndicators: [
      'Brake still high (above about 30%) when SteeringWheelAngle is already large',
      'SteeringWheelAngle increasing while YawRate flattens during the entry',
      'Rotation Model understeer events in the ENTRY phase, on the brakes',
      'ABSActive on while steering at entry (front tires at their limit)',
      'Minimum speed reached late, after the apex',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'move rearward a small step', effect: 'frees the front tires to turn while braking, more rotation on entry', tradeoff: 'less stability under braking; too far rearward and the rear locks or steps out' },
      { parameter: 'diffPreload', direction: 'reduce (or less coast locking where the car has ramps)', effect: 'lets the rear wheels turn at different speeds off throttle, helping rotation', tradeoff: 'can make the car less stable on entry and on throttle' },
      { parameter: 'diffRamps', direction: 'less coast-side locking', effect: 'more rotation off throttle', tradeoff: 'less entry stability' },
      { parameter: 'antiRollBarFront', direction: 'softer', effect: 'more front grip in slow corners', tradeoff: 'more roll, slower response, can add mid-corner understeer in fast corners if the platform suffers' },
      { parameter: 'antiRollBarRear', direction: 'stiffer', effect: 'more rotation', tradeoff: 'less rear grip, can add exit oversteer' },
      { parameter: 'reboundDamping', direction: 'less front rebound / more rear rebound', effect: 'load reaches the front faster on entry', tradeoff: 'can make the rear lighter and nervous' },
    ],
    drivingCorrections: [
      'Brake a little earlier and release the brake progressively into the turn (trail braking), so the front stays loaded as steering goes in.',
      'Carry less speed to the turn-in point and rotate the car before adding throttle.',
      'Do not add more steering when the front is already sliding; unwind slightly.',
    ],
    constraints: ['On a fixed setup only in-car adjustments (brake bias, ABS, TC where the car has them) can change.'],
  }),
  rec({
    id: 'dx-entry-oversteer',
    title: 'Corner-entry oversteer',
    authority: 'general_principle',
    ...anyCar,
    components: ['braking', 'differential', 'antiRollBars', 'dampers', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['oversteer', 'brakingInstability'],
    summary:
      'The rear steps out while braking or turning in. The rear tires are overloaded or underloaded: too much rear ' +
      'braking, a lift of the throttle that pitches the car forward, downshifting before the rear is settled, or a ' +
      'very sharp turn-in.',
    causes: [
      'Brake bias too far rearward',
      'Aggressive downshifts locking the rear through engine braking (driving)',
      'Very abrupt turn-in while still braking hard (driving)',
      'Differential locking too little off throttle, letting the rear rotate freely',
      'Rear anti-roll bar too stiff for slow corners',
      'Cold rear tires (out lap, first laps of a stint)',
    ],
    telemetryIndicators: [
      'Sideslip (VelocityY/VelocityX) growing during braking or entry',
      'Steering correction (SteeringWheelAngle reversing) during entry',
      'Rotation Model oversteer events of type ENTRY, often on the brakes',
      'RPM spikes on downshift with Brake high',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'move forward a small step', effect: 'more stability under braking', tradeoff: 'adds entry understeer' },
      { parameter: 'diffPreload', direction: 'increase (or more coast locking where the car has ramps)', effect: 'stabilises the rear off throttle', tradeoff: 'less rotation on entry, can add understeer' },
      { parameter: 'antiRollBarRear', direction: 'softer', effect: 'more rear grip', tradeoff: 'less rotation, can add mid-corner understeer' },
      { parameter: 'abs', direction: 'higher intervention setting where the car has ABS', effect: 'keeps the rear from locking under braking', tradeoff: 'longer braking distances if it intervenes too much' },
    ],
    drivingCorrections: [
      'Space the downshifts so each one happens once the car has slowed, and blip enough to match revs.',
      'Turn in more progressively while still trail braking; reduce brake pressure as steering increases.',
    ],
  }),
  rec({
    id: 'dx-mid-understeer',
    title: 'Mid-corner understeer',
    authority: 'general_principle',
    ...anyCar,
    components: ['antiRollBars', 'springs', 'alignment', 'tires', 'aero', 'driving'],
    phases: ['mid'],
    symptoms: ['understeer'],
    summary:
      'With the brakes off and before the throttle, the car pushes wide at the apex. This is closest to the car\'s ' +
      'steady-state balance, so it is the phase setup changes affect most directly. In slow corners look at mechanical ' +
      'roll stiffness and front grip; in fast corners at aero balance and ride height.',
    causes: [
      'Front roll stiffness too high relative to the rear (bars or springs)',
      'Not enough front camber, or front tires too hot / pressures too high',
      'Aero balance too far rearward (fast corners)',
      'Front ride height too high or rake too low, reducing front downforce (fast corners)',
      'Too much entry speed carried into the apex (driving)',
    ],
    telemetryIndicators: [
      'Rotation Model understeer in the MID_CORNER phase',
      'SteeringWheelAngle at the apex larger than on the fastest laps for the same Speed',
      'Front tire surface temperatures hotter than the rears, especially on the outside edge',
    ],
    adjustments: [
      { parameter: 'antiRollBarFront', direction: 'softer', effect: 'more front grip', tradeoff: 'slower response, more roll' },
      { parameter: 'antiRollBarRear', direction: 'stiffer', effect: 'more rotation mid-corner', tradeoff: 'less rear grip on exit' },
      { parameter: 'camber', direction: 'more negative front camber (check tire temperature spread)', effect: 'more front contact patch in the corner', tradeoff: 'less straight-line braking grip, more inner-edge wear' },
      { parameter: 'rearWing', direction: 'less rear wing (fast corners)', effect: 'moves aero balance forward', tradeoff: 'less high-speed rear stability' },
      { parameter: 'rideHeight', direction: 'lower front or raise rear (more rake), in small steps', effect: 'more front downforce in fast corners', tradeoff: 'risk of bottoming, rear less stable' },
    ],
    drivingCorrections: ['Slow the car a little more before the apex so the front tires are within their grip at the apex; a slower apex often gives a faster exit.'],
  }),
  rec({
    id: 'dx-mid-oversteer',
    title: 'Mid-corner oversteer',
    authority: 'general_principle',
    ...anyCar,
    components: ['antiRollBars', 'springs', 'aero', 'tires'],
    phases: ['mid'],
    symptoms: ['oversteer'],
    summary:
      'With neither pedal applied, the rear slides at the apex. In steady state the rear axle is reaching its limit ' +
      'first: too much rear roll stiffness, too little rear downforce, or rear tires out of their window.',
    causes: [
      'Rear roll stiffness too high relative to the front',
      'Aero balance too far forward (fast corners)',
      'Rear tires overheated or pressures too high',
      'Mid-corner lift of the throttle (driving)',
    ],
    telemetryIndicators: ['Rotation Model oversteer of type MID_CORNER', 'Small steering corrections at the apex', 'Rear tire surface temperatures above the fronts'],
    adjustments: [
      { parameter: 'antiRollBarRear', direction: 'softer', effect: 'more rear grip', tradeoff: 'less rotation' },
      { parameter: 'antiRollBarFront', direction: 'stiffer', effect: 'shifts balance toward understeer', tradeoff: 'less front grip in slow corners' },
      { parameter: 'rearWing', direction: 'more rear wing (fast corners)', effect: 'more rear downforce and stability', tradeoff: 'more drag, less top speed' },
      { parameter: 'tirePressure', direction: 'lower rear pressures if the rears run hotter than their window', effect: 'larger contact patch, cooler running', tradeoff: 'slower warm-up, more sidewall flex' },
    ],
    drivingCorrections: ['Hold a small, steady throttle through the apex instead of coasting; avoid lifting mid-corner.'],
  }),
  rec({
    id: 'dx-exit-understeer',
    title: 'Corner-exit (power-on) understeer',
    authority: 'general_principle',
    ...anyCar,
    components: ['differential', 'antiRollBars', 'springs', 'driving'],
    phases: ['exit'],
    symptoms: ['understeer'],
    summary:
      'On throttle the car runs wide and will not hold the line out of the corner. Accelerating moves load off the front ' +
      'tires; a differential that locks hard on power pushes the car straight. Often it is driving: too much throttle ' +
      'before the car has rotated.',
    causes: [
      'Throttle applied before the car has rotated (driving)',
      'Differential locking too much on power',
      'Front roll stiffness too high, limiting front grip as load moves rearward on throttle',
      'Front tires worn or overheated from entry understeer',
    ],
    telemetryIndicators: ['Throttle rising while SteeringWheelAngle is still increasing', 'Rotation Model understeer in the EXIT phase on throttle', 'Exit speed lower than the fastest runs with a wider line'],
    adjustments: [
      { parameter: 'diffRamps', direction: 'less power-side locking', effect: 'lets the car rotate on throttle', tradeoff: 'more inside-wheel spin, less traction in a straight line' },
      { parameter: 'diffPreload', direction: 'reduce', effect: 'more rotation at low throttle', tradeoff: 'less stability' },
      { parameter: 'antiRollBarFront', direction: 'softer', effect: 'more front grip on exit', tradeoff: 'slower response' },
    ],
    drivingCorrections: ['Finish the rotation first, then apply throttle progressively as you unwind the steering.'],
  }),
  rec({
    id: 'dx-exit-oversteer',
    title: 'Corner-exit (power-on) oversteer',
    authority: 'general_principle',
    ...anyCar,
    components: ['differential', 'tractionControl', 'antiRollBars', 'springs', 'dampers', 'driving'],
    phases: ['exit'],
    symptoms: ['oversteer', 'poorTraction'],
    summary:
      'The rear steps out, snaps loose or spins up when the throttle is applied. The rear tires are being asked for more drive and ' +
      'cornering force than they have: too much throttle too early with steering lock, too little rear grip, or a ' +
      'differential that lets the inside wheel spin and then locks suddenly.',
    causes: [
      'Throttle applied too early or too abruptly with steering lock still on (driving)',
      'Traction control set too low for the conditions (where the car has it)',
      'Rear roll stiffness too high (bars or springs) for the corner',
      'Differential behaviour on power not suited to the corner (too little or too sudden locking)',
      'Rear tires overheated or worn',
      'Short-shifting needed but not used in slow corners (driving)',
    ],
    telemetryIndicators: [
      'Rotation Model oversteer of type POWER_ON',
      'Throttle stepping from low to high quickly while SteeringWheelAngle is large',
      'Steering corrections (SteeringWheelAngle reversing) shortly after Throttle rises',
      'RPM rising faster than Speed (wheelspin) in low gears',
    ],
    adjustments: [
      { parameter: 'tractionControl', direction: 'more intervention a step', effect: 'controls wheelspin on exit', tradeoff: 'cuts power, can slow the exit if too high' },
      { parameter: 'antiRollBarRear', direction: 'softer', effect: 'more rear grip on exit', tradeoff: 'less rotation mid-corner' },
      { parameter: 'springs', direction: 'softer rear springs (open setup)', effect: 'more mechanical rear grip and traction', tradeoff: 'more pitch and squat, platform and ride height change' },
      { parameter: 'bumpDamping', direction: 'less rear bump (low speed)', effect: 'rear takes load more gently on throttle', tradeoff: 'more squat, can unsettle aero platform' },
      { parameter: 'diffRamps', direction: 'adjust power-side locking for progressive engagement', effect: 'smoother drive out of the corner', tradeoff: 'more locking adds exit understeer, less adds inside-wheel spin' },
    ],
    drivingCorrections: [
      'Squeeze the throttle progressively and match it to unwinding the steering.',
      'Use a higher gear in slow corners if the car spins its wheels.',
    ],
  }),
  rec({
    id: 'dx-braking-instability',
    title: 'Braking instability and brake locking',
    authority: 'general_principle',
    ...anyCar,
    components: ['braking', 'abs', 'differential', 'driving'],
    phases: ['braking'],
    symptoms: ['brakingInstability', 'brakeLocking', 'absIntervention'],
    summary:
      'The car moves around, pulls or wants to rotate under straight-line braking, or the wheels lock. Front locking ' +
      'gives understeer and flat spots; rear locking gives instability. With ABS, locking shows as ABS intervention ' +
      'instead, which lengthens braking if it is constant.',
    causes: [
      'Brake bias too far rearward (instability) or forward (front locking)',
      'Peak brake pressure too high for the grip (driving), or not reduced as speed and downforce fall',
      'Braking on a bumpy surface or over curbs',
      'Downshifting too early, locking the rear through engine braking',
      'Cold tires and brakes at the start of a stint',
    ],
    telemetryIndicators: [
      'ABSActive on for long stretches of each braking zone',
      'Sideslip or steering corrections in a straight line under Brake',
      'LongAccel lower (less deceleration) than on the fastest laps at the same Brake',
    ],
    adjustments: [
      { parameter: 'brakeBias', direction: 'forward for instability, rearward for front locking, small steps', effect: 'moves which axle locks first', tradeoff: 'forward adds entry understeer, rearward reduces stability' },
      { parameter: 'abs', direction: 'more intervention for locking, less if it intervenes constantly at normal pressure', effect: 'changes how early ABS cuts in', tradeoff: 'more ABS is safer but can lengthen braking' },
      { parameter: 'brakePressure', direction: 'lower if the driver cannot modulate at full pedal (open setup)', effect: 'finer control of the peak', tradeoff: 'needs more pedal force for the same braking' },
    ],
    drivingCorrections: [
      'Hit the peak pressure early while the car has the most speed and downforce, then bleed it off as the car slows.',
      'Keep the car straight while braking hard; only trail into the turn as pressure comes down.',
    ],
  }),
  rec({
    id: 'dx-abs-intervention',
    title: 'Excessive ABS intervention',
    authority: 'general_principle',
    ...anyCar,
    components: ['abs', 'braking', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['absIntervention'],
    summary:
      'ABS should catch the limit, not be ridden for the whole braking zone. Constant ABS means the pedal is past the ' +
      'grip available, so braking is no shorter and the front tires have nothing left for turning. It is mostly a ' +
      'driving issue; setup changes only shift where ABS starts.',
    causes: ['Peak pressure above what the tires can use (driving)', 'Not releasing pressure as speed and downforce fall (driving)', 'ABS setting too high an intervention for the car and tires', 'Brake bias far from where the car wants it'],
    telemetryIndicators: ['ABSActive true for most of the braking zone', 'Brake held at maximum through the whole zone with no release'],
    adjustments: [
      { parameter: 'abs', direction: 'one step less intervention', effect: 'lets the tires work closer to their peak', tradeoff: 'more risk of locking' },
      { parameter: 'brakeBias', direction: 'small step toward the axle that is not locking', effect: 'spreads the braking more evenly', tradeoff: 'changes entry balance' },
    ],
    drivingCorrections: ['Brake about as hard as the point where ABS just starts working, then trail off; you should feel ABS only briefly.'],
    constraints: ['ABSActive is only recorded where the simulator reports it; without it, ABS activity is inference.'],
  }),
  rec({
    id: 'dx-poor-traction',
    title: 'Poor traction and excessive traction-control intervention',
    authority: 'general_principle',
    ...anyCar,
    components: ['tractionControl', 'differential', 'springs', 'dampers', 'tires', 'driving'],
    phases: ['exit'],
    symptoms: ['poorTraction', 'tcIntervention'],
    summary:
      'The car will not put its power down out of slow corners: wheelspin, traction control cutting power, or the rear ' +
      'stepping out. The rear tires need load and a gentle torque build-up.',
    causes: ['Throttle applied too fast or too early (driving)', 'Rear springs or bump too stiff for the surface', 'Differential locking too abruptly on power', 'Rear tires overheated or worn', 'Traction control too low (spin) or too high (power cut)'],
    telemetryIndicators: ['RPM rising faster than Speed in low gears', 'Throttle oscillating (reapplications) on exit', 'Exit speed down on the fastest runs with similar entry'],
    adjustments: [
      { parameter: 'tractionControl', direction: 'one step more for wheelspin, one less if it cuts power with no spin', effect: 'trades wheelspin against power cut', tradeoff: 'too high slows the exit' },
      { parameter: 'springs', direction: 'softer rear (open setup)', effect: 'more traction', tradeoff: 'platform changes' },
      { parameter: 'diffRamps', direction: 'more progressive power locking', effect: 'smoother drive', tradeoff: 'see exit understeer/oversteer records' },
    ],
    drivingCorrections: ['Wait until the car points out of the corner, then roll the throttle on; short-shift in slow corners.'],
    constraints: ['Traction-control activity is not recorded in RacingCoach laps; infer it only from RPM against Speed and from the driver.'],
  }),
  rec({
    id: 'dx-bottoming-aero',
    title: 'Bottoming and aerodynamic instability',
    authority: 'general_principle',
    ...anyCar,
    components: ['aero', 'rideHeight', 'springs', 'dampers'],
    phases: ['straight', 'braking', 'mid'],
    symptoms: ['bottoming', 'aeroInstability'],
    summary:
      'At high speed or over bumps the floor or splitter touches the track, or the car reaches its bump stops, and ' +
      'downforce and grip drop suddenly. The car may feel nervous over crests and under heavy braking (pitch) in fast ' +
      'corners. Low ride height gives downforce until the floor is too close and the flow stalls.',
    causes: ['Ride height too low for the track\'s bumps and kerbs', 'Springs too soft for the downforce', 'Bump stops engaged too early', 'Too much pitch under braking (front dives)'],
    telemetryIndicators: [
      'Ride heights (LFrideHeight..RRrideHeight) reaching their lowest values and flattening at the bottom at high Speed or under Brake',
      'Sudden LatAccel or YawRate change at high speed with no input change',
    ],
    adjustments: [
      { parameter: 'rideHeight', direction: 'raise the end that bottoms, in small steps', effect: 'stops the floor touching', tradeoff: 'less downforce, changes aero balance' },
      { parameter: 'springs', direction: 'stiffer at the end that bottoms', effect: 'less travel at speed', tradeoff: 'less mechanical grip over bumps' },
      { parameter: 'bumpStops', direction: 'later engagement or softer stops where adjustable', effect: 'smoother when the suspension reaches them', tradeoff: 'more travel, possible floor contact' },
    ],
    constraints: ['Ride heights in the lap file come from the .ibt after the stint; live laps have none, so bottoming cannot be measured until positions are added.'],
  }),
  rec({
    id: 'dx-tire-overheating',
    title: 'Tire overheating and abnormal temperature spread',
    authority: 'general_principle',
    ...anyCar,
    components: ['tires', 'alignment'],
    phases: ['any'],
    symptoms: ['tireOverheating', 'tireWear'],
    summary:
      'An overheated tire loses grip progressively over a stint. The spread across the tread tells why: a hot inside ' +
      'edge suggests too much negative camber (or toe), a hot outside edge too little camber or too much sliding, a hot ' +
      'centre too high a pressure, cool centre too low. One axle running hotter than the other also shows which end ' +
      'is sliding more (the understeering or oversteering end).',
    causes: ['The tire sliding (balance problem at that end, or driving)', 'Pressures too high or too low', 'Camber or toe far from the tire\'s needs', 'Driving: repeated wheelspin, lock-ups or sliding'],
    telemetryIndicators: [
      'Surface temperatures (LFtempL/M/R..RRtempL/M/R) from the .ibt: edge-to-edge spread and front-to-rear difference',
      'Pressures (LFpressure..RRpressure) rising over the stint',
    ],
    adjustments: [
      { parameter: 'tirePressure', direction: 'lower if the centre is hottest, higher if the edges are hotter than the centre', effect: 'evens the contact patch', tradeoff: 'changes warm-up and response' },
      { parameter: 'camber', direction: 'less negative if the inside edge is much hotter, more if the outside is', effect: 'evens temperatures across the tread', tradeoff: 'affects braking and cornering grip in opposite ways' },
      { parameter: 'toe', direction: 'less toe (in or out) if the tire scrubs on the straights', effect: 'less heat and drag', tradeoff: 'changes turn-in (front) or stability (rear)' },
    ],
    constraints: ['Live laps carry carcass temperatures only from the pit stall; trust surface temperatures from the .ibt-enriched laps.'],
  }),
  rec({
    id: 'dx-cold-tires',
    title: 'Cold tires and brakes at the start of a stint',
    authority: 'general_principle',
    ...anyCar,
    components: ['tires', 'braking', 'driving'],
    phases: ['any'],
    symptoms: ['coldTires', 'understeer', 'oversteer', 'brakeLocking'],
    summary:
      'Out of the pits the tires and brakes are below their working temperature: less grip, earlier locking, and a car ' +
      'that may feel unbalanced. Setup changes made from the first laps of a stint chase a problem that disappears once ' +
      'the tires are warm.',
    causes: ['Out lap and first flying laps'],
    telemetryIndicators: ['Stint lap number', 'Surface temperatures well below later laps'],
    adjustments: [],
    drivingCorrections: ['Brake earlier and more gently for the first lap or two, then judge the balance once the tires are warm.'],
    constraints: ['Do not recommend setup changes from cold-tire laps alone.'],
  }),
  rec({
    id: 'dx-snap-oversteer',
    title: 'Snap oversteer',
    authority: 'general_principle',
    ...anyCar,
    components: ['vehicleDynamics', 'dampers', 'differential', 'driving'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['snapOversteer', 'oversteer'],
    summary:
      'A car that understeers and then suddenly oversteers: the driver adds steering while the front slides, the front ' +
      'regains grip, and the rear, now asked for more, lets go. Often caused by an understeer the driver fights rather ' +
      'than a loose car, so cure the understeer and the snap goes with it.',
    causes: ['Entry or mid-corner understeer fought with more steering (driving)', 'Lifting the throttle mid-corner', 'Abrupt differential lock-up'],
    telemetryIndicators: ['Understeer event followed within a second by an oversteer event in the same corner', 'Large SteeringWheelAngle then a quick reversal'],
    adjustments: [],
    drivingCorrections: ['When the front slides, unwind a little instead of adding lock, and keep the throttle steady.'],
  }),

  // ---------------------------------------------------------------- components
  rec({
    id: 'cmp-brake-bias',
    title: 'Brake bias',
    authority: 'general_principle',
    ...anyCar,
    components: ['braking'],
    phases: ['braking', 'entry'],
    symptoms: ['understeer', 'oversteer', 'brakingInstability', 'brakeLocking'],
    summary:
      'Brake bias sets the share of braking force at the front axle. Forward bias makes the car stable under braking ' +
      'but the fronts lock first and the car resists turning on the brakes; rearward bias helps rotation on entry and ' +
      'uses the rear tires more, but too far makes the rear lock and the car unstable. Because load moves forward as ' +
      'the car brakes harder, the ideal bias changes with speed, downforce, fuel load and tire wear. Adjust in small ' +
      'steps and re-test; it is usually adjustable from the cockpit, so it is the main tool on a fixed setup.',
    causes: [],
    telemetryIndicators: ['Which axle locks (ABSActive, sideslip under braking)', 'Entry balance on the brakes'],
    adjustments: [
      { parameter: 'brakeBias', direction: 'forward', effect: 'stability, front locks first', tradeoff: 'entry understeer' },
      { parameter: 'brakeBias', direction: 'rearward', effect: 'rotation on entry', tradeoff: 'less stability, rear locking' },
    ],
    constraints: ['In iRacing the in-car brake bias setting can be an offset from the garage value rather than a percentage, depending on the car.'],
  }),
  rec({
    id: 'cmp-trail-braking',
    title: 'Trail braking',
    authority: 'general_principle',
    ...anyCar,
    components: ['braking', 'driving'],
    phases: ['braking', 'entry'],
    symptoms: ['understeer'],
    summary:
      'Trail braking means releasing the brake progressively while turning in, so the front tires stay loaded and the ' +
      'grip released from braking goes into cornering. Released too early, the front unloads and the car understeers; ' +
      'held too hard, the fronts are overloaded and the car also understeers, or with rearward bias it oversteers.',
    causes: [],
    telemetryIndicators: ['Brake trace tapering down while SteeringWheelAngle rises', 'Brake at turn-in (brakeAtTurnInPct) compared with the fastest laps'],
    adjustments: [],
    drivingCorrections: ['Reduce brake pressure in step with adding steering; reach zero brake near the slowest point of the corner.'],
  }),
  rec({
    id: 'cmp-abs-tc',
    title: 'ABS and traction control settings',
    authority: 'general_principle',
    simulators: ['any'],
    carClasses: ['GT3', 'GT4', 'TCR'],
    components: ['abs', 'tractionControl'],
    phases: ['braking', 'exit'],
    symptoms: ['absIntervention', 'tcIntervention', 'poorTraction', 'brakeLocking'],
    summary:
      'Cars with driver aids let the driver choose how early ABS and traction control intervene, usually from the ' +
      'cockpit. More intervention is safer and easier on worn or cold tires; less lets a confident driver use more of ' +
      'the tire. The numbering direction (whether a higher number means more or less intervention) differs between cars ' +
      'and simulators, so always state the effect, not just "higher" or "lower".',
    causes: [],
    telemetryIndicators: ['ABSActive', 'Wheelspin from RPM against Speed'],
    adjustments: [
      { parameter: 'abs', direction: 'more intervention / less intervention', effect: 'earlier or later ABS', tradeoff: 'stability against braking distance' },
      { parameter: 'tractionControl', direction: 'more intervention / less intervention', effect: 'earlier or later power cut', tradeoff: 'wheelspin against exit speed' },
    ],
    constraints: ['Say "more intervention" or "less intervention" rather than a number, as the scale differs per car.'],
  }),
  rec({
    id: 'cmp-differential',
    title: 'Differential preload and locking (power and coast)',
    authority: 'general_principle',
    ...anyCar,
    components: ['differential'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer', 'poorTraction'],
    summary:
      'A limited-slip differential resists the rear wheels turning at different speeds. Preload sets a base locking ' +
      'that is always there; ramps (or clutch plates) add locking on power and on coast. More coast locking stabilises ' +
      'the car on entry but resists rotation (entry understeer); less helps rotation but can make the rear nervous. ' +
      'More power locking improves straight-line traction but pushes the car wide on exit; less lets it rotate but ' +
      'spins the inside wheel. Not every car exposes ramps, and some fixed setups lock the differential entirely.',
    causes: [],
    telemetryIndicators: ['Entry and exit balance phase by phase', 'Inside-wheel spin from RPM against Speed in slow corners'],
    adjustments: [
      { parameter: 'diffPreload', direction: 'more', effect: 'stability on entry and throttle', tradeoff: 'less rotation' },
      { parameter: 'diffPreload', direction: 'less', effect: 'more rotation at low torque', tradeoff: 'less stability' },
    ],
  }),
  rec({
    id: 'cmp-anti-roll-bars',
    title: 'Anti-roll bars',
    authority: 'general_principle',
    ...anyCar,
    components: ['antiRollBars', 'suspension'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer'],
    summary:
      'Anti-roll bars add roll stiffness to one axle without changing the stiffness in pitch or heave much. Stiffening ' +
      'one end makes that end take more of the lateral load transfer, so it loses grip relative to the other: a stiffer ' +
      'front bar adds understeer, a stiffer rear bar adds oversteer. They are the quickest balance tool on an open ' +
      'setup and affect slow corners most.',
    causes: [],
    telemetryIndicators: ['Balance through the mid-corner phase'],
    adjustments: [
      { parameter: 'antiRollBarFront', direction: 'softer for more front grip, stiffer for less', effect: 'moves balance', tradeoff: 'response and roll' },
      { parameter: 'antiRollBarRear', direction: 'stiffer for more rotation, softer for more rear grip', effect: 'moves balance', tradeoff: 'traction on exit' },
    ],
  }),
  rec({
    id: 'cmp-springs',
    title: 'Spring rates',
    authority: 'general_principle',
    ...anyCar,
    components: ['springs', 'suspension'],
    phases: ['any'],
    symptoms: ['understeer', 'oversteer', 'bottoming', 'poorTraction'],
    summary:
      'Springs carry the car\'s weight and downforce and set the ride height under load. Stiffer springs hold the aero ' +
      'platform steadier and respond faster but give less mechanical grip over bumps; softer springs give more grip ' +
      'and traction but more pitch and roll. Like bars, a stiffer end takes more of the lateral load transfer. In ' +
      'iRacing and ACC changing a spring also changes the ride height, which must be reset.',
    causes: [],
    telemetryIndicators: ['Ride height range over the lap', 'Balance in slow against fast corners'],
    adjustments: [
      { parameter: 'springs', direction: 'softer at the end that lacks grip', effect: 'more mechanical grip there', tradeoff: 'more movement, ride height changes' },
    ],
    constraints: ['After a spring change, re-check the ride heights.'],
  }),
  rec({
    id: 'cmp-dampers',
    title: 'Dampers: bump and rebound, low and high speed',
    authority: 'general_principle',
    ...anyCar,
    components: ['dampers', 'suspension'],
    phases: ['braking', 'entry', 'exit'],
    symptoms: ['understeer', 'oversteer', 'poorTraction', 'aeroInstability'],
    summary:
      'Dampers control how fast the suspension moves. Low-speed damping (slow shaft movement) governs the car\'s body ' +
      'motion as the driver brakes, turns and accelerates, so it shapes transient balance: on entry, front bump and rear ' +
      'rebound slow the load reaching the front; on exit, rear bump and front rebound slow it reaching the rear. ' +
      'High-speed damping governs bumps and kerbs. Too stiff and the car skips over bumps; too soft and it wallows and ' +
      'the aero platform moves.',
    causes: [],
    telemetryIndicators: ['Turn-in delay between steering and yaw rate', 'Rotation immediately after throttle'],
    adjustments: [
      { parameter: 'bumpDamping', direction: 'softer front bump for more turn-in bite; softer rear bump for traction', effect: 'faster load transfer to that end', tradeoff: 'more body movement' },
      { parameter: 'reboundDamping', direction: 'stiffer rear rebound for entry rotation; stiffer front rebound for exit stability', effect: 'holds load at the other end longer', tradeoff: 'can unload a tire over bumps' },
    ],
  }),
  rec({
    id: 'cmp-ride-height-rake',
    title: 'Ride height and rake',
    authority: 'general_principle',
    ...anyCar,
    components: ['rideHeight', 'aero'],
    phases: ['mid', 'straight'],
    symptoms: ['understeer', 'oversteer', 'bottoming', 'aeroInstability'],
    summary:
      'Ride height sets how close the floor is to the track. Lower gives more downforce and a lower centre of gravity ' +
      'until the floor touches or the flow stalls. Rake (rear higher than front) moves aero balance forward and makes ' +
      'the car more pitch-sensitive. Lowering the front or raising the rear gives more front grip in fast corners.',
    causes: [],
    telemetryIndicators: ['Ride heights at high Speed', 'Balance change between slow and fast corners'],
    adjustments: [
      { parameter: 'rideHeight', direction: 'more rake for front grip at speed, less for stability', effect: 'moves aero balance', tradeoff: 'pitch sensitivity, bottoming' },
    ],
  }),
  rec({
    id: 'cmp-alignment',
    title: 'Camber, caster and toe',
    authority: 'general_principle',
    ...anyCar,
    components: ['alignment'],
    phases: ['entry', 'mid'],
    symptoms: ['understeer', 'oversteer', 'tireOverheating', 'tireWear'],
    summary:
      'Negative camber tilts the top of the tire inward so it sits flatter when the car rolls, improving cornering grip ' +
      'at the cost of braking and traction grip. Caster adds self-aligning feel and dynamic camber when steering. Front ' +
      'toe-out sharpens turn-in; rear toe-in stabilises the rear. Toe in either direction scrubs and heats the tires on ' +
      'the straights. Judge camber by the temperature spread across the tread.',
    causes: [],
    telemetryIndicators: ['Tire surface temperature spread inside to outside'],
    adjustments: [
      { parameter: 'camber', direction: 'more or less negative, guided by temperature spread', effect: 'cornering against braking grip', tradeoff: 'wear' },
      { parameter: 'toe', direction: 'front toe-out for turn-in, rear toe-in for stability', effect: 'response and stability', tradeoff: 'drag and tire heat' },
      { parameter: 'caster', direction: 'more for feel and dynamic camber', effect: 'steering weight and camber gain', tradeoff: 'heavier steering' },
    ],
  }),
  rec({
    id: 'cmp-tire-pressures',
    title: 'Tire pressures',
    authority: 'general_principle',
    ...anyCar,
    components: ['tires'],
    phases: ['any'],
    symptoms: ['tireOverheating', 'understeer', 'oversteer', 'tireWear'],
    summary:
      'What matters is the hot pressure the tire reaches after a few laps, not the cold pressure set in the garage. ' +
      'Too high reduces the contact patch and grip and makes the tire skate; too low makes it squirm and overheat in ' +
      'the sidewall. Raising pressure at one end usually reduces grip at that end. The right hot pressure is specific ' +
      'to the tire and simulator: use the sim\'s or series\' guidance, not a general number.',
    causes: [],
    telemetryIndicators: ['LFpressure..RRpressure over a stint (from the .ibt)', 'Centre against edge surface temperatures'],
    adjustments: [{ parameter: 'tirePressure', direction: 'lower at the end that overheats or lacks grip from too high a hot pressure', effect: 'more contact patch', tradeoff: 'slower response, warm-up' }],
    constraints: ['Never give a target pressure number unless the knowledge base has a verified one for this car and simulator.'],
  }),
  rec({
    id: 'cmp-aero-balance',
    title: 'Aerodynamic balance, wing and drag',
    authority: 'general_principle',
    ...anyCar,
    components: ['aero'],
    phases: ['mid', 'straight'],
    symptoms: ['understeer', 'oversteer', 'aeroInstability'],
    summary:
      'Aero balance is the share of downforce on the front axle. More rear wing moves balance rearward (more high-speed ' +
      'stability, more high-speed understeer) and adds drag; less does the opposite. Balance also moves with ride height ' +
      'and pitch, so a car that is stable on a straight can change balance under braking as the nose dives.',
    causes: [],
    telemetryIndicators: ['Balance in fast corners only', 'Top Speed on straights against wing setting'],
    adjustments: [{ parameter: 'rearWing', direction: 'more for high-speed stability, less for top speed and high-speed rotation', effect: 'aero balance and drag', tradeoff: 'top speed against stability' }],
  }),

  // ---------------------------------------------------------------- class and simulator guidance
  rec({
    id: 'class-gt3-overview',
    title: 'GT3 cars: what shapes their handling',
    authority: 'car_class',
    simulators: ['any'],
    carClasses: ['GT3'],
    components: ['vehicleDynamics', 'aero', 'abs', 'tractionControl', 'braking'],
    phases: ['any'],
    symptoms: ['understeer', 'oversteer', 'absIntervention'],
    summary:
      'GT3 cars are heavy production-based cars with moderate downforce, ABS, traction control and a sequential gearbox, ' +
      'balanced by series rules (Balance of Performance). They respond strongly to brake bias, ABS and TC in the cockpit. ' +
      'ABS lets the driver brake hard, but riding it for the whole zone costs time and front grip. Engine layout ' +
      'differs (front-engined, mid-engined and rear-engined cars race together), which changes their natural balance on ' +
      'entry and exit, so advice that suits one car may not suit another.',
    causes: [],
    telemetryIndicators: ['ABSActive', 'Rotation Model events by phase'],
    adjustments: [],
    constraints: ['Balance of Performance can change power, weight and aero between seasons, so do not quote performance numbers.'],
  }),
  rec({
    id: 'sim-iracing-fixed-setup',
    title: 'iRacing fixed setups: what can still change',
    authority: 'simulator_specific',
    simulators: ['iracing'],
    carClasses: ['any'],
    components: ['braking', 'abs', 'tractionControl'],
    phases: ['any'],
    symptoms: ['understeer', 'oversteer', 'brakingInstability', 'poorTraction'],
    summary:
      'In an iRacing fixed-setup session the garage setup is locked: springs, dampers, bars, alignment, aero and ' +
      'differential cannot be changed. The driver can still use the in-car adjustments the car has (on GT3 cars brake ' +
      'bias, ABS and traction control, and on some cars more) and fuel. Balance problems on a fixed setup are therefore ' +
      'solved with in-car settings and driving technique.',
    causes: [],
    telemetryIndicators: ['Setup type from session info (DriverSetupLoadTypeName)', 'In-car brake bias (dcBrakeBias)'],
    adjustments: [],
    constraints: ['Never suggest a garage change in a fixed-setup session.'],
  }),
  rec({
    id: 'sim-iracing-brake-bias-offset',
    title: 'iRacing in-car brake bias readout',
    authority: 'simulator_specific',
    simulators: ['iracing'],
    carClasses: ['any'],
    components: ['braking'],
    phases: ['braking'],
    symptoms: ['brakingInstability', 'understeer', 'oversteer'],
    summary:
      'Depending on the car, iRacing reports the in-car brake bias either as the percentage to the front or as an ' +
      'offset from the garage value (for example small positive or negative numbers). Describe changes as "a step to the ' +
      'front" or "a step to the rear" unless the value is clearly a percentage.',
    causes: [],
    telemetryIndicators: ['dcBrakeBias'],
    adjustments: [],
  }),
  rec({
    id: 'sim-acc-setup-model',
    title: 'Assetto Corsa Competizione setups',
    authority: 'simulator_specific',
    simulators: ['acc'],
    carClasses: ['GT3', 'GT4'],
    components: ['tires', 'abs', 'tractionControl', 'braking', 'aero'],
    phases: ['any'],
    symptoms: ['understeer', 'oversteer', 'tireOverheating'],
    summary:
      'ACC models GT3 and GT4 cars with open setups in most sessions, and in-car adjustments of brake bias, ABS, TC ' +
      '(often two TC maps) and engine map. Its tire model is sensitive to hot pressure, so pressure is often the first ' +
      'thing to check when grip fades. Spring and bump stop changes alter ride height.',
    causes: [],
    telemetryIndicators: ['Tire pressures over a stint'],
    adjustments: [],
    constraints: ['ACC adjustment steps are per car; never quote click values.'],
  }),

  // ---------------------------------------------------------------- car characteristics (to confirm with telemetry)
  rec({
    id: 'car-porsche-911-gt3r-layout',
    title: 'Porsche 911 GT3 R: rear-engined layout',
    authority: 'hypothesis',
    simulators: ['any'],
    carClasses: ['GT3'],
    cars: ['porsche 911 gt3 r'],
    components: ['vehicleDynamics', 'braking', 'driving'],
    phases: ['braking', 'entry', 'exit'],
    symptoms: ['understeer', 'oversteer', 'poorTraction'],
    summary:
      'The 911 GT3 R has its engine behind the rear axle, so more of its weight sits on the rear wheels than in front- ' +
      'or mid-engined GT3 cars. Rear-engined cars usually brake and put power down well, and can feel light at the ' +
      'front in slow corners, needing the driver to keep weight on the nose with trail braking; lifting mid-corner can ' +
      'make the rear swing out. Treat this as a tendency to check against the driver\'s telemetry, not a diagnosis.',
    causes: ['Front unloading after an early brake release (entry/mid understeer)', 'Lift-off rotation from the rear weight'],
    telemetryIndicators: ['Entry understeer after early brake release', 'Oversteer following a mid-corner throttle lift'],
    adjustments: [],
    drivingCorrections: ['Trail the brake deeper into slow corners to keep the front loaded; avoid lifting mid-corner.'],
    constraints: ['A tendency of the layout, not a measured fact about the driver\'s car or setup.'],
  }),
  rec({
    id: 'car-ferrari-296-gt3-layout',
    title: 'Ferrari 296 GT3: mid-engined V6 layout',
    authority: 'hypothesis',
    simulators: ['any'],
    carClasses: ['GT3'],
    cars: ['ferrari 296 gt3'],
    components: ['vehicleDynamics'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer'],
    summary:
      'The Ferrari 296 GT3 is mid-engined (a V6 ahead of the rear axle), which keeps its mass near the centre: it ' +
      'usually changes direction quickly and rotates readily, and can be sensitive to how the rear is loaded on entry ' +
      'and exit. Treat this as a tendency to check against the telemetry, not a diagnosis.',
    causes: [],
    telemetryIndicators: ['Rotation Model events by phase'],
    adjustments: [],
    constraints: ['A tendency of the layout, not a measured fact about the driver\'s car or setup.'],
  }),
  rec({
    id: 'car-lamborghini-huracan-gt3-layout',
    title: 'Lamborghini Huracán GT3: mid-engined V10 layout',
    authority: 'hypothesis',
    simulators: ['any'],
    carClasses: ['GT3'],
    cars: ['lamborghini huracan gt3'],
    components: ['vehicleDynamics', 'braking'],
    phases: ['entry', 'mid', 'exit'],
    symptoms: ['understeer', 'oversteer'],
    summary:
      'The Huracán GT3 is mid-engined with a naturally aspirated V10 ahead of the rear axle. Mid-engined cars carry ' +
      'their mass near the centre and rotate readily; a common complaint in such cars is entry understeer when the ' +
      'driver releases the brake early, and power-on oversteer if the throttle comes in with lock on. Treat this as a ' +
      'tendency to check against the telemetry, not a diagnosis.',
    causes: [],
    telemetryIndicators: ['Brake at turn-in against the fastest laps', 'POWER_ON oversteer events'],
    adjustments: [],
    constraints: ['A tendency of the layout, not a measured fact about the driver\'s car or setup.'],
  }),
  // ---------------------------------------------------------------- wet weather (wetWeatherCorpus.ts)
  ...WET_WEATHER_CORPUS,
];
