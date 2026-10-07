import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';

// Reference Points tab. The browser measures every lap in every focus area (the CSVs are too big to
// send) and posts the numbers here. The reference table is computed here from the fastest runs through
// each area, so its numbers are exact; the agent digs through the same data with the tools below and
// writes the commentary (consistency, areas to treat with care).

// One lap through one focus area. brakeFeet/throttleFeet are feet from the start/finish line (null = none)
const runSchema = z.object({
  lap: z.string().max(20),
  seconds: z.number(),
  brakeFeet: z.number().nullable(),
  maxBrakePct: z.number(),
  throttleFeet: z.number().nullable(),
});

export const referenceSessionSchema = z.object({
  track: z.string().max(200),
  car: z.string().max(200),
  laps: z.array(z.object({ id: z.string().max(20), lapTime: z.number() })).min(1).max(100),
  areas: z
    .array(
      z.object({
        name: z.string().max(100),
        range: z.string().max(20),
        brakepointTarget: z.number().nullable(),
        maxBrakeTarget: z.number().nullable(),
        throttlePickupTarget: z.number().nullable(),
        runs: z.array(runSchema).max(100),
      })
    )
    .min(1)
    .max(50),
});

export type ReferenceSession = z.infer<typeof referenceSessionSchema>;
type Run = z.infer<typeof runSchema>;
type Area = ReferenceSession['areas'][number];

export type ReferenceRow = {
  area: string;
  brakeFeet: number | null;
  maxBrakePct: number | null;
  throttleFeet: number | null;
  // From the focus area in Track Management; null when no target is set (0 also counts as not set)
  brakeTargetFeet: number | null;
  maxBrakeTargetPct: number | null;
  throttleTargetFeet: number | null;
  lapsUsed: number;
  lapsMeasured: number;
};

const commentarySchema = z.object({
  commentary: z.string().describe('Short plain-text notes for the driver about the reference points'),
});

// Laps this much slower than the session's median lap are treated as incident laps (spins, offs, out laps)
const INCIDENT_LAP_FACTOR = 1.1;

function mean(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const targetOrNull = (value: number | null) => (value === null || value === 0 ? null : value);
const numbersOf = (values: (number | null)[]) => values.flatMap((v) => (v === null ? [] : [v]));
const avgOrNull = (values: number[], digits = 0) => {
  if (values.length === 0) return null;
  const factor = 10 ** digits;
  return Math.round(mean(values) * factor) / factor;
};

// Incident laps would skew the reference points, so they are left out (when 3+ laps give a meaningful median)
function cleanSession(session: ReferenceSession) {
  const cutoff = median(session.laps.map((l) => l.lapTime)) * INCIDENT_LAP_FACTOR;
  const incidentLaps = session.laps.length >= 3 ? session.laps.filter((l) => l.lapTime > cutoff) : [];
  const areas = session.areas.map((a) => ({
    ...a,
    runs: a.runs.filter((r) => !incidentLaps.some((l) => l.id === r.lap)),
  }));
  return { cutoff, incidentLaps, areas };
}

// The fastest third of an area's runs (at least one) are the reference runs
function referenceRuns(area: Area) {
  const sorted = [...area.runs].sort((a, b) => a.seconds - b.seconds);
  return { sorted, reference: sorted.slice(0, Math.max(1, Math.floor(sorted.length / 3))) };
}

export function referenceTable(session: ReferenceSession): ReferenceRow[] {
  const { areas } = cleanSession(session);
  return areas.map((area) => {
    const { reference } = referenceRuns(area);
    return {
      area: area.name,
      brakeFeet: avgOrNull(numbersOf(reference.map((r) => r.brakeFeet))),
      maxBrakePct: avgOrNull(reference.map((r) => r.maxBrakePct)),
      throttleFeet: avgOrNull(numbersOf(reference.map((r) => r.throttleFeet))),
      brakeTargetFeet: targetOrNull(area.brakepointTarget),
      maxBrakeTargetPct: targetOrNull(area.maxBrakeTarget),
      throttleTargetFeet: targetOrNull(area.throttlePickupTarget),
      lapsUsed: reference.length,
      lapsMeasured: area.runs.length,
    };
  });
}

const fixed = (value: number | null, unit = '') => (value === null ? 'n/a' : `${Math.round(value)}${unit}`);
const spread = (values: number[], unit: string) =>
  values.length === 0 ? 'n/a' : `${Math.round(Math.min(...values))}-${Math.round(Math.max(...values))}${unit}`;

function describeRun(run: Run) {
  return (
    `[${run.lap}] ${run.seconds.toFixed(3)}s, brake ${fixed(run.brakeFeet, ' ft')}, ` +
    `max brake ${run.maxBrakePct.toFixed(0)}%, on throttle ${fixed(run.throttleFeet, ' ft')}`
  );
}

function createTools(session: ReferenceSession) {
  const { cutoff, incidentLaps, areas } = cleanSession(session);
  const table = referenceTable(session);

  const overview = tool(
    async () =>
      [
        incidentLaps.length > 0
          ? `Left out as incident laps (over ${cutoff.toFixed(3)}s): ${incidentLaps.map((l) => `[${l.id}] ${l.lapTime.toFixed(3)}s`).join(', ')}.`
          : 'No incident laps were left out.',
        `${session.track}, ${session.car}. ${session.laps.length} laps uploaded.`,
        'Reference points (average of the fastest third of runs through each focus area; feet are from the start/finish line):',
        ...table.map(
          (r) =>
            `- ${r.area}: brake ${fixed(r.brakeFeet, ' ft')} (target ${fixed(r.brakeTargetFeet, ' ft')}), ` +
            `max brake ${fixed(r.maxBrakePct, '%')} (target ${fixed(r.maxBrakeTargetPct, '%')}), ` +
            `on throttle ${fixed(r.throttleFeet, ' ft')} (target ${fixed(r.throttleTargetFeet, ' ft')}) (from ${r.lapsUsed} of ${r.lapsMeasured} runs)`
        ),
      ].join('\n'),
    {
      name: 'get_reference_points',
      description: 'The reference points table for every focus area, and any incident laps left out. Call this first.',
      schema: z.object({}),
    }
  );

  const areaDetail = tool(
    async ({ area: name }: { area: string }) => {
      const area = areas.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
      if (!area) return `No focus area named "${name}". Focus areas: ${areas.map((a) => a.name).join(', ')}`;
      const { sorted, reference } = referenceRuns(area);
      return [
        `${area.name} (${area.range}). Reference runs: ${reference.map((r) => `[${r.lap}]`).join(', ')}.`,
        'Every run, fastest first:',
        ...sorted.map(describeRun),
        `Spread across all runs: brake ${spread(numbersOf(sorted.map((r) => r.brakeFeet)), ' ft')}, ` +
          `max brake ${spread(sorted.map((r) => r.maxBrakePct), '%')}, ` +
          `on throttle ${spread(numbersOf(sorted.map((r) => r.throttleFeet)), ' ft')}.`,
      ].join('\n');
    },
    {
      name: 'get_area_detail',
      description:
        'Every run through one focus area (time, brake point, max brake, on-throttle point) and the spread across runs. ' +
        'Use it to judge how consistent the reference points are.',
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the table') }),
    }
  );

  return [overview, areaDetail];
}

const SYSTEM_PROMPT =
  'You are a sim racing coach. The driver uploaded several lap files and wants reference points for each focus area: ' +
  'a brake point (feet from the start/finish line), a max brake pressure (%) and an on-throttle point (feet from the ' +
  'start/finish line). The reference table is already computed from the fastest runs, next to the targets from the ' +
  "driver's track file (n/a = no target set); do not restate it. Start with " +
  'get_reference_points, then use get_area_detail on any area that looks odd (a wide spread between runs, no braking ' +
  'or no throttle point found, or reference runs that disagree) and write short commentary: which reference points ' +
  'are solid, which are shaky and why, where a measured point is far from its target, and anything the driver should double-check. Use only numbers from the tools, ' +
  'never invent data, write to the driver as "you", keep it under 150 words, and use plain text with no markdown.';

export async function runReferencePoints(
  session: ReferenceSession
): Promise<{ rows: ReferenceRow[]; commentary: string; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const tools = createTools(session);
  const agent = createAgent({
    model: new ChatOpenAI({ model: 'gpt-4o', temperature: 0.2 }),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    responseFormat: commentarySchema,
  });

  const result = await agent.invoke(
    { messages: [{ role: 'user', content: `Review the reference points for ${session.track} in the ${session.car}.` }] },
    { recursionLimit: 30 }
  );

  const toolNames = new Set<string>(tools.map((t) => t.name));
  const steps = result.messages.flatMap((message: unknown) =>
    AIMessage.isInstance(message)
      ? (message.tool_calls ?? [])
          .filter((call) => toolNames.has(call.name))
          .map((call) => `${call.name}(${Object.values(call.args ?? {}).join(', ')})`)
      : []
  );

  return { rows: referenceTable(session), commentary: result.structuredResponse.commentary, steps };
}
