// Wet-weather intelligence (docs/wet-weather.md): the shared weather context, wet-weather retrieval and diagnosis,
// the wet-weather corpus and the In-Car AI Coach's weather alerts, all pure. npm run test:wet-weather
//
// The scenarios are the ones the feature was specified with: dry/slicks, wet/wets, wet/slicks, drying/wets, rain
// increasing and decreasing, missing compound and forecast, fixed and open setups in rain, wet entry understeer and
// exit oversteer, ABS and TC intervention, standing water, crossovers, stale and conflicting data, and a car without
// wet tires. Dry behaviour must not change: without wet conditions no wet-weather record is ever retrieved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_CORPUS, STARTER_SOURCES } from '../src/lib/engineering/starterCorpus.ts';
import { WET_WEATHER_CORPUS } from '../src/lib/engineering/wetWeatherCorpus.ts';
import { assembleContext, recordToChunk, retrieve } from '../src/lib/engineering/retrieval.ts';
import { allowedParameters, capabilitiesFor } from '../src/lib/engineering/setupCapabilities.ts';
import { diagnose, diagnosisFacts } from '../src/lib/engineering/diagnosis.ts';
import { BENCHMARK_QUESTIONS } from '../src/lib/engineering/benchmarkQuestions.ts';
import {
  assessWeather,
  buildWeatherContext,
  compoundKind,
  trackCondition,
  weatherContextFromLaps,
  weatherContextFromLive,
  weatherFacts,
  WEATHER_STALE_MS,
} from '../src/lib/engineering/weatherContext.ts';
import { CONFIRM_MS, MIN_GAP_MS, nextWeatherAlert } from '../src/lib/engineering/weatherAlerts.ts';

const CHUNKS = STARTER_CORPUS.map(recordToChunk);
const NOW = 1_800_000_000_000;
const CAR = 'Lamborghini Huracan GT3 EVO';

// iRacing's compounds for a car with wets, and one without
const WITH_WETS = [
  { index: 0, type: 'Hard' },
  { index: 1, type: 'Wet' },
];
const SLICKS_ONLY = [{ index: 0, type: 'Hard' }];

const WETNESS = { dry: 1, damp: 3, wet: 5, veryWet: 6 };
const RAIN = { dry: 0, damp: 0.05, wet: 0.3, veryWet: 0.7 };

function weather({ condition = 'dry', compound = 0, available = WITH_WETS, trend = null, ageMs = 1000, type = 'dynamic', tires = undefined, declaredWet } = {}) {
  return buildWeatherContext({
    car: CAR,
    weather: {
      type,
      wetness: WETNESS[condition],
      precipitation: RAIN[condition],
      declaredWet: declaredWet ?? WETNESS[condition] > 1,
      airTemp: 14,
      trackTemp: 18,
      humidity: 0.9,
    },
    tires: tires === undefined ? { compound, available } : tires,
    trend,
    observedAt: NOW - ageMs,
    now: NOW,
    origin: 'live',
  });
}

const trend = (over = {}) => ({ minutes: 10, airTemp: 0, trackTemp: 0, skies: 0, precipitation: 0, wetness: 0, ...over });

function run(said, w, { fixed = false } = {}) {
  const caps = capabilitiesFor('iracing', CAR);
  const allowed = allowedParameters(caps, fixed);
  const assessment = w === undefined ? undefined : assessWeather(w);
  const ctx = { simulator: 'iracing', carClass: caps.carClass, car: CAR, allowed, weather: assessment };
  const retrieval = retrieve(CHUNKS, said, ctx);
  const diagnosis = diagnose({ said, retrieval, capabilities: caps, allowed, fixed, setupKnown: true, rotation: null, weather: assessment });
  return { retrieval, diagnosis, ids: retrieval.results.map((r) => r.chunk.documentKey), ctx, caps };
}

const isWet = (id) => id.startsWith('wet-') || id.startsWith('dx-wet-');

// ------------------------------------------------------------------ the corpus

test('the wet-weather corpus is in the starter corpus, tagged wetWeather, with known sources', () => {
  assert.ok(WET_WEATHER_CORPUS.length >= 30);
  const sources = new Set(STARTER_SOURCES.map((s) => s.key));
  for (const r of WET_WEATHER_CORPUS) {
    assert.ok(STARTER_CORPUS.includes(r), r.id);
    assert.ok(r.components.includes('wetWeather'), r.id);
    assert.ok(isWet(r.id), r.id);
    assert.equal(r.verification, 'ai_drafted', r.id);
    for (const s of r.sources) assert.ok(sources.has(s), `${r.id}: ${s}`);
  }
});

test('wet-weather records state no exact settings and no one-size rules', () => {
  for (const r of WET_WEATHER_CORPUS) {
    for (const a of r.adjustments) {
      assert.doesNotMatch(a.direction, /\d/, `${r.id} ${a.parameter}: a number in the direction`);
      assert.ok(a.tradeoff.trim().length > 10, `${r.id} ${a.parameter}: no tradeoff`);
    }
    const text = [r.summary, ...r.adjustments.map((a) => a.direction), ...r.drivingCorrections].join(' ');
    assert.doesNotMatch(text, /always (move|put|shift) (the )?(brake )?bias rearward|always (soften|raise|add downforce)|off-line is always faster/i, r.id);
  }
});

test('the specific wet-weather problems each have a record', () => {
  for (const id of [
    'dx-wet-entry-understeer',
    'dx-wet-exit-oversteer',
    'dx-wet-abs-intervention',
    'dx-wet-rear-instability-braking',
    'dx-wet-aquaplaning',
    'dx-wet-wets-overheating-drying',
    'dx-wet-tc-intervention',
    'dx-wet-crossover-slicks-to-wets',
    'dx-wet-crossover-wets-to-slicks',
    'wet-diff-adjustments',
    'wet-brake-bias',
    'wet-tc-tuning',
    'wet-line-selection',
  ]) {
    assert.ok(WET_WEATHER_CORPUS.some((r) => r.id === id), id);
  }
});

test('the brake bias record does not tell the driver to move the bias rearward because it rains', () => {
  const bias = WET_WEATHER_CORPUS.find((r) => r.id === 'wet-brake-bias');
  assert.match(bias.summary, /not|depends|does not/i);
  assert.ok(bias.adjustments.some((a) => /forward/i.test(a.direction)) || /forward/i.test(bias.summary));
});

// ------------------------------------------------------------------ dry behaviour is unchanged

test('without wet conditions no benchmark question retrieves a wet-weather record', () => {
  for (const q of BENCHMARK_QUESTIONS) {
    const caps = capabilitiesFor('iracing', q.car);
    const ctx = { simulator: 'iracing', carClass: caps.carClass, car: q.car, allowed: null };
    const ids = retrieve(CHUNKS, q.question, ctx).results.map((r) => r.chunk.documentKey);
    assert.ok(!ids.some(isWet), `${q.question}: ${ids.join(', ')}`);
  }
});

test('scenario 1: dry track on slicks retrieves exactly what it did without weather', () => {
  const w = weather({ condition: 'dry', compound: 0 });
  assert.equal(w.condition, 'dry');
  assert.equal(w.tires.fitted.kind, 'dry');
  assert.equal(w.mismatch, null);
  for (const said of ['I have understeer on entry', 'oversteer on exit', 'the ABS keeps kicking in']) {
    const withWeather = run(said, w).ids;
    const without = run(said, undefined).ids;
    assert.deepEqual(withWeather, without, said);
  }
});

// ------------------------------------------------------------------ the weather context

test('track condition comes from iRacing TrackWetness, then rain', () => {
  assert.equal(trackCondition(1, 0, false), 'dry');
  assert.equal(trackCondition(2, 0, false), 'damp');
  assert.equal(trackCondition(4, 0.1, true), 'damp');
  assert.equal(trackCondition(5, 0.3, true), 'wet');
  assert.equal(trackCondition(7, 0.9, true), 'veryWet');
  assert.equal(trackCondition(null, 0.6, null), 'wet');
  assert.equal(trackCondition(0, 0.05, null), 'damp');
  assert.equal(trackCondition(null, 0, null), 'unknown');
});

test('compound names are classified, and the fitted compound is the index into the car list', () => {
  assert.equal(compoundKind('Hard'), 'dry');
  assert.equal(compoundKind('Wet'), 'wet');
  assert.equal(compoundKind('wet_compound'), 'wet');
  assert.equal(compoundKind('Intermediate'), 'intermediate');
  assert.equal(compoundKind('Mystery'), 'unknown');
  const w = weather({ condition: 'wet', compound: 1 });
  assert.equal(w.tires.fitted.kind, 'wet');
  assert.equal(w.tires.fitted.confidence, 'high');
  assert.equal(w.tires.carHasWetTires, true);
  assert.equal(w.tires.perCorner, 'notReported');
});

test('the next-stop compound is kept apart from the fitted one', () => {
  const w = buildWeatherContext({
    weather: { wetness: 5, precipitation: 0.3 },
    tires: { compound: 0, pitCompound: 1, available: WITH_WETS },
    observedAt: NOW,
    now: NOW,
    origin: 'live',
  });
  assert.equal(w.tires.fitted.kind, 'dry');
  assert.equal(w.tires.nextPit.kind, 'wet');
  assert.equal(w.mismatch, 'slicksOnWet');
  assert.ok(weatherFacts(w).some((f) => /next pit stop \(not fitted yet\)/.test(f)));
});

test('raw values, units and sources are kept with each reading', () => {
  const w = weather({ condition: 'wet', compound: 1 });
  assert.equal(w.rain.raw, 0.3);
  assert.equal(w.rain.source, 'Precipitation');
  assert.equal(w.trackWetness.raw, 5);
  assert.equal(w.trackWetness.label, 'moderately wet');
  assert.equal(w.trackTemp.unit, '°C');
  assert.equal(w.standingWater.status, 'notExposed');
});

// ------------------------------------------------------------------ the scenarios

test('scenario 2 and 11: wet track on wet tires, entry understeer, leads with the wet record', () => {
  const w = weather({ condition: 'wet', compound: 1 });
  assert.equal(w.mismatch, null);
  const { ids, diagnosis } = run('I have understeer on entry', w);
  assert.equal(ids[0], 'dx-wet-entry-understeer', ids.join(', '));
  assert.ok(ids.includes('dx-entry-understeer') || ids.some(isWet));
  assert.ok(diagnosis.sources.includes('dx-wet-entry-understeer'));
  assert.equal(diagnosis.weather, 'wet');
  assert.ok(diagnosis.observations.some((o) => /Track wet, on wet tires/.test(o)), diagnosis.observations.join(' | '));
});

test('scenario 3: wet track on slicks puts the tires before any handling or chassis change', () => {
  const w = weather({ condition: 'wet', compound: 0 });
  assert.equal(w.mismatch, 'slicksOnWet');
  const { diagnosis, ids } = run('I have understeer everywhere', w);
  assert.equal(diagnosis.focus, 'conditions');
  assert.match(diagnosis.conditionsNote, /slicks on a wet track/);
  assert.ok(diagnosis.setupChanges.every((c) => c.inCar), diagnosis.setupChanges.map((c) => c.label).join(', '));
  assert.match(diagnosis.driverChanges[0], /wet tires/);
  assert.ok(diagnosis.hypotheses[0].kind === 'conditions' && diagnosis.hypotheses[0].confidence === 'likely');
  assert.ok(ids.some((id) => id === 'dx-wet-crossover-slicks-to-wets' || id === 'dx-wet-tire-mismatch-slicks'), ids.join(', '));
  assert.ok(weatherFacts(w).some((f) => f.startsWith('TIRE MISMATCH')));
  assert.ok(diagnosisFacts(diagnosis).some((f) => /Work on first: the tires/.test(f)));
});

test('scenario 4: a drying track on wet tires raises overheating and the crossover', () => {
  const w = weather({ condition: 'damp', compound: 1, trend: trend({ wetness: -2, precipitation: -0.05 }) });
  assert.equal(w.trend.wetness, 'drying');
  assert.equal(w.mismatch, 'wetsOnDrying');
  const { ids, diagnosis } = run('the tires feel hot and greasy', w);
  assert.ok(ids.slice(0, 4).includes('dx-wet-wets-overheating-drying'), ids.join(', '));
  assert.ok(diagnosis.hypotheses.some((h) => /drying track/.test(h.cause)));
  // only a possibility: the laps and conditions decide, never a blanket "fit slicks"
  assert.notEqual(diagnosis.focus, 'conditions');
});

test('scenario 5: increasing rain is seen as a trend, projected but never called a forecast', () => {
  const w = weather({ condition: 'wet', compound: 1, trend: trend({ precipitation: 0.1, wetness: 1 }) });
  assert.equal(w.trend.rain, 'increasing');
  assert.equal(w.forecast.available, false);
  assert.match(w.forecast.projection.basis, /not a forecast/);
  assert.ok(w.forecast.projection.items.some((i) => /heavier/.test(i)));
  assert.equal(assessWeather(w).worsening, true);
});

test('scenario 6: decreasing rain is seen as easing', () => {
  const w = weather({ condition: 'wet', compound: 1, trend: trend({ precipitation: -0.1 }) });
  assert.equal(w.trend.rain, 'decreasing');
  assert.ok(w.forecast.projection.items.some((i) => /easing/.test(i)));
});

test('scenario 7: a missing tire compound is reported as missing, never assumed', () => {
  const w = weather({ condition: 'wet', tires: null });
  assert.equal(w.tires.fitted.confidence, 'none');
  assert.equal(w.mismatch, null);
  assert.ok(weatherFacts(w).some((f) => /Fitted tires: not reported/.test(f)));
  const { diagnosis } = run('understeer on entry', w);
  assert.ok(diagnosis.missing.some((m) => /Which tires are fitted/.test(m)));
  // an index with no compound list to name it is low confidence, and no mismatch is claimed from it
  const indexOnly = weather({ condition: 'wet', compound: 0, available: null });
  assert.equal(indexOnly.tires.fitted.confidence, 'low');
  assert.equal(indexOnly.mismatch, null);
});

test('scenario 8: iRacing shares no forecast, and the facts say so', () => {
  const w = weather({ condition: 'damp', compound: 1 });
  assert.equal(w.forecast.available, false);
  assert.ok(weatherFacts(w).some((f) => /^Forecast: not available/.test(f)));
  // with no trend yet there is no projection either
  assert.equal(w.forecast.projection, null);
  const fixedWeather = weather({ condition: 'wet', compound: 1, type: 'static' });
  assert.match(fixedWeather.forecast.projection.items[0], /No change/);
});

test('scenario 9: a fixed setup in the rain offers only in-car changes', () => {
  const w = weather({ condition: 'wet', compound: 1 });
  const { diagnosis, ids } = run('oversteer on exit', w, { fixed: true });
  assert.ok(diagnosis.setupChanges.length > 0);
  assert.ok(diagnosis.setupChanges.every((c) => c.inCar), diagnosis.setupChanges.map((c) => c.label).join(', '));
  assert.ok(ids.includes('wet-fixed-setup') || ids.some(isWet), ids.join(', '));
});

test('scenario 10: an open setup in the rain finds the wet setup knowledge, with chassis changes', () => {
  const w = weather({ condition: 'wet', compound: 1 });
  const { ids } = run('how should I set up the springs and anti-roll bars for the rain', w);
  assert.ok(ids.slice(0, 3).some((id) => id.startsWith('wet-setup')), ids.join(', '));
  const caps = capabilitiesFor('iracing', CAR);
  const ctx = { simulator: 'iracing', carClass: caps.carClass, car: CAR, allowed: allowedParameters(caps, false), weather: assessWeather(w) };
  const assembled = assembleContext(retrieve(CHUNKS, 'how should I set up the springs and anti-roll bars for the rain', ctx), ctx);
  assert.match(assembled.text, /tradeoff/);
});

test('scenario 12: wet exit oversteer leads with the wet record', () => {
  const { ids } = run('I get oversteer on exit when I get on the power', weather({ condition: 'wet', compound: 1 }));
  assert.equal(ids[0], 'dx-wet-exit-oversteer', ids.join(', '));
});

test('scenario 13: ABS working hard in the rain finds the wet ABS record', () => {
  const { ids } = run('the ABS is kicking in all the time under braking', weather({ condition: 'wet', compound: 1 }));
  assert.ok(ids.slice(0, 2).includes('dx-wet-abs-intervention'), ids.join(', '));
});

test('scenario 14: traction control cutting in finds the wet TC record', () => {
  const { ids } = run('traction control keeps cutting in on exit', weather({ condition: 'wet', compound: 1 }));
  assert.ok(ids.slice(0, 3).some((id) => id === 'dx-wet-tc-intervention' || id === 'wet-tc-tuning'), ids.join(', '));
});

test('scenario 15: standing water and aquaplaning find the aquaplaning records', () => {
  const w = weather({ condition: 'veryWet', compound: 1 });
  const { ids, retrieval } = run('the car aquaplanes through the standing water on the straight', w);
  assert.ok(ids.slice(0, 2).includes('dx-wet-aquaplaning'), ids.join(', '));
  assert.ok(retrieval.query.symptoms.includes('aquaplaning'));
  // the simulator reports no water depth, and the facts say so
  assert.ok(weatherFacts(w).some((f) => /standing water or water depth/.test(f)));
});

test('scenario 16: crossover decisions find the crossover records each way', () => {
  const drying = weather({ condition: 'damp', compound: 1, trend: trend({ wetness: -2 }) });
  const toSlicks = run('should I change to slicks', drying).ids;
  assert.ok(toSlicks.slice(0, 3).includes('dx-wet-crossover-wets-to-slicks'), toSlicks.join(', '));
  const raining = weather({ condition: 'wet', compound: 0 });
  const toWets = run('should I pit for wet tires', raining).ids;
  assert.ok(toWets.slice(0, 3).some((id) => id === 'dx-wet-crossover-slicks-to-wets' || id === 'dx-wet-tire-mismatch-slicks'), toWets.join(', '));
  // a wet question is answered from the wet knowledge even when the conditions aren't known
  assert.ok(run('when should I switch to wets', undefined).ids.some(isWet));
});

test('scenario 17: stale readings are never current, and conflicting ones are flagged', () => {
  const stale = weather({ condition: 'wet', compound: 0, ageMs: WEATHER_STALE_MS + 1000 });
  assert.equal(stale.fresh, false);
  assert.equal(stale.rain.status, 'stale');
  assert.equal(assessWeather(stale), null);
  assert.ok(weatherFacts(stale)[0].includes('NOT current'));
  // retrieval treats stale weather as unknown: no wet knowledge for a dry question
  assert.ok(!run('understeer on entry', stale).ids.some(isWet));
  // and the alerts stay quiet
  assert.equal(nextWeatherAlert(null, stale, NOW, true).alert, null);
  const conflicting = buildWeatherContext({
    weather: { wetness: 1, precipitation: 0.3, declaredWet: true, type: 'static' },
    trend: trend({ precipitation: 0.1 }),
    observedAt: NOW,
    now: NOW,
    origin: 'live',
  });
  assert.ok(conflicting.warnings.some((w) => /declared wet but the track wetness reads dry/.test(w)));
  assert.ok(conflicting.warnings.some((w) => /probably just starting to rain/.test(w)));
  assert.ok(conflicting.warnings.some((w) => /static but the readings are changing/.test(w)));
});

test('scenario 18: a car without wet tires on a wet track is told so', () => {
  const w = weather({ condition: 'wet', compound: 0, available: SLICKS_ONLY });
  assert.equal(w.tires.carHasWetTires, false);
  assert.equal(w.mismatch, 'noWetTires');
  assert.ok(weatherFacts(w).some((f) => /no wet tires/.test(f)));
  const { diagnosis } = run('no grip anywhere', w);
  assert.ok(diagnosis.hypotheses.some((h) => /no wet tires/.test(h.cause)));
  // the tire mismatch rule doesn't apply: there's nothing to change to
  assert.notEqual(diagnosis.conditionsNote ?? '', 'the tires: slicks on a wet track, before any handling or setup change');
});

// ------------------------------------------------------------------ from laps and from the live state

test('a session weather context from its laps is history, with the change across the session', () => {
  const laps = [
    { completedAt: NOW - 20 * 60_000, conditions: { trackTempC: 20, airTempC: 15, precipitation: 0.3, trackWetness: 5, declaredWet: true, tireCompoundType: 'Wet' } },
    { completedAt: NOW - 60_000, conditions: { trackTempC: 22, airTempC: 15, precipitation: 0, trackWetness: 3, declaredWet: true, tireCompoundType: 'Wet' } },
  ];
  const w = weatherContextFromLaps(laps, NOW, CAR);
  assert.equal(w.origin, 'lap');
  assert.equal(w.fresh, false);
  assert.equal(w.condition, 'damp');
  assert.equal(w.trend.wetness, 'drying');
  assert.equal(w.tires.fitted.kind, 'wet');
  assert.equal(w.mismatch, 'wetsOnDrying');
  // a debrief's conditions are reliable for those laps
  assert.ok(assessWeather(w));
  assert.match(weatherFacts(w)[0], /newest uploaded lap \(history/);
  // laps from collectors before 1.94.0 have no wet weather or tires: nothing is assumed
  const old = weatherContextFromLaps([{ completedAt: NOW, conditions: { trackTempC: 30, airTempC: 25 } }], NOW);
  assert.equal(old.condition, 'unknown');
  assert.equal(old.tires.fitted.confidence, 'none');
});

test('a live snapshot becomes a weather context, stale once old', () => {
  const snapshot = {
    update: { car: CAR, weather: { wetness: 5, precipitation: 0.3, declaredWet: true }, tires: { compound: 1, available: WITH_WETS } },
    field: { subSessionId: 4242 },
    weatherTrend: null,
    receivedAt: NOW - 2000,
  };
  const fresh = weatherContextFromLive(snapshot, NOW);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.sessionId, 4242);
  assert.equal(fresh.tires.fitted.kind, 'wet');
  assert.equal(weatherContextFromLive(snapshot, NOW + 60_000).fresh, false);
  assert.equal(weatherContextFromLive(null, NOW).origin, 'none');
});

// ------------------------------------------------------------------ alerts

test('a weather alert needs its evidence to hold, then respects its cooldown', () => {
  const dry = weather({ condition: 'dry', compound: 0 });
  let state = nextWeatherAlert(null, dry, NOW, true).state;
  const raining = (at) =>
    buildWeatherContext({ weather: { wetness: 1, precipitation: 0.1 }, tires: { compound: 0, available: WITH_WETS }, observedAt: at, now: at, origin: 'live' });
  let r = nextWeatherAlert(state, raining(NOW + 1000), NOW + 1000, true);
  assert.equal(r.alert, null, 'not confirmed yet');
  r = nextWeatherAlert(r.state, raining(NOW + 1000 + CONFIRM_MS), NOW + 1000 + CONFIRM_MS, true);
  assert.equal(r.alert, 'rainStarted');
  // said once; the same reading doesn't say it again
  const again = nextWeatherAlert(r.state, raining(NOW + 1000 + CONFIRM_MS + MIN_GAP_MS), NOW + 1000 + CONFIRM_MS + MIN_GAP_MS, true);
  assert.equal(again.alert, null);
});

test('slicks on a wet track is the first alert, and nothing is said off track', () => {
  const w = (at) => buildWeatherContext({ weather: { wetness: 5, precipitation: 0.3 }, tires: { compound: 0, available: WITH_WETS }, trend: trend({ precipitation: 0.1 }), observedAt: at, now: at, origin: 'live' });
  let r = nextWeatherAlert(null, w(NOW), NOW, false);
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS), NOW + CONFIRM_MS, false);
  assert.equal(r.alert, null, 'in the pits: quiet');
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS + 1), NOW + CONFIRM_MS + 1, true);
  assert.equal(r.alert, 'slicksOnWet');
  // the next due one waits for the gap between alerts
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS + 2000), NOW + CONFIRM_MS + 2000, true);
  assert.equal(r.alert, null);
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS + MIN_GAP_MS + 2), NOW + CONFIRM_MS + MIN_GAP_MS + 2, true);
  assert.equal(r.alert, 'rainHeavier');
});

test('a drying track on wet tires alerts, and easing rain is told last', () => {
  const w = (at) =>
    buildWeatherContext({
      weather: { wetness: 3, precipitation: 0.03 },
      tires: { compound: 1, available: WITH_WETS },
      trend: trend({ wetness: -1, precipitation: -0.1 }),
      observedAt: at,
      now: at,
      origin: 'live',
    });
  let r = nextWeatherAlert(null, w(NOW), NOW, true);
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS), NOW + CONFIRM_MS, true);
  assert.equal(r.alert, 'wetsOnDrying');
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS + MIN_GAP_MS), NOW + CONFIRM_MS + MIN_GAP_MS, true);
  assert.equal(r.alert, 'trackDrying');
  r = nextWeatherAlert(r.state, w(NOW + CONFIRM_MS + 2 * MIN_GAP_MS), NOW + CONFIRM_MS + 2 * MIN_GAP_MS, true);
  assert.equal(r.alert, 'rainEasing');
});
