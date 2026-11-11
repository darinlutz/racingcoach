import { createHash } from 'node:crypto';
import { createAgent } from 'langchain';
import { z } from 'zod';
import { brakeChangeRule, createTools, type DebriefSession } from './debriefCoach';
import { engineeringKnowledgeTool } from './engineering/knowledgeTool';
import { assessWeather, weatherFacts, type WeatherContext } from './engineering/weatherContext';
import { brakesLaterOnColdTires, tireWarmupFact, type TireWarmup } from './tireWarmup';
import { hasTrackPosition, withKmh } from './trackPositions';
import { DEFAULT_UNITS, DISTANCE_NAME, DISTANCE_UNIT, SPEED_UNIT, type Units } from './units';
import { languageCheck, type LanguageCheck } from './answerChecks';
import { englishWords, hasEnglish } from './i18n/englishWords';
import { aiLanguageFeedback, aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { getDictionary } from './i18n/server';
import { LAP_TIME_RULE } from './lapData';
import { ENGINEERING_KNOWLEDGE_RULE, LIVE_COACHING_METHOD, repeatsAny } from './coachingGuidance';
import { formatSeconds } from './stintExport';
import { chatModel, getAiModel, structured, withFallbackModel } from '@/lib/aiModels';

// The In-Car AI Coach: the telemetry collector's coach while the driver is on track. Each user writes their own
// In-Car AI Coach Instructions on the Account page ("Users".in_car_coach_instructions), on top of the built-in
// coaching method (src/lib/coachingGuidance.ts). It works in two parts:
//   - Plan (inCarCoachPlan): at the start of a session the collector fetches the instructions turned into rules
//     it runs itself on live telemetry (e.g. play a sound at the start/finish line), and how to deliver what the
//     coach says. No laps needed; no AI call without instructions. Every plan also says each lap time and New
//     best lap (builtInRules), without the driver having to ask.
//   - Lap feedback (inCarCoachCallouts): after laps upload, the agent looks through the session's laps so far with
//     the Debrief Coach's tools (debriefCoach.ts) and answers what to tell the driver now, if anything. Laps
//     driven live have no track positions until after the stint, and the coach never sees where the car is on the
//     track while it drives, so it never gives driving line advice: it has no get_driving_line tool, its prompt
//     forbids it, and a callout about the line is dropped (givesLineAdvice).

// Events the collector can detect on live telemetry, and the sounds it can play (CoachRules.cs in the collector)
export const COACH_EVENTS = ['lapStart', 'lapComplete', 'newBestLap', 'areaEntry', 'areaExit', 'pitEntry', 'pitExit', 'incident'] as const;
export const COACH_SOUNDS = ['beep', 'doubleBeep', 'chime', 'alert'] as const;

const ruleSchema = z.object({
  event: z
    .enum(COACH_EVENTS)
    .describe(
      'When the rule fires: lapStart the instant the car crosses the start/finish line; lapComplete about a second ' +
        'later, once the lap time is known; newBestLap when a lap is the best of the session so far (fires after ' +
        'lapComplete); areaEntry and areaExit at the start and end of a focus area; pitEntry and pitExit on entering ' +
        'and leaving pit road; incident when the driver gets incident points'
    ),
  area: z.string().nullable().describe('For areaEntry and areaExit: the focus area name, exactly as listed, or null for every area. Null for other events'),
  action: z.enum(['say', 'sound', 'message']).describe('say: speak the text; sound: play the sound; message: show the text on screen'),
  text: z
    .string()
    .nullable()
    .describe(
      'For say and message: what to say or show, short. It can use {lap} (the lap number just completed), ' +
        '{lapTime} (that lap time), {best} (the session best lap time), {delta} (that lap minus the best, e.g. ' +
        '+0.42), {area} (the focus area), {incidents} (the incident count). Null for sound'
    ),
  sound: z.enum(COACH_SOUNDS).nullable().describe('For sound: which one. Null for say and message'),
});

const planSchema = z.object({
  rules: z.array(ruleSchema).describe('One rule per thing the instructions ask to happen at a moment on track; empty when they ask for none'),
  speak: z.boolean().describe('Speak the lap feedback (true unless the instructions say not to talk or to only show messages)'),
  show: z
    .boolean()
    .describe(
      'Show the lap feedback on screen. True unless the instructions explicitly ask for nothing on screen; ' +
        'instructions about when or whether to talk (e.g. "only talk to me on the straights") are about speaking ' +
        'and leave this true'
    ),
  holdInFocusAreas: z.boolean().describe('Wait until the car is out of a focus area before speaking the lap feedback (true only when asked not to talk in corners or focus areas)'),
  lapFeedback: z.boolean().describe('Give coaching feedback from the laps at all (true unless the instructions say not to coach or only want the rules)'),
  feedbackEveryLaps: z.number().int().describe('How many laps between lap feedback: 1 for every lap unless the instructions ask for less often'),
  pronunciations: z
    .array(
      z.object({
        written: z.string().describe('The name as it is spelled, e.g. Lutz'),
        spoken: z.string().describe('Spelled the way it sounds, so a voice reading it says it right, e.g. Loots (rhymes with boots)'),
      })
    )
    .describe('Every name the instructions say how to pronounce; empty when they say none'),
});

export type CoachRule = z.infer<typeof ruleSchema>;
export type InCarCoachPlan = z.infer<typeof planSchema>;

const DEFAULT_PLAN: InCarCoachPlan = {
  rules: [],
  speak: true,
  show: true,
  holdInFocusAreas: false,
  lapFeedback: true,
  feedbackEveryLaps: 1,
  pronunciations: [],
};
const MAX_RULES = 20;
const MAX_PRONUNCIATIONS = 10;

// Rules every driver's coach runs, in their language: the lap time as each lap ends, and New best lap. Left out
// when the instructions ask the coach not to talk (speak false)
function builtInRules(language: Language): CoachRule[] {
  const words = getDictionary(language).coachSpeech;
  return [
    { event: 'lapComplete', area: null, action: 'say', text: words.lapTime, sound: null },
    { event: 'newBestLap', area: null, action: 'say', text: words.newBest, sound: null },
  ];
}

const withBuiltInRules = (plan: InCarCoachPlan, language: Language): InCarCoachPlan => ({
  ...plan,
  rules: plan.speak ? [...builtInRules(language), ...plan.rules] : plan.rules,
});

// What the built-in rules already say, so the plan doesn't say it twice
const BUILT_IN_RULES_PROMPT =
  ' The coach already says the lap time as each lap ends and "New best lap" on a new best, for every driver, so ' +
  'never make a rule that says or shows the lap time on lapComplete, or that announces a new best lap.';
const MAX_FEEDBACK_EVERY_LAPS = 20;

const calloutsSchema = z.object({
  callouts: z
    .array(
      z.object({
        text: z.string().describe('What to tell the driver, one short sentence they can take in at speed (under 15 words)'),
        sound: z.enum(COACH_SOUNDS).nullable().describe('A sound to play first, only when the instructions ask for one; otherwise null'),
      })
    )
    .describe(
      'Exactly 2 callouts, the most important first. The driver hears only the first, once per lap; the second is ' +
        'a spare in case the first cannot be used'
    ),
});

export type Callout = z.infer<typeof calloutsSchema>['callouts'][number];
const MAX_CALLOUTS = 1; // the coach talks once per lap; the model gives 2, the second a spare in case one is dropped

// The driver's own instructions: they say what this coach does in their car
export function driverInstructionsRule(instructions: string): string {
  if (!instructions.trim()) return '';
  return (
    "\n\nThe driver has given these instructions for their own In-Car AI Coach. Follow them: they decide what you " +
    'say, how often and what you leave out. If one needs data you do not have, ignore it; never invent data.\n' +
    `<driver_instructions>\n${instructions.trim()}\n</driver_instructions>`
  );
}

const PLAN_PROMPT =
  'You set up an In-Car AI Coach for a sim racing driver. The coach runs on the driver\'s PC during the session: it ' +
  'can fire rules on moments it detects in live telemetry (each rule speaks a short text, plays a sound or shows a ' +
  'message), and after laps it gives coaching feedback from the laps so far. Turn the driver\'s instructions into ' +
  'that setup. Make a rule only for something the instructions ask to happen at one of the listed moments; ' +
  'coaching advice, analysis and things to avoid are not rules (they steer the lap feedback, which follows the ' +
  'same instructions). When an instruction asks for something the coach cannot detect or do, leave it out. Keep ' +
  'rule texts short and write them in the language below, with names spelled normally: when the instructions ' +
  'say how a name is pronounced, list it in pronunciations, and the voice will say it that way.';

// Rule texts are spoken and shown as they are, so any distance or speed in them is in the user's units, and no
// distance in them is a place on the track
const unitsRule = (units: Units) =>
  ` Any distance or speed in a rule text is in ${DISTANCE_NAME[units]} (${DISTANCE_UNIT[units]}) and ${SPEED_UNIT[units]}. ` +
  brakeChangeRule(units);

// A plan is only worked out again when the instructions, the track's focus areas, the language or the units change
const planCache = new Map<string, InCarCoachPlan>();
const PLAN_CACHE_SIZE = 500;

// The collector gives up on a request after 60 s (RacingCoachApi.cs), so the coach answers within 50 s whatever the
// model does, the picked model getting the first 30 (withFallbackModel)
const COACH_TIMES = { pickedMs: 30_000, totalMs: 50_000 };

export async function inCarCoachPlan(
  instructions: string,
  areaNames: string[],
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS
): Promise<InCarCoachPlan> {
  if (!instructions.trim()) return withBuiltInRules(DEFAULT_PLAN, language);
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  // Keyed by model too, so a model picked on the Admin page takes effect at once
  const model = await getAiModel('inCarCoachPlan');
  const key = createHash('sha256')
    .update(JSON.stringify([instructions.trim(), areaNames, language, units, model]))
    .digest('hex');
  const cached = planCache.get(key);
  if (cached) return withBuiltInRules(cached, language);

  const content =
    `Focus areas on this track: ${areaNames.length > 0 ? areaNames.join(', ') : 'none (no areaEntry or areaExit rules)'}.\n` +
    `<driver_instructions>\n${instructions.trim()}\n</driver_instructions>`;
  // Rule texts are spoken and shown as they are, so a plan for a user of another language with English in them gets
  // one rewrite, and a rule whose text still has English is left out (cleanPlan)
  const check = await languageCheck(language, areaNames);
  const englishIn = (plan: InCarCoachPlan) =>
    check ? englishWords(plan.rules.map((rule) => rule.text ?? '').join('\n'), language, check.names) : [];
  const answer = await withFallbackModel('inCarCoachPlan', COACH_TIMES, async (aiModel, signal) => {
    const agent = createAgent({
      model: await chatModel('inCarCoachPlan', 0, aiModel),
      tools: [],
      systemPrompt: PLAN_PROMPT + BUILT_IN_RULES_PROMPT + unitsRule(units) + aiLanguageRule(language),
      responseFormat: planSchema,
    });
    const first = await agent.invoke({ messages: [{ role: 'user', content }] }, { signal });
    const english = englishIn(structured(first));
    if (english.length === 0) return structured(first);
    const again = await agent.invoke(
      { messages: [...first.messages, { role: 'user', content: aiLanguageFeedback(language, english) }] },
      { signal }
    );
    return structured(again);
  });

  const plan = cleanPlan(answer, areaNames, check);
  if (planCache.size >= PLAN_CACHE_SIZE) planCache.delete(planCache.keys().next().value!);
  planCache.set(key, plan);
  return withBuiltInRules(plan, language);
}

// Drops rules the collector couldn't run (a say or message with no text, a sound with none, an unknown area), and
// any whose text says where on the track something happens (src/lib/trackPositions.ts)
function cleanPlan(plan: InCarCoachPlan, areaNames: string[], check?: LanguageCheck): InCarCoachPlan {
  const rules = plan.rules
    .flatMap((rule): CoachRule[] => {
      const isAreaEvent = rule.event === 'areaEntry' || rule.event === 'areaExit';
      const area = isAreaEvent && rule.area ? areaNames.find((n) => n.toLowerCase() === rule.area!.trim().toLowerCase()) : null;
      if (isAreaEvent && rule.area && !area) return [];
      if (rule.action === 'sound') return [{ ...rule, area: area ?? null, text: null, sound: rule.sound ?? 'beep' }];
      if (!rule.text?.trim() || hasTrackPosition(rule.text)) return [];
      if (check && hasEnglish(rule.text, check.language, check.names)) {
        console.warn(`In-Car AI Coach rule left out, its text still has English for a ${check.language} user: ${rule.text}`);
        return [];
      }
      // the built-in rules already say these
      if (rule.action === 'say' && (rule.event === 'newBestLap' || (rule.event === 'lapComplete' && rule.text.includes('{lapTime}')))) return [];
      return [{ ...rule, area: area ?? null, text: withKmh(rule.text.trim()), sound: null }];
    })
    .slice(0, MAX_RULES);
  return {
    ...plan,
    rules,
    pronunciations: (plan.pronunciations ?? []).filter((p) => p.written.trim() && p.spoken.trim()).slice(0, MAX_PRONUNCIATIONS),
    feedbackEveryLaps: Math.min(MAX_FEEDBACK_EVERY_LAPS, Math.max(1, Math.round(plan.feedbackEveryLaps || 1))),
  };
}

const calloutPrompt = (units: Units) =>
  'You are an In-Car AI Coach for a sim racing driver who is driving right now. After each lap the driver\'s ' +
  'laps so far in this session are analysed, and you decide what, if anything, to tell them before the next ' +
  'lap. Every lap you give exactly 2 callouts, most important first: the driver hears only the first, once per ' +
  'lap, and the second is a spare. They are at speed: each callout is one short sentence they can take in while driving, with at most one ' +
  `number, and points at one focus area and one change (for example "Turn 1: brake about ${units === 'metric' ? 6 : 20} ` +
  `${DISTANCE_UNIT[units]} later"). When the ` +
  'Debrief Coach tools are available, start with get_session_overview, then dig into ' +
  'the focus areas that lose the most time with get_area_detail and the braking, throttle and steering tools, and get_shifting_points for the upshifts; any ' +
  'brakepoint advice must follow the brakepoint verdict, and any throttle pickup advice the pickup verdict. ' +
  brakeChangeRule(units) +
  ' You cannot see where the car is on the track: live laps have no track positions, so never give driving line ' +
  'advice of any kind (the racing line, the apex, turning in earlier or later, running wide, the track out, using ' +
  'the curbs or the track width, inside or outside of the corner, positioning the car), even when instructions ask ' +
  'for it; coach only the inputs the data measures (brake, throttle, steering amount, gears, speed). Anything the driver\'s instructions ask to ' +
  'happen at a moment on track (a sound at the line, the lap time after each lap, a message at an area) is ' +
  'already done by the coach\'s rules, so never repeat it here: your callouts are coaching from the lap data. Only ' +
  'add a sound when the instructions ask for one with coaching. Never return fewer than 2 callouts. Vary them from ' +
  'lap to lap: prefer a focus area or change you have not mentioned recently, tell the driver how the newest lap ' +
  'went on something you said before (better or worse, with its number), or give the next most useful change. ' +
  'Only repeat earlier advice word for word when nothing else in the data is worth saying. ' +
  'Before you write the callouts, call get_engineering_knowledge once for the focus area and problem your first ' +
  'callout is about (e.g. steering held long with the speed down, the throttle picked up and dropped again, a late ' +
  'hard brake release), and choose the driving correction from it; a callout is always a driving change, never a ' +
  'setup change. ' +
  'Use the numbers from the data, never ' +
  'invent data, talk to the driver as "you", and use plain text with no markdown.' +
  LAP_TIME_RULE +
  ' Your callouts are spoken, though, so round every time difference (a gap between laps, or time lost or gained in ' +
  'a focus area) to the nearest tenth of a second and write it the way a race engineer says it on the radio, never ' +
  'with "s" for seconds: under a second in tenths (e.g. "two tenths slower" for 0.213 s), otherwise in seconds with ' +
  'one decimal (e.g. "2.3 seconds faster" for 2.319 s).';

// A callout about the driving line (English only; the prompt forbids it in every language), which the coach can't see
const LINE_ADVICE = [
  /\b(racing|driving) line\b/i,
  /\b(tighter|wider|later|earlier|different|better|cleaner|wide|tight|inside|outside) line\b/i,
  /\bapex\b/i,
  /\btrack[- ]?out\b/i,
  /\brun(ning|s)? wide\b/i,
  /\b(curbs?|kerbs?|track width)\b/i,
  /\b(inside|outside) of the (corner|turn)\b/i,
  /\bturn[- ]?in (point|earlier|later|sooner)\b/i,
];
export function givesLineAdvice(text: string): boolean {
  return LINE_ADVICE.some((p) => p.test(text));
}

export type InCarLap = { id: string; lapNumber: number; lapSeconds: number; incidents: number; offTrack: boolean };

// The live conditions for the callouts, only on a wet or changing track or with tires that don't suit it, so a dry
// session's callout prompt is exactly as before
export function wetCalloutFacts(weather: WeatherContext | null | undefined, units: Units): string[] {
  const w = assessWeather(weather);
  if (!w || (!w.wet && !w.drying && !w.mismatch && w.fittedCompound !== 'wet' && w.fittedCompound !== 'intermediate')) return [];
  return [
    'The track conditions now:',
    ...weatherFacts(weather, units === 'metric' ? 'metric' : 'standard'),
    'Coach for these conditions: in the wet compare the newest lap with my laps in similar conditions, not with a ' +
      'dry lap; earlier, more progressive braking and smoother throttle are often right, so only tell me to brake ' +
      'later or get on the throttle sooner when my own wet laps show it works. Point at one input the data shows ' +
      '(e.g. throttle picked up earlier than my best wet run in a focus area, or the brake released abruptly). When ' +
      'the tires do not suit the track, say that first. Never claim standing water, aquaplaning, ABS or traction ' +
      'control activity, or a tire temperature the data does not show; never state a weather forecast.',
  ];
}

export async function inCarCoachCallouts(input: {
  instructions: string;
  track: string;
  car: string;
  laps: InCarLap[];
  // The laps measured in the track's focus areas, or null when the track isn't in Track Data
  session: DebriefSession | null;
  // The car's rev limit from the user's Car Data, for get_shifting_points
  carRpmLimit?: number | null;
  recentCallouts: string[];
  language?: Language;
  units?: Units;
  // Whether the newest lap's tires are still cold (src/lib/tireWarmup.ts)
  tires?: TireWarmup | null;
  // The live track conditions and fitted tires (engineering/weatherContext.ts); null when the driver isn't live
  weather?: WeatherContext | null;
}): Promise<{ callouts: Callout[]; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const units = input.units ?? DEFAULT_UNITS;
  const hasAreas = !!input.session && input.session.areas.some((area) => area.runs.length > 0);
  // The Race Engineering knowledge base (src/lib/engineering/knowledgeTool.ts), only alongside lap data to judge
  const tools = hasAreas
    ? [
        // no track positions in live laps, so no driving line
        ...createTools(input.session!, units, input.carRpmLimit ?? null).filter((t) => t.name !== 'get_driving_line'),
        engineeringKnowledgeTool(input.car, {
          maxTokens: 600,
          agent: 'inCarCoachCallouts',
          units: units === 'metric' ? 'metric' : 'standard',
          ...(input.weather !== undefined ? { weather: input.weather } : {}),
        }),
      ]
    : [];
  const systemPrompt =
    calloutPrompt(units) +
    LIVE_COACHING_METHOD +
    (hasAreas ? ENGINEERING_KNOWLEDGE_RULE : '') +
    driverInstructionsRule(input.instructions) +
    aiLanguageRule(input.language ?? DEFAULT_LANGUAGE);

  const lapLines = input.laps.map(
    (lap) =>
      `${lap.id}: ${formatSeconds(lap.lapSeconds)}` +
      (lap.incidents > 0 ? `, ${lap.incidents} incident points` : '') +
      (lap.offTrack ? ', went off track' : '')
  );
  const content = [
    `${input.track}, ${input.car}. Laps so far this session, oldest first:`,
    ...lapLines,
    '',
    hasAreas
      ? 'The Debrief Coach tools have every lap measured in the focus areas from my Track Data.'
      : 'This track has no focus areas in my Track Data, so only the lap times are available.',
    ...(input.tires?.cold ? [tireWarmupFact(input.tires, units)] : []),
    ...wetCalloutFacts(input.weather, units),
    input.recentCallouts.length > 0
      ? 'Already said recently, and I am working on it, so tell me how my newest lap went on it or move on to ' +
        'something else, rather than saying it the same way again: ' +
        input.recentCallouts.map((c) => `"${c}"`).join(' ')
      : 'You have not said anything yet this session.',
    'What are your 2 callouts for my next lap?',
  ].join('\n');

  const result = await withFallbackModel('inCarCoachCallouts', COACH_TIMES, async (aiModel, signal) => {
    const agent = createAgent({
      model: await chatModel('inCarCoachCallouts', 0.5, aiModel),
      tools,
      systemPrompt,
      responseFormat: calloutsSchema,
    });
    const answer = await agent.invoke({ messages: [{ role: 'user', content }] }, { recursionLimit: 20, signal });
    return { callouts: structured(answer).callouts as Callout[], messages: answer.messages };
  });
  // A callout that still says where on the track to brake (feet or meters from the line) is dropped, and so is one
  // telling the driver to brake later on cold tires without saying it's for once they're warm; saying nothing is fine
  const coldTires = !!input.tires?.cold;
  // and so is one with English words in it for a user of another language (the spare is said instead)
  const check = await languageCheck(input.language ?? DEFAULT_LANGUAGE, [
    input.track,
    input.car,
    ...(input.session?.areas.map((area) => area.name) ?? []),
  ]);
  const callouts = result.callouts
    .filter(
      (c) =>
        c.text.trim() &&
        !hasTrackPosition(c.text) &&
        !givesLineAdvice(c.text) &&
        !(coldTires && brakesLaterOnColdTires(c.text)) &&
        !(check && hasEnglish(c.text, check.language, check.names)) &&
        // much the same as something said in the last few laps: the spare, or nothing, is said instead
        !repeatsAny(c.text, input.recentCallouts)
    )
    .slice(0, MAX_CALLOUTS)
    .map((c) => ({ text: withKmh(c.text.trim()), sound: c.sound ?? null }));
  const toolNames = new Set(tools.map((t) => t.name));
  const steps = result.messages.flatMap((message) =>
    'tool_calls' in message && Array.isArray(message.tool_calls)
      ? message.tool_calls.filter((call) => toolNames.has(call.name)).map((call) => call.name)
      : []
  );
  return { callouts, steps };
}
