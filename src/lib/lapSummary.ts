import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { brakeChangeRule } from './debriefCoach';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { LAP_TIME_RULE } from './lapData';
import type { LapDrivingLine } from './lapDrivingLine';
import { coachInstructionsRule } from './siteSettings';
import { TRACK_POSITION_RULE, withoutTrackPositions } from './trackPositions';
import { DEFAULT_UNITS, DISTANCE_NAME, DISTANCE_UNIT, distanceFromMeters, roundLineOffset, SPEED_UNIT, type Units } from './units';
import { chatModel } from '@/lib/aiModels';

// How the prompts name the user's units: the data they're sent is already in them
function unitWords(units: Units) {
  return { distanceName: DISTANCE_NAME[units], speedUnit: SPEED_UNIT[units] };
}

// Lines this close together (0.5 m, about 1.6 ft) are treated as the same line
const SAME_LINE_METERS = 0.5;

// 45 -> "the middle of the area"
function partOfArea(pct: number) {
  if (pct <= 15) return 'the entry';
  if (pct <= 40) return 'turn-in';
  if (pct <= 60) return 'the middle of the area';
  if (pct <= 85) return 'the second half of the area';
  return 'the exit';
}

// The Racing Coach's analyze_driving_line tool: how far, and which way, the Compare lap's line was from the
// Base lap's through one focus area, with a verdict worked out here so left and right can't get flipped.
// Directions are always left or right, never inside or outside. Distances are in the user's units.
function analyzeDrivingLineTool(lines: LapDrivingLine[], areaNames: string[], units: Units) {
  const unit = DISTANCE_UNIT[units];
  // Whole feet (2.1 -> "2 ft"), or meters to one decimal
  const distance = (meters: number) => `${roundLineOffset(distanceFromMeters(Math.abs(meters), units), units)} ${unit}`;

  return tool(
    async ({ area: name }: { area: string }) => {
      const wanted = name.trim().toLowerCase();
      const line = lines.find((l) => l.area.toLowerCase() === wanted);
      if (!line) {
        if (!areaNames.some((a) => a.toLowerCase() === wanted)) {
          return `No focus area named "${name}". Focus areas: ${areaNames.join(', ')}`;
        }
        return (
          `One or both laps have no track positions (Lat/Lon) in ${name}, so the driving lines cannot be compared ` +
          'there. Do not give driving line advice for this area.'
        );
      }

      // Left of the Base line is positive. Always left or right, never inside or outside of the corner.
      const side = (meters: number) => (meters >= 0 ? 'left' : 'right');
      // 0.62 -> "2 ft left", -0.62 -> "2 ft right", rounding to 0 -> "on the Base line"
      const offset = (meters: number) =>
        Number.parseFloat(distance(meters)) === 0 ? 'on the Base line' : `${distance(meters)} ${side(meters)}`;
      const time = `${line.secondsDiff >= 0 ? '+' : '-'}${Math.abs(line.secondsDiff).toFixed(3)}s`;
      const where = `${partOfArea(line.maxOffsetAtPct)} (${line.maxOffsetAtPct}% through the area)`;

      let verdict: string;
      if (Math.abs(line.maxOffsetM) < SAME_LINE_METERS) {
        verdict =
          `Line verdict: the two laps take lines within ${distance(SAME_LINE_METERS)} of each other here, so the driving ` +
          'line does not explain the time. Do not give driving line advice for this area.';
      } else if (line.secondsDiff <= 0) {
        verdict =
          `Line verdict: the Compare lap was faster here while running up to ${distance(line.maxOffsetM)} further ` +
          `${side(line.maxOffsetM)} at ${where}, so it should keep its line; do not tell it to copy the Base lap's line.`;
      } else {
        verdict =
          `Line verdict: the Compare lap was ${distance(line.maxOffsetM)} further ${side(line.maxOffsetM)} than the faster ` +
          `Base lap at ${where}. Any driving line advice for this area must say to move the car about ` +
          `${distance(line.maxOffsetM)} to the ${side(-line.maxOffsetM)} there, in those words: left or right, never ` +
          'inside or outside.';
      }

      return [
        `${line.area} driving line: the Compare lap against the Base lap's line (the Compare lap was ${time} here). ` +
          "Left and right are as seen from the driver's seat, facing the direction of travel" +
          (line.turn ? ` (it is a ${line.turn}-hand corner).` : '.'),
        "Compare lap's distance from the Base line every 10% through the area: " +
          line.offsetsM.map((m, i) => `${i * 10}% ${offset(m)}`).join(', ') +
          '.',
        `Largest difference: ${offset(line.maxOffsetM)} at ${where}.`,
        verdict,
      ].join('\n');
    },
    {
      name: 'analyze_driving_line',
      description:
        "Compares the Compare lap's driving line with the Base lap's through one focus area: how many " +
        `${DISTANCE_NAME[units]} the Compare lap was to the left or right of the Base line every 10% through ` +
        'the area, the largest difference and a line verdict. ' +
        (lines.length > 0
          ? `Both laps have track positions in: ${lines.map((l) => l.area).join(', ')}.`
          : 'Neither lap has track positions anywhere, so do not call it.'),
      schema: z.object({ area: z.string().describe('Focus area name, exactly as in the comparison') }),
    }
  );
}

const lapSummarySchema = z.object({
  summary: z.string().describe('The 6 or 7 sentence summary, in a single paragraph of plain prose'),
});

const lapSummaryPrompt = (track: string, units: Units) =>
  'You are a sim racing driving coach. The user will give you a focus-area comparison of two laps ' +
  `of ${track}: a Base lap and a Compare lap. Each focus area lists the time through the area for ` +
  'both laps with the difference (Compare minus Base; negative means the Compare lap was faster), ' +
  `how many ${DISTANCE_NAME[units]} later or earlier the Compare lap first touched the brake than the Base lap (the ` +
  'reference brakepoint), and the peak brake pressure for each lap (harder or lighter for the ' +
  `Compare lap), the minimum speed through the area (min speed, in ${SPEED_UNIT[units]}) for each lap, and the ` +
  `speed at the end of the area (exit speed, in ${SPEED_UNIT[units]}) for each lap. After the focus areas, a ` +
  '"Biggest losses" line lists the focus areas where the Compare lap lost the most time, most first, already ranked ' +
  'for you: trust it rather than ranking the areas yourself. Before writing, call analyze_driving_line on each ' +
  'area in the "Biggest losses" line that has track positions, to see whether the driving line explains the time. ' +
  'Write a summary of exactly 6 or 7 sentences from the perspective of the Compare lap that answers: where on the ' +
  'track, and how, could the Compare lap be better? Start with the first area in the "Biggest losses" line, then ' +
  'cover the others in it in that order (never leave out the first), use the numbers from the data, and give ' +
  'concrete advice based on the brakepoint, brake pressure, min speed, exit speed and driving line ' +
  'differences. Briefly note where the Compare lap was already stronger. After the focus areas comes a "Braking ' +
  'advice" line for each area, worked out from the data: any braking advice you give for an area must use exactly ' +
  'that direction (later or earlier, more or less pressure) and number, and never the opposite. A Compare lap that braked ' +
  'lighter must never be told to reduce brake pressure, and one that braked earlier must never be told to brake ' +
  'earlier. Any driving line advice must follow the line verdict from analyze_driving_line exactly (which way, ' +
  `how many ${DISTANCE_NAME[units]} and where in the area), and never be given where the verdict says not to. Say ` +
  'which way to move the car as left or right, never inside or outside. Both ' +
  'laps were driven in the same conditions, which may be wet, so do not assume a dry track; when the advice is ' +
  'more pressure, say to build it progressively to avoid locking up. Write plain prose in a single paragraph with ' +
  'no headings, lists, or markdown, and do not invent data that is not in the comparison or the tool results. ' +
  brakeChangeRule(units);

// Coaching summary of a Lap Compare result, written for the Compare lap. lines are the focus areas' driving
// lines for the analyze_driving_line tool, and areaNames every focus area in the comparison.
export async function summarizeLapComparison(
  comparison: string,
  track: string,
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS,
  lines: LapDrivingLine[] = [],
  areaNames: string[] = lines.map((l) => l.area)
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const agent = createAgent({
    model: await chatModel('lapSummary', 0.3),
    tools: [analyzeDrivingLineTool(lines, areaNames, units)],
    systemPrompt: lapSummaryPrompt(track, units) + LAP_TIME_RULE + (await coachInstructionsRule()) + aiLanguageRule(language),
    responseFormat: lapSummarySchema,
  });
  const result = await agent.invoke({ messages: [{ role: 'user', content: comparison }] }, { recursionLimit: 20 });
  return withoutTrackPositions(result.structuredResponse.summary.trim(), async (feedback) => {
    const rewritten = await agent.invoke({ messages: [...result.messages, { role: 'user', content: feedback }] }, { recursionLimit: 20 });
    return rewritten.structuredResponse.summary.trim();
  });
}

const MULTI_LAP_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sim racing driving coach. The user will give you multi-lap statistics from several laps of ' +
      '{track} by the same driver. It lists the lap times, then each focus area with the best, average ' +
      'and worst time through the area, the average time lost to the best, and the standard deviation ' +
      'of the time; plus the average and standard deviation of the brakepoint (in {distanceName} after or before the ' +
      'fastest lap\'s brakepoint in the area, with the driver\'s Target Lap\'s brakepoint from it too when there is ' +
      'one; after means later), the peak brake pressure (with the Target Lap\'s when there is ' +
      'one), the minimum speed and the exit speed ({speedUnit}). Focus areas are listed from most to least ' +
      'average time lost. Write an analysis in two short paragraphs of plain prose, 8 to 10 sentences in ' +
      'total. The first paragraph covers the biggest opportunities: which focus areas cost the most time ' +
      'on average and what to change there, comparing against the Target Lap where given. The second ' +
      'covers consistency: which focus areas have the largest variation from lap to lap (time, ' +
      'brakepoint, brake pressure or speeds), what that variation suggests the driver is doing, and ' +
      'where the driver is already consistent. Use the numbers from the data, write to the driver as ' +
      '"you", use no headings, lists, or markdown, and do not invent data that is not in the statistics.{rules}',
  ],
  ['user', '{stats}'],
]);

// Opportunities and consistency analysis of a Multi-Lap Analysis result
export async function summarizeMultiLap(
  stats: string,
  track: string,
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = await chatModel('multiLapSummary', 0.3);
  return invokeWithoutTrackPositions(MULTI_LAP_PROMPT_TEMPLATE, model, {
    stats,
    track,
    ...unitWords(units),
    rules: ' ' + brakeChangeRule(units) + LAP_TIME_RULE + (await coachInstructionsRule()) + aiLanguageRule(language),
  });
}

const STINT_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sim racing driving coach. The user will give you a report on one stint at {track}, built ' +
      'from a Garage 61 stint export: lap time statistics and trend, a theoretical best from the best ' +
      'sectors, per-sector best/average/standard deviation, the weather over the stint with the correlation ' +
      'between track temperature and lap time, and fuel use. Write an analysis in three short paragraphs of ' +
      'plain prose, 9 to 12 sentences in total. First, pace: how the stint went, the trend, and how far the ' +
      'best lap is from the theoretical best. Second, sectors: where the most time is lost and where the ' +
      'driver is least consistent, with concrete things to work on. Third, conditions and fuel: whether the ' +
      'weather plausibly affected pace (a correlation can also come from the driver improving over the ' +
      'stint, so say so when that is possible) and what the fuel numbers mean for stint length. Use the ' +
      'numbers from the report, write to the driver as "you", use no headings, lists, or markdown, and do ' +
      'not invent data that is not in the report.{rules}',
  ],
  ['user', '{report}'],
]);

// A prompt and model's answer, rewritten once and then cut if it says where on the track something happens
async function invokeWithoutTrackPositions(
  prompt: ChatPromptTemplate,
  model: Awaited<ReturnType<typeof chatModel>>,
  values: Record<string, string>
): Promise<string> {
  const messages = await prompt.formatMessages(values);
  const response = await model.invoke(messages);
  return withoutTrackPositions(response.text.trim(), async (feedback) =>
    (await model.invoke([...messages, new AIMessage(response.text), new HumanMessage(feedback)])).text.trim()
  );
}

// Coaching analysis of a Stint Analysis report
export async function summarizeStint(report: string, track: string, language: Language = DEFAULT_LANGUAGE): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = await chatModel('stintSummary', 0.3);
  return invokeWithoutTrackPositions(STINT_PROMPT_TEMPLATE, model, {
    report,
    track,
    rules: TRACK_POSITION_RULE + LAP_TIME_RULE + (await coachInstructionsRule()) + aiLanguageRule(language),
  });
}
