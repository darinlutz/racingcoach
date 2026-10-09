import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';

// Post-session debrief coach for the Debrief Coach tab. The browser measures every lap in every
// focus area (the CSVs are too big to send) and posts the numbers here; the agent digs through
// them with the tools below and returns the 1-3 things to fix next session.

// One lap through one focus area. brakeFeet is feet from the start/finish line (null = no braking)
const runSchema = z.object({
  lap: z.string().max(20),
  seconds: z.number(),
  brakeFeet: z.number().nullable(),
  maxBrakePct: z.number(),
  minSpeedMph: z.number(),
  exitSpeedMph: z.number(),
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
          .enum(['Braking', 'Brake pressure', 'Mid-corner speed', 'Corner exit', 'Consistency'])
          .describe(
            'What the fix changes: Braking for the brakepoint, Brake pressure for peak brake, Mid-corner speed for ' +
              'minimum speed, Corner exit for exit speed, Consistency when no single input explains the time'
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
const brakeFeetOf = (runs: DebriefRun[]) => runs.flatMap((r) => (r.brakeFeet === null ? [] : [r.brakeFeet]));

function describeRun(run: DebriefRun) {
  return (
    `[${run.lap}] ${run.seconds.toFixed(3)}s, ` +
    `${run.brakeFeet === null ? 'no braking' : `brake at ${run.brakeFeet} ft`}, ` +
    `max brake ${run.maxBrakePct.toFixed(0)}%, min ${run.minSpeedMph.toFixed(1)} mph, exit ${run.exitSpeedMph.toFixed(1)} mph`
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

// Fast and slow runs braking within this many feet of each other is treated as no difference
const BRAKE_DIFF_FEET = 10;

type BrakeDirection = { direction: 'later' | 'earlier'; aimFeet: number; diffFeet: number };

// Which way the fastest runs moved the brakepoint compared with the slowest, decided here rather than by
// the model so "later" and "earlier" can't get flipped. null when the data doesn't show a clear difference.
function brakeDirection(area: DebriefArea): BrakeDirection | null {
  const { fast, slow } = fastSlow(area);
  const fastFeet = brakeFeetOf(fast);
  const slowFeet = brakeFeetOf(slow);
  if (fastFeet.length === 0 || slowFeet.length === 0) return null;
  const diff = mean(fastFeet) - mean(slowFeet);
  if (Math.abs(diff) < BRAKE_DIFF_FEET) return null;
  return { direction: diff > 0 ? 'later' : 'earlier', aimFeet: Math.round(mean(fastFeet)), diffFeet: Math.round(Math.abs(diff)) };
}

function createTools(session: DebriefSession) {
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
        `${area.name} (${area.range}). Brakepoint target ${area.brakepointTarget ?? 'n/a'} ft, ` +
          `max brake target ${area.maxBrakeTarget === null ? 'n/a' : `${area.maxBrakeTarget}%`}. ` +
          'Brakepoints are feet from the start/finish line, so more feet means braking later.',
        'Per lap, fastest first:',
        ...runs.map(describeRun),
        '',
        `Fastest ${k} vs slowest ${k} runs (averages): ` +
          [
            split('time', (r) => avgOf(r.map((x) => x.seconds), 3, 's')),
            split('brakepoint', (r) => avgOf(brakeFeetOf(r), 0, ' ft')),
            split('max brake', (r) => avgOf(r.map((x) => x.maxBrakePct), 0, '%')),
            split('min speed', (r) => avgOf(r.map((x) => x.minSpeedMph), 1, ' mph')),
            split('exit speed', (r) => avgOf(r.map((x) => x.exitSpeedMph), 1, ' mph')),
          ].join('; ') +
          '.',
      ];

      const brake = brakeDirection(area);
      lines.push(
        brake
          ? `Brakepoint verdict: your fastest runs braked ${brake.diffFeet} ft ${brake.direction.toUpperCase()} than your ` +
              `slowest. Any brakepoint fix for this area must say brake ${brake.direction.toUpperCase()}, near ${brake.aimFeet} ft.`
          : `Brakepoint verdict: your fast and slow runs brake within ${BRAKE_DIFF_FEET} ft of each other here, so the ` +
              'brakepoint does not explain the time. Do not give a brakepoint fix for this area.'
      );

      const brakes = brakeFeetOf(runs);
      if (area.brakepointTarget !== null && brakes.length > 0) {
        const target = area.brakepointTarget;
        const early = brakes.filter((ft) => ft < target);
        const late = brakes.filter((ft) => ft > target);
        lines.push(
          `Against the brakepoint target: early on ${early.length} of ${brakes.length} laps` +
            `${early.length > 0 ? ` (avg ${(target - mean(early)).toFixed(0)} ft early)` : ''}, late on ${late.length}` +
            `${late.length > 0 ? ` (avg ${(mean(late) - target).toFixed(0)} ft late)` : ''}. ` +
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
        return [{ delta: run.seconds - best.seconds, text: `${area.name}: ${describeRun(run)} | area best ${describeRun(best)}` }];
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

  return [overview, areaDetail, compareLap];
}

const SYSTEM_PROMPT =
  'You are a sim racing driving coach running a post-session debrief. Your job is to tell the driver what to ' +
  'fix next session. Start with get_session_overview. Then use get_area_detail on the focus areas that lose the ' +
  'most time (at least the top three), and use compare_lap_to_best on the slowest laps when it helps find a ' +
  'pattern. Choose 1 to 3 fixes, ordered by time available, each one a single concrete change the driver can ' +
  'make in the car with a number to aim for (for example "brake about 30 ft later, near 1230 ft" or "build to ' +
  'about 90% peak pressure"). Base the number to aim for on what your fastest runs did; the targets are only a ' +
  'reference, so when your fastest runs beat the area while missing a target, tell the driver to copy the ' +
  'fastest runs, and never give a fix that contradicts its own evidence. get_area_detail gives a brakepoint ' +
  'verdict for each area: any brakepoint fix must use exactly that direction (later or earlier) and number, and ' +
  'the problem and evidence must agree with it. Only blame braking or speed when the fast and slow runs actually differ in it; if ' +
  'nothing in the data explains the time, say the cause is not in the data instead of guessing. Use the numbers ' +
  'from the tools, never invent data, write to the driver as "you", and use plain text with no markdown.';

// "brake about 30 ft later", "braking earlier", "brake later" -> the direction words in a fix
const BRAKE_DIRECTION_RE = /\bbrak\w*\b(?:\W+[\w%~]+){0,5}?\W+(later|earlier|sooner)\b/gi;

function brakeDirectionsIn(text: string) {
  return new Set([...text.matchAll(BRAKE_DIRECTION_RE)].map((m) => (m[1].toLowerCase() === 'later' ? 'later' : 'earlier')));
}

// Fixes whose brake instruction points the opposite way to what the fastest runs did
function brakeContradictions(response: DebriefFixes, areas: DebriefArea[]) {
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
          `In ${fix.area} you said to brake ${opposite}, but your fastest runs braked ${brake.diffFeet} ft ` +
          `${brake.direction} than your slowest (aim near ${brake.aimFeet} ft).`,
      },
    ];
  });
}

// Tool calls the agent made, e.g. "get_area_detail(T 1&2)", shown under the debrief
function toolSteps(messages: unknown[]) {
  return messages.flatMap((message) =>
    AIMessage.isInstance(message)
      ? (message.tool_calls ?? []).map((call) => `${call.name}(${Object.values(call.args ?? {}).join(', ')})`)
      : []
  );
}

export async function runDebriefCoach(session: DebriefSession): Promise<{ debrief: Debrief; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const tools = createTools(session);
  const agent = createAgent({
    model: new ChatOpenAI({ model: 'gpt-4o', temperature: 0.2 }),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    responseFormat: debriefSchema,
  });

  let result = await agent.invoke(
    { messages: [{ role: 'user', content: `Debrief my session at ${session.track} in the ${session.car}. What should I fix?` }] },
    { recursionLimit: 30 }
  );

  // The model can still flip "later" and "earlier", so check every fix against the data and give it one chance
  // to correct itself before dropping any fix that still contradicts it
  const { areas } = cleanSession(session);
  let problems = brakeContradictions(result.structuredResponse, areas);
  if (problems.length > 0) {
    result = await agent.invoke(
      {
        messages: [
          ...result.messages,
          {
            role: 'user',
            content:
              `Your debrief contradicts the brakepoint data: ${problems.map((p) => p.message).join(' ')} ` +
              'Rewrite the whole debrief so every brakepoint fix, problem and evidence agrees with the brakepoint verdicts.',
          },
        ],
      },
      { recursionLimit: 30 }
    );
    problems = brakeContradictions(result.structuredResponse, areas);
  }

  const response: DebriefFixes = result.structuredResponse;
  const fixes = response.fixes.filter((fix) => !problems.some((p) => p.fix === fix));
  if (fixes.length === 0) {
    throw new Error('The coach gave brakepoint advice that contradicts the data');
  }

  const toolNames = new Set<string>(tools.map((t) => t.name));
  return {
    debrief: { ...response, fixes, headline: `${fixes[0].area}: ${fixes[0].fix}` },
    steps: toolSteps(result.messages).filter((step) => toolNames.has(step.slice(0, step.indexOf('(')))),
  };
}
