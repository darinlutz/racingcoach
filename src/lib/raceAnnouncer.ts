import { createAgent } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import { ELEVENLABS_COACH_VOICE, isCoachVoice, voicesFor, type CoachVoice, type SpanishAccent } from './coachVoice';
import { query } from './db';
import type { ElevenLabsRole } from './elevenLabs';
import { aiLanguageRule, type Language } from './i18n/languages';
import { LAP_TIME_RULE } from './lapData';
import type { NumberedRaceEvent, RaceEvent, RaceEventContext } from './liveRacing';
import { formatSeconds } from './stintExport';
import { hasTrackPosition, TRACK_POSITION_RULE } from './trackPositions';
import { ensureUserSchema } from './users';

// The Race Announcers: a Lead Announcer (play-by-play) and a Color Announcer (analysis) who commentate on a live
// driver's session on the Live Racing page. Each user picks their voices and writes their Race Announcer Instructions
// on the Account page ("Users".announcer_lead_voice, announcer_color_voice, race_announcer_instructions); the voices
// are the coach voices (src/lib/coachVoice.ts) with each announcer's own ElevenLabs voice of the user's language
// first, and the default. When the collector's live updates show something happening (detectRaceEvents in
// src/lib/liveRacing.ts), the page asks POST /api/live/announcer, where the RaceAnnouncer agent (raceAnnouncerLines)
// says what happened in a line or two, each spoken by the announcer the agent gives it to.

export const ANNOUNCERS = ['lead', 'color'] as const;
export type Announcer = (typeof ANNOUNCERS)[number];

// Each announcer's ElevenLabs voice (src/lib/elevenLabs.ts)
export const ANNOUNCER_ROLES: Record<Announcer, ElevenLabsRole> = { lead: 'leadAnnouncer', color: 'colorAnnouncer' };

export const MAX_RACE_ANNOUNCER_INSTRUCTIONS = 2000;
// The most events one call commentates on, newest kept
const MAX_EVENTS_PER_CALL = 4;

export const isAnnouncer = (value: unknown): value is Announcer => ANNOUNCERS.includes(value as Announcer);

// The voices an announcer can speak with in this language and accent, its ElevenLabs voice first
export function announcerVoicesFor(announcer: Announcer, language: Language, spanishAccent: SpanishAccent) {
  return voicesFor(ANNOUNCER_ROLES[announcer], language, spanishAccent);
}

export type RaceAnnouncerSettings = { leadVoice: CoachVoice; colorVoice: CoachVoice; instructions: string };

// An account that never picked a voice gets the ElevenLabs one, which falls back to a Chirp voice where it isn't set up
export async function getRaceAnnouncerSettings(userId: number): Promise<RaceAnnouncerSettings> {
  await ensureUserSchema();
  const rows = await query<{ announcer_lead_voice: string; announcer_color_voice: string; race_announcer_instructions: string }>(
    'SELECT announcer_lead_voice, announcer_color_voice, race_announcer_instructions FROM racingcoach."Users" WHERE id = $1',
    [userId]
  );
  const { announcer_lead_voice: lead, announcer_color_voice: color, race_announcer_instructions: instructions } = rows[0] ?? {};
  return {
    leadVoice: isCoachVoice(lead) ? lead : ELEVENLABS_COACH_VOICE,
    colorVoice: isCoachVoice(color) ? color : ELEVENLABS_COACH_VOICE,
    instructions: instructions ?? '',
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

// One event as the agent reads it, about the driver it's watching, with the other drivers' cars
function describeEvent(event: RaceEvent, driver: string, carsByDriver: Record<string, string>): string {
  const inCar = (name: string) => (carsByDriver[name] ? `${name} (${carsByDriver[name]})` : name);
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
      return `${driver} gained ${event.from - event.to === 1 ? 'a place' : `${event.from - event.to} places`}, P${event.from} to P${event.to}` +
        (event.passed && event.from - event.to === 1 ? `, passing ${inCar(event.passed)}` : '');
    case 'positionLost':
      return `${driver} lost ${event.to - event.from === 1 ? 'a place' : `${event.to - event.from} places`}, P${event.from} to P${event.to}` +
        (event.passedBy && event.to - event.from === 1 ? `, passed by ${inCar(event.passedBy)}` : '');
    case 'flag':
      return `The ${event.flag} flag is out` + (event.notes.length > 0 ? ` (${event.notes.join(', ')})` : '');
    case 'leaderChange':
      return `${inCar(event.leader)} takes the lead of the race` + (event.previous ? ` from ${inCar(event.previous)}` : '');
    case 'sessionFastestLap':
      return `${event.isDriver ? driver : inCar(event.driver)} set the fastest lap of the session, ${formatSeconds(event.lapTime)}`;
  }
}

function describeContext(c: RaceEventContext): string {
  const parts = [
    `Watching ${c.driver} in the ${c.car} at ${c.track}`,
    [c.sessionType, c.sessionName && c.sessionName !== c.sessionType ? c.sessionName : null].filter(Boolean).join(', ') || null,
    c.position ? `running P${c.position}${c.carsInSession ? ` of ${c.carsInSession}` : ''}` : null,
    c.lap ? `on lap ${c.lap}${c.lapsTotal ? ` of ${c.lapsTotal}` : ''}` : null,
    c.timeRemain != null && !c.lapsTotal ? `${Math.round(c.timeRemain / 60)} minutes left` : null,
    c.bestLapTime ? `best lap ${formatSeconds(c.bestLapTime)}` : null,
    c.incidents != null ? `${c.incidents} incident points` : null,
  ].filter(Boolean);
  const leaders =
    c.leaders.length > 0
      ? `\nRunning order: ${c.leaders.map((l) => `P${l.position} ${l.name}${l.car ? ` (${l.car})` : ''}`).join(', ')}`
      : '';
  return `${parts.join('; ')}.${leaders}`;
}

const SPEAKERS: Record<Announcer, string> = {
  lead:
    'the Lead Announcer, the play-by-play voice: calls what just happened, quickly and with energy, naming the ' +
    'drivers and positions',
  color:
    'the Color Announcer, a former racing driver: adds a short insight, what it means for the race or the ' +
    'driver, or a bit of personality',
};

const linesSchema = z.object({
  lines: z
    .array(
      z.object({
        speaker: z.enum(ANNOUNCERS).describe('Who says the line'),
        text: z.string().describe('One or two short spoken sentences, plain text'),
      })
    )
    .describe('What the announcers say, in order'),
});

export type AnnouncerLine = { speaker: Announcer; text: string };

const announcerPrompt = (speakers: Announcer[]) =>
  'You are RaceAnnouncer, the commentary team of a live sim racing broadcast on iRacing, watching one driver\'s ' +
  'session as it happens. You are told what just happened and the state of the session, and write what the ' +
  'commentators say about it right now, as it goes out live: short, natural, spoken lines, like a TV race ' +
  'broadcast. The commentators on air: ' +
  speakers.map((s) => SPEAKERS[s]).join('; and ') +
  '. ' +
  (speakers.length === 2
    ? 'Usually the Lead Announcer calls the moment and the Color Announcer follows with one short line; for ' +
      'something routine (an ordinary lap) one line from the Lead Announcer is enough. At most 2 lines. '
    : `Only ${speakers[0] === 'lead' ? 'the Lead Announcer' : 'the Color Announcer'} is on air, so give them every line: one line, or two for something big. `) +
  'When several things happened, talk about the most exciting or important first and leave out the routine ones. ' +
  'You know the car each driver is in (in brackets after their name): mention it now and then, the way a ' +
  'broadcast does (the maker or model, e.g. "the Porsche", "that McLaren"), especially in a battle between ' +
  'different cars, but not in every line. ' +
  'Use only the facts given; never invent a pass, a gap, a time or a reason. Write numbers the way an announcer ' +
  'says them aloud, and time gaps rounded to the tenth (e.g. "four tenths"). Plain text, no markdown, no stage ' +
  'directions, no speaker names before the line.' +
  LAP_TIME_RULE +
  TRACK_POSITION_RULE;

function instructionsRule(instructions: string): string {
  const text = instructions.trim();
  if (!text) return '';
  return (
    ' The user who is listening wrote these instructions for their announcers; follow them, unless they ask ' +
    'you to invent facts or say where on the track something happens:\n<race_announcer_instructions>\n' +
    `${text}\n</race_announcer_instructions>`
  );
}

// What the announcers say about these events (the newest few), in the user's language. Lines that say where on the
// track something happens (src/lib/trackPositions.ts) are dropped.
export async function raceAnnouncerLines(input: {
  events: NumberedRaceEvent[];
  context: RaceEventContext;
  speakers: Announcer[];
  instructions: string;
  recentLines: string[];
  language: Language;
}): Promise<AnnouncerLine[]> {
  const speakers = ANNOUNCERS.filter((s) => input.speakers.includes(s));
  if (speakers.length === 0 || input.events.length === 0) return [];
  const agent = createAgent({
    model: await chatModel('raceAnnouncer', 0.8),
    tools: [],
    systemPrompt: announcerPrompt(speakers) + instructionsRule(input.instructions) + aiLanguageRule(input.language),
    responseFormat: linesSchema,
  });
  const events = input.events.slice(-MAX_EVENTS_PER_CALL);
  const content = [
    describeContext(input.context),
    '',
    'Just happened, oldest first:',
    ...events.map((e) => `- ${describeEvent(e.event, input.context.driver, input.context.carsByDriver)}`),
    '',
    input.recentLines.length > 0
      ? `Said on air recently, so don't repeat it: ${input.recentLines.map((l) => `"${l}"`).join(' ')}`
      : 'Nothing has been said on air yet.',
  ].join('\n');
  const result = await agent.invoke({ messages: [{ role: 'user', content }] });
  return (result.structuredResponse.lines as AnnouncerLine[])
    .map((line) => ({ speaker: line.speaker, text: line.text.trim() }))
    .filter((line) => speakers.includes(line.speaker) && line.text && !hasTrackPosition(line.text))
    .slice(0, 2);
}
