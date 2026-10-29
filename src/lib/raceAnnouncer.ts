import { createAgent } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import type { Decision, Format, Speaker } from './broadcastDirector';
import { parseBroadcastSettings, type BroadcastSettings } from './broadcastSettings';
import type { BroadcastEvent, Storyline } from './broadcastTracker';
import { checkLine, deliveryText, fitToSeconds, type LineFacts } from './broadcastValidation';
import { spokenCarName } from './carBrands';
import { ELEVENLABS_COACH_VOICE, isCoachVoice, voicesFor, type CoachVoice, type SpanishAccent } from './coachVoice';
import { query } from './db';
import type { ElevenLabsRole } from './elevenLabs';
import { aiLanguageRule, type Language } from './i18n/languages';
import type { RaceEvent } from './liveRacing';
import { formatSeconds } from './stintExport';
import { hasTrackPosition, TRACK_POSITION_RULE } from './trackPositions';
import { ensureUserSchema } from './users';

// The Race Announcers: a Lead Announcer (play-by-play) and a Color Announcer (analysis), the two-person broadcast team
// of the Live Racing page and TV Broadcast Mode. Each user picks their voices, writes their Race Announcer Instructions
// and sets their Race Broadcast preferences on the Account page ("Users".announcer_lead_voice, announcer_color_voice,
// race_announcer_instructions, broadcast_settings); the voices are the coach voices (src/lib/coachVoice.ts) with each
// announcer's own ElevenLabs voice of the user's language first, and the default.
//
// The Commentary Director (src/lib/broadcastDirector.ts) decides what is said, by whom and how excitedly; here the
// RaceAnnouncer agent (raceAnnouncerLines) only phrases it, from a structured request of verified facts
// (src/lib/announcerCommentary.ts builds it), and every line is checked against those facts before it's spoken
// (src/lib/broadcastValidation.ts).

export const ANNOUNCERS = ['lead', 'color'] as const;
export type Announcer = (typeof ANNOUNCERS)[number];

// Each announcer's ElevenLabs voice (src/lib/elevenLabs.ts)
export const ANNOUNCER_ROLES: Record<Announcer, ElevenLabsRole> = { lead: 'leadAnnouncer', color: 'colorAnnouncer' };

export const MAX_RACE_ANNOUNCER_INSTRUCTIONS = 2000;

export const isAnnouncer = (value: unknown): value is Announcer => ANNOUNCERS.includes(value as Announcer);

// The voices an announcer can speak with in this language and accent, its ElevenLabs voice first
export function announcerVoicesFor(announcer: Announcer, language: Language, spanishAccent: SpanishAccent) {
  return voicesFor(ANNOUNCER_ROLES[announcer], language, spanishAccent);
}

export type RaceAnnouncerSettings = { leadVoice: CoachVoice; colorVoice: CoachVoice; instructions: string; broadcast: BroadcastSettings };

// An account that never picked a voice gets the ElevenLabs one, which falls back to a Chirp voice where it isn't set up
export async function getRaceAnnouncerSettings(userId: number): Promise<RaceAnnouncerSettings> {
  await ensureUserSchema();
  const rows = await query<{ announcer_lead_voice: string; announcer_color_voice: string; race_announcer_instructions: string; broadcast_settings: unknown }>(
    'SELECT announcer_lead_voice, announcer_color_voice, race_announcer_instructions, broadcast_settings FROM racingcoach."Users" WHERE id = $1',
    [userId]
  );
  const { announcer_lead_voice: lead, announcer_color_voice: color, race_announcer_instructions: instructions, broadcast_settings: broadcast } =
    rows[0] ?? {};
  return {
    leadVoice: isCoachVoice(lead) ? lead : ELEVENLABS_COACH_VOICE,
    colorVoice: isCoachVoice(color) ? color : ELEVENLABS_COACH_VOICE,
    instructions: instructions ?? '',
    broadcast: parseBroadcastSettings(broadcast),
  };
}

export async function setAnnouncerVoice(userId: number, announcer: Announcer, voice: CoachVoice): Promise<void> {
  await ensureUserSchema();
  const column = announcer === 'lead' ? 'announcer_lead_voice' : 'announcer_color_voice';
  await query(`UPDATE racingcoach."Users" SET ${column} = $1 WHERE id = $2`, [voice, userId]);
}

export async function setRaceAnnouncerInstructions(userId: number, instructions: string): Promise<void> {
  await ensureUserSchema();
  await query('UPDATE racingcoach."Users" SET race_announcer_instructions = $1 WHERE id = $2', [instructions, userId]);
}

// Saves these Race Broadcast preferences (already checked, broadcastSettingsPatch) over the user's others
export async function setBroadcastSettings(userId: number, patch: Partial<BroadcastSettings>): Promise<BroadcastSettings> {
  await ensureUserSchema();
  const rows = await query<{ broadcast_settings: unknown }>(
    `UPDATE racingcoach."Users" SET broadcast_settings = broadcast_settings || $1::jsonb WHERE id = $2 RETURNING broadcast_settings`,
    [JSON.stringify(patch), userId]
  );
  return parseBroadcastSettings(rows[0]?.broadcast_settings);
}

const tenth = (s: number) => Math.round(s * 10) / 10;

// How the announcers refer to a driver: their name, or, with Announce driver names off, their car number (the
// listener's own driver is always named)
export type NameFor = (name: string) => string;

// One event as a sentence of facts, about the listener's driver (driver) or the field
export function describeEvent(event: RaceEvent, driver: string, name: NameFor, carsByDriver: Record<string, string>): string {
  const inCar = (n: string) => (carsByDriver[n] ? `${name(n)} (${spokenCarName(carsByDriver[n])})` : name(n));
  switch (event.type) {
    case 'lapComplete':
      return (
        `${driver} completed ${event.lap ? `lap ${event.lap}` : 'a lap'} in ${formatSeconds(event.lapTime)}` +
        (event.newBest ? ', a new personal best lap' : event.bestLapTime ? ` (best so far ${formatSeconds(event.bestLapTime)})` : '')
      );
    case 'pitEntry':
      return `${driver} came into pit road`;
    case 'pitExit':
      return `${driver} left pit road and rejoined`;
    case 'offTrack':
      return `${driver} went off the track`;
    case 'incident':
      return `${driver} picked up ${event.added} incident point${event.added === 1 ? '' : 's'} (${event.total} in the session)`;
    case 'positionGained':
      return (
        `${driver} gained ${event.from - event.to === 1 ? 'a place' : `${event.from - event.to} places`}, P${event.from} to P${event.to}` +
        (event.passed && event.from - event.to === 1 ? `, passing ${inCar(event.passed)}` : '')
      );
    case 'positionLost':
      return (
        `${driver} lost ${event.to - event.from === 1 ? 'a place' : `${event.to - event.from} places`}, P${event.from} to P${event.to}` +
        (event.passedBy && event.to - event.from === 1 ? `, passed by ${inCar(event.passedBy)}` : '')
      );
    case 'flag':
      return `The ${event.flag} flag is out` + (event.notes.length > 0 ? ` (${event.notes.join(', ')})` : '');
    case 'leaderChange':
      return `${inCar(event.leader)} takes the lead of the race` + (event.previous ? ` from ${inCar(event.previous)}` : '');
    case 'sessionFastestLap':
      return `${event.isDriver ? driver : inCar(event.driver)} set the fastest lap of the session, ${formatSeconds(event.lapTime)}`;
    case 'nearbyIncident': {
      const what = event.kind === 'offTrack' ? 'went off the track' : 'slowed suddenly on track, likely a spin or a crash (inferred from its speed)';
      return `Incident near ${driver}: ${inCar(event.driver)}, just ${event.ahead ? 'ahead of' : 'behind'} ${driver}, ${what}` + (event.place ? `, ${event.place}` : '');
    }
    default:
      return describeBroadcastEvent(event, driver, name, inCar);
  }
}

function describeBroadcastEvent(e: BroadcastEvent, driver: string, name: NameFor, inCar: (n: string) => string): string {
  switch (e.type) {
    case 'preRace':
      return (
        `Before the start: ${e.starters} cars` +
        (e.classes.length > 1 ? ` in ${e.classes.length} classes (${e.classes.join(', ')})` : '') +
        (e.lapsTotal ? `, a ${e.lapsTotal}-lap race` : e.minutes ? `, a ${e.minutes}-minute race` : '') +
        (e.pole ? `; ${inCar(e.pole)} lines up first` : '') +
        (e.userGrid ? `; ${driver} lines up P${e.userGrid}` : '')
      );
    case 'raceStart':
      return `The race has started, ${e.starters} cars` + (e.userGrid ? `; ${driver} started P${e.userGrid}` : '');
    case 'overtake': {
      const who = e.user === 'gained' ? driver : inCar(e.driver);
      const whom = e.user === 'lost' ? driver : inCar(e.passed);
      const where = e.multiClass && e.carClass ? `P${e.position} in the ${e.carClass} class` : `P${e.position}`;
      return `${who} passed ${whom} on track for ${where}` + (e.finalLap ? ', on the final lap' : '');
    }
    case 'battle': {
      const ahead = inCar(e.ahead);
      const behind = inCar(e.behind);
      const pos = `P${e.position}${e.carClass ? ` (${e.carClass})` : ''}`;
      const trend = e.closingPerLap !== null ? `, ${e.closingPerLap > 0 ? 'closing' : 'losing'} about ${Math.abs(e.closingPerLap).toFixed(1)} s a lap` : '';
      const phases: Record<typeof e.phase, string> = {
        start: `${behind} has caught ${ahead} in the fight for ${pos}: ${tenth(e.gap)} s behind`,
        veryClose: `${behind} is right with ${ahead} for ${pos}, ${tenth(e.gap)} s behind`,
        closing: `${behind} is closing on ${ahead} for ${pos}: ${tenth(e.gap)} s now` + (e.previousGap !== null ? `, from ${tenth(e.previousGap)} s` : ''),
        pulling: `${ahead} is pulling away from ${behind} in the fight for ${pos}: ${tenth(e.gap)} s` + (e.previousGap !== null ? `, from ${tenth(e.previousGap)} s` : ''),
        ended: `The fight for ${pos} between ${ahead} and ${behind} has eased: ${tenth(e.gap)} s apart`,
      };
      return phases[e.phase] + trend + (e.laps >= 1 ? `; they have been within a second for ${e.laps} lap${e.laps === 1 ? '' : 's'}` : '') + '. A time gap only, not side by side.';
    }
    case 'pitStop':
      return e.phase === 'in'
        ? `${inCar(e.driver)} came into pit road from P${e.position ?? '?'}`
        : `${inCar(e.driver)} rejoined after ${tenth(e.seconds ?? 0)} s on pit road` +
            (e.positionBefore && e.position ? `, P${e.positionBefore} before, P${e.position} now` : '');
    case 'fieldIncident': {
      const what = e.kind === 'offTrack' ? 'went off the track' : 'slowed suddenly on track, likely a spin or crash (inferred from its speed, not confirmed)';
      return `${inCar(e.driver)}${e.position ? ` (P${e.position})` : ''} ${what}` + (e.others.length > 0 ? `, with ${e.others.map(name).join(' and ')} in trouble at the same place` : '');
    }
    case 'finalLap':
      return `The leader, ${inCar(e.leader)}, has started the final lap of ${e.lapsTotal}`;
    case 'raceWon':
      return (
        `${e.userWon ? driver : inCar(e.winner)} takes the checkered flag first` +
        (e.margin !== null ? `, ${e.margin.toFixed(1)} s ahead of second` : '') +
        ' (provisional until the results are official)'
      );
    case 'driverFinished':
      return (
        `${driver} crossed the finish line` +
        (e.position ? ` in P${e.position}` : '') +
        (e.gained ? `, ${Math.abs(e.gained)} place${Math.abs(e.gained) === 1 ? '' : 's'} ${e.gained > 0 ? 'better' : 'worse'} than the start` : '') +
        ' (provisional)'
      );
    case 'storyline':
      return describeStoryline(e.storyline, name);
    case 'raceSummary':
      return 'Time for a short update on how the race stands';
    case 'statsUpdate':
      return 'Time for a piece of analysis from the statistics';
  }
}

export function describeStoryline(s: Storyline, name: NameFor): string {
  const f = s.facts;
  const [a, b] = s.drivers.map(name);
  switch (s.kind) {
    case 'recovery':
      return `${a} dropped from P${f.startPosition} to P${f.worstPosition} and has recovered ${f.regained} places, to P${f.position}`;
    case 'charge':
      return `${a} has gained ${f.gained} places since the start, P${f.startPosition} to P${f.position}`;
    case 'longBattle':
      return `${a} and ${b} have been within a second of each other for ${f.laps} laps` + (f.position ? `, fighting for P${f.position}` : '');
    case 'leaderPressure':
      return `The leader ${a} is under pressure: ${b} is ${f.gap} s behind and gaining about ${f.closingPerLap} s a lap`;
  }
}

// One line the Director asked for: who says it, how excited, and how long it may run
export type LinePlan = { speaker: Speaker; intensity: number; maxSeconds: number; job: string };

// What each line of a format is for
export function linePlans(decision: Decision): LinePlan[] {
  const lead = (job: string): LinePlan => ({ speaker: 'lead', intensity: decision.intensity, maxSeconds: decision.maxSeconds.lead, job });
  const color = (job: string): LinePlan => ({ speaker: 'color', intensity: decision.colorIntensity, maxSeconds: decision.maxSeconds.color, job });
  const analysis = 'Add analysis the Lead did not say: why it is happening or what it means, from the statistics given; or qualify the Lead politely when the data supports it.';
  const plans: Record<Format, LinePlan[]> = {
    lead: [lead('Call it: what happened, who is involved and why it matters.')],
    color: [
      color(
        decision.selected.kind === 'stats' || decision.selected.kind === 'summary'
          ? 'Give one meaningful piece of analysis from the statistics, introducing it yourself.'
          : 'React to it with analysis: what it means for the race, from the facts given.'
      ),
    ],
    leadColor: [lead('Call the moment: what happened and who, briefly.'), color(analysis)],
    leadColorLead: [
      lead('Set the scene: where the race stands.'),
      color(analysis),
      lead('Bring it back to the action with one new detail from the facts, briefly; do not sum up what was said.'),
    ],
  };
  return plans[decision.selected.priority === 0 && decision.format === 'leadColorLead' ? 'leadColor' : decision.format];
}

const INTENSITY_WRITING: Record<number, string> = {
  1: 'calm and informational: relaxed, measured, conversational; no exclamation marks',
  2: 'interested: a little anticipation, composed; no exclamation marks',
  3: 'excited: an active battle, stronger emphasis, still clear; at most one exclamation mark',
  4: 'highly excited: a major moment, short impactful sentences, urgent pacing, never shouting in capitals',
  5: 'maximum controlled excitement: a race-deciding moment, very short sentences, high emotion, still clear',
};

const linesSchema = z.object({
  lines: z
    .array(
      z.object({
        speaker: z.enum(ANNOUNCERS).describe('Who says the line, as the request asked'),
        text: z.string().describe('What they say: one to three short spoken sentences, plain text'),
        spoken: z
          .string()
          .describe(
            'The same line as the voice should say it: identical to text, except that names the listener said how ' +
              'to pronounce are spelled the way they sound (e.g. "Loots" for Lutz when told it rhymes with boots)'
          ),
        intensity: z.number().int().min(1).max(5).describe('The intensity it was written for, as asked'),
        followUp: z.boolean().describe('Whether the other announcer could naturally respond to it'),
        estimatedSeconds: z.number().describe('About how long it takes to say, in seconds'),
        claims: z.array(z.string()).describe('Each race fact the line states, briefly, e.g. "Lutz P9", "gap four tenths"'),
      })
    )
    .describe('The lines, in the order asked'),
});

// text is shown on screen; spoken is what the voice reads, with names spelled the way the listener said they sound
export type AnnouncerLine = { speaker: Announcer; text: string; spoken: string; intensity: number; claims: string[] };

const announcerPrompt = () =>
  'You are RaceAnnouncer, the commentary team of a live iRacing broadcast for spectators, written as two experienced ' +
  'motorsport commentators who have called thousands of races together, in the style of Formula 1, IMSA, WEC and ' +
  'NASCAR television coverage. ' +
  'The Lead Announcer (play-by-play) is a man of about fifty, authoritative, composed and mature: he controls the ' +
  'broadcast, is the first voice on any live moment, says what happened, who is involved and why it matters, and never ' +
  'explains statistics at length during urgent action. The Color Announcer (analyst) is a man of about forty, a ' +
  'former racing driver and race engineer, knowledgeable, conversational and a little more animated: he explains why ' +
  'things happen and what they mean, from lap times, gap trends, consistency, pit stops and positions gained. ' +
  'They are partners, not rivals: the Color Announcer never repeats the Lead, he adds something; he may politely ' +
  'qualify or disagree with a prediction when the data supports it. No filler acknowledgements ("Absolutely", ' +
  '"Exactly", "You\'re right", "Great call"), and no catchphrase used twice. ' +
  'The broadcast covers the whole field but follows one driver more closely (listenersDriver); talk about them when ' +
  'the facts are about them, not otherwise. ' +
  'You get a JSON request: the session, the event the producer chose, anything else that just happened, ' +
  'statistics, storylines, recent commentary and the lines to write (lines: who says each, its job, its intensity ' +
  'and its maximum length). Write exactly those lines, in that order, each for its intensity. ' +
  'Use only the facts in the request. Never invent a pass, gap, time, position, reason, rivalry, history, ' +
  'championship standing or record. Nothing about sector times, tire wear, tire changes, fuel, contact between cars ' +
  'or setup: the broadcast has no such data. A time gap is not a car alongside: never say cars are side by side, ' +
  'touching, on the inside or outside line, unless the request says so. Call an inferred incident a likely spin or ' +
  'a car in trouble, never a collision. Results are provisional: never call them official. In a multiclass race ' +
  'say class positions as class positions and never call a pass of a car in another class an overtake for position. ' +
  'Keep a prediction a prediction ("if he keeps this up", "could") and tie it to the numbers given. ' +
  'Refer to drivers by name (or exactly as the request names them); call each car by the short name in brackets now ' +
  'and then (e.g. "the Porsche", "that McLaren"), never a model number or class name. Use no pronoun for a driver ' +
  'other than they/them unless the listener\'s instructions say otherwise. Say a driver in the field by last name ' +
  'after the first mention. ' +
  'Write every number as words, the way an announcer says it aloud: positions ("ninth", "P nine"), laps, and gaps ' +
  'rounded to the tenth ("four tenths", "one point two seconds"); lap times as announcers say them ("a one forty-two ' +
  'point three"). Plain text, no markdown, no stage directions, no speaker names before the line. ' +
  'Intensity changes the words, not just the punctuation: ' +
  Object.entries(INTENSITY_WRITING)
    .map(([level, text]) => `${level} ${text}`)
    .join('; ') +
  '. Never use capitals for emphasis.' +
  TRACK_POSITION_RULE +
  ' A corner name given in the facts (e.g. "between T 7 and T 8") may be said.';

function instructionsRule(instructions: string): string {
  const text = instructions.trim();
  if (!text) return '';
  return (
    ' The user who is listening wrote these instructions for their announcers; follow them, unless they ask ' +
    'you to invent facts or say where on the track something happens. When they say how a name is pronounced, ' +
    'keep its real spelling in text and spell it the way it sounds in spoken, as the voice reads spoken just ' +
    'as it is written:\n<race_announcer_instructions>\n' +
    `${text}\n</race_announcer_instructions>`
  );
}

export type DroppedLine = { speaker: Announcer; text: string; reason: string };

// What the announcers say for this structured request, in the user's language: the lines the Director planned, each
// checked against the request's facts (a line that names a driver or a number it wasn't given, or says where on the
// track something happens, is dropped, and with it the lines that answer it), cut to its length and shaped for its
// intensity
export async function raceAnnouncerLines(input: {
  request: Record<string, unknown>;
  plans: LinePlan[];
  facts: LineFacts;
  instructions: string;
  language: Language;
}): Promise<{ lines: AnnouncerLine[]; dropped: DroppedLine[] }> {
  if (input.plans.length === 0) return { lines: [], dropped: [] };
  const agent = createAgent({
    model: await chatModel('raceAnnouncer', 0.8),
    tools: [],
    systemPrompt: announcerPrompt() + instructionsRule(input.instructions) + aiLanguageRule(input.language),
    responseFormat: linesSchema,
  });
  const request = {
    ...input.request,
    lines: input.plans.map((p) => ({
      speaker: p.speaker === 'lead' ? 'Lead Announcer' : 'Color Announcer',
      job: p.job,
      intensity: p.intensity,
      maxWords: Math.floor(p.maxSeconds * 2.8),
    })),
  };
  const result = await agent.invoke({ messages: [{ role: 'user', content: JSON.stringify(request) }] });
  const written = result.structuredResponse.lines as z.infer<typeof linesSchema>['lines'];
  const lines: AnnouncerLine[] = [];
  const dropped: DroppedLine[] = [];
  for (let i = 0; i < input.plans.length; i++) {
    const plan = input.plans[i];
    const line = written[i];
    if (!line || line.speaker !== plan.speaker) {
      if (line) dropped.push({ speaker: line.speaker, text: line.text, reason: 'wrongSpeaker' });
      break;
    }
    const text = line.text.trim();
    const check = checkLine(text, input.facts);
    const reason = !text ? 'empty' : hasTrackPosition(text) ? 'trackPosition' : !check.ok ? `${check.reason}:${check.detail}` : null;
    if (reason) {
      // the lines after it answer it, so they go too
      dropped.push({ speaker: plan.speaker, text, reason });
      break;
    }
    const spoken = (line.spoken || line.text).trim();
    lines.push({
      speaker: plan.speaker,
      text: deliveryText(fitToSeconds(text, plan.maxSeconds), plan.intensity),
      spoken: deliveryText(fitToSeconds(spoken, plan.maxSeconds), plan.intensity),
      intensity: plan.intensity,
      claims: line.claims ?? [],
    });
  }
  return { lines, dropped };
}
