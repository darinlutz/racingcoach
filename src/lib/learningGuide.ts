// "The Art of Driving a Race Car", the guide on the Learning page (src/app/learning/page.tsx), in each of the
// site's languages: English here, Spanish in learningGuideEs.ts, Portuguese in learningGuidePt.ts and German in learningGuideDe.ts. The page
// chrome around it is in the dictionaries' `learning`. Each chapter's figure is drawn by
// src/components/LearningFigures.tsx, with the labels in `figures`.

import type { Language } from '@/lib/i18n/languages';
import { DE } from '@/lib/learningGuideDe';
import { ES } from '@/lib/learningGuideEs';
import { PT } from '@/lib/learningGuidePt';

// `drill` and `error` sections are shown as callouts; `principle` as the closing quote
export type GuideSection = { heading: string; body: string; kind?: 'drill' | 'error' | 'principle' };

export type GuideChapter = {
  // The same in every language, as it's the chapter's link (/learning#<id>)
  id: string;
  title: string;
  // One line under the title, shown while the chapter is collapsed
  summary: string;
  figureTitle: string;
  sections: GuideSection[];
};

// The text inside the figures
export type FigureLabels = {
  front: string;
  rear: string;
  brakingLoad: string;
  acceleratingLoad: string;
  // Two lines
  corneringLoad: [string, string];
  accelerating: string;
  braking: string;
  turning: string;
  tireLimit: string;
  trailPath: string;
  progressThroughCorner: string;
  lateralPosition: string;
  geometricApex: string;
  geometricArc: string;
  laterApexPath: string;
  brakingZoneDistance: string;
  brakeCommand: string;
  plannedThreshold: string;
  lateAbrupt: string;
  cornerEntryProgression: string;
  normalizedInput: string;
  brakePressure: string;
  steeringDemand: string;
  illustrativeSpeed: string;
  entry: string;
  apex: string;
  exit: string;
  speed: string;
  distanceAfterCorner: string;
  speedKmh: string;
  driverA: string;
  driverB: string;
  cornerProgression: string;
  yawRate: string;
  referenceYaw: string;
  underRotation: string;
  overRotation: string;
  twoCornerProgress: string;
  balancedPath: string;
  alternativePath: string;
  normalizedCornerDistance: string;
  currentLap: string;
  referenceLap: string;
};

export type Guide = {
  title: string;
  subtitle: string;
  topics: string[];
  note: string;
  chapters: GuideChapter[];
  figures: FigureLabels;
};

const CHAPTERS: GuideChapter[] = [
  {
    id: 'race-car-dynamics',
    title: 'Understanding Race Car Dynamics',
    summary: 'Four contact patches, load transfer, and where grip comes from.',
    figureTitle: 'Load transfer changes tire loads, not total vehicle weight',
    sections: [
      {
        heading: 'The four contact patches',
        body: 'A race car interacts with the track through four relatively small tire contact patches. Every braking, accelerating, and cornering force ultimately passes through them. The driver does not create grip by moving the steering wheel or pressing a pedal; the driver requests forces that the tires may or may not be able to produce. Tire compound, temperature, pressure, track surface, and vertical load all influence the result.',
      },
      {
        heading: 'Load transfer',
        body: 'During braking, load transfers toward the front axle; under acceleration, toward the rear; in a corner, toward the outside tires. This is dynamic load transfer, not a literal movement of the car’s total mass. Greater load on a tire generally increases its absolute grip but usually less than proportionally, so large load transfers can reduce the sum of available grip. Smooth transitions make the car easier to control.',
      },
      {
        heading: 'Mechanical and aerodynamic grip',
        body: 'Mechanical grip comes from the tires, suspension, surface, and loading. Aerodynamic downforce increases vertical tire load with speed, usually making high-speed corners different from low-speed corners. A GT3 car may tolerate a larger steering or braking demand at speed, but downforce decreases as the car slows. Never assume that a technique effective in a fast bend will work identically in a hairpin.',
      },
      {
        heading: 'Driving application',
        body: 'Approach every corner with a clear sequence: brake while the car is stable, progressively introduce steering, balance the car near the apex, and progressively unwind the wheel while accelerating. Use a repeatable setup and consistent tire conditions before judging whether a handling problem is driver-induced or mechanical.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Drive five laps at a comfortable pace and focus exclusively on smooth transitions between braking, steering, and throttle. Review whether the car pitches or changes direction abruptly. Smoothness is not slowness: it is precise control of the rate at which tire forces change.',
      },
    ],
  },
  {
    id: 'traction-circle',
    title: 'The Traction Circle: Understanding Grip Limits',
    summary: 'Braking, accelerating and turning all share one finite force budget.',
    figureTitle: 'Traction circle: combined tire-force budget',
    sections: [
      {
        heading: 'A shared force budget',
        body: 'A tire can generate longitudinal force for braking or acceleration and lateral force for turning. These demands compete for a finite capacity. The traction circle is a useful conceptual model: if a tire is near maximum straight-line braking, very little additional lateral force is available. In practice, the boundary often resembles an ellipse and changes with load, speed, surface, and tire condition.',
      },
      {
        heading: 'Combining inputs',
        body: 'A driver entering a corner at maximum braking must reduce braking force as steering demand grows. At the apex, lateral demand may be high and throttle demand modest. On exit, the driver gradually reduces steering while adding throttle. This coordinated exchange of forces is the central skill of performance driving.',
      },
      {
        heading: 'What the diagram means',
        body: 'The figure uses normalized force axes; it is not a calibrated map for any particular tire. Points inside the boundary represent feasible combinations; points beyond it imply sliding, wheel lock, ABS activity, traction-control intervention, or some combination. The true available boundary differs at each wheel.',
      },
      {
        heading: 'Common error',
        kind: 'error',
        body: 'Beginners often ask for full brake pressure and a large steering angle simultaneously. Another common error is flooring the throttle before the steering wheel is sufficiently unwound. Both overload the tire-force budget. The cure is not necessarily a lower overall pace: it is better timing and blending.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'On a consistent medium-speed corner, brake firmly in a straight line, then deliberately taper pressure as steering increases. Repeat with a small, controlled overlap. Compare stability and minimum speed, not merely how late you can brake.',
      },
    ],
  },
  {
    id: 'racing-line',
    title: 'The Racing Line: Geometry and Speed',
    summary: 'Outside–inside–outside, reference points, and choosing the apex.',
    figureTitle: 'Different lines trade entry radius against exit position',
    sections: [
      {
        heading: 'Start with outside–inside–outside',
        body: 'Using the available track width can increase corner radius, reducing the lateral acceleration required at a given speed. The basic outside–inside–outside line is an effective starting point: approach wide, turn toward the apex, and allow the car to track outward on exit. The ideal path depends on the next corner, grip, traffic, curbing, and the car.',
      },
      {
        heading: 'Reference points',
        body: 'Choose a braking marker, turn-in point, apex reference, and exit target. A good reference is fixed and visible: a board, seam, curb beginning, or marshal post. Avoid shadows and temporary objects. Look toward the next reference before reaching the current one, rather than staring at the front bumper.',
      },
      {
        heading: 'Early and late apex',
        body: 'An early apex can force the car to run wide at exit and delay throttle. A later apex often sacrifices some entry speed to improve exit orientation and acceleration, especially before a long straight. Neither is universally faster. The geometric apex is simply a useful starting geometry, not a rule.',
      },
      {
        heading: 'Corner combinations',
        body: 'The fastest line through one corner may compromise the next. For a left-right sequence, it may be advantageous to exit the first corner on the side that prepares the second. Treat linked corners as a single optimization problem, with special attention to the final exit.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Select one corner and drive three repeatable lines: slightly early, neutral, and slightly late apex. Compare corner-segment time and speed 100–200 meters after the exit. Use legal track limits and make changes small enough to interpret.',
      },
    ],
  },
  {
    id: 'braking',
    title: 'Braking: Where Lap Time Is Won or Lost',
    summary: 'Threshold braking, the release, and how to measure a braking zone.',
    figureTitle: 'Illustrative brake pressure traces',
    sections: [
      {
        heading: 'Braking is a sequence',
        body: 'A high-quality braking zone includes initial pedal application, peak deceleration, controlled release, and transition into steering. The correct braking point depends on entry speed, gradient, tire grip, downforce, fuel, and the required corner entry speed. Braking later is only faster if the car still reaches the proper turn-in speed and position.',
      },
      {
        heading: 'Threshold braking',
        body: 'Threshold braking aims to use available longitudinal tire grip without uncontrolled lockup. Build pressure rapidly but progressively enough to avoid a destabilizing spike. As speed falls, aerodynamic load may decrease, changing the allowable pressure. In an ABS-equipped GT3 car, brief ABS intervention may occur; sustained heavy intervention can indicate excess demand or a poor pressure profile.',
      },
      {
        heading: 'Brake release matters',
        body: 'Abruptly releasing the pedal can change front loading and upset the transition to steering. A controlled release allows the car to rotate predictably. Many intermediate drivers gain more time by improving brake release than by moving their braking point several meters later.',
      },
      {
        heading: 'Measuring braking',
        body: 'Use brake pressure, speed, longitudinal acceleration, and distance. Compare where braking begins, peak pressure, how quickly speed drops, and where pressure reaches zero. A late braking point with a slow apex or compromised exit is not an improvement. Distinguish pedal position from actual brake pressure when analyzing telemetry.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Keep the braking marker fixed for five laps. Improve the pressure shape and release first. Then adjust the marker in small increments while checking apex placement and exit speed. Never experiment with maximum braking in traffic or an uncontrolled setting.',
      },
    ],
  },
  {
    id: 'trail-braking',
    title: 'Trail Braking: Controlling Corner Entry Rotation',
    summary: 'Trading brake pressure for steering to manage entry speed and rotation.',
    figureTitle: 'Trail braking: release brake as steering demand rises',
    sections: [
      {
        heading: 'Definition',
        body: 'Trail braking means carrying a decreasing amount of brake pressure beyond initial turn-in. Rather than ending braking before steering begins, the driver overlaps them while exchanging longitudinal tire demand for lateral demand. The technique can help manage entry speed and influence how readily the car rotates.',
      },
      {
        heading: 'Why it works',
        body: 'Deceleration changes tire loads and available forces. Retaining some brake pressure can maintain front loading while rear tires may have less lateral reserve, affecting yaw response. The exact effect depends on brake balance, differential behavior, tire characteristics, speed, and setup. Trail braking is not a guarantee of extra front grip or automatic rotation.',
      },
      {
        heading: 'The release profile',
        body: 'Start with a stable, mostly straight braking phase. As steering increases, taper brake pressure smoothly. Avoid holding full brake pressure deep into a tight turn. The goal is not a predetermined amount of overlap; it is a balanced, repeatable transition that lets the car follow the intended line.',
      },
      {
        heading: 'When not to force it',
        body: 'Very fast corners, bumps, crests, low-grip conditions, and unstable rear-end behavior may require earlier brake release or a more conservative approach. Some corners are best handled with straight-line braking followed by a clean turn-in. If the rear begins to rotate too quickly, reduce the combined demand and prioritize stabilizing the car.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'In a forgiving medium-speed corner, compare a clean straight-line release with a small amount of trailing pressure. Review brake and steering traces, minimum speed, yaw response, and exit quality. Change only one variable at a time.',
      },
    ],
  },
  {
    id: 'cornering',
    title: 'Cornering Technique: Entry, Apex, and Exit',
    summary: 'One continuous maneuver: establish the platform, balance, open the wheel.',
    figureTitle: 'Corner phases and the minimum-speed region',
    sections: [
      {
        heading: 'Entry: establish the platform',
        body: 'The entry begins before turn-in. The driver chooses a braking point, arrives at an appropriate speed, and positions the car to achieve a manageable radius. Looking ahead is essential: visual attention should progress from turn-in toward apex and then exit. Overdriving entry typically increases steering demand and can delay acceleration.',
      },
      {
        heading: 'Mid-corner: balance',
        body: 'Near the apex, steering and lateral acceleration are often substantial. A balanced car may require maintenance throttle, a gentle lift, or no throttle depending on corner and setup. The objective is not always to maximize minimum speed; it is to carry the speed that enables the best total segment time.',
      },
      {
        heading: 'Exit: open the wheel',
        body: 'As the car rotates toward the exit, begin reducing steering demand and progressively adding throttle. The tire-force budget permits more acceleration as lateral demand decreases. Track-out should be deliberate and predictable rather than a consequence of running out of front grip.',
      },
      {
        heading: 'A useful mental model',
        body: 'Think of the corner as one continuous maneuver rather than three disconnected actions. A late or abrupt brake release affects apex balance; apex position affects when the wheel can be unwound; that affects how early full power becomes available. The phases are labels for analysis, not abrupt control boundaries.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Identify four landmarks in a single corner: brake, turn, apex, exit. Make the car hit each landmark consistently before attempting to increase speed. Review video or telemetry for the first phase where an error appears.',
      },
    ],
  },
  {
    id: 'exit-speed',
    title: 'Exit Speed: Turning Good Corners Into Fast Laps',
    summary: 'Why an exit-speed advantage keeps paying all the way down the straight.',
    figureTitle: 'Exit speed advantage carries onto the straight',
    sections: [
      {
        heading: 'Why exits matter',
        body: 'An exit-speed advantage persists down the following straight and may create a time benefit far beyond the corner itself. A driver who reaches full throttle earlier with a better-oriented car can continue gaining distance. The effect is especially valuable before long straights, although the exact time gain depends on acceleration and drag.',
      },
      {
        heading: 'Earlier is not always better',
        body: 'The first instant of throttle application is not the same as effective acceleration. Applying throttle too early may cause wheelspin, traction-control intervention, power understeer, or a wider exit that forces a lift. The useful metric is how much acceleration is achieved while maintaining the desired line.',
      },
      {
        heading: 'Trade entry for exit',
        body: 'In a slow corner leading onto a long straight, a slightly slower entry or later apex may permit earlier steering unwind and stronger acceleration. A driver can lose a small amount of time on entry and gain more on exit. Validate this with segment time and speed traces rather than assuming a late apex always wins.',
      },
      {
        heading: 'Read the right metrics',
        body: 'Compare speed at a fixed exit marker, throttle progression, steering angle, and speed 100 or 200 meters later. When possible, compare the same gear, fuel load, tire state, and track conditions. Exit speed at one marker is more meaningful than an isolated peak-speed value.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Pick the slow corner before the longest straight. Make small changes to apex timing and throttle progression. Rank laps by time from turn-in to a fixed point well down the straight, not by apex speed alone.',
      },
    ],
  },
  {
    id: 'understeer-oversteer',
    title: 'Understeer and Oversteer: Understanding Rotation',
    summary: 'Recognizing imbalance by corner phase, and how to respond.',
    figureTitle: 'Yaw comparison requires speed, steering and context',
    sections: [
      {
        heading: 'Understeer',
        body: 'Understeer occurs when the car turns less than demanded: the front tires cannot provide sufficient lateral response relative to the rear. The car tends to run wider than intended. Causes can include excessive entry speed, abrupt steering, front tire saturation under braking, or early power application in some drivetrains.',
      },
      {
        heading: 'Oversteer',
        body: 'Oversteer occurs when the rear rotates more than intended relative to the front. It can result from abrupt lift-off, excessive trail braking, aggressive throttle, rear tire saturation, or a setup that promotes rotation. Mild, controlled rotation can be useful; a growing rear slip angle that requires substantial countersteer is usually slower and riskier.',
      },
      {
        heading: 'Corner phase is diagnostic',
        body: 'Entry understeer often points toward speed, braking, and turn-in. Mid-corner understeer may involve line, balance, or tire grip. Exit understeer may reflect throttle timing or insufficient steering unwind. Entry oversteer can arise from brake release or rear stability; power oversteer typically develops during acceleration. These are clues, not definitive diagnoses.',
      },
      {
        heading: 'Corrective actions',
        body: 'For understeer, avoid adding more steering once the front is saturated; reduce the demand and allow the tires to recover. For oversteer, respond promptly with appropriate countersteering and measured pedal inputs, avoiding abrupt corrections that trigger a pendulum effect. Real-car recovery should be practiced with qualified instruction in a controlled environment.',
      },
      {
        heading: 'Telemetry interpretation',
        body: 'Steering angle, speed, yaw rate, lateral acceleration, throttle, and brake help identify likely imbalance. A simplified reference yaw rate is speed divided by path radius, but radius is not known reliably from yaw alone. Comparing actual yaw against a steering- and speed-based vehicle model is useful only when calibrated for steering ratio, wheelbase, tire behavior, and sign conventions. A yaw-rate mismatch alone does not prove understeer or oversteer.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Review three corners with a driving coach or replay. Label each handling event by phase and probable trigger. Correlate the observation with pedal and steering traces before changing setup.',
      },
    ],
  },
  {
    id: 'connecting-corners',
    title: 'Connecting Corners: Optimizing a Sequence',
    summary: 'A lap is a sequence, not a collection of corner records.',
    figureTitle: 'Chicane: prioritize where the car ends up',
    sections: [
      {
        heading: 'Optimize the sequence',
        body: 'A lap is not a collection of independent corner records. The exit of one corner establishes the entry conditions of the next. In a chicane or series of esses, an aggressive first apex can leave the car poorly positioned for the final turn and the following straight.',
      },
      {
        heading: 'Prioritize the last exit',
        body: 'If the final corner leads onto a long straight, work backward from the ideal exit position and heading. That may require a conservative first turn, a shallower initial line, or an earlier steering transition. The correct compromise depends on spacing, speed, curb shape, and the car’s response.',
      },
      {
        heading: 'Direction changes',
        body: 'Fast transitions require precise load management. An abrupt left-right steering reversal can create a strong lateral load transfer and unsettle the rear. Smooth, purposeful steering and appropriate throttle balance keep the car stable while minimizing unnecessary distance.',
      },
      {
        heading: 'Traffic changes the answer',
        body: 'In racing, the fastest solo line may not be available. Defensive positioning, overtaking, and compromised entries require different priorities. Leave enough margin to adapt to other cars, especially when braking or turning side by side.',
      },
      {
        heading: 'Practice drill',
        kind: 'drill',
        body: 'Compare two lines through one two-corner complex. Record total time from the first braking marker to a point after the final exit. Ignore which individual corner feels faster; judge the complete sequence.',
      },
    ],
  },
  {
    id: 'practice-and-telemetry',
    title: 'Putting It Together: Practice and Telemetry',
    summary: 'Consistency first, then measure, change one thing, and repeat.',
    figureTitle: 'Overlay traces reveal where speed differences develop',
    sections: [
      {
        heading: 'Consistency before maximum attack',
        body: 'A driver cannot reliably identify improvements if lap-to-lap variation is larger than the technique change being tested. Begin with a stable baseline: same car, track configuration, tire conditions, and fuel assumptions where possible. Drive repeatable laps at a pace that leaves enough attention to observe what the car is doing.',
      },
      {
        heading: 'A useful telemetry hierarchy',
        body: 'Start with speed versus distance because it shows where time is lost. Then inspect brake pressure and release, throttle pickup and progression, steering demand, and available accelerations. Overlay comparable laps using distance alignment. A faster driver’s brake marker is not necessarily the right target if their line or corner entry speed differs.',
      },
      {
        heading: 'Measure complete outcomes',
        body: 'Useful corner metrics include entry speed, brake onset, peak brake pressure, brake-release distance, minimum speed, throttle pickup, full-throttle point, exit speed, and total segment time. Coasting distance and brake/throttle overlap can provide context, but neither is inherently bad: a brief coast or overlap may be appropriate for a particular car and corner.',
      },
      {
        heading: 'A repeatable improvement loop',
        body: 'Observe one recurring issue; form a hypothesis; choose a single input change; run several consistent laps; compare the complete corner and downstream straight; keep or reject the change. Avoid changing setup, braking marker, apex, and throttle strategy simultaneously because the result becomes hard to interpret.',
      },
      {
        heading: 'Four-session development plan',
        body: 'Session 1: learn references and repeat a stable line.\nSession 2: refine brake pressure and release.\nSession 3: improve apex placement and exit acceleration.\nSession 4: analyze telemetry and focus on the two corners with the greatest repeatable time loss.\nRepeat the cycle as track familiarity grows.',
      },
      {
        heading: 'Final principle',
        kind: 'principle',
        body: 'Speed is the result of using available grip efficiently, placing the car accurately, and making each control input serve the next phase of the lap. Drive with intent, measure the result, and change one thing at a time.',
      },
    ],
  },
];

const EN: Guide = {
  title: 'The Art of Driving a Race Car',
  subtitle: 'A practical, illustrated guide for beginner and intermediate drivers',
  topics: ['Vehicle dynamics', 'Racing line', 'Braking', 'Trail braking', 'Rotation', 'Telemetry'],
  note: 'Designed for closed-course motorsport and racing simulators, with GT3 examples. Techniques should be practiced progressively and under qualified supervision in real vehicles.',
  chapters: CHAPTERS,
  figures: {
    front: 'FRONT',
    rear: 'REAR',
    brakingLoad: 'Braking: load to the front',
    acceleratingLoad: 'Accelerating: load to the rear',
    corneringLoad: ['Cornering: load', 'to the outside tires'],
    accelerating: 'ACCELERATING',
    braking: 'BRAKING',
    turning: 'TURNING',
    tireLimit: 'Tire-force limit (normalized)',
    trailPath: 'Illustrative trail-braking path',
    progressThroughCorner: 'Progress through corner',
    lateralPosition: 'Lateral position (schematic)',
    geometricApex: 'Geometric apex',
    geometricArc: 'Geometric arc',
    laterApexPath: 'Later-apex path',
    brakingZoneDistance: 'Distance through braking zone (normalized)',
    brakeCommand: 'Brake command (%)',
    plannedThreshold: 'Planned threshold braking',
    lateAbrupt: 'Late, abrupt braking',
    cornerEntryProgression: 'Corner entry progression',
    normalizedInput: 'Normalized input',
    brakePressure: 'Brake pressure (%)',
    steeringDemand: 'Steering demand (relative)',
    illustrativeSpeed: 'Speed (illustrative km/h)',
    entry: 'Entry',
    apex: 'Apex',
    exit: 'Exit',
    speed: 'Speed',
    distanceAfterCorner: 'Distance after corner (m)',
    speedKmh: 'Speed (km/h)',
    driverA: 'Driver A: slower exit',
    driverB: 'Driver B: +5 km/h at exit',
    cornerProgression: 'Corner progression',
    yawRate: 'Yaw rate (schematic)',
    referenceYaw: 'Reference yaw response',
    underRotation: 'Under-rotation (possible understeer)',
    overRotation: 'Over-rotation (possible oversteer)',
    twoCornerProgress: 'Progress through two-corner complex',
    balancedPath: 'Balanced path prioritizing final exit',
    alternativePath: 'Alternative path',
    normalizedCornerDistance: 'Normalized corner distance',
    currentLap: 'Current lap',
    referenceLap: 'Reference lap',
  },
};

const GUIDES: Record<Language, Guide> = { en: EN, es: ES, pt: PT, de: DE };

export function getGuide(language: Language): Guide {
  return GUIDES[language];
}
