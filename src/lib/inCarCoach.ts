import { createHash } from 'node:crypto';
import { createAgent } from 'langchain';
import { z } from 'zod';
import { brakeChangeRule, createTools, type DebriefSession } from './debriefCoach';
import { hasTrackPosition } from './trackPositions';
import { DEFAULT_UNITS, DISTANCE_NAME, DISTANCE_UNIT, SPEED_UNIT, type Units } from './units';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { LAP_TIME_RULE } from './lapData';
import { coachInstructionsRule, getHeadCoachInCarInstructions } from './siteSettings';
import { formatSeconds } from './stintExport';
import { chatModel, getAiModel } from '@/lib/aiModels';

// The In-Car AI Coach: the telemetry collector's coach while the driver is on track. Each user writes their own
// In-Car AI Coach Instructions on the Account page ("Users".in_car_coach_instructions), on top of the head
// coach's AI Coach Instructions that every AI feature follows and the head coach's In-Car AI Coach Instructions
// from the Coach page (getHeadCoachInCarInstructions) that every driver's In-Car AI Coach follows. It works in two parts:
//   - Plan (inCarCoachPlan): at the start of a session the collector fetches the instructions turned into rules
//     it runs itself on live telemetry (e.g. play a sound at the start/finish line), and how to deliver what the
//     coach says. No laps needed; no AI call without instructions.
//   - Lap feedback (inCarCoachCallouts): after laps upload, the agent looks through the session's laps so far with
//     the Debrief Coach's tools (debriefCoach.ts) and answers what to tell the driver now, if anything. Laps
//     driven live have no track positions until after the stint, so the driving line usually can't be compared.

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
});

export type CoachRule = z.infer<typeof ruleSchema>;
export type InCarCoachPlan = z.infer<typeof planSchema>;

const DEFAULT_PLAN: InCarCoachPlan = { rules: [], speak: true, show: true, holdInFocusAreas: false, lapFeedback: true, feedbackEveryLaps: 1 };
const MAX_RULES = 20;
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

// The Coach page's In-Car AI Coach Instructions, for every driver; a failed read only loses them, not the coaching
async function readHeadCoachInCarInstructions(): Promise<string> {
  try {
    return (await getHeadCoachInCarInstructions()).trim();
  } catch (error) {
    console.error("Failed to read the head coach's In-Car AI Coach Instructions:", error);
    return '';
  }
}

const headCoachInCarBlock = (instructions: string) =>
  instructions ? `<head_coach_in_car_instructions>\n${instructions}\n</head_coach_in_car_instructions>` : '';

// The head coach's In-Car AI Coach Instructions, for every driver's In-Car AI Coach, before the driver's own
function headCoachInCarRule(instructions: string): string {
  if (!instructions) return '';
  return (
    '\n\nThe head coach has given these instructions for every driver\'s In-Car AI Coach. Follow them, unless the ' +
    "driver's own instructions below say otherwise or one needs data you do not have; never invent data.\n" +
    headCoachInCarBlock(instructions)
  );
}

// The driver's own instructions, after the head coach's: the driver's say what this coach does in their car
function driverInstructionsRule(instructions: string): string {
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
  'rule texts short and write them in the language below. The head coach\'s instructions, when given, apply to ' +
  'every driver; the driver\'s own instructions come after them and win where the two disagree.';

// Rule texts are spoken and shown as they are, so any distance or speed in them is in the user's units, and no
// distance in them is a place on the track
const unitsRule = (units: Units) =>
  ` Any distance or speed in a rule text is in ${DISTANCE_NAME[units]} (${DISTANCE_UNIT[units]}) and ${SPEED_UNIT[units]}. ` +
  brakeChangeRule(units);

// A plan is only worked out again when the instructions, the track's focus areas, the language or the units change
const planCache = new Map<string, InCarCoachPlan>();
const PLAN_CACHE_SIZE = 500;

export async function inCarCoachPlan(
  instructions: string,
  areaNames: string[],
  language: Language = DEFAULT_LANGUAGE,
  units: Units = DEFAULT_UNITS
): Promise<InCarCoachPlan> {
  const headCoach = await readHeadCoachInCarInstructions();
  if (!instructions.trim() && !headCoach) return DEFAULT_PLAN;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  // Keyed by model too, so a model picked on the Admin page takes effect at once
  const model = await getAiModel('inCarCoachPlan');
  const key = createHash('sha256')
    .update(JSON.stringify([headCoach, instructions.trim(), areaNames, language, units, model]))
    .digest('hex');
  const cached = planCache.get(key);
  if (cached) return cached;

  const agent = createAgent({
    model: await chatModel('inCarCoachPlan', 0),
    tools: [],
    systemPrompt: PLAN_PROMPT + unitsRule(units) + aiLanguageRule(language),
    responseFormat: planSchema,
  });
  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content:
          `Focus areas on this track: ${areaNames.length > 0 ? areaNames.join(', ') : 'none (no areaEntry or areaExit rules)'}.\n` +
          (headCoach ? `${headCoachInCarBlock(headCoach)}\n` : '') +
          (instructions.trim() ? `<driver_instructions>\n${instructions.trim()}\n</driver_instructions>` : ''),
      },
    ],
  });

  const plan = cleanPlan(result.structuredResponse, areaNames);
  if (planCache.size >= PLAN_CACHE_SIZE) planCache.delete(planCache.keys().next().value!);
  planCache.set(key, plan);
  return plan;
}

// Drops rules the collector couldn't run (a say or message with no text, a sound with none, an unknown area), and
// any whose text says where on the track something happens (src/lib/trackPositions.ts)
function cleanPlan(plan: InCarCoachPlan, areaNames: string[]): InCarCoachPlan {
  const rules = plan.rules
    .flatMap((rule): CoachRule[] => {
      const isAreaEvent = rule.event === 'areaEntry' || rule.event === 'areaExit';
      const area = isAreaEvent && rule.area ? areaNames.find((n) => n.toLowerCase() === rule.area!.trim().toLowerCase()) : null;
      if (isAreaEvent && rule.area && !area) return [];
      if (rule.action === 'sound') return [{ ...rule, area: area ?? null, text: null, sound: rule.sound ?? 'beep' }];
      if (!rule.text?.trim() || hasTrackPosition(rule.text)) return [];
      return [{ ...rule, area: area ?? null, text: rule.text.trim(), sound: null }];
    })
    .slice(0, MAX_RULES);
  return {
    ...plan,
    rules,
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
  ' Live laps have no track positions yet, so do not give ' +
  'driving line advice unless get_driving_line shows a line verdict. Anything the driver\'s instructions ask to ' +
  'happen at a moment on track (a sound at the line, the lap time after each lap, a message at an area) is ' +
  'already done by the coach\'s rules, so never repeat it here: your callouts are coaching from the lap data. Only ' +
  'add a sound when the instructions ask for one with coaching. Never return fewer than 2 callouts. Vary them from ' +
  'lap to lap: prefer a focus area or change you have not mentioned recently, tell the driver how the newest lap ' +
  'went on something you said before (better or worse, with its number), or give the next most useful change. ' +
  'Only repeat earlier advice word for word when nothing else in the data is worth saying. ' +
  'Use the numbers from the data, never ' +
  'invent data, talk to the driver as "you", and use plain text with no markdown.' +
  LAP_TIME_RULE;

export type InCarLap = { id: string; lapNumber: number; lapSeconds: number; incidents: number; offTrack: boolean };

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
}): Promise<{ callouts: Callout[]; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const units = input.units ?? DEFAULT_UNITS;
  const hasAreas = !!input.session && input.session.areas.some((area) => area.runs.length > 0);
  const tools = hasAreas ? createTools(input.session!, units, input.carRpmLimit ?? null) : [];
  const agent = createAgent({
    model: await chatModel('inCarCoachCallouts', 0.2),
    tools,
    systemPrompt:
      calloutPrompt(units) +
      (await coachInstructionsRule()) +
      headCoachInCarRule(await readHeadCoachInCarInstructions()) +
      driverInstructionsRule(input.instructions) +
      aiLanguageRule(input.language ?? DEFAULT_LANGUAGE),
    responseFormat: calloutsSchema,
  });

  const lapLines = input.laps.map(
    (lap) =>
      `[${lap.id}] lap ${lap.lapNumber}: ${formatSeconds(lap.lapSeconds)}` +
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
    input.recentCallouts.length > 0
      ? 'Already said recently, and I am working on it, so tell me how my newest lap went on it or move on to ' +
        'something else, rather than saying it the same way again: ' +
        input.recentCallouts.map((c) => `"${c}"`).join(' ')
      : 'You have not said anything yet this session.',
    'What are your 2 callouts for my next lap?',
  ].join('\n');

  const result = await agent.invoke({ messages: [{ role: 'user', content }] }, { recursionLimit: 20 });
  // A callout that still says where on the track to brake (feet or meters from the line) is dropped; saying nothing is fine
  const callouts = (result.structuredResponse.callouts as Callout[])
    .filter((c) => c.text.trim() && !hasTrackPosition(c.text))
    .slice(0, MAX_CALLOUTS)
    .map((c) => ({ text: c.text.trim(), sound: c.sound ?? null }));
  const toolNames = new Set(tools.map((t) => t.name));
  const steps = result.messages.flatMap((message) =>
    'tool_calls' in message && Array.isArray(message.tool_calls)
      ? message.tool_calls.filter((call) => toolNames.has(call.name)).map((call) => call.name)
      : []
  );
  return { callouts, steps };
}
