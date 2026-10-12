import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { coachInstructionsRule } from './siteSettings';
import {
  DEFAULT_UNITS,
  DISTANCE_NAME,
  DISTANCE_UNIT,
  distanceFromFeet,
  distanceFromMeters,
  SPEED_UNIT,
  speedFromMph,
  type Units,
} from './units';

// Post-session debrief coach for the Debrief Coach tab. The browser measures every lap in every
// focus area (the CSVs are too big to send) and posts the numbers here; the agent digs through
// them with the tools below and returns the 1-3 things to fix next session.

// Braking, steering and driving line detail of one run (src/lib/areaInputs.ts has what each number means).
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
const steeringSchema = z.object({ maxDeg: z.number(), apexDeg: z.number(), reversals: z.number() });
const lineSchema = z.object({ offsetsM: z.array(z.number()).length(5), maxOffsetM: z.number(), maxOffsetAtPct: z.number() });

// One lap through one focus area. brakeFeet is feet from the start/finish line (null = no braking)
const runSchema = z.object({
  lap: z.string().max(20),
  seconds: z.number(),
  brakeFeet: z.number().nullable(),
  maxBrakePct: z.number(),
  minSpeedMph: z.number(),
  exitSpeedMph: z.number(),
  braking: brakingSchema.optional(),
  steering: steeringSchema.optional(),
  // null when the lap (or every lap) has no track positions in the area
  line: lineSchema.nullable().optional(),
});

export const debriefSessionSchema = z.object({
  track: z.string().max(200),
  car: z.string().max(200),
  laps: z.array(z.object({ id: z.string().max(20), lapTime: z.number() })).min(2).max(100),
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
          .enum(['Braking', 'Brake pressure', 'Trail braking', 'Steering', 'Driving line', 'Mid-corner speed', 'Corner exit', 'Consistency'])
          .describe(
            'What the fix changes: Braking for the brakepoint, Brake pressure for peak brake, Trail braking for how the ' +
              'brake is released into the corner, Steering for wheel angle or corrections, Driving line for where the car ' +
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

// How far apart the fast and slow brakepoints are, in the user's units: "30 ft" or "9 m"
function brakeDiffText(brake: BrakeDirection, u: UnitFormat) {
  return `${Math.round(u.feet(brake.diffFeet))}${u.unit}`;
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

// Fast and slow runs' lines this close together are treated as the same line
const LINE_DIFF_METERS = 0.5;
const LINE_CHECKPOINTS = ['the start of the area (entry)', '25% through', 'the middle (50%)', '75% through', 'the end of the area (exit)'];

// Also used by the In-Car AI Coach (inCarCoach.ts), on the laps the collector has uploaded so far.
// The tools write distances and speeds in the user's units.
export function createTools(session: DebriefSession, units: Units = DEFAULT_UNITS) {
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
          ? `Left out as incident laps (over ${cutoff.toFixed(3)}s, 110% of the median lap): ` +
            `${incidentLaps.map((l) => `[${l.id}] ${l.lapTime.toFixed(3)}s`).join(', ')}. All statistics below use the other laps.`
          : 'No incident laps were left out.',
        `${session.track}, ${session.car}. ${times.length} laps: best ${Math.min(...times).toFixed(3)}s, ` +
          `avg ${mean(times).toFixed(3)}s, worst ${Math.max(...times).toFixed(3)}s, std dev ${fixed(stdDev(times), 3, 's')}.`,
        `Laps fastest to slowest: ${laps.map((l) => `[${l.id}] ${l.lapTime.toFixed(3)}s`).join(', ')}`,
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
        `${area.name} (${area.range}). Brakepoint target ` +
          `${area.brakepointTarget === null ? 'n/a' : u.feet(area.brakepointTarget).toFixed(0)}${u.unit}, ` +
          `max brake target ${area.maxBrakeTarget === null ? 'n/a' : `${area.maxBrakeTarget}%`}. ` +
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
          `Against the brakepoint target: early on ${early.length} of ${brakes.length} laps` +
            `${early.length > 0 ? ` (avg ${u.feet(target - mean(early)).toFixed(0)}${u.unit} early)` : ''}, late on ${late.length}` +
            `${late.length > 0 ? ` (avg ${u.feet(mean(late) - target).toFixed(0)}${u.unit} late)` : ''}. ` +
            'The target is only a reference: when it disagrees with the brakepoint verdict, follow the verdict.'
        );
      }
      if (area.maxBrakeTarget !== null) {
        const target = area.maxBrakeTarget;
        const under = runs.filter((r) => r.maxBrakePct < target - 2);
        lines.push(`Against the max brake target: more than 2% under it on ${under.length} of ${runs.length} laps.`);
      }
      return lines.join('\n');
    },
    {
      name: 'get_area_detail',
      description:
        'Every lap through one focus area (time, brakepoint, max brake, min and exit speed), how the fastest runs ' +
        'differ from the slowest, and how the laps compare with the targets. Use it to find what costs time in an area.',
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
        `Lap [${match.id}] ${match.lapTime.toFixed(3)}s${match.lapTime > cutoff ? ' (an incident lap)' : ''}. Time lost to the best run in each focus area, most first ` +
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

      // Toward the inside of the corner is positive when the corner direction is known, otherwise left is
      const turn = turnDirection(area);
      const sign = turn === 'right' ? -1 : 1;
      const toward = turn ? ['inside', 'outside'] : ['left', 'right'];
      // Meters from the reference line -> "+1.2" in the user's units
      const offset = (meters: number) => {
        const value = u.meters(meters);
        return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
      };
      const describe = (run: DebriefRun) => {
        if (!run.line) return `[${run.lap}] ${run.seconds.toFixed(3)}s: no track positions`;
        return (
          `[${run.lap}] ${run.seconds.toFixed(3)}s: ${run.line.offsetsM.map((m) => offset(m * sign)).join(', ')}${u.unit}; ` +
          `largest ${offset(run.line.maxOffsetM * sign)}${u.unit} at ${run.line.maxOffsetAtPct}% through the area`
        );
      };
      const average = (group: DebriefRun[], i: number) => {
        const values = group.flatMap((r) => (r.line ? [r.line.offsetsM[i] * sign] : []));
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
                `${u.meters(Math.abs(diff)).toFixed(1)}${u.unit} further ${diff > 0 ? toward[0] : toward[1]} than your fastest. A driving ` +
                `line fix for this area should move the car about ${u.meters(Math.abs(diff)).toFixed(1)}${u.unit} toward the ` +
                `${diff > 0 ? toward[1] : toward[0]} there.`
              );
            })()
          : `Line verdict: your fast and slow runs take lines within ${u.meters(LINE_DIFF_METERS).toFixed(1)}${u.unit} of each other, so the ` +
            'driving line does not explain the time here. Do not give a driving line fix for this area.';

      return [
        `${area.name} (${area.range}) driving line, compared with lap [${area.lineReference ?? '?'}] (the fastest ` +
          `through the area with track positions). Each lap shows how many ${u.distanceName} it was from that line at the start ` +
          `of the area, 25%, 50%, 75% and the end, + toward the ${toward[0]} and - toward the ${toward[1]}` +
          (turn ? ` of this ${turn}-hand corner.` : ' (no single corner direction here).'),
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
        `Where each lap placed the car through one focus area compared with the fastest lap's line, in ${u.distanceName} toward ` +
        'the inside or outside of the corner at the entry, middle and exit, with the fastest runs against the slowest ' +
        'and a line verdict. Use it to find line mistakes such as turning in early or running wide on exit.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the overview') }),
    }
  );

  return [overview, areaDetail, compareLap, brakingDetail, steeringDetail, drivingLine];
}

// Brake advice is only ever a change (how many feet or meters earlier or later), never where on the track to brake.
// Also used by the In-Car AI Coach.
export function brakeChangeRule(units: Units = DEFAULT_UNITS): string {
  const [small, smaller, far, near] = units === 'metric' ? [6, 3, 1865, 375] : [20, 10, 6120, 1230];
  const unit = DISTANCE_UNIT[units];
  return (
    `Tell the driver how much to change the brakepoint in ${DISTANCE_NAME[units]}, e.g. "brake about ${small} ${unit} later" ` +
    `or "brake ${smaller} ${unit} earlier", and never where on the track to brake: never write a brakepoint as a ` +
    `distance from the start/finish line (not "brake at ${far} ${unit}" or "near ${near} ${unit}").`
  );
}

// A change in feet or meters is followed by its direction ("30 ft later") or comes after "by" ("later by 30 ft");
// any other number of feet or meters is a place on the track, e.g. "brake at 6,120 ft" or "near 375 meters".
// Driving line moves ("1.5 m toward the inside") are changes too.
const DISTANCE_RE = /\d[\d,.]*\s*(?:ft|feet|foot|pés|pies|m|meters?|metres?|metros?)(?!\p{L})/giu;
const CHANGE_AFTER_RE =
  /^[^\p{L}\p{N}]*(?:\p{L}+[^\p{L}\p{N}]+){0,2}?(?:later|earlier|sooner|deeper|mais tarde|más tarde|mais cedo|más temprano|antes|depois|después|toward|towards|further|farther|wider|tighter|para|hacia|em direção|en dirección)(?!\p{L})/iu;
const CHANGE_BEFORE_RE = /(?<!\p{L})(?:by|por|em|en)\s+(?:about\s+|around\s+|roughly\s+|cerca de\s+|unos\s+|uns\s+)?$/iu;

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
  'pattern. To find why an area loses time, use get_braking_detail, get_steering_detail and get_driving_line on the ' +
  'areas that lose the most. A driving line fix must use the line verdict from get_driving_line: the place in the ' +
  `area and the ${DISTANCE_NAME[units]} to move toward the inside or outside, and never one where the verdict says the line does not ` +
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
  'the driver as "you", and use plain text with no markdown.';

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
  units: Units = DEFAULT_UNITS
): Promise<{ debrief: Debrief; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const u = unitFormat(units);
  const tools = createTools(session, units);
  const agent = createAgent({
    model: new ChatOpenAI({ model: 'gpt-4o', temperature: 0.2 }),
    tools,
    systemPrompt: systemPrompt(units) + (await coachInstructionsRule()) + aiLanguageRule(language),
    responseFormat: debriefSchema,
  });

  let result = await agent.invoke(
    { messages: [{ role: 'user', content: `Debrief my session at ${session.track} in the ${session.car}. What should I fix?` }] },
    { recursionLimit: 30 }
  );

  // The model can still flip "later" and "earlier" or say where to brake, so check every fix and give it one
  // chance to correct itself before dropping any fix that still breaks the rules
  const { areas } = cleanSession(session);
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
      { recursionLimit: 30 }
    );
    problems = check(result.structuredResponse);
  }

  const response: DebriefFixes = result.structuredResponse;
  const fixes = response.fixes.filter((fix) => !problems.some((p) => p.fix === fix));
  if (fixes.length === 0) {
    throw new Error('The coach gave brakepoint advice that contradicts the data or says where on the track to brake');
  }

  const toolNames = new Set<string>(tools.map((t) => t.name));
  return {
    debrief: { ...response, fixes, headline: `${fixes[0].area}: ${fixes[0].fix}` },
    steps: toolSteps(result.messages).filter((step) => toolNames.has(step.slice(0, step.indexOf('(')))),
  };
}
