// Lap Compare's telemetry chart events and phases (src/lib/lapEvents.ts): npm run test:lap-events

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaStats } from '../src/lib/lapData.ts';
import { deltas, lapFuel, largest, meanAbs, pairShifts, shiftEvents, stats, steeringReversals, stretchesWhere } from '../src/lib/lapChannels.ts';
import { roundTicks } from '../src/lib/lapCharts.ts';
import { cornerPhases, detectLapEvents, evenGrid, positionAtTime, resample, resampleNearest } from '../src/lib/lapEvents.ts';

const close = (actual, expected, within = 1e-9) => assert.ok(Math.abs(actual - expected) < within, `${actual} is not ${expected}`);
const N = 1001;
const pcts = Array.from({ length: N }, (_, i) => 0.2 + (i / (N - 1)) * 0.1); // 0.2..0.3 of the lap
const at = (pct) => pcts.findIndex((p) => p >= pct - 1e-12);

// Fills from..to (lap positions), with the rest the given value
const shape = (rest, ...spans) => pcts.map((p) => spans.find(([from, to]) => p >= from - 1e-12 && p < to - 1e-12)?.[2] ?? rest);

// Flat out, lift and brake, a corner with the speed dipping to its lowest at 0.26, back on the power
function corner() {
  return {
    pcts,
    times: pcts.map((_, i) => i / 60),
    brakes: shape(0, [0.22, 0.25, 0.8]),
    throttles: shape(1, [0.219, 0.255, 0], [0.255, 0.27, 0.5]),
    steerings: pcts.map((p) => (p < 0.235 ? 0.01 : p < 0.27 ? 0.4 : 0.01)),
    speeds: pcts.map((p) => 30 + Math.abs(p - 0.26) * 800),
  };
}

test('finds the events of a corner', () => {
  const events = detectLapEvents(corner());
  close(events.peakBrake.value, 0.8);
  close(events.brakeRelease, 0.25);
  close(events.throttleLift, 0.219);
  close(events.throttlePickup, 0.255);
  close(events.fullThrottle, 0.27);
  close(events.turnIn, 0.235);
  close(events.apex.pct, 0.26);
  close(events.apex.speed, 30);
  assert.ok(events.apex.start < 0.26 && events.apex.end > 0.26);
  assert.ok(events.brakePoint >= pcts[at(0.22) - 1] && events.brakePoint <= 0.22);
});

test('the brakepoint and pickup match what the focus area table measures', () => {
  const trace = corner();
  const stats = areaStats({ ...trace, lats: [], lons: [] }, 100, 0.205, 0.295);
  const events = detectLapEvents(trace);
  close(events.brakePoint, stats.brakePct);
  close(events.throttlePickup, stats.throttlePct);
});

test('a lap with no braking has no brake events and no phases, but still an apex', () => {
  const trace = { ...corner(), brakes: shape(0), throttles: shape(1, [0.25, 0.26, 0], [0.26, 0.28, 0.5]) };
  const events = detectLapEvents(trace);
  assert.equal(events.brakePoint, null);
  assert.equal(events.peakBrake, null);
  assert.equal(events.brakeRelease, null);
  assert.equal(events.turnIn, null);
  close(events.throttleLift, 0.25);
  close(events.throttlePickup, 0.26);
  close(events.fullThrottle, 0.28);
  assert.ok(events.apex);
  assert.deepEqual(cornerPhases(events, 0.3), []);
});

test('a partial lift has no pickup, as the throttle never came off', () => {
  const events = detectLapEvents({ ...corner(), brakes: shape(0), throttles: shape(1, [0.25, 0.26, 0.5]) });
  close(events.throttleLift, 0.25);
  assert.equal(events.throttlePickup, null);
  assert.equal(events.fullThrottle, null);
});

test('a brush of the brake isn’t the corner: the brakepoint stays the table’s, the rest follow the main zone', () => {
  const trace = { ...corner(), brakes: shape(0, [0.205, 0.207, 0.03], [0.22, 0.25, 0.8]) };
  const events = detectLapEvents(trace);
  const stats = areaStats({ ...trace, lats: [], lons: [] }, 100, 0.2005, 0.295);
  close(events.brakePoint, stats.brakePct);
  assert.ok(events.brakePoint < 0.206);
  close(events.mainBrakeStart, 0.22);
  close(events.peakBrake.value, stats.maxBrake);
  close(events.brakeRelease, 0.25);
  close(events.throttlePickup, 0.255);
  close(events.apex.pct, 0.26);
  assert.deepEqual(cornerPhases(events, 0.3).map(({ id }) => id), ['braking', 'turnIn', 'apex', 'exit']);
  close(cornerPhases(events, 0.3)[0].start, events.mainBrakeStart);
});

test('an area with two corners is measured on the one with the most brake, as the table’s peak is', () => {
  const trace = {
    ...corner(),
    brakes: shape(0, [0.21, 0.23, 0.5], [0.27, 0.29, 0.95]),
    speeds: pcts.map((p) => (p < 0.27 ? 40 + Math.abs(p - 0.24) * 100 : 20 + Math.abs(p - 0.295) * 100)),
  };
  const events = detectLapEvents(trace);
  close(events.peakBrake.value, 0.95);
  close(events.brakeRelease, 0.29);
  close(events.apex.pct, 0.295);
});

test('the apex stops at the end of the area, as the lap’s samples run just past it', () => {
  const events = { ...detectLapEvents(corner()), apex: { pct: 0.29, start: 0.285, end: 0.3005, speed: 30 } };
  const phases = cornerPhases(events, 0.3);
  assert.equal(phases[phases.length - 1].id, 'apex');
  assert.equal(phases[phases.length - 1].end, 0.3);
});

test('an area crossing the start/finish line keeps its order, as lap positions carry on past 1', () => {
  const across = pcts.map((p) => p + 0.75); // 0.95..1.05
  const trace = { ...corner(), pcts: across };
  const events = detectLapEvents(trace);
  const phases = cornerPhases(events, 1.05);
  assert.deepEqual(phases.map(({ id }) => id), ['braking', 'turnIn', 'apex', 'exit']);
  close(events.apex.pct, 1.01);
});

test('a brake still on at the end of the area has no release, and it stays out of the pickup', () => {
  const events = detectLapEvents({ ...corner(), brakes: shape(0, [0.25, 0.31, 0.5]) });
  assert.equal(events.brakeRelease, null);
  assert.equal(events.throttlePickup, null);
});

test('phases are in order, inside the area and never overlap', () => {
  const phases = cornerPhases(detectLapEvents(corner()), 0.3);
  assert.deepEqual(phases.map(({ id }) => id), ['braking', 'turnIn', 'apex', 'exit']);
  phases.forEach(({ start, end }, i) => {
    assert.ok(end > start);
    if (i > 0) assert.equal(start, phases[i - 1].end);
  });
  assert.ok(phases[phases.length - 1].end <= 0.3);
});

test('steering that starts before the brake leaves out the braking phase rather than going backwards', () => {
  const phases = cornerPhases(detectLapEvents({ ...corner(), steerings: pcts.map(() => 0.4) }), 0.3);
  assert.deepEqual(phases.map(({ id }) => id), ['turnIn', 'apex', 'exit']);
});

test('no phases when the apex comes before the brakepoint', () => {
  const events = { ...detectLapEvents(corner()), mainBrakeStart: 0.28 };
  assert.deepEqual(cornerPhases(events, 0.3), []);
});

test('a full throttle before the apex ends the exit at the end of the area instead', () => {
  const events = { ...detectLapEvents(corner()), fullThrottle: 0.21 };
  const phases = cornerPhases(events, 0.3);
  close(phases[phases.length - 1].end, 0.3);
});

test('resample interpolates, holds the ends and keeps gaps', () => {
  assert.deepEqual(resample([0, 1, 2], [0, 10, 30], [-1, 0, 0.5, 1.5, 2, 3]), [0, 0, 5, 20, 30, 30]);
  const gapped = resample([0, 1, 2, 3], [1, NaN, 3, 4], [0.5, 1.5, 2.5]);
  assert.ok(Number.isNaN(gapped[0]) && Number.isNaN(gapped[1]));
  close(gapped[2], 3.5);
});

test('evenGrid has both ends', () => {
  const grid = evenGrid([0.2, 0.4], 5);
  assert.equal(grid.length, 5);
  close(grid[0], 0.2);
  close(grid[2], 0.3);
  close(grid[4], 0.4);
});

test('roundTicks always gives a chart an axis, even for a value that never changes', () => {
  for (const [lo, hi, smallest] of [[194, 194, 1], [0, 0, 0.01], [-3.5, -3.5, 2], [26.1, 26.1, 0.4], [0, 100, 1]]) {
    const ticks = roundTicks(lo, hi, smallest);
    assert.ok(ticks.length >= 2, `${lo}..${hi} has ${ticks.length} ticks`);
    assert.ok(ticks[0] <= lo && ticks[ticks.length - 1] >= hi, `${ticks} covers ${lo}..${hi}`);
    assert.ok(ticks[ticks.length - 1] > ticks[0]);
    assert.ok(ticks.every(Number.isFinite));
  }
  assert.ok(roundTicks(0, 0, 0.01).includes(0), 'the Time chart keeps its zero line for identical laps');
});

test('resampleNearest never makes up a value between two samples, as a gear can’t be 2.5', () => {
  assert.deepEqual(resampleNearest([0, 1, 2], [2, 3, 4], [0, 0.4, 0.6, 1.4, 1.6, 2]), [2, 2, 3, 3, 4, 4]);
});

test('stats, deltas and largest skip what a lap file doesn’t have', () => {
  assert.deepEqual(stats([1, NaN, 3]), { min: 1, max: 3, avg: 2 });
  assert.equal(stats([NaN, NaN]), null);
  assert.equal(stats(null), null);
  assert.deepEqual(stats([1, 2, 3, 100], 0, 2), { min: 1, max: 3, avg: 2 });
  assert.equal(deltas(null, [1]), null);
  const delta = deltas([1, 2, 3], [2, NaN, 0]);
  assert.equal(delta[0], 1);
  assert.ok(Number.isNaN(delta[1]));
  assert.deepEqual(largest(delta), { value: -3, index: 2 });
  assert.equal(largest([NaN]), null);
  assert.equal(meanAbs([-1, 3]), 2);
});

test('shifts: neutral between gears isn’t a shift, and the RPM is from just before it', () => {
  const pcts = [0, 1, 2, 3, 4, 5, 6];
  const gears = [3, 3, 0, 4, 4, NaN, 3];
  const rpms = [7000, 8000, 5000, 6000, 6500, 0, 7500];
  const shifts = shiftEvents(pcts, gears, rpms);
  assert.equal(shifts.length, 2);
  assert.deepEqual([shifts[0].type, shifts[0].from, shifts[0].to, shifts[0].pct, shifts[0].rpm], ['up', 3, 4, 3, 8000]);
  assert.deepEqual([shifts[1].type, shifts[1].from, shifts[1].to, shifts[1].pct, shifts[1].rpm], ['down', 4, 3, 6, 6500]);
});

test('shifts are only compared with the same gears, nearest, and within the window', () => {
  const shift = (id, from, to, pct) => ({ id, type: to > from ? 'up' : 'down', from, to, pct, rpm: 8000 });
  const pairs = pairShifts(
    [shift('a', 4, 3, 0.1), shift('b', 3, 2, 0.12), shift('c', 2, 3, 0.2)],
    [shift('x', 4, 3, 0.11), shift('y', 4, 3, 0.13), shift('z', 2, 3, 0.9)],
    0.05
  );
  const find = (id) => pairs.find((p) => p.target?.id === id);
  assert.equal(find('a').compare.id, 'x');
  assert.equal(find('b').compare, null, 'no 3 to 2 on the Compare lap');
  assert.equal(find('c').compare, null, 'the same shift too far away is another shift');
  assert.ok(pairs.some((p) => p.target === null && p.compare.id === 'y'));
  assert.ok(pairs.some((p) => p.target === null && p.compare.id === 'z'));
  pairs.reduce((last, p) => {
    const at = p.target?.pct ?? p.compare.pct;
    assert.ok(at >= last, 'in track order');
    return at;
  }, 0);
});

test('steering reversals: where it turns back by more than the swing, with how far', () => {
  const pcts = Array.from({ length: 9 }, (_, i) => i);
  assert.deepEqual(steeringReversals(pcts, [0, 30, 60, 40, 50, 60, 30]), [
    { pct: 2, amplitude: 20 },
    { pct: 3, amplitude: 20 },
    { pct: 5, amplitude: 30 },
  ]);
  // The whole swing back counts, not just the first sample past the threshold, or nothing would be a large reversal
  assert.deepEqual(steeringReversals(pcts, [0, 30, 60, 40, 45, 10, -20, -18, -40]), [{ pct: 2, amplitude: 100 }]);
  assert.deepEqual(steeringReversals(pcts, [0, 2, 4, 3, 5, 6, 7, 6, 8]), [], 'small wiggles aren’t reversals');
  assert.deepEqual(steeringReversals(pcts, null), []);
});

test('stretchesWhere finds each stretch, including one running to the end', () => {
  const holds = [true, true, false, false, true, false, true, true];
  assert.deepEqual(stretchesWhere(holds.map((_, i) => i), (i) => holds[i]), [
    { from: 0, to: 1 },
    { from: 4, to: 4 },
    { from: 6, to: 7 },
  ]);
});

test('a lap’s fuel: what it used and what’s left, but not a refuel or no readings', () => {
  assert.deepEqual(lapFuel([50, NaN, 48, 47.5]), { used: 2.5, left: 47.5 });
  assert.deepEqual(lapFuel([40, 90]), { used: null, left: 90 });
  assert.deepEqual(lapFuel([NaN, NaN]), { used: null, left: null });
});

test('positionAtTime is the inverse of the lap’s times and stays on the lap', () => {
  const trace = { pcts: [0.1, 0.2, 0.4], times: [10, 11, 12] };
  close(positionAtTime(trace, 10.5), 0.15);
  close(positionAtTime(trace, 11.5), 0.3);
  assert.equal(positionAtTime(trace, 5), 0.1);
  assert.equal(positionAtTime(trace, 50), 0.4);
});
