// Cold tire checks for the In-Car AI Coach (src/lib/tireWarmup.ts): npm run test:tire-warmup

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brakesLaterOnColdTires, lapSurfaceTemp, stintLaps, tireWarmup } from '../src/lib/tireWarmup.ts';

const start = Date.parse('2026-11-04T18:00:00Z');
// Laps of 100 s, back to back from lap `first`
const laps = (first, count, offsetS = 0, surfaceC = null) =>
  Array.from({ length: count }, (_, i) => ({
    lapNumber: first + i,
    lapSeconds: 100,
    completedAt: new Date(start + (offsetS + (i + 1) * 100) * 1000).toISOString(),
    surfaceC: Array.isArray(surfaceC) ? surfaceC[i] : surfaceC,
  }));

test('the first two flying laps of a stint are on cold tires, the third is not', () => {
  assert.equal(tireWarmup(laps(2, 1)).cold, true);
  assert.equal(tireWarmup(laps(2, 2)).cold, true);
  const third = tireWarmup(laps(2, 3));
  assert.equal(third.cold, false);
  assert.equal(third.stintLap, 3);
});

test('a missing lap number (the pit road in and out laps) starts a new stint', () => {
  const session = [...laps(2, 5), ...laps(9, 1, 900)];
  assert.deepEqual(stintLaps(session), [1, 2, 3, 4, 5, 1]);
  assert.equal(tireWarmup(session).cold, true);
});

test('a long wait between consecutive lap numbers starts a new stint', () => {
  const session = [...laps(2, 3), ...laps(5, 1, 600)];
  assert.deepEqual(stintLaps(session), [1, 2, 3, 1]);
});

test('surface temperatures decide when the lap has them', () => {
  assert.equal(tireWarmup(laps(2, 1, 0, 85)).cold, false);
  assert.equal(tireWarmup(laps(2, 4, 0, [50, 55, 58, 59])).cold, true);
  assert.equal(tireWarmup(laps(2, 3, 0, [70, 76, 82])).cold, true);
  assert.equal(tireWarmup(laps(2, 3, 0, [80, 84, 86])).cold, false);
});

test('the surface temperature is the end of the lap, surface layers only', () => {
  const ramp = Array.from({ length: 100 }, (_, i) => i);
  const tire = { outer: ramp, middle: ramp, inner: ramp };
  assert.equal(lapSurfaceTemp({ LF: tire }, { LF: 'surface' }), 94.5);
  assert.equal(lapSurfaceTemp({ LF: tire }, { LF: 'carcass' }), null);
});

test('braking later on cold tires is caught unless it is for once they are warm', () => {
  for (const text of [
    'Turn 1: brake about 20 ft later.',
    'T4: brake 6 m later than your fastest lap.',
    'Curva 1: frear 6 m mais tarde.',
    'Curva 1: frena 6 m más tarde.',
    'Kurve 1: 6 m später bremsen.',
  ]) {
    assert.equal(brakesLaterOnColdTires(text), true, text);
  }
  for (const text of [
    'Once your tires are warm, brake about 20 ft later in Turn 1.',
    'Quando os pneus estiverem quentes, frear 6 m mais tarde na Curva 1.',
    'Cuando los neumáticos estén calientes, frena 6 m más tarde.',
    'Wenn die Reifen warm sind, 6 m später bremsen.',
    'Turn 1: get back on the throttle earlier.',
    'Turn 3: brake 20 ft earlier.',
  ]) {
    assert.equal(brakesLaterOnColdTires(text), false, text);
  }
});
