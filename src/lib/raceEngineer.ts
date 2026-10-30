import { createAgent } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import type { CollectorSession } from './collectorSession';
import { brakeChangeRule, createTools } from './debriefCoach';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { driverInstructionsRule, headCoachInCarRule, readHeadCoachInCarInstructions } from './inCarCoach';
import { LAP_TIME_RULE } from './lapData';
import type { EngineerSnapshot, FieldCar, NumberedRaceEvent } from './liveRacing';
import { sessionFlag } from './raceFlags';
import { coachInstructionsRule } from './siteSettings';
import { formatSeconds } from './stintExport';
import { TRACK_POSITION_RULE, withoutTrackPositions } from './trackPositions';
import { DEFAULT_UNITS, formatTemperature, type Units } from './units';

// The Race Engineer: Driver Radio's other half. When the driver says something over the radio (src/lib/driverRadio.ts,
// POST /api/collector/radio) the engineer decides whether it needs an answer and, if it does, answers in a sentence
// or two, which the collector says in the driver's coach voice and the Live Racing page shows under Driver Radio. It
// knows what the driver's live update says (position, gaps to the cars around them in their class, lap times, the
// session's laps and time left, fuel, the flag, the weather, recent race events), what was said on the radio in the
// last few minutes, and, with the session's uploaded laps, the Debrief Coach's tools for where time is being lost.
// Like the In-Car AI Coach it follows the head coach's and the driver's In-Car AI Coach Instructions, and never says
// where on the track something happens.

const LITERS_PER_GALLON = 3.78541;

const replySchema = z.object({
  needsReply: z
    .boolean()
    .describe('True when the driver asked a question, asked for something, or said something a race engineer would answer'),
  reply: z.string().describe('What you say back over the radio, or an empty string when needsReply is false'),
});

const MAX_REPLY_CHARS = 300;

const enginePrompt = (units: Units, hasTools: boolean) =>
  'You are the race engineer of a sim racing driver who is in an iRacing session right now, talking on the team ' +
  'radio. The driver just pressed the radio button and said something. Decide whether it needs an answer: a ' +
  'question, a request ("tell me the gap", "how much fuel"), a call a real engineer acknowledges ("box this lap", ' +
  '"I have a puncture"), or a complaint about the car you can help with all do. Small talk to nobody, swearing at ' +
  'another driver, or words that make no sense as a message to you do not: set needsReply false. ' +
  'When you answer, it is spoken in the driver\'s ear at speed: one or two short sentences, the most useful number ' +
  'first, no lists, no markdown, talk to the driver as "you", calm and brisk like a real race engineer. Answer only ' +
  'from the facts you are given and the tools; if you do not have what they asked for, say so in a few words ' +
  '(e.g. "No sector data on this one, sorry"). Never invent a number. Gaps in a race are time behind on the road ' +
  'from the live timing; outside a race, compare best laps. For fuel, give laps of fuel left, and whether it is ' +
  'enough to the end when the session has a limit. ' +
  (hasTools
    ? 'For questions about where they lose time or what to change, use the Debrief Coach tools: start with ' +
      'get_session_overview, then get_area_detail for the focus area that loses the most, and give one change. ' +
      'Any brakepoint advice must follow the brakepoint verdict. ' +
      brakeChangeRule(units) +
      ' Do not call tools for questions the live facts answer (gaps, position, fuel, laps left). '
    : TRACK_POSITION_RULE + ' ') +
  'Name focus areas by their names, never by a distance from the start/finish line. ' +
  LAP_TIME_RULE +
  ' Your answer is spoken, though, so round every time difference to the nearest tenth of a second and write it ' +
  'the way a race engineer says it on the radio, never with "s" for seconds: under a second in tenths (e.g. "two ' +
  'tenths" for 0.213 s), otherwise in seconds with one decimal (e.g. "2.3 seconds" for 2.319 s).' +
  (units === 'metric' ? ' Fuel is in liters.' : ' Fuel is in US gallons.');

const lapTime = (seconds: number | null | undefined) => (seconds != null && seconds > 0 ? formatSeconds(seconds) : null);
const gap = (seconds: number) => `${seconds.toFixed(2)} s`;

function fuelAmount(liters: number, units: Units): string {
  return units === 'metric' ? `${liters.toFixed(1)} L` : `${(liters / LITERS_PER_GALLON).toFixed(2)} gal`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

const carLabel = (car: FieldCar) => car.details?.name ?? (car.details?.number ? `car #${car.details.number}` : `car ${car.idx}`);

// The cars around the driver in their class: the one ahead and the one behind, with the gap to each
function neighbourFacts(snapshot: EngineerSnapshot, isRace: boolean): string[] {
  const field = snapshot.field;
  const me = field?.cars.find((c) => c.idx === field.myCarIdx);
  if (!field || !me) return [];
  const myClass = me.details?.carClass ?? null;
  const sameClass = field.cars.filter((c) => (c.details?.carClass ?? null) === myClass && c.idx !== me.idx);
  const myPos = me.classPosition ?? me.position;
  if (myPos == null) return [];
  const at = (pos: number) => sameClass.find((c) => (c.classPosition ?? c.position) === pos);
  const facts = [`Cars in your class: ${sameClass.length + 1}.`];
  for (const [label, car] of [
    ['ahead', at(myPos - 1)],
    ['behind', at(myPos + 1)],
  ] as const) {
    if (!car) {
      facts.push(label === 'ahead' ? 'Nobody ahead of you in your class: you lead it.' : 'Nobody behind you in your class.');
      continue;
    }
    const parts = [`Car ${label} in class (P${car.classPosition ?? car.position}): ${carLabel(car)}`];
    if (car.details?.car) parts.push(car.details.car);
    if (isRace && me.f2Time != null && car.f2Time != null && (me.lapsDone ?? 0) === (car.lapsDone ?? 0)) {
      parts.push(`gap ${gap(Math.abs(me.f2Time - car.f2Time))} on the road`);
    } else if (!isRace && me.bestLapTime && car.bestLapTime) {
      const diff = car.bestLapTime - me.bestLapTime;
      parts.push(`their best ${lapTime(car.bestLapTime)} (${diff >= 0 ? `${gap(diff)} slower` : `${gap(-diff)} faster`} than yours)`);
    }
    if (car.lastLapTime) parts.push(`last lap ${lapTime(car.lastLapTime)}`);
    if (car.onPitRoad) parts.push('on pit road');
    facts.push(parts.join(', ') + '.');
  }
  const leader = sameClass.find((c) => (c.classPosition ?? c.position) === 1);
  if (leader && myPos > 2) facts.push(`Class leader: ${carLabel(leader)}.`);
  const fastest = [...sameClass, me].filter((c) => c.bestLapTime).sort((a, b) => a.bestLapTime! - b.bestLapTime!)[0];
  if (fastest?.bestLapTime) {
    facts.push(`Fastest lap in your class: ${lapTime(fastest.bestLapTime)} by ${fastest.idx === me.idx ? 'you' : carLabel(fastest)}.`);
  }
  return facts;
}

// The driver's own race events of the last couple of minutes, briefly; never where on the track they happened
function eventFacts(events: NumberedRaceEvent[]): string[] {
  const now = Date.now();
  return events.flatMap(({ at, event: e }) => {
    const ago = `${Math.round((now - at) / 1000)} s ago`;
    switch (e.type) {
      case 'lapComplete':
        return [`${ago}: lap completed in ${lapTime(e.lapTime)}${e.newBest ? ', a new best' : ''}.`];
      case 'pitEntry':
        return [`${ago}: you entered pit road.`];
      case 'pitExit':
        return [`${ago}: you left pit road.`];
      case 'offTrack':
        return [`${ago}: you went off track.`];
      case 'incident':
        return [`${ago}: ${e.added}x incident, ${e.total}x in all.`];
      case 'positionGained':
        return [`${ago}: you gained P${e.to} from P${e.from}${e.passed ? `, passing ${e.passed}` : ''}.`];
      case 'positionLost':
        return [`${ago}: you lost P${e.from}, now P${e.to}${e.passedBy ? `, passed by ${e.passedBy}` : ''}.`];
      case 'nearbyIncident':
        return [`${ago}: ${e.driver}, ${e.ahead ? 'ahead of' : 'behind'} you, ${e.kind === 'offTrack' ? 'went off track' : 'slowed suddenly'}.`];
      case 'battle':
        return e.user ? [`${ago}: battle for P${e.position}, ${e.ahead} ahead of ${e.behind} by ${gap(e.gap)}.`] : [];
      default:
        return [];
    }
  });
}

// Everything the engineer knows about the session right now, as lines of facts
export function engineerFacts(snapshot: EngineerSnapshot | null, units: Units): string[] {
  if (!snapshot) return ['You have no live timing from this driver right now (they are not in a session, or not sharing live).'];
  const u = snapshot.update;
  const isRace = u.sessionType?.toLowerCase() === 'race';
  const facts = [`${u.track}, ${u.car}. Session: ${[u.sessionType, u.sessionName].filter(Boolean).join(', ') || 'unknown'}.`];
  facts.push(u.onTrack ? (u.onPitRoad ? 'The driver is on pit road.' : 'The driver is on track.') : 'The driver is not in the car.');
  const flag = sessionFlag(u.sessionFlags, u.sessionState);
  if (flag) {
    facts.push(
      `Flag: ${flag.flag}${flag.waving ? ' (waving)' : ''}` +
        (flag.notes.length ? `; ${flag.notes.join(', ')}` : '') +
        (flag.driverFlags.length ? `. Driver's own flags: ${flag.driverFlags.join(', ')}` : '') +
        '.'
    );
  }
  const lapLimits = [
    u.lap != null && u.lap >= 0 ? `On lap ${u.lap}` : null,
    u.sessionLapsTotal ? `of ${u.sessionLapsTotal}` : null,
    u.sessionLapsRemain != null ? `${u.sessionLapsRemain} laps to go` : null,
    u.sessionTimeRemain != null ? `${clock(u.sessionTimeRemain)} left in the session` : null,
  ].filter(Boolean);
  if (lapLimits.length) facts.push(lapLimits.join(', ') + '.');
  if (u.position) facts.push(`Position: P${u.position} overall.`);
  const myCar = snapshot.field?.cars.find((c) => c.idx === snapshot.field?.myCarIdx);
  if (myCar?.classPosition) facts.push(`Position in class: P${myCar.classPosition}.`);
  facts.push(...neighbourFacts(snapshot, isRace));
  const times = [
    lapTime(u.lastLapTime) ? `last lap ${lapTime(u.lastLapTime)}` : null,
    lapTime(u.bestLapTime) ? `best lap ${lapTime(u.bestLapTime)}` : null,
    u.deltaToBest != null && u.onTrack ? `${u.deltaToBest >= 0 ? '+' : ''}${u.deltaToBest.toFixed(2)} s to your best on this lap so far` : null,
  ].filter(Boolean);
  if (times.length) facts.push(`Your ${times.join(', ')}.`);
  if (u.incidents != null) facts.push(`Incidents: ${u.incidents}x.`);
  if (u.fuelLevel != null) {
    const parts = [`Fuel: ${fuelAmount(u.fuelLevel, units)} left`];
    if (u.fuelPerLap) {
      const lapsOfFuel = u.fuelLevel / u.fuelPerLap;
      parts.push(`using ${fuelAmount(u.fuelPerLap, units)} a lap`, `about ${lapsOfFuel.toFixed(1)} laps of fuel`);
      // Laps to the end: the session's laps left, else its time left over the best (or last) lap
      const pace = u.bestLapTime && u.bestLapTime > 0 ? u.bestLapTime : u.lastLapTime && u.lastLapTime > 0 ? u.lastLapTime : null;
      const lapsToGo =
        u.sessionLapsRemain != null ? u.sessionLapsRemain : u.sessionTimeRemain != null && pace ? Math.ceil(u.sessionTimeRemain / pace) + 1 : null;
      if (lapsToGo != null) {
        const spare = lapsOfFuel - lapsToGo;
        parts.push(
          `about ${lapsToGo} laps to the end, so ${spare >= 0 ? `${spare.toFixed(1)} laps spare` : `${(-spare).toFixed(1)} laps short (${fuelAmount(-spare * u.fuelPerLap, units)} more needed)`}`
        );
      }
    } else {
      parts.push('not enough green laps yet to know the use per lap');
    }
    facts.push(parts.join(', ') + '.');
  } else {
    facts.push('No fuel data from this collector.');
  }
  const w = u.weather;
  if (w) {
    const weather = [
      w.airTemp != null ? `air ${formatTemperature(w.airTemp, units)}` : null,
      w.trackTemp != null ? `track ${formatTemperature(w.trackTemp, units)}` : null,
      w.precipitation ? `rain ${Math.round(w.precipitation * 100)}%` : null,
      w.declaredWet ? 'declared wet' : null,
    ].filter(Boolean);
    if (weather.length) facts.push(`Weather: ${weather.join(', ')}.`);
    const trend = snapshot.weatherTrend;
    if (trend?.trackTemp != null && Math.abs(trend.trackTemp) >= 1) {
      facts.push(`Track temperature ${trend.trackTemp > 0 ? 'rising' : 'falling'} over the last ${Math.round(trend.minutes)} minutes.`);
    }
    if (trend?.precipitation != null && Math.abs(trend.precipitation) >= 0.05) {
      facts.push(`Rain ${trend.precipitation > 0 ? 'getting heavier' : 'easing'}.`);
    }
  }
  const events = eventFacts(snapshot.events);
  if (events.length) facts.push('Recent events:', ...events.slice(-8));
  return facts;
}

export async function raceEngineerReply(input: {
  // What the driver just said
  said: string;
  snapshot: EngineerSnapshot | null;
  // The session's uploaded laps, measured; null without any
  measured: CollectorSession | null;
  instructions: string;
  language?: Language;
  units?: Units;
}): Promise<{ reply: string | null; steps: string[] }> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const units = input.units ?? DEFAULT_UNITS;
  const measured = input.measured;
  const hasAreas = !!measured?.session && measured.session.areas.some((area) => area.runs.length > 0);
  const tools = hasAreas ? createTools(measured!.session!, units, measured!.carRpmLimit) : [];
  const agent = createAgent({
    model: await chatModel('raceEngineer', 0.3),
    tools,
    systemPrompt:
      enginePrompt(units, hasAreas) +
      (await coachInstructionsRule()) +
      headCoachInCarRule(await readHeadCoachInCarInstructions()) +
      driverInstructionsRule(input.instructions) +
      aiLanguageRule(input.language ?? DEFAULT_LANGUAGE),
    responseFormat: replySchema,
  });

  // The conversation so far: the radio of the last few minutes, without what was just said (it's last in the list)
  const radio = (input.snapshot?.radio ?? []).slice(0, -1).slice(-6);
  const content = [
    'Live facts:',
    ...engineerFacts(input.snapshot, units),
    '',
    measured
      ? `Laps uploaded this session, oldest first: ${measured.laps
          .map((lap) => `lap ${lap.lapNumber} ${formatSeconds(lap.lapSeconds)}${lap.incidents ? ` (${lap.incidents}x)` : ''}${lap.offTrack ? ' (off track)' : ''}`)
          .join('; ')}.` + (hasAreas ? ' The Debrief Coach tools have them measured in the focus areas.' : ' This track has no focus areas in Track Data.')
      : 'No laps uploaded this session yet, so there is no focus area analysis.',
    radio.length
      ? `Said on the radio in the last few minutes, oldest first:\n${radio.map((r) => `${r.from === 'driver' ? 'Driver' : 'You'}: "${r.text}"`).join('\n')}`
      : '',
    '',
    `The driver says: "${input.said}"`,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');

  const ask = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const result = await agent.invoke({ messages }, { recursionLimit: 12 });
    return { response: result.structuredResponse as z.infer<typeof replySchema>, messages: result.messages };
  };
  const first = await ask([{ role: 'user', content }]);
  const toolNames = new Set(tools.map((t) => t.name));
  const steps = first.messages.flatMap((message) =>
    'tool_calls' in message && Array.isArray(message.tool_calls)
      ? message.tool_calls.filter((call) => toolNames.has(call.name)).map((call) => call.name)
      : []
  );
  if (!first.response.needsReply || !first.response.reply.trim()) return { reply: null, steps };
  try {
    const reply = await withoutTrackPositions(first.response.reply.trim(), async (feedback) => {
      const again = await ask([
        { role: 'user', content },
        { role: 'assistant', content: first.response.reply },
        { role: 'user', content: feedback },
      ]);
      return again.response.reply;
    });
    return { reply: reply.slice(0, MAX_REPLY_CHARS), steps };
  } catch {
    // only said where on the track things happen: better silent
    return { reply: null, steps };
  }
}
