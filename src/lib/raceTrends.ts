import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';

// My Race Trends page. The driver's races are synced from iRacePlan into racingcoach."RaceResults"
// (see raceHistory.ts). The iRating and incident trends are computed here so the charts' numbers are
// exact; the agent digs through the same races with the tools below and writes the commentary.

// One race for the driver. Positions are 1-based; iRating and safety rating are null when not reported.
export type RaceEvent = {
  eventId: number;
  startTime: string;
  series: string;
  track: string;
  // License category from the series (e.g. "Sports car"); iRacing keeps a separate iRating for each
  category: string;
  car: string;
  oldIRating: number | null;
  newIRating: number | null;
  oldSafetyRating: number | null;
  newSafetyRating: number | null;
  startPosition: number | null;
  finishPosition: number | null;
  incidents: number;
  lapsComplete: number;
};

type Rated = RaceEvent & { oldIRating: number; newIRating: number };

export type IRatingPoint = {
  eventId: number;
  startTime: string;
  oldIRating: number;
  iRating: number;
  series: string;
  track: string;
  finishPosition: number | null;
};

// One line per license category: iRacing keeps a separate iRating for each
export type IRatingSeries = { category: string; points: IRatingPoint[] };

// Incidents in every race, rated or not
export type IncidentPoint = {
  eventId: number;
  startTime: string;
  incidents: number;
  lapsComplete: number;
  series: string;
  track: string;
};

const commentarySchema = z.object({
  commentary: z.string().describe('Short plain-text notes for the driver about their iRating trend'),
});

// Every event once, oldest first
function uniqueEvents(events: RaceEvent[]) {
  return [...new Map(events.map((e) => [e.eventId, e])).values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

const isRated = (e: RaceEvent): e is Rated => e.oldIRating !== null && e.newIRating !== null;

// Events with an iRating for the driver, oldest first
const ratedEvents = (events: RaceEvent[]) => uniqueEvents(events).filter(isRated);

export function incidentTrend(events: RaceEvent[]): IncidentPoint[] {
  return uniqueEvents(events).map((e) => ({
    eventId: e.eventId,
    startTime: e.startTime,
    incidents: e.incidents,
    lapsComplete: e.lapsComplete,
    series: e.series,
    track: e.track,
  }));
}

export function iRatingTrend(events: RaceEvent[]): IRatingSeries[] {
  const byCategory = new Map<string, IRatingPoint[]>();
  for (const e of ratedEvents(events)) {
    const points = byCategory.get(e.category) ?? [];
    points.push({
      eventId: e.eventId,
      startTime: e.startTime,
      oldIRating: e.oldIRating,
      iRating: e.newIRating,
      series: e.series,
      track: e.track,
      finishPosition: e.finishPosition,
    });
    byCategory.set(e.category, points);
  }
  // The category with the most events first, so it keeps the first chart color
  return [...byCategory.entries()]
    .map(([category, points]) => ({ category, points }))
    .sort((a, b) => b.points.length - a.points.length);
}

const day = (iso: string) => iso.slice(0, 10);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const avg = (values: number[]) =>
  values.length === 0 ? 'n/a' : (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);
const nums = (values: (number | null)[]) => values.flatMap((v) => (v === null ? [] : [v]));

function describeEvent(e: RaceEvent) {
  const rating = isRated(e) ? `iR ${e.oldIRating}->${e.newIRating} (${signed(e.newIRating - e.oldIRating)})` : 'no iRating';
  const safety =
    e.oldSafetyRating !== null && e.newSafetyRating !== null ? `, SR ${e.oldSafetyRating}->${e.newSafetyRating}` : '';
  return (
    `${day(e.startTime)} ${e.series} @ ${e.track} (${e.car}): ${rating}${safety}, ` +
    `started ${e.startPosition ?? 'n/a'}, finished ${e.finishPosition ?? 'n/a'}, ${e.incidents}x incidents`
  );
}

const perLap = (group: RaceEvent[]) => {
  const laps = group.reduce((s, e) => s + e.lapsComplete, 0);
  return laps === 0 ? 'n/a' : (group.reduce((s, e) => s + e.incidents, 0) / laps).toFixed(2);
};

function incidentSummary(unique: RaceEvent[]) {
  const half = Math.ceil(unique.length / 2);
  const worst = unique.reduce((a, b) => (b.incidents > a.incidents ? b : a));
  const clean = unique.filter((e) => e.incidents === 0).length;
  const recent = unique.slice(-10);
  return [
    `Incidents across all ${unique.length} races: avg ${avg(unique.map((e) => e.incidents))} per race, ${perLap(unique)} per lap, ` +
      `${clean} clean (0x) races.`,
    `  First half of races avg ${avg(unique.slice(0, half).map((e) => e.incidents))}, second half avg ` +
      `${avg(unique.slice(half).map((e) => e.incidents))}; last ${recent.length} races avg ${avg(recent.map((e) => e.incidents))}.`,
    `  Worst: ${worst.incidents}x on ${day(worst.startTime)} (${worst.series} @ ${worst.track}).`,
  ].join('\n');
}

const GROUPINGS = {
  series: (e: RaceEvent) => e.series,
  track: (e: RaceEvent) => e.track,
  car: (e: RaceEvent) => e.car,
  month: (e: RaceEvent) => e.startTime.slice(0, 7),
  category: (e: RaceEvent) => e.category,
} as const;

function createTools(driver: string, events: RaceEvent[]) {
  const unique = uniqueEvents(events);
  const rated = ratedEvents(events);
  const trend = iRatingTrend(events);

  const overview = tool(
    async () =>
      [
        `${driver}: ${unique.length} races, ${rated.length} with an iRating ` +
          `(unofficial races such as 13th week events show no iRating change).`,
        ...trend.map(({ category, points }) => {
          const first = points[0];
          const last = points[points.length - 1];
          const peak = points.reduce((best, p) => (p.iRating > best.iRating ? p : best));
          const low = points.reduce((worst, p) => (p.iRating < worst.iRating ? p : worst));
          const changes = points.map((p) => ({ p, change: p.iRating - p.oldIRating }));
          const gain = changes.reduce((a, b) => (b.change > a.change ? b : a));
          const loss = changes.reduce((a, b) => (b.change < a.change ? b : a));
          const recent = points.slice(-10);
          const inCategory = rated.filter((e) => e.category === category);
          const firstSafety = inCategory.find((e) => e.oldSafetyRating !== null)?.oldSafetyRating ?? null;
          const lastSafety = [...inCategory].reverse().find((e) => e.newSafetyRating !== null)?.newSafetyRating ?? null;
          return [
            `${category}: ${points.length} rated events from ${day(first.startTime)} to ${day(last.startTime)}.`,
            `  Started at ${first.oldIRating}, now ${last.iRating} (${signed(last.iRating - first.oldIRating)}).`,
            `  Peak ${peak.iRating} on ${day(peak.startTime)}, low ${low.iRating} on ${day(low.startTime)}.`,
            `  Biggest gain ${signed(gain.change)} (${day(gain.p.startTime)} ${gain.p.series} @ ${gain.p.track}), ` +
              `biggest loss ${signed(loss.change)} (${day(loss.p.startTime)} ${loss.p.series} @ ${loss.p.track}).`,
            `  Last ${recent.length} events: ${signed(recent[recent.length - 1].iRating - recent[0].oldIRating)} ` +
              `(${recent.map((p) => p.iRating).join(', ')}).`,
            `  Safety rating ${firstSafety ?? 'n/a'} at the start, ${lastSafety ?? 'n/a'} now.`,
          ].join('\n');
        }),
        incidentSummary(unique),
      ].join('\n'),
    {
      name: 'get_irating_overview',
      description:
        'iRating start, current, peak, low, biggest gain/loss, recent form and safety rating for each license ' +
        'category, and the incident trend across all races. Call this first.',
      schema: z.object({}),
    }
  );

  const breakdown = tool(
    async ({ by }: { by: keyof typeof GROUPINGS }) => {
      const groups = new Map<string, RaceEvent[]>();
      for (const e of unique) {
        const key = GROUPINGS[by](e);
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      const rows = [...groups.entries()].map(([key, group]) => {
        const ratedGroup = group.filter(isRated);
        const net = ratedGroup.reduce((s, e) => s + e.newIRating - e.oldIRating, 0);
        const gained = nums(group.map((e) => (e.startPosition && e.finishPosition ? e.startPosition - e.finishPosition : null)));
        return {
          net,
          line:
            `- ${key}: ${group.length} events, iRating ${signed(net)} over ${ratedGroup.length} rated, ` +
            `avg start ${avg(nums(group.map((e) => e.startPosition)))}, avg finish ${avg(nums(group.map((e) => e.finishPosition)))}, ` +
            `avg places gained ${avg(gained)}, avg incidents ${avg(group.map((e) => e.incidents))}`,
        };
      });
      const sorted = by === 'month' ? rows : rows.sort((a, b) => b.net - a.net);
      return [`Grouped by ${by} (${rows.length} groups):`, ...sorted.slice(0, 60).map((r) => r.line)].join('\n');
    },
    {
      name: 'get_breakdown',
      description:
        'Net iRating change, average starting and finishing position, places gained and incidents, ' +
        'grouped by series, track, car, month or license category.',
      schema: z.object({ by: z.enum(['series', 'track', 'car', 'month', 'category']) }),
    }
  );

  const eventList = tool(
    async ({ from, to }: { from: string | null; to: string | null }) => {
      const inRange = unique.filter((e) => (!from || day(e.startTime) >= from) && (!to || day(e.startTime) <= to));
      if (inRange.length === 0) return `No events between ${from ?? 'the start'} and ${to ?? 'the end'}.`;
      const shown = inRange.slice(0, 60);
      return [
        ...shown.map(describeEvent),
        inRange.length > shown.length ? `(${inRange.length - shown.length} more; narrow the dates to see them)` : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
    {
      name: 'get_events',
      description: 'Every event in a date range (YYYY-MM-DD; null for an open end), oldest first, up to 60 at a time.',
      schema: z.object({
        from: z.string().nullable().describe('First day to include, YYYY-MM-DD, or null for the start'),
        to: z.string().nullable().describe('Last day to include, YYYY-MM-DD, or null for the end'),
      }),
    }
  );

  return [overview, breakdown, eventList];
}

const SYSTEM_PROMPT =
  "You are a sim racing coach reviewing a driver's iRacing race results. The driver can already see charts of " +
  'their iRating and incidents over time, so do not just restate them. Start with get_irating_overview, then use get_breakdown and ' +
  'get_events to explain the trend: when and where the rating rose or fell, which series, tracks or cars went well ' +
  'or badly, and whether starting position, places gained, incidents or safety rating explain it. Use only numbers from the tools, never ' +
  'invent data, write to the driver as "you", keep it under 150 words, and use plain text with no markdown.';

export async function runRaceTrends(
  driver: string,
  events: RaceEvent[]
): Promise<{ trend: IRatingSeries[]; incidents: IncidentPoint[]; commentary: string; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const tools = createTools(driver, events);
  const agent = createAgent({
    model: new ChatOpenAI({ model: 'gpt-4o', temperature: 0.2 }),
    tools,
    systemPrompt: SYSTEM_PROMPT,
    responseFormat: commentarySchema,
  });

  const result = await agent.invoke(
    { messages: [{ role: 'user', content: `Analyze the iRating trend for ${driver}.` }] },
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

  return {
    trend: iRatingTrend(events),
    incidents: incidentTrend(events),
    commentary: result.structuredResponse.commentary,
    steps,
  };
}
