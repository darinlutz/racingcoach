import { createAgent } from 'langchain';
import { z } from 'zod';
import { chatModel } from './aiModels';
import { readCollectorLapsByClientId } from './collectorLaps';
import { aiLanguageRule, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import type { EngineerSnapshot, LiveUpdate } from './liveRacing';
import { analyzeRotationSession, type SessionRotation } from './rotationAnalysis';
import { calibrationForCar, ROTATION_MODEL_CONFIG } from './rotationModelConfig';
import { repeatsAny, SETUP_ENGINEER_METHOD, VARIETY_FEEDBACK, varietyRule } from './coachingGuidance';
import { TRACK_POSITION_RULE } from './trackPositions';
import { checkedAnswer, languageCheck, namesIn } from './answerChecks';
import { DEFAULT_UNITS, type Units } from './units';
import { engineeringContext, rotationEvidence, type EngineeringContext } from './engineering/knowledgeService';
import { checkSetupAnswer, setupGuardFeedback, withoutDisallowedSentences } from './engineering/setupAnswerGuard';
import { assessWeather, weatherFacts, weatherSummary, type WeatherContext } from './engineering/weatherContext';
import { getAiModel } from './aiModels';
import { answerFeedback } from './answerChecks';
import { checkProposals, MAX_PROPOSALS, type RawProposal, type SetupProposal } from './setupChanges';
import { fixedSetupSession } from './setupInspection';
import type { CompareRow } from './setupCompare';
import type { SetupParameter } from './setupYaml';
import { removeTrackPositions } from './trackPositions';

// The Setup Engineer: Driver Radio's car setup specialist. When the driver asks the Race Engineer (src/lib/raceEngineer.ts)
// about the car's setup or its handling ("I have understeer", "what should I change on the car"), the Race Engineer hands
// the question over, and the Setup Engineer answers it from the car's setup (its name, and whether it's a fixed setup,
// from the collector's live update), the in-car brake bias, the Rotation Model's understeer and oversteer in the
// session's uploaded laps (src/lib/rotationAnalysis.ts), what the driver said and the Race Engineering knowledge base,
// following the built-in Setup Engineer method (SETUP_ENGINEER_METHOD in src/lib/coachingGuidance.ts), and never says
// again what it said on the radio a moment ago. In a fixed setup it says so: no chassis changes are possible, only
// in-car adjustments such as brake bias. Otherwise it suggests specific chassis changes. It also knows the track
// conditions and the fitted tires (src/lib/engineering/weatherContext.ts, from the live update): on a wet track it
// works from the wet-weather knowledge, and tires that don't suit the track come before any handling change.

type CarSetup = NonNullable<LiveUpdate['setup']>;

const replySchema = z.object({
  reply: z.string().describe('What you say back over the radio'),
});

const MAX_REPLY_CHARS = 400;

// Whether the session is a fixed setup session: the session's own flag (WeekendInfo.WeekendOptions.IsFixedSetup, from
// collectors from 1.97.0), else a load type of "fixed" (fixedSetupSession in setupInspection.ts). The setup's name
// doesn't decide it: iRacing's own GT3 setups include one named "fixed.sto" that loads in open sessions too, so a name
// alone leaves it unknown
export function isFixedSetup(setup: CarSetup | null | undefined): boolean {
  if (!setup) return false;
  return fixedSetupSession(setup).fixed;
}

const setupPrompt = (fixed: boolean, known: boolean) =>
  'You are the setup engineer of a sim racing driver in an iRacing session, talking on the team radio. The driver ' +
  'asked about the car\'s setup or how it handles. Answer in two or three short spoken sentences: no lists, no ' +
  'markdown, talk to the driver as "you", like a real setup engineer. Start from what the driver said they feel ' +
  '(e.g. understeer on entry, oversteer on power), check it against the measured understeer and oversteer from their ' +
  'laps when there is any, and say which phase of the corner the problem is in when you know it. Suggest one or two ' +
  'changes, the most effective first, and say which way to move each one and what it will do to the car. If the ' +
  'driver did not say what the car is doing and the data does not show it either, ask them where in the corner the ' +
  'car is unhappy (entry, middle or exit) and whether it understeers or oversteers. Never invent a number or a ' +
  'setting the car does not have. ' +
  (fixed
    ? 'The car is on a FIXED setup: start by telling the driver that they are on a fixed setup, so no chassis ' +
      'adjustments can be made, but they can change the brake bias from the cockpit to change how the car behaves. ' +
      'Then suggest only in-car adjustments: brake bias first (more to the front calms entry oversteer and makes the ' +
      'car more stable on the brakes, but adds entry understeer; more to the rear helps the car rotate on entry but ' +
      'can make it loose), and, when the car has them, traction control or ABS settings. Driving changes (brake ' +
      'release, entry speed, throttle application) are fine too. Never suggest springs, dampers, anti-roll bars, ' +
      'wings, ride heights, alignment, tire pressures, differential or any other garage change. '
    : (known
        ? 'The setup is not fixed: the driver can change it in the garage. '
        : 'It is not known whether the setup is fixed. If the driver could be on a fixed setup, say that in a ' +
          'fixed setup only brake bias and other in-car adjustments can change. ') +
      'Suggest specific chassis changes for the problem: for example tire pressures, anti-roll bars, springs, ' +
      'dampers (bump and rebound), ride height and rake, wing, differential preload or ramps, toe and camber, and ' +
      'brake bias. Say which end of the car and which direction (e.g. "soften the front anti-roll bar a click or ' +
      'two"), never an exact value you were not given, as the car\'s settings are not known. ') +
  TRACK_POSITION_RULE +
  ' When the facts include a structured diagnosis and engineering reference material, use them: say whether the ' +
  'evidence points at driving or at the setup (when the diagnosis says to work on driving first, give the driving ' +
  'change first), keep what was measured apart from what is only likely, and suggest only setup changes the facts ' +
  'list for this car in this session, the smallest useful step first, with what it trades off. Close with how to ' +
  'check it in a few short words (e.g. "try it for three laps and compare"). Never claim ABS activation, tire ' +
  'saturation, bottoming or any other event the facts do not show; when you infer one, say it is likely, not that ' +
  'it happened. A car tendency from the reference material is a tendency, not a fact about this car.';

// How to work in the conditions the facts give: on a wet or changing track, or with tires that don't suit it
export function wetSetupRule(weather: WeatherContext | null | undefined): string {
  const w = assessWeather(weather);
  if (!w || (!w.wet && !w.drying && !w.mismatch && w.fittedCompound !== 'wet' && w.fittedCompound !== 'intermediate')) return '';
  return (
    ' The facts give the track conditions and the fitted tires. Work in this order: the conditions and the tires, ' +
    'then whether the setup is fixed, then the symptom, its likely cause and the change. If the car is on dry (slick) ' +
    'tires on a wet track, say first that the tires are the problem and wet tires are the fix, before any handling ' +
    'change; never try to cure it with suspension alone. If it is on wet tires in the rain, never suggest slicks ' +
    'unless the facts show the track drying. Rain does not by itself mean moving the brake bias rearward: more to ' +
    'the front can make the car more stable on the brakes, more to the rear can help it rotate but makes rear ' +
    'locking and instability more likely, so choose from the symptom and the current bias. Never assume softer ' +
    'suspension, more ride height or more downforce is right in the wet; say what each trades off. Observed weather ' +
    'is observed; a projection is not a forecast, and iRacing gives apps no forecast, so never state one.'
  );
}

// The Rotation Model over the session's uploaded laps, as lines of facts; none without usable laps
function rotationFacts(rotation: SessionRotation | null): string[] {
  if (!rotation) return ['No laps uploaded this session yet, so no understeer or oversteer has been measured.'];
  const usable = rotation.laps.filter((lap) => lap.supported);
  if (usable.length === 0) {
    return [
      'The understeer and oversteer model could not judge this session\'s laps (the car is not calibrated for it, or ' +
        'the laps lack what it needs), so only what the driver says is known about the balance.',
    ];
  }
  const s = rotation.summary;
  const phases = (type: 'UNDERSTEER' | 'OVERSTEER') =>
    (['ENTRY', 'MID_CORNER', 'EXIT', 'STRAIGHT'] as const)
      .filter((phase) => s.byPhase[type][phase] > 0)
      .map((phase) => `${s.byPhase[type][phase]} on ${phase === 'MID_CORNER' ? 'mid-corner' : phase.toLowerCase()}`)
      .join(', ');
  const severity = (value: number | null) => (value == null ? '' : `, average severity ${Math.round(value)} out of 100`);
  const facts = [`Measured over ${usable.length} uploaded lap${usable.length === 1 ? '' : 's'} this session:`];
  facts.push(
    s.understeerEvents > 0
      ? `Understeer: ${s.understeerEvents} times, ${s.understeerSeconds.toFixed(1)} s in all${severity(s.averageUndersteerSeverity)}` +
          (phases('UNDERSTEER') ? ` (${phases('UNDERSTEER')})` : '') +
          `; ${s.onBrake.UNDERSTEER} on the brakes, ${s.onThrottle.UNDERSTEER} on the throttle.`
      : 'Understeer: none measured.'
  );
  facts.push(
    s.oversteerEvents > 0
      ? `Oversteer: ${s.oversteerEvents} times, ${s.oversteerSeconds.toFixed(1)} s in all${severity(s.averageOversteerSeverity)}` +
          ` (${s.oversteerTypes.ENTRY} on entry, ${s.oversteerTypes.MID_CORNER} mid-corner, ${s.oversteerTypes.POWER_ON} on power)` +
          `; ${s.onBrake.OVERSTEER} on the brakes, ${s.onThrottle.OVERSTEER} on the throttle.`
      : 'Oversteer: none measured.'
  );
  const recurring = rotation.recurring.filter((r) => r.laps >= 2).slice(0, 4);
  if (recurring.length) {
    facts.push(
      'Happening in the same corner lap after lap: ' +
        recurring
          .map((r) => `${r.eventType.toLowerCase()} on ${r.cornerPhase === 'MID_CORNER' ? 'mid-corner' : r.cornerPhase.toLowerCase()} in ${r.laps} laps`)
          .join('; ') +
        '.'
    );
  }
  return facts;
}

function setupFacts(update: EngineerSnapshot['update'] | null): { facts: string[]; fixed: boolean; known: boolean } {
  if (!update) return { facts: ['You have no live data from this driver right now, so the car and setup are unknown.'], fixed: false, known: false };
  const setup = update.setup;
  const session = setup ? fixedSetupSession(setup) : { fixed: false, known: false };
  const fixed = session.fixed;
  const facts = [`Car: ${update.car}. Track: ${update.track}.`];
  if (!setup) {
    facts.push('The setup is unknown (the driver\'s collector does not send it).');
  } else {
    facts.push(
      `Setup: ${setup.name?.trim() || 'no name'}` +
        (setup.loadType ? ` (iRacing's setup type: ${setup.loadType})` : '') +
        (fixed ? ', a FIXED setup' : '') +
        (setup.modified ? ', changed since it was loaded' : '') +
        '.'
    );
    if (setup.brakeBias != null) {
      facts.push(
        `In-car brake bias setting: ${setup.brakeBias}` +
          (setup.brakeBias > 30 && setup.brakeBias < 80 ? '% to the front.' : ' (an offset from the setup\'s brake bias, not a percentage).')
      );
    } else {
      facts.push('The car reports no in-car brake bias setting.');
    }
  }
  return { facts, fixed, known: session.known };
}

// The Rotation Model over the session's uploaded laps; null without any, or when they can't be read
export async function measureSessionRotation(userId: number, clientLapIds: string[]): Promise<SessionRotation | null> {
  if (clientLapIds.length === 0) return null;
  try {
    const laps = await readCollectorLapsByClientId(userId, clientLapIds);
    if (laps.length === 0) return null;
    const track = laps[laps.length - 1].track;
    return analyzeRotationSession(
      laps.filter((lap) => lap.track === track).map((lap) => ({ id: lap.clientLapId, lapNumber: lap.lapNumber, car: lap.car, csv: lap.csv })),
      ROTATION_MODEL_CONFIG,
      (car) => (car ? calibrationForCar(car) : null)
    );
  } catch (error) {
    console.error('Setup Engineer: failed to measure understeer and oversteer:', error);
    return null;
  }
}

export async function setupEngineerReply(input: {
  // What the driver just said
  said: string;
  update: EngineerSnapshot['update'] | null;
  rotation: SessionRotation | null;
  // The driver's own In-Car AI Coach Instructions (e.g. how to pronounce names, how much to say)
  driverInstructions: string;
  language?: Language;
  units?: Units;
  // The track conditions and fitted tires (weatherContext.ts's weatherContextFromLive); undefined when not known
  weather?: WeatherContext | null;
  // What the engineers said on the radio in the last few minutes, oldest first, so it isn't said again
  recentReplies?: string[];
}): Promise<string | null> {
  const units = input.units ?? DEFAULT_UNITS;
  const recent = input.recentReplies ?? [];
  const setup = setupFacts(input.update);
  const { fixed, known } = setup;
  const facts = input.weather !== undefined ? [...setup.facts, ...weatherFacts(input.weather, units === 'metric' ? 'metric' : 'standard')] : setup.facts;
  // The Race Engineering knowledge base (src/lib/engineering/); without it the engineer answers as before
  const engineering = await engineeringContext({
    question: input.said,
    car: input.update?.car ?? null,
    fixed,
    setupKnown: known,
    rotation: rotationEvidence(input.rotation),
    ...(input.weather !== undefined ? { weather: input.weather, weatherInFacts: false } : {}),
    agent: 'setupEngineer',
    model: await getAiModel('setupEngineer').catch(() => null),
  }).catch((error): EngineeringContext | null => {
    console.error('Setup Engineer: engineering knowledge failed, answering without it:', error);
    return null;
  });
  if (engineering) {
    console.log(
      `Setup Engineer knowledge: ${engineering.source}, ${engineering.retrieval.confidence} confidence, ` +
        `${engineering.context.used.map((u) => u.id).join(', ') || 'nothing retrieved'}, focus ${engineering.diagnosis.focus}, ` +
        `weather ${input.weather === undefined ? 'not given' : weatherSummary(input.weather)}`
    );
  }
  const driverRule = input.driverInstructions.trim()
    ? '\n\nThe driver has given these instructions for how they are spoken to on the radio. Follow them where they ' +
      'are about how you talk; they never allow chassis changes in a fixed setup.\n' +
      `<driver_instructions>\n${input.driverInstructions.trim()}\n</driver_instructions>`
    : '';
  const agent = createAgent({
    model: await chatModel('setupEngineer', 0.6),
    tools: [],
    systemPrompt:
      setupPrompt(fixed, known) +
      SETUP_ENGINEER_METHOD +
      wetSetupRule(input.weather) +
      (units === 'metric' ? ' Use metric units.' : ' Use US units (psi, inches).') +
      varietyRule(recent, 'You and the race engineer said this to the driver on the radio in the last few minutes.') +
      driverRule +
      aiLanguageRule(input.language ?? DEFAULT_LANGUAGE),
    responseFormat: replySchema,
  });
  const content = [
    'Facts:',
    ...facts,
    '',
    ...rotationFacts(input.rotation),
    ...(engineering ? ['', ...engineering.facts] : []),
    '',
    `The driver says: "${input.said}"`,
  ].join('\n');
  const ask = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const result = await agent.invoke({ messages }, { recursionLimit: 6 });
    return (result.structuredResponse as z.infer<typeof replySchema>).reply;
  };
  let first = (await ask([{ role: 'user', content }])).trim();
  if (!first) return null;
  // Much the same as something said a moment ago: one rewrite in other words
  if (repeatsAny(first, recent)) {
    const again = (
      await ask([
        { role: 'user', content },
        { role: 'assistant', content: first },
        { role: 'user', content: VARIETY_FEEDBACK },
      ]).catch(() => '')
    ).trim();
    if (again) first = again;
  }
  // Only parameters this car can change in this session (src/lib/engineering/setupAnswerGuard.ts): one rewrite, then
  // whatever still names another is left out
  const allowed = engineering?.capabilities.known ? engineering.allowed : null;
  if (allowed) {
    const guard = checkSetupAnswer(first, allowed);
    if (!guard.ok) {
      console.warn(`Setup Engineer suggested what the car can't change (${guard.disallowed.join(', ')}); asking for a rewrite`);
      const rewrite = (
        await ask([
          { role: 'user', content },
          { role: 'assistant', content: first },
          { role: 'user', content: setupGuardFeedback(guard, fixed) },
        ]).catch(() => '')
      ).trim();
      first = withoutDisallowedSentences(rewrite || first, allowed);
      if (!first) return null;
    }
  }
  try {
    const reply = await checkedAnswer(
      first,
      (feedback) =>
        ask([
          { role: 'user', content },
          { role: 'assistant', content: first },
          { role: 'user', content: feedback },
        ]),
      await languageCheck(input.language ?? DEFAULT_LANGUAGE, namesIn(input.update))
    );
    const checked = allowed ? withoutDisallowedSentences(reply, allowed) : reply;
    return checked ? checked.slice(0, MAX_REPLY_CHARS) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Setups page (src/components/SetupEngineerChat.tsx, POST /api/setups/engineer): the same Setup Engineer, given a
// saved setup's actual values instead of the radio's live update. It writes its analysis for reading rather than for
// the radio, keeps what the data shows apart from what is only likely, and proposes changes as structured data that
// checkProposals (setupChanges.ts) checks against the setup: only parameters it really has, by their exact path, in
// their own units, in-car only in a fixed setup session. Nothing is changed until the driver accepts a proposal.

const workbenchSchema = z.object({
  summary: z.string().describe('Two to four sentences answering the question'),
  findings: z.array(z.string()).describe('What the setup values, the comparison or the measured laps show; facts only'),
  hypotheses: z.array(z.string()).describe('Likely explanations, each said to be likely, not certain'),
  recommendations: z.array(z.string()).describe('What to do and how to check it, the most effective first'),
  changes: z
    .array(
      z.object({
        path: z.string().describe('The exact parameter path from the setup list, e.g. Chassis.Rear.ArbBlades'),
        proposedValue: z.number().describe('The new number, in that parameter\'s own unit'),
        reason: z.string(),
        expectedEffect: z.string(),
        confidence: z.enum(['low', 'medium', 'high']),
      })
    )
    .describe(`At most ${MAX_PROPOSALS} proposed changes; none when no setup change is the right answer`),
});

export type WorkbenchAnswer = {
  summary: string;
  findings: string[];
  hypotheses: string[];
  recommendations: string[];
  changes: SetupProposal[];
  // Proposals left out by checkProposals, for the logs
  dropped: number;
};

export type WorkbenchSetup = {
  name: string;
  car: string | null;
  track: string | null;
  parameters: SetupParameter[];
  // From the capture: whether the session it was seen in was a fixed setup session, and its load type and name
  fixedSession: boolean | null;
  loadType: string | null;
  simSetupName: string | null;
  revisionNumber: number | null;
  recentChanges: string[];
};

const workbenchPrompt = (fixed: boolean, known: boolean) =>
  'You are a race car setup engineer working with a sim racing driver on their saved iRacing setup on the RacingCoach ' +
  'Setups page. The facts list every value of the setup exactly as iRacing shows it, one per line as ' +
  '"path | value | setting or reading | in-car or garage". Readings (corner weights, last hot pressures, tread, the aero ' +
  'calculator) are measured or worked out by iRacing and can never be changed directly. Answer the driver\'s question ' +
  'from these values, the comparison and the measured laps when the facts have them. Keep three things apart: ' +
  'findings are only what the values, the comparison or the measured laps show; hypotheses are likely explanations, ' +
  'said as likely; recommendations are what to do and how to check it (e.g. three laps, then compare). Never invent a ' +
  'value, a parameter the list does not have, a legal range, a click step or a lap time. iRacing does not tell apps a ' +
  'car\'s legal ranges, so propose small steps (one or two clicks, a few millimetres, half a percent of brake bias) ' +
  'and say the garage will limit them. Each proposed change must use a path exactly as it is in the list, a setting ' +
  'not a reading, and a number in that parameter\'s own unit; change one thing at a time when you can, the most ' +
  'effective first, and say what it trades off. A setup change never fixes a driving technique problem: when the ' +
  'facts point at driving, say so and propose no change. Left and right side values are usually set as a pair, so ' +
  'propose both sides when you change one. ' +
  (fixed
    ? 'This setup was seen in a FIXED setup session: only in-car adjustments (the in-car values in the list, such as ' +
      'brake bias, ABS and traction control) can change; propose only those, and say so first. '
    : known
      ? 'It was seen in an open setup session, so garage changes are possible. '
      : 'It is not known whether the driver races it in a fixed setup session; if they might, say that in a fixed setup ' +
        'session only the in-car values can change. ') +
  TRACK_POSITION_RULE;

function parameterLines(parameters: SetupParameter[]): string[] {
  return parameters.map((p) => `${p.path} | ${p.raw} | ${p.kind} | ${p.inCar ? 'in-car' : 'garage'}`);
}

export async function setupWorkbenchAnswer(input: {
  question: string;
  setup: WorkbenchSetup;
  // The other setup's differences from this one, when comparing
  comparison: { name: string; rows: CompareRow[] } | null;
  // The laps linked to the setup (setups.ts's readLinkedLaps) and their understeer and oversteer
  laps: { laps: number; cleanLaps: number; bestSeconds: number | null; averageCleanSeconds: number | null } | null;
  rotation: SessionRotation | null;
  weather?: WeatherContext | null;
  // A question about one part of the comparison, e.g. the Compare tab's alignment (alignmentGeometry.ts): its facts and
  // how to answer, added to the prompt
  focus?: { facts: string[]; rule: string } | null;
  language?: Language;
  units?: Units;
}): Promise<WorkbenchAnswer> {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const units = input.units ?? DEFAULT_UNITS;
  const session = fixedSetupSession({ fixedSession: input.setup.fixedSession, loadType: input.setup.loadType, name: input.setup.simSetupName });
  const facts = [
    `Setup: ${input.setup.name}${input.setup.revisionNumber ? `, revision ${input.setup.revisionNumber}` : ''}.`,
    `Car: ${input.setup.car ?? 'unknown'}. Track: ${input.setup.track ?? 'not set'}.`,
    input.setup.loadType ? `iRacing's setup load type: ${input.setup.loadType}.` : '',
    '',
    'Setup values:',
    ...parameterLines(input.setup.parameters),
  ].filter((line, i, all) => line || all[i - 1]);
  if (input.setup.recentChanges.length) facts.push('', 'Recent changes to this setup, newest first:', ...input.setup.recentChanges);
  if (input.comparison) {
    const changed = input.comparison.rows.filter((r) => r.status !== 'same');
    facts.push(
      '',
      `Compared with the setup "${input.comparison.name}" (same car), ${changed.length} values differ, as "path: this setup -> the other":`,
      ...changed.slice(0, 80).map((r) => `${r.path}: ${r.baseline ?? 'not in this setup'} -> ${r.comparison ?? 'not in the other'}`)
    );
  }
  if (input.laps && input.laps.laps > 0) {
    facts.push(
      '',
      `Laps driven on this setup: ${input.laps.laps} (${input.laps.cleanLaps} clean)` +
        (input.laps.bestSeconds ? `, best ${input.laps.bestSeconds.toFixed(3)} s` : '') +
        (input.laps.averageCleanSeconds ? `, clean average ${input.laps.averageCleanSeconds.toFixed(3)} s` : '') +
        '. Lap times depend on the driver and the conditions too, never only on the setup.'
    );
  } else {
    facts.push('', 'No laps are linked to this setup, so nothing about how it drives has been measured.');
  }
  if (input.focus) facts.push('', ...input.focus.facts);
  if (input.rotation) facts.push('', ...rotationFacts(input.rotation));
  if (input.weather !== undefined) facts.push('', ...weatherFacts(input.weather, units === 'metric' ? 'metric' : 'standard'));

  const engineering = await engineeringContext({
    question: input.question,
    car: input.setup.car,
    fixed: session.fixed,
    setupKnown: true,
    rotation: rotationEvidence(input.rotation),
    ...(input.weather !== undefined ? { weather: input.weather, weatherInFacts: false } : {}),
    agent: 'setupEngineer',
    model: await getAiModel('setupEngineer').catch(() => null),
  }).catch((error): EngineeringContext | null => {
    console.error('Setup Engineer (Setups page): engineering knowledge failed, answering without it:', error);
    return null;
  });
  if (engineering) facts.push('', ...engineering.facts);

  const agent = createAgent({
    model: await chatModel('setupEngineer', 0.4),
    tools: [],
    systemPrompt:
      workbenchPrompt(session.fixed, session.known) +
      SETUP_ENGINEER_METHOD +
      wetSetupRule(input.weather) +
      (input.focus?.rule ?? '') +
      ' Keep every setup value in the unit the list gives it. ' +
      (units === 'metric' ? 'Use metric units for anything else.' : 'Use US units for anything else.') +
      aiLanguageRule(language),
    responseFormat: workbenchSchema,
  });
  const content = ['Facts:', ...facts, '', `The driver asks: "${input.question}"`].join('\n');
  const ask = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const result = await agent.invoke({ messages }, { recursionLimit: 6 });
    return result.structuredResponse as z.infer<typeof workbenchSchema>;
  };
  let answer = await ask([{ role: 'user', content }]);
  // A place on the track or English for another language: one rewrite (answerChecks.ts), then those sentences go
  const text = (a: typeof answer) => [a.summary, ...a.findings, ...a.hypotheses, ...a.recommendations, ...a.changes.flatMap((c) => [c.reason, c.expectedEffect])].join('\n');
  const check = await languageCheck(language, [input.setup.car ?? '', input.setup.track ?? '', input.setup.name, ...input.setup.parameters.map((p) => p.key)]);
  const feedback = answerFeedback(text(answer), check);
  if (feedback) {
    answer = await ask([
      { role: 'user', content },
      { role: 'assistant', content: JSON.stringify(answer) },
      { role: 'user', content: feedback },
    ]).catch(() => answer);
  }
  const clean = (s: string) => removeTrackPositions(s).trim();
  const list = (items: string[]) => items.map(clean).filter(Boolean).slice(0, 8);
  const { kept, rejected } = checkProposals(answer.changes as RawProposal[], input.setup.parameters, { fixedSession: session.fixed });
  if (rejected.length) console.warn(`Setup Engineer (Setups page) proposals left out: ${rejected.map((r) => r.why).join(', ')}`);
  return {
    summary: clean(answer.summary),
    findings: list(answer.findings),
    hypotheses: list(answer.hypotheses),
    recommendations: list(answer.recommendations),
    changes: kept.map((c) => ({ ...c, reason: clean(c.reason), expectedEffect: clean(c.expectedEffect) })),
    dropped: rejected.length,
  };
}
