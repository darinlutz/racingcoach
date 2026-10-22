import { AIMessage } from '@langchain/core/messages';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { LAP_TIME_RULE } from './lapData';
import { planOptimalLap, segmentName, type OptimalLap } from './optimalLap';
import { shiftLimit, type LapShifting } from './shifting';
import { coachInstructionsRule } from './siteSettings';
import { formatSeconds } from './stintExport';
import {
  DEFAULT_UNITS,
  DISTANCE_NAME,
  DISTANCE_UNIT,
  distanceFromFeet,
  distanceFromMeters,
  roundBrakeChange,
  roundLineOffset,
  SPEED_UNIT,
  speedFromMph,
  type Units,
} from './units';
import { chatModel } from '@/lib/aiModels';

// Post-session debrief coach for the Debrief Coach tab. The browser measures every lap in every
// focus area (the CSVs are too big to send) and posts the numbers here; the agent digs through
// them with the tools below and returns the 1-3 things to fix next session.

// Braking, throttle, steering and driving line detail of one run (src/lib/areaInputs.ts has what each number means).
// Optional so sessions from before they were measured still validate.
const brakingSchema = z.object({
  rampSeconds: z.number().nullable(),
  trailSeconds: z.number().nullable(),
  releaseFeet: z.number().nullable(),
  throttleFeet: z.number().nullable(),
  brakeAtTurnInPct: z.number().nullable(),
  brakeSeconds: z.number(),
  coastSeconds: z.number(),
});
const throttleSchema = z.object({
  liftSeconds: z.number().nullable(),
  partialLiftPct: z.number().nullable(),
  pickupFeet: z.number().nullable(),
  pickupToFullSeconds: z.number().nullable(),
  reapplications: z.number(),
  worstDrop: z.object({ fromPct: z.number(), toPct: z.number() }).nullable(),
});
const steeringSchema = z.object({ maxDeg: z.number(), apexDeg: z.number(), reversals: z.number() });
const lineSchema = z.object({ offsetsM: z.array(z.number()).length(5), maxOffsetM: z.number(), maxOffsetAtPct: z.number() });

// Upshifts and rev limiter hits of one whole lap (src/lib/shifting.ts has what each number means); null when
// the lap file has no RPM or Gear column
const shiftingSchema = z.object({
  upshifts: z.array(z.object({ fromGear: z.number(), rpm: z.number(), feet: z.number().nullable() })).max(100),
  partThrottleUpshifts: z.number(),
  limiterHits: z.array(z.object({ gear: z.number(), rpm: z.number(), seconds: z.number(), beforeUpshift: z.boolean() })).max(100),
  maxRpm: z.number(),
});

// One lap through one focus area. brakeFeet is feet from the start/finish line (null = no braking)
const runSchema = z.object({
  lap: z.string().max(20),
  seconds: z.number(),
  brakeFeet: z.number().nullable(),
  maxBrakePct: z.number(),
  minSpeedMph: z.number(),
  exitSpeedMph: z.number(),
  braking: brakingSchema.optional(),
  throttle: throttleSchema.optional(),
  steering: steeringSchema.optional(),
  // null when the lap (or every lap) has no track positions in the area
  line: lineSchema.nullable().optional(),
});

export const debriefSessionSchema = z.object({
  track: z.string().max(200),
  car: z.string().max(200),
  laps: z
    .array(z.object({ id: z.string().max(20), lapTime: z.number(), shifting: shiftingSchema.nullable().optional() }))
    .min(2)
    .max(100),
  areas: z
    .array(
      z.object({
        name: z.string().max(100),
        range: z.string().max(20),
        brakepointTarget: z.number().nullable(),
        maxBrakeTarget: z.number().nullable(),
        // The lap every run's driving line is compared with: the fastest through the area with track positions
        lineReference: z.string().max(20).nullable().optional(),
        runs: z.array(runSchema).max(100),
      })
    )
    .min(1)
    .max(50),
  // Every lap's time through every part of the track (the focus areas and the stretches between them), for
  // assemble_optimal_lap (src/lib/optimalLap.ts). Only Debrief Coach sends them.
  segments: z
    .array(
      z.object({
        start: z.number().min(0).max(1),
        end: z.number().min(0).max(1),
        area: z.string().max(300).nullable(),
        next: z.string().max(100).nullable(),
        times: z.array(z.object({ lap: z.string().max(20), seconds: z.number() })).max(100),
      })
    )
    .max(120)
    .optional(),
});

export type DebriefSession = z.infer<typeof debriefSessionSchema>;
type DebriefArea = DebriefSession['areas'][number];
type DebriefRun = z.infer<typeof runSchema>;

// No headline here: "Fix this first" is built from fixes[0] so the two can never disagree
const debriefSchema = z.object({
  fixes: z
    .array(
      z.object({
        area: z.string().describe('Focus area name, exactly as in the data'),
        focus: z
          .enum(['Braking', 'Brake pressure', 'Trail braking', 'Throttle', 'Shifting', 'Steering', 'Driving line', 'Mid-corner speed', 'Corner exit', 'Consistency'])
          .describe(
            'What the fix changes: Braking for the brakepoint, Brake pressure for peak brake, Trail braking for how the ' +
              'brake is released into the corner, Throttle for how the throttle is lifted, where it goes back on ' +
              'and committing to full throttle, Shifting for upshift RPM (with "Shifting" as the area), Steering for wheel angle or corrections, Driving line for where the car ' +
              'is placed on the track, Mid-corner speed for minimum speed, Corner exit for exit speed, Consistency when ' +
              'no single input explains the time'
          ),
        timeGainSeconds: z.number().describe("Time available per lap: the area's average time lost to its best"),
        problem: z.string().describe('What you are doing wrong there, with the numbers that show it'),
        fix: z.string().describe('One concrete change to make in the car, with a number to aim for'),
        evidence: z.string().describe('How your fast runs differ from your slow runs in this area'),
      })
    )
    .describe('1 to 3 fixes, the most time available first'),
  keepDoing: z.array(z.string()).describe('1 to 3 short things you already do well, with numbers'),
  optimalLap: z
    .string()
    .describe(
      'One or two sentences on the theoretical lap from assemble_optimal_lap: how much faster it is than your best ' +
        'lap and where it gains the most, from which laps. Empty when it could not be assembled.'
    ),
});

type DebriefFixes = z.infer<typeof debriefSchema>;
export type Debrief = DebriefFixes & { headline: string };

function mean(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Sample standard deviation (n - 1); needs at least two values
function stdDev(values: number[]) {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1));
}

const fixed = (value: number | null, digits: number, unit = '') => (value === null ? 'n/a' : `${value.toFixed(digits)}${unit}`);
const avgOf = (values: number[], digits: number, unit: string) => (values.length === 0 ? 'n/a' : fixed(mean(values), digits, unit));
// Average of the laps that measured it (null or undefined = not measured on that lap)
const avgMeasured = (values: (number | null | undefined)[], digits: number, unit: string) =>
  avgOf(values.filter((v): v is number => typeof v === 'number'), digits, unit);
const brakeFeetOf = (runs: DebriefRun[]) => runs.flatMap((r) => (r.brakeFeet === null ? [] : [r.brakeFeet]));

// The session is always in feet and mph (line offsets in meters); the agent sees it in the user's units:
// feet and mph for Standard, meters and kph for Metric
type UnitFormat = ReturnType<typeof unitFormat>;
function unitFormat(units: Units) {
  return {
    // " ft" or " m", " mph" or " kph", "feet" or "meters"
    unit: ` ${DISTANCE_UNIT[units]}`,
    speed: ` ${SPEED_UNIT[units]}`,
    distanceName: DISTANCE_NAME[units],
    feet: (feet: number) => distanceFromFeet(feet, units),
    mph: (mph: number) => speedFromMph(mph, units),
    meters: (meters: number) => distanceFromMeters(meters, units),
    // A brakepoint change in feet -> the user's units, rounded as the coaches say it ("20 ft", "6 m")
    brakeChange: (feet: number) => `${roundBrakeChange(distanceFromFeet(feet, units), units)} ${DISTANCE_UNIT[units]}`,
    // A driving line offset in meters -> the user's units, as the coaches say it ("2 ft", "0.6 m")
    line: (meters: number) => `${roundLineOffset(distanceFromMeters(meters, units), units)} ${DISTANCE_UNIT[units]}`,
  };
}

function describeRun(run: DebriefRun, u: UnitFormat) {
  return (
    `[${run.lap}] ${run.seconds.toFixed(3)}s, ` +
    `${run.brakeFeet === null ? 'no braking' : `brake at ${u.feet(run.brakeFeet).toFixed(0)}${u.unit}`}, ` +
    `max brake ${run.maxBrakePct.toFixed(0)}%, min ${u.mph(run.minSpeedMph).toFixed(1)}${u.speed}, ` +
    `exit ${u.mph(run.exitSpeedMph).toFixed(1)}${u.speed}`
  );
}

// Average time lost to the area's best run
function timeLost(area: DebriefArea) {
  const times = area.runs.map((r) => r.seconds);
  return mean(times) - Math.min(...times);
}

// Laps this much slower than the session's median lap are treated as incident laps (spins, offs, out laps)
const INCIDENT_LAP_FACTOR = 1.1;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Incident laps would swamp the averages, so the area statistics leave them out
function cleanSession(session: DebriefSession) {
  const cutoff = median(session.laps.map((l) => l.lapTime)) * INCIDENT_LAP_FACTOR;
  const incidentLaps = session.laps.filter((l) => l.lapTime > cutoff);
  const cleanLaps = session.laps.filter((l) => l.lapTime <= cutoff);
  const isClean = (run: DebriefRun) => cleanLaps.some((l) => l.id === run.lap);
  const areas = session.areas
    .map((a) => ({ ...a, runs: a.runs.filter(isClean) }))
    .filter((a) => a.runs.length > 0);
  return { cutoff, incidentLaps, cleanLaps, areas };
}

// Fastest third against slowest third of an area's runs (at least one run each)
function fastSlow(area: DebriefArea) {
  const runs = [...area.runs].sort((a, b) => a.seconds - b.seconds);
  const k = Math.max(1, Math.floor(runs.length / 3));
  return { runs, k, fast: runs.slice(0, k), slow: runs.slice(-k) };
}

// Fast and slow runs braking within this many feet (3 m) of each other is treated as no difference
const BRAKE_DIFF_FEET = 10;

type BrakeDirection = { direction: 'later' | 'earlier'; diffFeet: number };

// Which way the fastest runs moved the brakepoint compared with the slowest, decided here rather than by
// the model so "later" and "earlier" can't get flipped. null when the data doesn't show a clear difference.
function brakeDirection(area: DebriefArea): BrakeDirection | null {
  const { fast, slow } = fastSlow(area);
  const fastFeet = brakeFeetOf(fast);
  const slowFeet = brakeFeetOf(slow);
  if (fastFeet.length === 0 || slowFeet.length === 0) return null;
  const diff = mean(fastFeet) - mean(slowFeet);
  if (Math.abs(diff) < BRAKE_DIFF_FEET) return null;
  return { direction: diff > 0 ? 'later' : 'earlier', diffFeet: Math.round(Math.abs(diff)) };
}

// How far apart the fast and slow brakepoints are, in the user's units: "30 ft" (to the nearest 5) or "9 m"
function brakeDiffText(brake: BrakeDirection, u: UnitFormat) {
  return u.brakeChange(brake.diffFeet);
}

// Which way the area turns, from the steering at its slowest point on most laps; null for a straight or a
// left-right (chicane) the median doesn't settle
const MIN_APEX_DEGREES = 5;
function turnDirection(area: DebriefArea): 'left' | 'right' | null {
  const apexes = area.runs.flatMap((r) => (r.steering ? [r.steering.apexDeg] : []));
  if (apexes.length === 0) return null;
  const middle = median(apexes);
  if (Math.abs(middle) < MIN_APEX_DEGREES) return null;
  return middle > 0 ? 'left' : 'right';
}

// Fast and slow runs picking up the throttle within this many feet (3 m) of each other is treated as no difference
const PICKUP_DIFF_FEET = 10;
// A lift from 90% to off slower than this is a slow release
const SLOW_LIFT_SECONDS = 0.15;

// Which way the fastest runs moved the throttle pickup compared with the slowest, decided here like
// brakeDirection. null when the data doesn't show a clear difference.
function pickupDirection(area: DebriefArea): { direction: 'later' | 'earlier'; diffFeet: number } | null {
  const { fast, slow } = fastSlow(area);
  const feetOf = (runs: DebriefRun[]) => runs.flatMap((r) => (typeof r.throttle?.pickupFeet === 'number' ? [r.throttle.pickupFeet] : []));
  const fastFeet = feetOf(fast);
  const slowFeet = feetOf(slow);
  if (fastFeet.length === 0 || slowFeet.length === 0) return null;
  const diff = mean(fastFeet) - mean(slowFeet);
  if (Math.abs(diff) < PICKUP_DIFF_FEET) return null;
  return { direction: diff > 0 ? 'later' : 'earlier', diffFeet: Math.round(Math.abs(diff)) };
}

// Full-throttle upshifts under this share of the rev limit are early; the ideal is just before the limit
const EARLY_SHIFT_SHARE = 0.95;
// Limiter hits under this share of the rev limit are top speed in top gear, not the limiter
const LIMITER_SHARE = 0.985;
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// Fast and slow runs' lines this close together are treated as the same line
const LINE_DIFF_METERS = 0.5;
const LINE_CHECKPOINTS = ['the start of the area (entry)', '25% through', 'the middle (50%)', '75% through', 'the end of the area (exit)'];

// Also used by the In-Car AI Coach (inCarCoach.ts), on the laps the collector has uploaded so far.
// The tools write distances and speeds in the user's units.
// carRpmLimit is the car's rev limit from the user's Car Data (null when it isn't there), for get_shifting_points.
export function createTools(session: DebriefSession, units: Units = DEFAULT_UNITS, carRpmLimit: number | null = null) {
  const u = unitFormat(units);
  // Feet that may not have been measured -> the user's units
  const feetIn = <T extends null | undefined>(feet: number | T): number | T => (typeof feet === 'number' ? u.feet(feet) : feet);
  const { cutoff, incidentLaps, cleanLaps, areas } = cleanSession(session);
  const findArea = (name: string) => areas.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  const areaNames = areas.map((a) => a.name).join(', ');

  const overview = tool(
    async () => {
      const times = cleanLaps.map((l) => l.lapTime);
      const laps = [...cleanLaps].sort((a, b) => a.lapTime - b.lapTime);
      return [
        incidentLaps.length > 0
          ? `Left out as incident laps (over ${formatSeconds(cutoff)}, 110% of the median lap): ` +
            `${incidentLaps.map((l) => `[${l.id}] ${formatSeconds(l.lapTime)}`).join(', ')}. All statistics below use the other laps.`
          : 'No incident laps were left out.',
        `${session.track}, ${session.car}. ${times.length} laps: best ${formatSeconds(Math.min(...times))}, ` +
          `avg ${formatSeconds(mean(times))}, worst ${formatSeconds(Math.max(...times))}, std dev ${fixed(stdDev(times), 3, 's')}.`,
        `Laps fastest to slowest: ${laps.map((l) => `[${l.id}] ${formatSeconds(l.lapTime)}`).join(', ')}`,
        '',
        'Focus areas, most average time lost first:',
        ...[...areas]
          .sort((a, b) => timeLost(b) - timeLost(a))
          .map((a) => {
            const times = a.runs.map((r) => r.seconds);
            return (
              `- ${a.name} (${a.range}): best ${Math.min(...times).toFixed(3)}s, avg lost to best ${timeLost(a).toFixed(3)}s, ` +
              `std dev ${fixed(stdDev(times), 3, 's')}, ${times.length} laps`
            );
          }),
      ].join('\n');
    },
    {
      name: 'get_session_overview',
      description: 'Lap times for the session and every focus area ranked by average time lost to its best. Call this first.',
      schema: z.object({}),
    }
  );

  const areaDetail = tool(
    async ({ area: name }: { area: string }) => {
      const area = findArea(name);
      if (!area) return `No focus area named "${name}". Focus areas: ${areaNames}`;

      const { runs, k, fast, slow } = fastSlow(area);
      const split = (label: string, pick: (r: DebriefRun[]) => string) => `${label} ${pick(fast)} vs ${pick(slow)}`;

      const lines = [
        `${area.name} (${area.range}). Target Lap brakepoint ` +
          `${area.brakepointTarget === null ? 'n/a' : `${u.feet(area.brakepointTarget).toFixed(0)}${u.unit}`}, ` +
          `Target Lap max brake ${area.maxBrakeTarget === null ? 'n/a' : `${area.maxBrakeTarget}%`}. ` +
          `Brakepoints are ${u.distanceName} from the start/finish line, so more ${u.distanceName} means braking later.`,
        'Per lap, fastest first:',
        ...runs.map((run) => describeRun(run, u)),
        '',
        `Fastest ${k} vs slowest ${k} runs (averages): ` +
          [
            split('time', (r) => avgOf(r.map((x) => x.seconds), 3, 's')),
            split('brakepoint', (r) => avgOf(brakeFeetOf(r).map(u.feet), 0, u.unit)),
            split('max brake', (r) => avgOf(r.map((x) => x.maxBrakePct), 0, '%')),
            split('min speed', (r) => avgOf(r.map((x) => u.mph(x.minSpeedMph)), 1, u.speed)),
            split('exit speed', (r) => avgOf(r.map((x) => u.mph(x.exitSpeedMph)), 1, u.speed)),
          ].join('; ') +
          '.',
      ];

      const brake = brakeDirection(area);
      lines.push(
        brake
          ? `Brakepoint verdict: your fastest runs braked ${brakeDiffText(brake, u)} ${brake.direction.toUpperCase()} than your ` +
              `slowest. Any brakepoint fix for this area must say brake about ${brakeDiffText(brake, u)} ` +
              `${brake.direction.toUpperCase()}, never where on the track to brake.`
          : `Brakepoint verdict: your fast and slow runs brake within ${u.feet(BRAKE_DIFF_FEET).toFixed(0)}${u.unit} of each other here, so the ` +
              'brakepoint does not explain the time. Do not give a brakepoint fix for this area.'
      );

      const brakes = brakeFeetOf(runs);
      if (area.brakepointTarget !== null && brakes.length > 0) {
        const target = area.brakepointTarget;
        const early = brakes.filter((ft) => ft < target);
        const late = brakes.filter((ft) => ft > target);
        lines.push(
          `Against the Target Lap's brakepoint: early on ${early.length} of ${brakes.length} laps` +
            `${early.length > 0 ? ` (avg ${u.brakeChange(target - mean(early))} early)` : ''}, late on ${late.length}` +
            `${late.length > 0 ? ` (avg ${u.brakeChange(mean(late) - target)} late)` : ''}. ` +
            'The Target Lap is only a reference: when it disagrees with the brakepoint verdict, follow the verdict.'
        );
      }
      if (area.maxBrakeTarget !== null) {
        const target = area.maxBrakeTarget;
        const under = runs.filter((r) => r.maxBrakePct < target - 2);
        lines.push(`Against the Target Lap's max brake: more than 2% under it on ${under.length} of ${runs.length} laps.`);
      }
      return lines.join('\n');
    },
    {
      name: 'get_area_detail',
      description:
        'Every lap through one focus area (time, brakepoint, max brake, min and exit speed), how the fastest runs ' +
        'differ from the slowest, and how the laps compare with the Target Lap. Use it to find what costs time in an area.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  const compareLap = tool(
    async ({ lap }: { lap: string }) => {
      const id = lap.replace(/[[\]]/g, '').trim().toLowerCase();
      const match = session.laps.find((l) => l.id.toLowerCase() === id);
      if (!match) return `No lap with ID "${lap}". Lap IDs: ${session.laps.map((l) => l.id).join(', ')}`;

      // The lap's own run comes from all laps (it may be an incident lap); the area best from the clean laps
      const rows = areas.flatMap((area) => {
        const run = session.areas.find((a) => a.name === area.name)?.runs.find((r) => r.lap === match.id);
        if (!run) return [];
        const best = area.runs.reduce((a, b) => (b.seconds < a.seconds ? b : a));
        return [{ delta: run.seconds - best.seconds, text: `${area.name}: ${describeRun(run, u)} | area best ${describeRun(best, u)}` }];
      });
      rows.sort((a, b) => b.delta - a.delta);
      const total = rows.reduce((sum, r) => sum + r.delta, 0);
      return [
        `Lap [${match.id}] ${formatSeconds(match.lapTime)}${match.lapTime > cutoff ? ' (an incident lap)' : ''}. Time lost to the best run in each focus area, most first ` +
          `(${total.toFixed(3)}s in total):`,
        ...rows.map((r) => `+${r.delta.toFixed(3)}s ${r.text}`),
      ].join('\n');
    },
    {
      name: 'compare_lap_to_best',
      description:
        'Where one lap lost time: each focus area of that lap against the best run through the area. Use it on ' +
        'slow laps to look for a pattern.',
      schema: z.object({ lap: z.string().describe('Lap ID from the overview, e.g. "ab12"') }),
    }
  );

  const brakingDetail = tool(
    async ({ area: name }: { area: string }) => {
      const area = findArea(name);
      if (!area) return `No focus area named "${name}". Focus areas: ${areaNames}`;
      const { runs, k, fast, slow } = fastSlow(area);
      if (!runs.some((r) => r.braking)) return `Braking detail was not measured for ${area.name} in this session.`;

      const describe = (run: DebriefRun) => {
        const d = run.braking;
        if (!d) return `[${run.lap}] ${run.seconds.toFixed(3)}s: not measured`;
        return (
          `[${run.lap}] ${run.seconds.toFixed(3)}s: ` +
          [
            run.brakeFeet === null ? 'no braking' : `brake at ${u.feet(run.brakeFeet).toFixed(0)}${u.unit}`,
            `${fixed(d.rampSeconds, 2, 's')} to peak ${run.maxBrakePct.toFixed(0)}%`,
            `${fixed(d.trailSeconds, 2, 's')} from peak to release`,
            `released at ${fixed(feetIn(d.releaseFeet), 0, u.unit)}`,
            d.brakeAtTurnInPct === null ? 'no turn-in' : `${d.brakeAtTurnInPct}% brake at turn-in`,
            `${d.brakeSeconds.toFixed(2)}s on the brake`,
            `${d.coastSeconds.toFixed(2)}s coasting`,
            `throttle back at ${fixed(feetIn(d.throttleFeet), 0, u.unit)}`,
          ].join(', ')
        );
      };
      const split = (label: string, pick: (r: DebriefRun) => number | null | undefined, digits: number, unit: string) =>
        `${label} ${avgMeasured(fast.map(pick), digits, unit)} vs ${avgMeasured(slow.map(pick), digits, unit)}`;

      return [
        `${area.name} (${area.range}) braking. ${u.distanceName[0].toUpperCase()}${u.distanceName.slice(1)} are from ` +
          `the start/finish line (more ${u.distanceName} = later). "To peak" is ` +
          'how long the brake took to reach its highest pressure; "peak to release" is how long it was trailed off ' +
          'into the corner; "at turn-in" is the brake pressure when the steering reached half its largest angle; ' +
          'coasting is off the brake with under 10% throttle.',
        'Per lap, fastest first:',
        ...runs.map(describe),
        '',
        `Fastest ${k} vs slowest ${k} runs (averages): ` +
          [
            split('time to peak', (r) => r.braking?.rampSeconds, 2, 's'),
            split('peak to release', (r) => r.braking?.trailSeconds, 2, 's'),
            split('release point', (r) => feetIn(r.braking?.releaseFeet), 0, u.unit),
            split('brake at turn-in', (r) => r.braking?.brakeAtTurnInPct, 0, '%'),
            split('time on the brake', (r) => r.braking?.brakeSeconds, 2, 's'),
            split('coasting', (r) => r.braking?.coastSeconds, 2, 's'),
            split('throttle back', (r) => feetIn(r.braking?.throttleFeet), 0, u.unit),
          ].join('; ') +
          '.',
      ].join('\n');
    },
    {
      name: 'get_braking_detail',
      description:
        'How each lap used the brake through one focus area: time to peak pressure, trail braking (peak to release), ' +
        'release point, brake still on at turn-in, time on the brake, coasting and throttle pickup, with the fastest ' +
        'runs against the slowest. Use it when braking looks like where the time goes.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  const throttleDetail = tool(
    async ({ area: name }: { area: string }) => {
      const area = findArea(name);
      if (!area) return `No focus area named "${name}". Focus areas: ${areaNames}`;
      const { runs, k, fast, slow } = fastSlow(area);
      if (!runs.some((r) => r.throttle)) return `Throttle detail was not measured for ${area.name} in this session.`;

      const describe = (run: DebriefRun) => {
        const d = run.throttle;
        if (!d) return `[${run.lap}] ${run.seconds.toFixed(3)}s: not measured`;
        const lift =
          d.liftSeconds !== null
            ? `lifted in ${d.liftSeconds.toFixed(2)}s${d.liftSeconds > SLOW_LIFT_SECONDS ? ' (slow)' : ''}`
            : d.partialLiftPct !== null
              ? `partial lift to ${d.partialLiftPct}%`
              : 'no lift measured';
        return (
          `[${run.lap}] ${run.seconds.toFixed(3)}s: ` +
          [
            lift,
            d.pickupFeet === null ? 'no pickup in the area' : `throttle on at ${u.feet(d.pickupFeet).toFixed(0)}${u.unit}`,
            d.pickupFeet === null ? null : d.pickupToFullSeconds === null ? 'never full throttle in the area' : `${d.pickupToFullSeconds.toFixed(2)}s to full throttle`,
            d.reapplications === 0
              ? d.pickupFeet === null ? null : 'committed (no re-application)'
              : `${d.reapplications} re-application${d.reapplications === 1 ? '' : 's'}` +
                (d.worstDrop ? ` (worst: cut from ${d.worstDrop.fromPct}% to ${d.worstDrop.toPct}%, then on again)` : ''),
          ]
            .filter((part) => part !== null)
            .join(', ')
        );
      };
      const split = (label: string, pick: (r: DebriefRun) => number | null | undefined, digits: number, unit: string) =>
        `${label} ${avgMeasured(fast.map(pick), digits, unit)} vs ${avgMeasured(slow.map(pick), digits, unit)}`;

      const lines = [
        `${area.name} (${area.range}) throttle. Lift time is how long the throttle took from 90% to off (under 10%): ` +
          `a committed lift is quick, under ${SLOW_LIFT_SECONDS.toFixed(2)}s, and a slower one is marked slow. A partial lift ` +
          `went back to 90% without getting off the throttle. "Throttle on" is where the throttle went back on (10%) ` +
          `after being off, in ${u.distanceName} from the start/finish line (more ${u.distanceName} = later). A re-application is the ` +
          'throttle cut back by 15% or more after the pickup and then pressed again. The ideal: once you commit to the ' +
          'throttle, go to 100% and do not come back off it.',
        'Per lap, fastest first:',
        ...runs.map(describe),
        '',
        `Fastest ${k} vs slowest ${k} runs (averages): ` +
          [
            split('lift time', (r) => r.throttle?.liftSeconds, 2, 's'),
            split('throttle on', (r) => feetIn(r.throttle?.pickupFeet), 0, u.unit),
            split('time to full throttle', (r) => r.throttle?.pickupToFullSeconds, 2, 's'),
            split('re-applications', (r) => r.throttle?.reapplications, 1, ''),
          ].join('; ') +
          '.',
      ];

      const pickup = pickupDirection(area);
      const pickupText = pickup ? `${Math.round(u.feet(pickup.diffFeet))}${u.unit}` : '';
      lines.push(
        pickup
          ? `Throttle pickup verdict: your fastest runs put the throttle on ${pickupText} ${pickup.direction.toUpperCase()} than your ` +
              `slowest. Any pickup fix for this area must say throttle on about ${pickupText} ${pickup.direction.toUpperCase()}, ` +
              'never where on the track.'
          : `Throttle pickup verdict: your fast and slow runs put the throttle on within ${u.feet(PICKUP_DIFF_FEET).toFixed(0)}${u.unit} of ` +
              'each other here (or it was not measured), so the pickup point does not explain the time. Do not give a pickup fix for this area.'
      );

      const lifts = runs.flatMap((r) => (typeof r.throttle?.liftSeconds === 'number' ? [r.throttle.liftSeconds] : []));
      if (lifts.length > 0) {
        const slowLifts = lifts.filter((s) => s > SLOW_LIFT_SECONDS).length;
        lines.push(
          `Lift: slow (over ${SLOW_LIFT_SECONDS.toFixed(2)}s) on ${slowLifts} of ${lifts.length} laps. Only call a slow lift a problem ` +
            'when your fastest runs lift quicker than your slowest; a gradual lift can be deliberate to settle the car in a fast corner.'
        );
      }
      const measured = runs.filter((r) => r.throttle && r.throttle.pickupFeet !== null);
      if (measured.length > 0) {
        const reapplied = measured.filter((r) => r.throttle!.reapplications > 0);
        lines.push(
          `Commitment: re-applied the throttle on ${reapplied.length} of ${measured.length} laps` +
            (reapplied.length > 0 ? ` (${reapplied.map((r) => `[${r.lap}]`).join(', ')})` : '') +
            '. Each re-application means you got on the gas too early or too hard for the grip and had to back out; ' +
            'a later, committed pickup that goes straight to 100% is the goal.'
        );
      }
      return lines.join('\n');
    },
    {
      name: 'get_throttle_detail',
      description:
        'How each lap used the throttle through one focus area: how quickly it was lifted (90% to off), partial ' +
        'lifts, where it went back on, time from there to full throttle, and re-applications (getting on the gas, ' +
        'backing out, then on again), with the fastest runs against the slowest and a pickup verdict. Use it when ' +
        'corner entry or exit looks like where the time goes.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  const shiftingPoints = tool(
    async () => {
      const laps = [...cleanLaps].sort((a, b) => a.lapTime - b.lapTime).filter((l) => l.shifting);
      const limit = shiftLimit(
        laps.map((l) => l.shifting),
        carRpmLimit
      );
      if (laps.length === 0 || !limit) {
        return 'RPM and gear were not recorded in these laps, so shifting cannot be analysed. Do not give a shifting fix.';
      }

      const rpm = (value: number) => `${Math.round(value).toLocaleString('en-US')} rpm`;
      const share = (value: number) => `${Math.round((value / limit.rpm) * 100)}%`;
      const canJudgeEarly = limit.source !== 'highest';
      const isEarly = (value: number) => canJudgeEarly && value < limit.rpm * EARLY_SHIFT_SHARE;
      const redlines = (shifting: LapShifting) => shifting.limiterHits.filter((hit) => hit.rpm >= limit.rpm * LIMITER_SHARE);
      const shiftingOf = (lap: (typeof laps)[number]) => lap.shifting!;

      const describe = (lap: (typeof laps)[number]) => {
        const shifting = shiftingOf(lap);
        const shifts = shifting.upshifts.map(
          (shift) => `${shift.fromGear}→${shift.fromGear + 1} ${rpm(shift.rpm)} (${share(shift.rpm)}${isEarly(shift.rpm) ? ', early' : ''})`
        );
        const hits = redlines(shifting).map(
          (hit) =>
            `on the limiter ${hit.seconds.toFixed(2)}s in ${ordinal(hit.gear)} gear` +
            (hit.beforeUpshift ? ' before shifting up' : ' (no upshift after it)')
        );
        return (
          `[${lap.id}] ${formatSeconds(lap.lapTime)}: ${shifts.length > 0 ? shifts.join(', ') : 'no full-throttle upshifts'}` +
          (hits.length > 0 ? `; ${hits.join(', ')}` : '; never on the limiter') +
          (shifting.partThrottleUpshifts > 0 ? `; ${shifting.partThrottleUpshifts} part-throttle upshift(s) left out` : '')
        );
      };

      // Each gear's upshifts over every lap
      const byGear = new Map<number, number[]>();
      for (const lap of laps) {
        for (const shift of shiftingOf(lap).upshifts) byGear.set(shift.fromGear, [...(byGear.get(shift.fromGear) ?? []), shift.rpm]);
      }
      const hits = laps.flatMap((lap) => redlines(shiftingOf(lap)));
      const gearLines = [...byGear.entries()]
        .sort(([a], [b]) => a - b)
        .map(([gear, rpms]) => {
          const limiterBefore = hits.filter((hit) => hit.beforeUpshift && hit.gear === gear).length;
          return (
            `- ${gear}→${gear + 1}: ${rpms.length} shifts, avg ${rpm(mean(rpms))} (${share(mean(rpms))} of the limit), ` +
            `lowest ${rpm(Math.min(...rpms))}, highest ${rpm(Math.max(...rpms))}` +
            (canJudgeEarly ? `, early on ${rpms.filter(isEarly).length}` : '') +
            `, held the limiter before it ${limiterBefore} time${limiterBefore === 1 ? '' : 's'}`
          );
        });

      const all = laps.flatMap((lap) => shiftingOf(lap).upshifts.map((shift) => shift.rpm));
      const early = all.filter(isEarly);
      const k = Math.max(1, Math.floor(laps.length / 3));
      const fast = laps.slice(0, k);
      const slow = laps.slice(-k);
      const avgShare = (group: typeof laps) => {
        const rpms = group.flatMap((lap) => shiftingOf(lap).upshifts.map((shift) => shift.rpm));
        return rpms.length === 0 ? 'n/a' : share(mean(rpms));
      };
      const limiterSeconds = (group: typeof laps) =>
        `${mean(group.map((lap) => redlines(shiftingOf(lap)).reduce((sum, hit) => sum + hit.seconds, 0))).toFixed(2)}s`;
      const earlyPct = Math.round(EARLY_SHIFT_SHARE * 100);

      const verdicts: string[] = [];
      if (!canJudgeEarly) {
        verdicts.push(
          `Early shift verdict: the rev limit of the ${session.car} is not in your Car Data and these laps never held the ` +
            'limiter before shifting, so the limit is only the highest RPM reached. Early shifts cannot be judged; do not ' +
            'give an early-shift fix.'
        );
      } else if (early.length > 0) {
        verdicts.push(
          `Early shift verdict: ${early.length} of ${all.length} full-throttle upshifts were under ${earlyPct}% of the limit, ` +
            `on average ${rpm(limit.rpm - mean(early))} short of it. Shifting early drops the engine out of its strongest ` +
            `range: hold each gear until just before the limit, about ${rpm(Math.round((limit.rpm * 0.97) / 50) * 50)}.`
        );
      } else {
        verdicts.push(`Early shift verdict: every full-throttle upshift was at ${earlyPct}% of the limit or more. Do not give an early-shift fix.`);
      }
      const beforeShift = hits.filter((hit) => hit.beforeUpshift);
      const redlineLaps = laps.filter((lap) => redlines(shiftingOf(lap)).some((hit) => hit.beforeUpshift)).length;
      verdicts.push(
        beforeShift.length > 0
          ? `Redline verdict: you held the rev limiter before shifting up ${beforeShift.length} time${beforeShift.length === 1 ? '' : 's'} ` +
              `(${beforeShift.reduce((sum, hit) => sum + hit.seconds, 0).toFixed(2)}s in total, on ${redlineLaps} of ${laps.length} laps). ` +
              'On the limiter the car stops accelerating: that is shifting too late. Shift just before the limit.'
          : 'Redline verdict: you never held the rev limiter before shifting up. Do not give a late-shift fix.'
      );
      const noUpshift = hits.length - beforeShift.length;
      if (noUpshift > 0) {
        verdicts.push(
          `On the limiter without shifting up after it ${noUpshift} time${noUpshift === 1 ? '' : 's'} (top gear running out, ` +
            'or lifting while on the limiter): that is gearing, not a shift point, unless a higher gear was available.'
        );
      }

      const source =
        limit.source === 'limiter'
          ? 'where these laps held the rev limiter'
          : limit.source === 'carData'
            ? 'the rpm limit in your Car Data'
            : 'the highest RPM reached, as the limit is not known for this car';
      return [
        `Shifting in the ${session.car}, over the whole lap. Rev limit ${rpm(limit.rpm)} (${source}). The ideal upshift ` +
          `is just before the limit, at peak RPM: under ${earlyPct}% of it is early (not using the engine's full range), ` +
          'and holding the limiter (full throttle, RPM pinned, the car no longer gaining speed) is too late. Only ' +
          'full-throttle upshifts are judged. Shifting is not measured by focus area: a Shifting fix uses "Shifting" as ' +
          'the area, and for timeGainSeconds the lap time difference below only when your fastest and slowest laps shift ' +
          'differently, otherwise 0.',
        'Per lap, fastest first:',
        ...laps.map(describe),
        '',
        'Per gear:',
        ...gearLines,
        '',
        `Fastest ${k} vs slowest ${k} laps (averages): ` +
          [
            `lap time ${formatSeconds(mean(fast.map((l) => l.lapTime)))} vs ${formatSeconds(mean(slow.map((l) => l.lapTime)))}`,
            `upshift ${avgShare(fast)} vs ${avgShare(slow)} of the limit`,
            `time on the limiter ${limiterSeconds(fast)} vs ${limiterSeconds(slow)} per lap`,
          ].join('; ') +
          '.',
        ...verdicts,
      ].join('\n');
    },
    {
      name: 'get_shifting_points',
      description:
        "Upshift RPM over the whole lap against the car's rev limit: every full-throttle upshift per lap and per gear, " +
        "early shifts (short of the limit, not using the engine's full range) and time held on the rev limiter " +
        '(shifting too late), with the fastest laps against the slowest and verdicts. The ideal is to shift just ' +
        'before the limit. Call it once; it takes no area.',
      schema: z.object({}),
    }
  );

  const steeringDetail = tool(
    async ({ area: name }: { area: string }) => {
      const area = findArea(name);
      if (!area) return `No focus area named "${name}". Focus areas: ${areaNames}`;
      const { runs, k, fast, slow } = fastSlow(area);
      if (!runs.some((r) => r.steering)) return `Steering was not measured for ${area.name} in this session.`;

      const side = (deg: number) => (deg === 0 ? 'straight' : `${Math.abs(deg).toFixed(0)}° ${deg > 0 ? 'left' : 'right'}`);
      const describe = (run: DebriefRun) => {
        const d = run.steering;
        if (!d) return `[${run.lap}] ${run.seconds.toFixed(3)}s: not measured`;
        return (
          `[${run.lap}] ${run.seconds.toFixed(3)}s: max wheel angle ${d.maxDeg.toFixed(0)}°, ${side(d.apexDeg)} at the ` +
          `slowest point (${u.mph(run.minSpeedMph).toFixed(1)}${u.speed}), ${d.reversals} steering reversal${d.reversals === 1 ? '' : 's'}`
        );
      };
      const split = (label: string, pick: (r: DebriefRun) => number | null | undefined, digits: number, unit: string) =>
        `${label} ${avgMeasured(fast.map(pick), digits, unit)} vs ${avgMeasured(slow.map(pick), digits, unit)}`;
      const turn = turnDirection(area);

      return [
        `${area.name} (${area.range}) steering, in steering wheel degrees. ` +
          (turn ? `It is a ${turn}-hand corner. ` : 'It has no single corner direction (a straight or a chicane). ') +
          'A reversal is the wheel swinging back the other way by 4° or more: turning in then unwinding is one, so ' +
          'more than that means corrections (sawing at the wheel or catching the car). More wheel angle at the same ' +
          'or lower speed means the car is not turning as well (understeer) or the line is tighter.',
        'Per lap, fastest first:',
        ...runs.map(describe),
        '',
        `Fastest ${k} vs slowest ${k} runs (averages): ` +
          [
            split('max wheel angle', (r) => r.steering?.maxDeg, 0, '°'),
            split('wheel angle at the slowest point', (r) => (r.steering ? Math.abs(r.steering.apexDeg) : null), 0, '°'),
            split('steering reversals', (r) => r.steering?.reversals, 1, ''),
            split('min speed', (r) => u.mph(r.minSpeedMph), 1, u.speed),
          ].join('; ') +
          '.',
      ].join('\n');
    },
    {
      name: 'get_steering_detail',
      description:
        'Steering wheel angle through one focus area for each lap: the largest angle, the angle at the slowest point ' +
        'and the number of steering reversals (corrections), with the fastest runs against the slowest. Use it to ' +
        'find understeer, too much steering or corrections that cost time.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  const drivingLine = tool(
    async ({ area: name }: { area: string }) => {
      const area = findArea(name);
      if (!area) return `No focus area named "${name}". Focus areas: ${areaNames}`;
      const { runs, k, fast, slow } = fastSlow(area);
      if (!runs.some((r) => r.line)) {
        return (
          `No track positions (Lat/Lon) for ${area.name} in these laps, so the driving line cannot be compared. ` +
          'Do not give a driving line fix for this area.'
        );
      }

      // Left of the reference line is positive. Always left or right, never inside or outside of the corner.
      const turn = turnDirection(area);
      const side = (meters: number) => (meters >= 0 ? 'left' : 'right');
      // Meters from the reference line -> "2 ft left" (or "0.6 m left"), "on the line" when it rounds to 0
      const offset = (meters: number) => {
        const shown = u.line(Math.abs(meters));
        return Number.parseFloat(shown) === 0 ? 'on the line' : `${shown} ${side(meters)}`;
      };
      const describe = (run: DebriefRun) => {
        if (!run.line) return `[${run.lap}] ${run.seconds.toFixed(3)}s: no track positions`;
        return (
          `[${run.lap}] ${run.seconds.toFixed(3)}s: ${run.line.offsetsM.map(offset).join(', ')}; ` +
          `largest ${offset(run.line.maxOffsetM)} at ${run.line.maxOffsetAtPct}% through the area`
        );
      };
      const average = (group: DebriefRun[], i: number) => {
        const values = group.flatMap((r) => (r.line ? [r.line.offsetsM[i]] : []));
        return values.length === 0 ? null : mean(values);
      };
      const fastAvg = LINE_CHECKPOINTS.map((_, i) => average(fast, i));
      const slowAvg = LINE_CHECKPOINTS.map((_, i) => average(slow, i));

      let biggest = -1;
      LINE_CHECKPOINTS.forEach((_, i) => {
        const diff = fastAvg[i] === null || slowAvg[i] === null ? 0 : Math.abs(slowAvg[i]! - fastAvg[i]!);
        const best = biggest < 0 ? 0 : Math.abs(slowAvg[biggest]! - fastAvg[biggest]!);
        if (diff > best) biggest = i;
      });
      const verdict =
        biggest >= 0 && Math.abs(slowAvg[biggest]! - fastAvg[biggest]!) >= LINE_DIFF_METERS
          ? (() => {
              const diff = slowAvg[biggest]! - fastAvg[biggest]!;
              return (
                `Line verdict: the biggest difference is at ${LINE_CHECKPOINTS[biggest]}, where your slowest runs were ` +
                `${u.line(Math.abs(diff))} further ${side(diff)} than your fastest. A driving ` +
                `line fix for this area should move the car about ${u.line(Math.abs(diff))} to the ` +
                `${side(-diff)} there, in those words: left or right, never inside or outside.`
              );
            })()
          : `Line verdict: your fast and slow runs take lines within ${u.line(LINE_DIFF_METERS)} of each other, so the ` +
            'driving line does not explain the time here. Do not give a driving line fix for this area.';

      return [
        `${area.name} (${area.range}) driving line, compared with lap [${area.lineReference ?? '?'}] (the fastest ` +
          `through the area with track positions). Each lap shows how many ${u.distanceName} it was from that line at the start ` +
          "of the area, 25%, 50%, 75% and the end, to the left or right as seen from the driver's seat facing the " +
          'direction of travel' +
          (turn ? ` (this is a ${turn}-hand corner).` : ' (no single corner direction here).'),
        'Per lap, fastest first:',
        ...runs.map(describe),
        '',
        `Fastest ${k} vs slowest ${k} runs (average ${u.distanceName} at each point): ` +
          LINE_CHECKPOINTS.map(
            (label, i) => `${label} ${fastAvg[i] === null ? 'n/a' : offset(fastAvg[i]!)} vs ${slowAvg[i] === null ? 'n/a' : offset(slowAvg[i]!)}`
          ).join('; ') +
          '.',
        verdict,
      ].join('\n');
    },
    {
      name: 'get_driving_line',
      description:
        `Where each lap placed the car through one focus area compared with the fastest lap's line, in ${u.distanceName} to ` +
        'the left or right at the entry, middle and exit, with the fastest runs against the slowest ' +
        'and a line verdict. Use it to find line mistakes such as turning in early or running wide on exit.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  return [overview, areaDetail, compareLap, brakingDetail, throttleDetail, shiftingPoints, steeringDetail, drivingLine];
}

// The theoretical lap (src/lib/optimalLap.ts): only the Debrief Coach has it, as only its sessions carry the
// segment times. plan is worked out before the agent runs, so the browser gets the same lap the tool describes.
function assembleOptimalLapTool(plan: OptimalLap | null, session: DebriefSession) {
  return tool(
    async () => {
      if (!plan) {
        return (session.segments ?? []).length === 0
          ? 'Segment times were not measured for this session, so no theoretical lap can be assembled. Leave optimalLap empty.'
          : 'No clean lap covers some part of the track, so no theoretical lap can be assembled. Leave optimalLap empty.';
      }
      const gain = plan.bestLap.lapTime - plan.lapTime;
      const laps = new Set(plan.segments.map((s) => s.lap));
      return [
        `Theoretical lap ${formatSeconds(plan.lapTime)}, ${gain.toFixed(3)}s faster than your best lap [${plan.bestLap.id}] ` +
          `${formatSeconds(plan.bestLap.lapTime)}, built from the fastest clean run through each of ${plan.segments.length} parts ` +
          `of the track, taken from ${laps.size} lap${laps.size === 1 ? '' : 's'}. The driver can download it and set it ` +
          'as their Target Lap.',
        'Parts in lap order (time, lap it comes from, gain over your best lap):',
        ...plan.segments.map(
          (s) =>
            `- ${segmentName(s)} (${(s.start * 100).toFixed(0)}%-${(s.end * 100).toFixed(0)}%): ${s.seconds.toFixed(3)}s from ` +
            `[${s.lap}]${s.gain > 0.0005 ? `, ${s.gain.toFixed(3)}s faster than [${plan.bestLap.id}]` : ''}`
        ),
      ].join('\n');
    },
    {
      name: 'assemble_optimal_lap',
      description:
        'Builds the theoretical lap: the fastest clean run through every part of the track (each focus area and the ' +
        'stretch before it), from any of the laps analysed, joined into one lap. Answers its time, how much faster it ' +
        'is than the best lap, and which lap each part comes from. Call it once, after the other tools; it takes no input.',
      schema: z.object({}),
    }
  );
}

// Brake advice is only ever a change (how many feet or meters earlier or later), never where on the track to brake.
// Also used by the In-Car AI Coach.
export function brakeChangeRule(units: Units = DEFAULT_UNITS): string {
  const [small, smaller, far, near] = units === 'metric' ? [6, 3, 1865, 375] : [20, 10, 6120, 1230];
  const unit = DISTANCE_UNIT[units];
  return (
    `Tell the driver how much to change the brakepoint in ${DISTANCE_NAME[units]}, e.g. "brake about ${small} ${unit} later" ` +
    `or "brake ${smaller} ${unit} earlier", and never where on the track to brake: never write a brakepoint as a ` +
    `distance from the start/finish line (not "brake at ${far} ${unit}" or "near ${near} ${unit}").` +
    (units === 'metric'
      ? ''
      : ' Round every brakepoint change to the nearest 5 feet, so it ends in 5 or 0 (22 feet earlier is "20 feet ' +
        'earlier", 48 feet later is "50 feet later"), and give driving line moves in whole feet with no decimals ' +
        '(not "2.1 ft to the left" but "2 ft to the left").')
  );
}

// A change in feet or meters is followed by its direction ("30 ft later", "16 m too early") or comes after "by"
// or "within" ("later by 30 ft", "within 3 m of each other", as the verdicts say); any other number of feet or
// meters is a place on the track, e.g. "brake at 6,120 ft" or "near 375 meters". Driving line moves ("1.5 m to
// the left") are changes too.
const DISTANCE_RE = /\d[\d,.]*\s*(?:ft|feet|foot|pés|pies|m|meters?|metres?|metros?)(?!\p{L})/giu;
const CHANGE_AFTER_RE =
  /^[^\p{L}\p{N}]*(?:\p{L}+[^\p{L}\p{N}]+){0,2}?(?:later|earlier|sooner|late|early|deeper|apart|mais tarde|más tarde|mais cedo|más temprano|tarde|cedo|temprano|antes|depois|después|toward|towards|further|farther|wider|tighter|wide|para|hacia|em direção|en dirección|left|right|esquerda|direita|izquierda|derecha)(?!\p{L})/iu;
const CHANGE_BEFORE_RE =
  /(?<!\p{L})(?:by|por|em|en|within|under|over|less than|more than|up to|dentro de|menos de|más de|mais de|até|hasta)\s+(?:about\s+|around\s+|roughly\s+|cerca de\s+|unos\s+|uns\s+)?$/iu;

export function hasTrackPosition(text: string): boolean {
  return [...text.matchAll(DISTANCE_RE)].some((m) => {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    return !CHANGE_AFTER_RE.test(after) && !CHANGE_BEFORE_RE.test(before);
  });
}

const systemPrompt = (units: Units) =>
  'You are a sim racing driving coach running a post-session debrief. Your job is to tell the driver what to ' +
  'fix next session. Start with get_session_overview. Then use get_area_detail on the focus areas that lose the ' +
  'most time (at least the top three), and use compare_lap_to_best on the slowest laps when it helps find a ' +
  'pattern. To find why an area loses time, use get_braking_detail, get_throttle_detail, get_steering_detail and get_driving_line ' +
  'on the areas that lose the most, and get_shifting_points once for the upshifts. A throttle pickup fix must use the pickup verdict from get_throttle_detail, ' +
  'the same way as a brakepoint fix. A driving line fix must use the line verdict from get_driving_line: the place in the ' +
  `area and the ${DISTANCE_NAME[units]} to move to the left or right (never inside or outside), and never one where the verdict says the line does not ` +
  'explain the time. Choose 1 to 3 fixes, ordered by time available, each one a single concrete change the driver can ' +
  `make in the car with a number to aim for (for example "brake about ${units === 'metric' ? 9 : 30} ${DISTANCE_UNIT[units]} later" or "build to ` +
  'about 90% peak pressure"). Base the number to aim for on what your fastest runs did; the targets are only a ' +
  'reference, so when your fastest runs beat the area while missing a target, tell the driver to copy the ' +
  'fastest runs, and never give a fix that contradicts its own evidence. get_area_detail gives a brakepoint ' +
  'verdict for each area: any brakepoint fix must use exactly that direction (later or earlier) and number, and ' +
  'the problem and evidence must agree with it. ' +
  brakeChangeRule(units) +
  ' Only blame braking or speed when the fast and slow runs actually differ in it; if ' +
  'nothing in the data explains the time, say the cause is not in the data instead of guessing. Use the numbers ' +
  `from the tools in the units they give (${DISTANCE_NAME[units]}, ${SPEED_UNIT[units]}), never invent data, write to ` +
  'the driver as "you", and use plain text with no markdown. Once you have your fixes, call assemble_optimal_lap ' +
  'once and sum up the theoretical lap it builds in optimalLap.' +
  LAP_TIME_RULE;

// "brake about 30 ft later", "braking earlier", "brake later" -> the direction words in a fix. Also
// Portuguese ("freie uns 30 ft mais tarde") and Spanish ("frena más tarde"), for answers in those languages
// ("frente", front, is not braking).
const BRAKE_DIRECTION_RE =
  /(?<!\p{L})(?:brak|fre(?!nt)[aein])\p{L}*(?:[^\p{L}\p{N}%~]+[\p{L}\p{N}%~]+){0,5}?[^\p{L}\p{N}%~]+(later|earlier|sooner|mais tarde|más tarde|mais cedo|más temprano|antes)(?!\p{L})/giu;
const LATER_WORDS = new Set(['later', 'mais tarde', 'más tarde']);

function brakeDirectionsIn(text: string) {
  return new Set([...text.matchAll(BRAKE_DIRECTION_RE)].map((m) => (LATER_WORDS.has(m[1].toLowerCase()) ? 'later' : 'earlier')));
}

// Fixes whose brake instruction points the opposite way to what the fastest runs did
function brakeContradictions(response: DebriefFixes, areas: DebriefArea[], u: UnitFormat) {
  return response.fixes.flatMap((fix) => {
    const area = areas.find((a) => a.name.toLowerCase() === fix.area.trim().toLowerCase());
    const brake = area && brakeDirection(area);
    if (!brake) return [];
    const said = brakeDirectionsIn(fix.fix);
    const opposite = brake.direction === 'later' ? 'earlier' : 'later';
    if (!said.has(opposite) || said.has(brake.direction)) return [];
    return [
      {
        fix,
        message:
          `In ${fix.area} you said to brake ${opposite}, but your fastest runs braked ${brakeDiffText(brake, u)} ` +
          `${brake.direction} than your slowest.`,
      },
    ];
  });
}

// Fixes that tell the driver where on the track to brake (feet or meters from the start/finish line) instead of a change
function trackPositions(response: DebriefFixes, u: UnitFormat) {
  return response.fixes.flatMap((fix) =>
    [fix.fix, fix.problem, fix.evidence].some(hasTrackPosition)
      ? [{ fix, message: `In ${fix.area} you gave a place on the track in ${u.distanceName} instead of a change.` }]
      : []
  );
}

// Tool calls the agent made, e.g. "get_area_detail(T 1&2)", shown under the debrief
function toolSteps(messages: unknown[]) {
  return messages.flatMap((message) =>
    AIMessage.isInstance(message)
      ? (message.tool_calls ?? []).map((call) => `${call.name}(${Object.values(call.args ?? {}).join(', ')})`)
      : []
  );
}

export async function runDebriefCoach(
  session: DebriefSession,
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS,
  // The car's rev limit from the user's Car Data, for get_shifting_points
  carRpmLimit: number | null = null
): Promise<{ debrief: Debrief; steps: string[]; optimalLap: OptimalLap | null }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const u = unitFormat(units);
  const { areas, cleanLaps } = cleanSession(session);
  const optimalLap = planOptimalLap(
    session,
    cleanLaps.map((lap) => lap.id)
  );
  const tools = [...createTools(session, units, carRpmLimit), assembleOptimalLapTool(optimalLap, session)];
  const agent = createAgent({
    model: await chatModel('debriefCoach', 0.2),
    tools,
    systemPrompt: systemPrompt(units) + (await coachInstructionsRule()) + aiLanguageRule(language),
    responseFormat: debriefSchema,
  });

  let result = await agent.invoke(
    { messages: [{ role: 'user', content: `Debrief my session at ${session.track} in the ${session.car}. What should I fix?` }] },
    { recursionLimit: 40 }
  );

  // The model can still flip "later" and "earlier" or say where to brake, so check every fix and give it one
  // chance to correct itself before dropping any fix that still breaks the rules
  const check = (response: DebriefFixes) => [...brakeContradictions(response, areas, u), ...trackPositions(response, u)];
  let problems = check(result.structuredResponse);
  if (problems.length > 0) {
    result = await agent.invoke(
      {
        messages: [
          ...result.messages,
          {
            role: 'user',
            content:
              `Your debrief breaks the brakepoint rules: ${problems.map((p) => p.message).join(' ')} ` +
              'Rewrite the whole debrief so every brakepoint fix, problem and evidence agrees with the brakepoint ' +
              `verdicts. ${brakeChangeRule(units)}`,
          },
        ],
      },
      { recursionLimit: 40 }
    );
    problems = check(result.structuredResponse);
  }

  const response: DebriefFixes = result.structuredResponse;
  for (const p of problems) console.error(`Debrief coach dropped a fix: ${p.message}`, JSON.stringify(p.fix));
  const fixes = response.fixes.filter((fix) => !problems.some((p) => p.fix === fix));
  if (fixes.length === 0) {
    throw new Error('The coach gave brakepoint advice that contradicts the data or says where on the track to brake');
  }

  const toolNames = new Set<string>(tools.map((t) => t.name));
  return {
    debrief: { ...response, fixes, headline: `${fixes[0].area}: ${fixes[0].fix}`, optimalLap: optimalLap ? response.optimalLap : '' },
    steps: toolSteps(result.messages).filter((step) => toolNames.has(step.slice(0, step.indexOf('(')))),
    optimalLap,
  };
}
