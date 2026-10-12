import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { coachInstructionsRule } from './siteSettings';
import { DEFAULT_UNITS, DISTANCE_NAME, SPEED_UNIT, type Units } from './units';

// How the prompts name the user's units: the data they're sent is already in them
function unitWords(units: Units) {
  return { distanceName: DISTANCE_NAME[units], speedUnit: SPEED_UNIT[units] };
}

const PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sim racing driving coach. The user will give you a focus-area comparison of two laps ' +
      'of {track}: a Base lap and a Compare lap. Each focus area lists the time through the area for ' +
      'both laps with the difference (Compare minus Base; negative means the Compare lap was faster), ' +
      'where each lap first touched the brake in {distanceName} from the start/finish line (later or earlier ' +
      'for the Compare lap), and the peak brake pressure for each lap (harder or lighter for the ' +
      'Compare lap), the minimum speed through the area (min speed, in {speedUnit}) for each lap, and the speed at the end of the area (exit speed, in {speedUnit}) for each lap. Write a summary of exactly 6 or 7 sentences from the perspective of the Compare ' +
      'lap that answers: where on the track, and how, could the Compare lap be better? Name the ' +
      'specific focus areas where the Compare lap lost the most time, use the numbers from the data, ' +
      'and give concrete advice based on the brakepoint, brake pressure, min speed and exit speed differences. Briefly note ' +
      'where the Compare lap was already stronger. After the focus areas comes a "Braking advice" line for ' +
      'each area, worked out from the data: any braking advice you give for an area must use exactly that ' +
      'direction (later or earlier, more or less pressure) and never the opposite. A Compare lap that braked ' +
      'lighter must never be told to reduce brake pressure, and one that braked earlier must never be told to ' +
      'brake earlier. Both laps were driven in the same conditions, which may be wet, so do not assume a dry ' +
      'track; when the advice is more pressure, say to build it progressively to avoid locking up. ' +
      'Write plain prose in a single paragraph with no ' +
      'headings, lists, or markdown, and do not invent data that is not in the comparison.{rules}',
  ],
  ['user', '{comparison}'],
]);

// Coaching summary of a Lap Compare result, written for the Compare lap
export async function summarizeLapComparison(
  comparison: string,
  track: string,
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.3 });
  const chain = PROMPT_TEMPLATE.pipe(model);
  const response = await chain.invoke({
    comparison,
    track,
    ...unitWords(units),
    rules: (await coachInstructionsRule()) + aiLanguageRule(language),
  });
  return typeof response.content === 'string' ? response.content.trim() : '';
}

const MULTI_LAP_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a sim racing driving coach. The user will give you multi-lap statistics from several laps of ' +
      '{track} by the same driver. It lists the lap times, then each focus area with the best, average ' +
      'and worst time through the area, the average time lost to the best, and the standard deviation ' +
      'of the time; plus the average and standard deviation of the brakepoint ({distanceName} from the start/finish ' +
      'line, with the target when there is one; more {distanceName} than the target means braking later than the ' +
      'target), the peak brake pressure (with the target when there is ' +
      'one), the minimum speed and the exit speed ({speedUnit}). Focus areas are listed from most to least ' +
      'average time lost. Write an analysis in two short paragraphs of plain prose, 8 to 10 sentences in ' +
      'total. The first paragraph covers the biggest opportunities: which focus areas cost the most time ' +
      'on average and what to change there, comparing against the targets where given. The second ' +
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

  const model = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.3 });
  const chain = MULTI_LAP_PROMPT_TEMPLATE.pipe(model);
  const response = await chain.invoke({
    stats,
    track,
    ...unitWords(units),
    rules: (await coachInstructionsRule()) + aiLanguageRule(language),
  });
  return typeof response.content === 'string' ? response.content.trim() : '';
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

// Coaching analysis of a Stint Analysis report
export async function summarizeStint(report: string, track: string, language: Language = DEFAULT_LANGUAGE): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.3 });
  const chain = STINT_PROMPT_TEMPLATE.pipe(model);
  const response = await chain.invoke({ report, track, rules: (await coachInstructionsRule()) + aiLanguageRule(language) });
  return typeof response.content === 'string' ? response.content.trim() : '';
}
