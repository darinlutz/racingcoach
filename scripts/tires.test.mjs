// The Setups page's Tires tab: npm run test:tires (docs/setups.md)
//
// tiresGeometry.ts against the real CarSetup capture (the BMW M4 GT3 EVO's fixed.sto as iRacing showed it) and changed
// copies of it: which values are found, the pressure deltas, conversions and balance, iRacing's readings kept apart
// (temperatures in inner/middle/outer order from the key, the hot pressure rise, tread), unreadable values, the
// conceptual drawings and the gas law, and the Setup Engineer's facts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCarSetupYaml } from '../src/lib/setupYaml.ts';
import { compareSetups } from '../src/lib/setupCompare.ts';
import {
  bandsOnScreen,
  compareTires,
  conceptualDeflection,
  constantVolumePressure,
  findItem,
  formatPressure,
  formatValuePressure,
  gaugeRange,
  percentChange,
  pressureBalance,
  pressureRise,
  readTireValue,
  TIRES_ENGINEER_RULE,
  tempSpread,
  tireEngineerFacts,
  tireKind,
  toKpa,
  treadLeft,
  treadTemps,
} from '../src/lib/tiresGeometry.ts';

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

// The fixture with a box's key given a new value (or removed with null)
function edited(edits) {
  let group = null;
  const out = [];
  for (const line of fixture.split(/\r?\n/)) {
    const box = /^  (\w+):\s*$/.exec(line);
    if (box) group = box[1];
    const key = /^   (\w+):/.exec(line);
    const edit = key && edits.find((e) => e.group === group && e.key === key[1]);
    if (edit) {
      if (edit.value !== null) out.push(`   ${edit.key}: ${edit.value}`);
    } else out.push(line);
  }
  return out.join('\n');
}

const setup = (yaml) => ({ car: 'BMW M4 GT3 EVO', carKey: 'bmwm4gt3', parameters: parseCarSetupYaml(yaml).parameters });
const tiresOf = (a, b) => compareTires(compareSetups(setup(a), setup(b)).rows);

const comparison = edited([
  { group: 'LeftFront', key: 'StartingPressure', value: '165 kPa' },
  { group: 'RightFront', key: 'StartingPressure', value: '165 kPa' },
  { group: 'LeftFront', key: 'LastHotPressure', value: '178 kPa' },
  { group: 'LeftFront', key: 'LastTempsOMI', value: '80C, 84C, 90C' },
  { group: 'RightRear', key: 'TreadRemaining', value: '97%, 95%, 96%' },
]);
const same = tiresOf(fixture, fixture);
const changed = tiresOf(fixture, comparison);

describe('values found in the real setup', () => {
  test('the tire type and each corner’s starting pressure, as settings', () => {
    assert.equal(findItem(same, 'car', 'type').baseline.raw.trim(), 'Dry');
    for (const c of ['LF', 'RF', 'LR', 'RR']) {
      const p = findItem(same, c, 'startPressure');
      assert.equal(p.baseline.value, 159);
      assert.equal(p.baseline.unit, 'kPa');
      assert.equal(p.reading, false);
    }
    assert.equal(same.sourceUnit, 'kPa');
  });
  test('the last run’s hot pressure, temperatures and tread are readings', () => {
    for (const param of ['hotPressure', 'temps', 'tread']) assert.equal(findItem(same, 'LF', param).reading, true, param);
    assert.equal(same.changedCount, 0);
    assert.equal(same.unsupported.length, 0);
  });
});

describe('pressures', () => {
  test('165 against 159 kPa is +6 kPa and 3.77%, in any unit', () => {
    const lf = findItem(changed, 'LF', 'startPressure');
    assert.equal(lf.deltaKpa, 6);
    assert.ok(Math.abs(percentChange(lf.baseline, lf.comparison) - 3.7736) < 1e-3);
    assert.equal(formatPressure(lf.deltaKpa, 'kPa', { signed: true }), '+6.0 kPa');
    assert.equal(formatPressure(lf.deltaKpa, 'psi', { signed: true }), '+0.87 psi');
    assert.equal(formatValuePressure(lf.baseline, 'kPa'), '159 kPa');
    assert.equal(formatValuePressure(lf.baseline, 'bar'), '1.590 bar');
  });
  test('1 psi is 6.894757 kPa and 1 bar 100 kPa; the stored value never changes', () => {
    const psi = readTireValue('23.0 psi', 'startPressure');
    assert.ok(Math.abs(toKpa(psi) - 23 * 6.894757) < 1e-9);
    assert.equal(toKpa(readTireValue('1.6 bar', 'startPressure')), 160);
    assert.equal(psi.value, 23);
  });
  test('balance: front 165, rear 159, front minus rear +6, spread 6', () => {
    const b = pressureBalance(changed, 'comparison');
    assert.equal(b.front, 165);
    assert.equal(b.rear, 159);
    assert.equal(b.frontRear, 6);
    assert.equal(b.leftRight, 0);
    assert.equal(b.spread, 6);
  });
  test('a missing corner leaves the averages and extremes it needs empty', () => {
    const c = tiresOf(fixture, edited([{ group: 'LeftRear', key: 'StartingPressure', value: null }]));
    const b = pressureBalance(c, 'comparison');
    assert.equal(b.rear, null);
    assert.equal(b.spread, null);
    assert.equal(b.front, 159);
  });
  test('the gauges’ range covers every pressure with padding', () => {
    const r = gaugeRange(changed);
    assert.ok(r.min <= 159 && r.max >= 178);
  });
});

describe('the last run’s readings', () => {
  test('LastTempsOMI is outer, middle, inner: 80/84/90 is inner 90, outer 80', () => {
    const t = treadTemps(findItem(changed, 'LF', 'temps'), 'comparison');
    assert.deepEqual([t.inner, t.middle, t.outer], [90, 84, 80]);
    assert.deepEqual(tempSpread(t), { innerOuter: 10, middleEdges: -1 });
  });
  test('LastTempsIMO on the right is inner, middle, outer', () => {
    const item = findItem(same, 'RF', 'temps');
    assert.deepEqual(item.order, ['I', 'M', 'O']);
  });
  test('the bands on screen run outer to inner on a left tire, inner to outer on a right one', () => {
    const t = { inner: 90, middle: 84, outer: 80, unit: 'C', decimals: 0 };
    assert.deepEqual(bandsOnScreen(t, 'LF'), [80, 84, 90]);
    assert.deepEqual(bandsOnScreen(t, 'RR'), [90, 84, 80]);
  });
  test('the hot pressure rose 13 kPa from the starting pressure; tread left is read', () => {
    assert.equal(pressureRise(changed, 'LF', 'comparison'), 13);
    assert.equal(pressureRise(same, 'LF', 'baseline'), 0);
    assert.deepEqual(treadLeft(findItem(changed, 'RR', 'tread'), 'comparison').values, [97, 95, 96]);
  });
  test('readings that changed aren’t counted as setup changes', () => {
    assert.equal(changed.changedCount, 2);
    assert.equal(findItem(changed, 'LF', 'temps').status, 'changed');
  });
});

describe('unreadable values and illustrations', () => {
  test('a pressure in an unknown unit or as text is unsupported, never compared', () => {
    assert.equal(readTireValue('159 furlongs', 'startPressure'), 'unsupported');
    assert.equal(readTireValue('Soft', 'startPressure'), 'unsupported');
    assert.equal(readTireValue('35C, 35C', 'temps'), 'unsupported');
    assert.equal(readTireValue('100%, 100%, 100%', 'temps'), 'unsupported');
  });
  test('the tire type picks the drawing; anything unknown is schematic', () => {
    const item = findItem(same, 'car', 'type');
    assert.equal(tireKind(item, 'baseline'), 'dry');
    assert.equal(tireKind({ baseline: { raw: 'Wet' } }, 'baseline'), 'wet');
    assert.equal(tireKind({ baseline: { raw: 'Medium' } }, 'baseline'), 'unknown');
  });
  test('the conceptual bulge grows as pressure drops, capped, and is 0 without a reference', () => {
    assert.ok(conceptualDeflection(150, 160, 5) > 0);
    assert.ok(conceptualDeflection(170, 160, 5) < 0);
    assert.equal(conceptualDeflection(10, 160, 10), 12);
    assert.equal(conceptualDeflection(150, null, 5), 0);
  });
  test('the gas law on absolute values: 260 kPa at 300 K is 286 kPa at 330 K', () => {
    assert.equal(constantVolumePressure(260, 300, 330), 286);
    assert.equal(constantVolumePressure(260, 0, 330), null);
  });
});

describe('the Setup Engineer’s facts', () => {
  const facts = tireEngineerFacts(changed, { baseline: 'Fixed (rev 1)', comparison: 'Fixed (rev 2)', car: 'BMW M4 GT3 EVO' }).join('\n');
  test('starting pressures as iRacing wrote them, the deltas and the balance', () => {
    assert.match(facts, /Left front \[TiresAero\.LeftFront\.StartingPressure\]: 159 kPa -> 165 kPa, delta \+6\.0 kPa \(\+3\.8%\)/);
    assert.match(facts, /Comparison starting pressure balance: front minus rear \+6\.0 kPa/);
    assert.match(facts, /Tire type .*: Dry -> Dry \(unchanged\)/);
  });
  test('the readings apart, with the inner/middle/outer order and the rise', () => {
    assert.match(facts, /readings from the last run/);
    assert.match(facts, /Left front, comparison: last hot pressure 178 kPa \(\+13\.0 kPa from its starting pressure\); tread temperatures inner\/middle\/outer 90 \/ 84 \/ 80 °C/);
    assert.doesNotMatch(facts, /−/);
  });
  test('the rule never gives targets and keeps readings from being predictions', () => {
    assert.match(TIRES_ENGINEER_RULE, /never give a target hot/);
    assert.match(TIRES_ENGINEER_RULE, /not setup\s+values/);
    assert.match(TIRES_ENGINEER_RULE, /Never call either setup better/);
  });
});
