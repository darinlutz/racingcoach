import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import { checkedAnswer, languageCheck, namesIn } from './answerChecks';
import { repeatsAny, VARIETY_FEEDBACK, varietyRule } from './coachingGuidance';
import { assessWeather, type WeatherContext } from './engineering/weatherContext';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { driverInstructionsRule } from './inCarCoach';
import type { EngineerSnapshot } from './liveRacing';
import { sessionFlag } from './raceFlags';
import {
  fuelPlan,
  pitActivity,
  pitLoss,
  projectPitExit,
  type PitExit,
  type StrategyCar,
  type StrategyInput,
} from './raceStrategy';
import { formatSeconds } from './stintExport';
import { TRACK_POSITION_RULE } from './trackPositions';
import { DEFAULT_UNITS, type Units } from './units';

// The Race Strategist: Driver Radio's pit strategy specialist, beside the Setup Engineer (src/lib/setupEngineer.ts).
// When the driver asks the Race Engineer (src/lib/raceEngineer.ts) about pit strategy ("when should I pit", "how much
// fuel do I need", "where do I come out if I box now"), the Race Engineer hands the question over, answering
// strategyQuestion, and the Race Strategist answers it from the numbers src/lib/raceStrategy.ts works out of the live
// update and the Race Broadcast's tracker: the fuel left and used per lap, the tank, the laps to the end and the pit
// window; what a stop costs, measured from the stops seen this session (the driver's own, else their class's, else
// the field's); who is on pit road now and who has stopped; and, most of all, where the driver would come back out on
// track after a stop: their position in class and overall, who would get by, the cars just ahead and behind, and
// traffic where they rejoin. With no stop measured yet it says so, and can work it out for a stop time the driver
// gives (its project_pit_exit tool). It never invents a number, and says a projection is one.

const LITERS_PER_GALLON = 3.78541;
const MAX_REPLY_CHARS = 400;

const replySchema = z.object({
  reply: z.string().describe('What you say back over the radio'),
});

function fuelAmount(liters: number, units: Units): string {
  return units === 'metric' ? `${liters.toFixed(1)} L` : `${(liters / LITERS_PER_GALLON).toFixed(2)} gal`;
}

const carName = (c: Pick<StrategyCar, 'driver' | 'number'>) => (c.driver ? `${c.driver}${c.number ? ` (#${c.number})` : ''}` : `#${c.number ?? '?'}`);

// What src/lib/raceStrategy.ts needs, from the engineers' snapshot of the driver's session
export function strategyInput(snapshot: EngineerSnapshot): StrategyInput {
  const u = snapshot.update;
  const pits = new Map((snapshot.pits ?? []).map((p) => [p.idx, p]));
  return {
    isRace: u.sessionType?.toLowerCase() === 'race',
    myCarIdx: snapshot.field?.myCarIdx ?? null,
    cars: (snapshot.field?.cars ?? []).map((c) => {
      const pit = pits.get(c.idx);
      return {
        idx: c.idx,
        driver: c.details?.name ?? pit?.driver ?? null,
        number: c.details?.number ?? null,
        carClass: c.details?.carClass ?? pit?.carClass ?? null,
        lap: c.lap ?? null,
        pct: c.pct ?? null,
        lapsDone: c.lapsDone ?? null,
        position: c.position ?? null,
        classPosition: c.classPosition ?? null,
        onPitRoad: !!c.onPitRoad,
        secondsOnPitRoad: pit?.secondsOnPitRoad ?? null,
        pitStops: pit?.pitStops ?? 0,
        lastPitSeconds: pit?.lastPitSeconds ?? null,
        lastPitLap: pit?.lastPitLap ?? null,
        pitLosses: pit?.pitLosses ?? [],
      };
    }),
    lap: u.lap ?? null,
    pct: u.pct ?? null,
    fuelLevel: u.fuelLevel ?? null,
    fuelPerLap: u.fuelPerLap ?? null,
    fuelLevelPct: u.fuelLevelPct ?? null,
    sessionLapsRemain: u.sessionLapsRemain ?? null,
    sessionTimeRemain: u.sessionTimeRemain ?? null,
    bestLapTime: u.bestLapTime != null && u.bestLapTime > 0 ? u.bestLapTime : null,
    lastLapTime: u.lastLapTime != null && u.lastLapTime > 0 ? u.lastLapTime : null,
    averageLapTime: snapshot.averageLapTime ?? null,
  };
}

// A projected stop, as lines of facts
export function exitFacts(exit: PitExit, label: string): string[] {
  const facts = [
    `${label}: you would rejoin P${exit.classPositionAfter} in class (P${exit.classPositionNow} now)` +
      (exit.positionAfter !== exit.classPositionAfter || exit.positionNow !== exit.classPositionNow
        ? `, P${exit.positionAfter} overall (P${exit.positionNow} now)`
        : '') +
      '.',
  ];
  if (exit.passedBy.length) {
    facts.push(
      `Cars of your class that would get by while you stop: ${exit.passedBy.map((c) => `${carName(c)}, ${c.gapNow.toFixed(1)} s behind you now${c.onPitRoad ? ' (counting the rest of its stop, as it is on pit road now)' : ''}`).join('; ')}.`
    );
  } else {
    facts.push('No car of your class would get by while you stop.');
  }
  if (exit.aheadAfter) facts.push(`Car of your class just ahead after the stop: ${carName(exit.aheadAfter)}, ${exit.aheadAfter.gap.toFixed(1)} s ahead of you.`);
  else facts.push('Nobody of your class ahead of you after the stop: you would lead it.');
  if (exit.behindAfter) facts.push(`Car of your class just behind after the stop: ${carName(exit.behindAfter)}, ${exit.behindAfter.gap.toFixed(1)} s behind you.`);
  if (exit.traffic.length) {
    facts.push(
      `Cars on the road within ${1.5} s of where you would rejoin: ` +
        exit.traffic
          .map((c) => `${carName(c)}${c.sameClass ? '' : ` (${c.carClass ?? 'another class'})`}, ${Math.abs(c.gap).toFixed(1)} s ${c.gap >= 0 ? 'ahead' : 'behind'} on the road`)
          .join('; ') +
        '.'
    );
  } else {
    facts.push('Clear road where you would rejoin: no car within 1.5 s.');
  }
  if (exit.aheadYetToStop.length) {
    facts.push(
      `Of the cars of your class ahead of you after the stop, these have not made more stops than you have now, so ` +
        `they may still have to stop: ${exit.aheadYetToStop.join(', ')}.`
    );
  }
  return facts;
}

// Everything the strategist knows, as lines of facts
export function strategyFacts(snapshot: EngineerSnapshot | null, units: Units): string[] {
  if (!snapshot) return ['You have no live timing from this driver right now (they are not in a session, or not sharing live).'];
  const u = snapshot.update;
  const input = strategyInput(snapshot);
  const facts = [`${u.track}, ${u.car}. Session: ${[u.sessionType, u.sessionName].filter(Boolean).join(', ') || 'unknown'}.`];
  facts.push(u.onTrack ? (u.onPitRoad ? 'The driver is on pit road.' : 'The driver is on track.') : 'The driver is in the garage, not in the car.');
  const flag = sessionFlag(u.sessionFlags, u.sessionState);
  if (flag) facts.push(`Flag: ${flag.flag}${flag.notes.length ? `; ${flag.notes.join(', ')}` : ''}.`);
  const limits = [
    u.lap != null && u.lap >= 0 ? `On lap ${u.lap}` : null,
    u.sessionLapsTotal ? `of ${u.sessionLapsTotal}` : null,
    u.sessionLapsRemain != null ? `${u.sessionLapsRemain} laps to go` : null,
    u.sessionTimeRemain != null ? `${Math.round(u.sessionTimeRemain / 60)} minutes left in the session` : null,
  ].filter(Boolean);
  if (limits.length) facts.push(limits.join(', ') + '.');
  const times = [
    input.averageLapTime ? `recent clean average ${formatSeconds(input.averageLapTime)}` : null,
    input.bestLapTime ? `best ${formatSeconds(input.bestLapTime)}` : null,
    input.lastLapTime ? `last ${formatSeconds(input.lastLapTime)}` : null,
  ].filter(Boolean);
  if (times.length) facts.push(`Your laps: ${times.join(', ')}.`);

  // Fuel
  const fuel = fuelPlan(input);
  if (!fuel) {
    facts.push('No fuel data from this collector.');
  } else {
    const parts = [`Fuel: ${fuelAmount(fuel.level, units)} in the tank`];
    if (fuel.capacity) parts.push(`the tank holds about ${fuelAmount(fuel.capacity, units)}`);
    if (fuel.perLap && fuel.lapsOfFuel != null) parts.push(`using ${fuelAmount(fuel.perLap, units)} a green lap`, `about ${fuel.lapsOfFuel.toFixed(1)} laps of fuel`);
    else parts.push('not enough green laps yet to know the use per lap');
    facts.push(parts.join(', ') + '.');
    if (fuel.lapsToGo != null && fuel.neededToFinish != null) {
      facts.push(
        `About ${fuel.lapsToGo} laps to the end (${fuel.lapsToGoFrom === 'laps' ? "from the session's laps left" : "from the time left at your pace"}, counting the lap you are on as a whole lap), ` +
          `needing ${fuelAmount(fuel.neededToFinish, units)}: ` +
          (fuel.short === 0
            ? `you have enough to finish, ${fuelAmount(fuel.level - fuel.neededToFinish, units)} spare, so no stop is needed for fuel.`
            : `${fuelAmount(fuel.short!, units)} short` +
              (fuel.stopsNeeded != null ? `, ${fuel.stopsNeeded} stop${fuel.stopsNeeded === 1 ? '' : 's'} needed` : '') +
              (fuel.addNowToFinish != null ? `; pitting now, add ${fuelAmount(fuel.addNowToFinish, units)} to finish` : "; pitting now, the tank can't take enough to finish, so fill it") +
              '.')
      );
    } else if (fuel.perLap) {
      facts.push('The laps to the end are not known (no lap or time limit, or no lap time yet).');
    }
    if (fuel.latestStopInLaps != null) {
      facts.push(
        fuel.latestStopInLaps === 0
          ? 'Fuel window: you must box this lap, the fuel will not last another.'
          : `Fuel window: box within ${fuel.latestStopInLaps} lap${fuel.latestStopInLaps === 1 ? '' : 's'} from now at the latest` +
              (fuel.earliestOneStopInLaps != null
                ? fuel.earliestOneStopInLaps === 0
                  ? ', and one stop with a full tank gets you to the end from now on.'
                  : `; one stop with a full tank gets you to the end only from ${fuel.earliestOneStopInLaps} laps from now.`
                : '.')
      );
    }
  }

  // Pit road
  const activity = pitActivity(input);
  if (activity.onPitRoad.length) {
    facts.push(
      'On pit road now: ' +
        activity.onPitRoad
          .map(
            (c) =>
              `${carName(c)}${c.classPosition ? `, P${c.classPosition} in class` : ''}` +
              ((c.carClass ?? null) !== (input.cars.find((m) => m.idx === input.myCarIdx)?.carClass ?? null) && c.carClass ? ` (${c.carClass})` : '') +
              (c.secondsOnPitRoad != null ? `, ${Math.round(c.secondsOnPitRoad)} s so far` : '')
          )
          .join('; ') +
        '.'
    );
  } else if (input.cars.length) {
    facts.push('Nobody else is on pit road right now.');
  }
  if (activity.stopped.length) {
    facts.push(
      'Stops seen this session: ' +
        activity.stopped
          .slice(0, 12)
          .map(
            (c) =>
              `${carName(c)} ${c.pitStops} stop${c.pitStops === 1 ? '' : 's'}` +
              (c.lastPitLap != null && c.lapsDone != null ? `, last ${Math.max(0, c.lapsDone - c.lastPitLap)} laps ago` : '') +
              (c.lastPitSeconds != null ? `, ${Math.round(c.lastPitSeconds)} s on pit road` : '')
          )
          .join('; ') +
        '.'
    );
  } else if (input.cars.length) {
    facts.push('No other car has made a pit stop since live timing started.');
  }
  const me = input.cars.find((c) => c.idx === input.myCarIdx);
  if (me) facts.push(`Your own stops seen: ${me.pitStops}${me.lastPitLap != null && me.lapsDone != null ? `, last ${Math.max(0, me.lapsDone - me.lastPitLap)} laps ago` : ''}.`);

  // What a stop costs, and where it puts the driver
  const loss = pitLoss(input);
  if (loss) {
    facts.push(
      `A pit stop costs about ${loss.seconds.toFixed(1)} s against a green lap, measured from ` +
        (loss.from === 'own' ? 'your own' : loss.from === 'class' ? "your class's" : "the field's") +
        ` ${loss.stops} stop${loss.stops === 1 ? '' : 's'} this session` +
        (loss.stops > 1 ? ` (from ${loss.min.toFixed(1)} to ${loss.max.toFixed(1)} s, depending on fuel and tires taken)` : '') +
        '.'
    );
  } else {
    facts.push(
      'No pit stop has been measured this session yet, so what a stop costs is not known. Do not guess one: tell the ' +
        'driver, and if they give you a stop time, or one comes from what they said, call project_pit_exit with it.'
    );
  }
  if (!input.isRace) {
    facts.push('This is not a race, so track position after a stop does not matter; the projection is only for races.');
  } else if (loss) {
    const exit = projectPitExit(input, loss.seconds);
    if (exit) facts.push(...exitFacts(exit, `If you pit now, with a ${loss.seconds.toFixed(1)} s stop, as the field is now and at everyone's present pace (a projection)`));
    else facts.push('Your place on the road or your pace is not known yet, so where you would rejoin cannot be worked out.');
  }
  return facts;
}

const strategistPrompt = (units: Units) =>
  'You are the race strategist of a sim racing driver in an iRacing session, talking on the team radio. The race ' +
  'engineer handed you the driver\'s question about pit strategy: when to pit, fuel (how much they have, how much ' +
  'they need, how much to add), the pit window, or where they would come out after a stop. Answer in two or three ' +
  'short spoken sentences: no lists, no markdown, talk to the driver as "you", calm and decisive like a real race ' +
  'strategist. The most useful number first. Answer only from the facts and the tool, and answer the question they ' +
  'asked. When they ask about pitting, always say where they would rejoin (their position in class, who would get by, ' +
  'and traffic when there is any), as that is what matters most; when cars of their class are on pit road now or ' +
  'have just stopped, say so when it bears on the call (an undercut, or a rival who still has to stop). Say a rejoin ' +
  'position is a projection when you give one (e.g. "you\'d come out about P5"). Recommend a lap to box when they ask ' +
  'when to pit: inside the fuel window, and, when track position allows, where they rejoin in clear road rather than ' +
  'behind a slower car. Never invent a number: when what a stop costs is not measured yet, say so in a few words, ' +
  'and give the fuel numbers you do have. When the driver gives a stop time ("if my stop takes 40 seconds") or asks ' +
  'about a stop that differs from the measured one, call project_pit_exit with that many seconds of time lost ' +
  'against a green lap, and answer from its result. Never claim tire wear, a tire change time, a refuelling rate or ' +
  'a pit lane speed limit you were not given. ' +
  TRACK_POSITION_RULE +
  ' Your answer is spoken, so round time gaps to the nearest tenth of a second and write them the way a race ' +
  'engineer says them, never with "s" for seconds: under a second in tenths (e.g. "two tenths"), otherwise seconds ' +
  'with one decimal. Write units out in full words in your language, never as symbols or abbreviations (e.g. "3 ' +
  'gallons", not "3 gal"; "12 liters", not "12 L").' +
  (units === 'metric' ? ' Fuel is in liters.' : ' Fuel is in US gallons.');

// On a wet or changing track: tires may be the reason to stop
function wetStrategyRule(weather: WeatherContext | null | undefined): string {
  const w = assessWeather(weather);
  if (!w || (!w.wet && !w.drying && !w.mismatch)) return '';
  return (
    ' The track is wet or changing, or the tires do not suit it: a stop for the right tires can matter more than ' +
    'fuel, so say so when the tires do not suit the track. iRacing gives apps no forecast, so never state one.'
  );
}

export async function raceStrategistReply(input: {
  said: string;
  snapshot: EngineerSnapshot | null;
  instructions: string;
  language?: Language;
  units?: Units;
  weather?: WeatherContext | null;
  // What the engineers said on the radio in the last few minutes, oldest first, so it isn't said again
  recentReplies?: string[];
}): Promise<{ reply: string | null; steps: string[] }> {
  const units = input.units ?? DEFAULT_UNITS;
  const recent = input.recentReplies ?? [];
  const snapshot = input.snapshot;
  const strategy = snapshot ? strategyInput(snapshot) : null;
  const projectTool = tool(
    async ({ pitLossSeconds }: { pitLossSeconds: number }) => {
      if (!strategy) return 'No live timing from the driver, so nothing can be projected.';
      if (!strategy.isRace) return 'This is not a race, so track position after a stop is not projected.';
      const exit = projectPitExit(strategy, pitLossSeconds);
      return exit
        ? exitFacts(exit, `If you pit now, with a ${pitLossSeconds.toFixed(1)} s stop, as the field is now (a projection)`).join('\n')
        : "The driver's place on the road or pace is not known yet, so where they would rejoin cannot be worked out.";
    },
    {
      name: 'project_pit_exit',
      description:
        'Where the driver would rejoin if they pitted now and the stop cost this many seconds against a green lap: ' +
        'their position in class and overall, who would get by, the cars just ahead and behind, and traffic.',
      schema: z.object({ pitLossSeconds: z.number().min(5).max(200).describe('Seconds lost to the stop against a green lap') }),
    }
  );
  const agent = createAgent({
    model: await chatModel('raceStrategist', 0.5),
    tools: [projectTool],
    systemPrompt:
      strategistPrompt(units) +
      wetStrategyRule(input.weather) +
      (snapshot && !snapshot.update.onTrack
        ? ' The driver is in the garage: answer from the fuel and the stops seen as well as you can.'
        : '') +
      varietyRule(recent, 'You and the other engineers said this to the driver on the radio in the last few minutes.') +
      driverInstructionsRule(input.instructions) +
      aiLanguageRule(input.language ?? DEFAULT_LANGUAGE),
    responseFormat: replySchema,
  });
  const radio = (snapshot?.radio ?? []).slice(0, -1).slice(-6);
  const content = [
    'Facts:',
    ...strategyFacts(snapshot, units),
    radio.length
      ? `\nSaid on the radio in the last few minutes, oldest first:\n${radio.map((r) => `${r.from === 'driver' ? 'Driver' : 'Engineers'}: "${r.text}"`).join('\n')}`
      : '',
    '',
    `The driver says: "${input.said}"`,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
  const ask = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const result = await agent.invoke({ messages }, { recursionLimit: 8 });
    return { reply: (result.structuredResponse as z.infer<typeof replySchema>).reply.trim(), messages: result.messages };
  };
  const first = await ask([{ role: 'user', content }]);
  const steps = first.messages.flatMap((message) =>
    'tool_calls' in message && Array.isArray(message.tool_calls) ? message.tool_calls.filter((c) => c.name === projectTool.name).map((c) => c.name) : []
  );
  let answer = first.reply;
  if (!answer) return { reply: null, steps };
  // Much the same as something said a moment ago: one rewrite in other words
  if (repeatsAny(answer, recent)) {
    const again = await ask([
      { role: 'user', content },
      { role: 'assistant', content: answer },
      { role: 'user', content: VARIETY_FEEDBACK },
    ]).catch(() => null);
    if (again?.reply) answer = again.reply;
  }
  try {
    const reply = await checkedAnswer(
      answer,
      async (feedback) =>
        (
          await ask([
            { role: 'user', content },
            { role: 'assistant', content: answer },
            { role: 'user', content: feedback },
          ])
        ).reply,
      await languageCheck(input.language ?? DEFAULT_LANGUAGE, namesIn(snapshot))
    );
    return { reply: reply ? reply.slice(0, MAX_REPLY_CHARS) : null, steps };
  } catch {
    // only said where on the track things happen: better silent
    return { reply: null, steps };
  }
}
