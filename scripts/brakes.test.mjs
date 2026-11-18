// The Setups page's Brakes tab: npm run test:brakes (docs/setups.md)
//
// brakesGeometry.ts against the real CarSetup capture (the BMW M4 GT3 EVO's fixed.sto as iRacing showed it) and changed
// copies of it, through the same parser and comparison the tab uses: which values are found, the bias split and its
// delta in percentage points, the master cylinder hydraulics, ABS and pads, the LED kept apart, other cars' keys,
// unreadable values, and the Setup Engineer's facts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCarSetupYaml } from '../src/lib/setupYaml.ts';
import { compareSetups } from '../src/lib/setupCompare.ts';
import {
  balanceTilt,
  biasDelta,
  boreRadius,
  BRAKES_ENGINEER_RULE,
  brakeEngineerFacts,
  changeDirection,
  compareBrakes,
  distribution,
  findItem,
  formatBrake,
  ledSwatch,
  meanBore,
  pistonArea,
  pressure,
  readBrakeValue,
  relativeChange,
  travelRatio,
} from '../src/lib/brakesGeometry.ts';

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
const brakesOf = (a, b) => compareBrakes(compareSetups(setup(a), setup(b)).rows);

const comparison = edited([
  { group: 'InCarAdjustments', key: 'BrakePressureBias', value: '49.50%' },
  { group: 'FrontBrakes', key: 'FrontMasterCyl', value: '19.1 mm' },
  { group: 'FrontBrakes', key: 'BrakePads', value: 'High friction' },
  { group: 'InCarAdjustments', key: 'AbsSetting', value: '5 (ABS)' },
]);
const same = brakesOf(fixture, fixture);
const changed = brakesOf(fixture, comparison);

describe('values found in the real setup', () => {
  test('bias, both master cylinders, pads and ABS, as iRacing wrote them', () => {
    assert.equal(findItem(same, 'bias').baseline.raw.trim(), '51.00%');
    assert.equal(findItem(same, 'bias').path, 'Chassis.InCarAdjustments.BrakePressureBias');
    assert.equal(findItem(same, 'frontMaster').baseline.value, 17.8);
    assert.equal(findItem(same, 'rearMaster').baseline.unit, 'mm');
    assert.equal(formatBrake(findItem(same, 'pads').baseline), 'Medium friction');
    assert.equal(findItem(same, 'abs').baseline.value, 3);
    assert.equal(formatBrake(findItem(same, 'abs').baseline), '3');
  });
  test('nothing else is taken for a brake (traction control, tires, wing)', () => {
    assert.ok(!same.items.some((i) => /TcSetting|Pressure$|Wing/.test(i.key) && i.param !== 'bias'));
    assert.equal(same.unsupported.length, 0);
    assert.equal(same.changedCount, 0);
  });
  test('BrakePressureBias is the front share, so it splits: 51.00% front is 49.00% rear', () => {
    assert.equal(findItem(same, 'bias').frontPercentage, true);
    assert.deepEqual(distribution(same, 'baseline'), { front: 51, rear: 49, decimals: 2 });
  });
});

describe('changes', () => {
  test('bias rearward by 1.5 percentage points', () => {
    assert.equal(biasDelta(changed), -1.5);
    assert.equal(changeDirection(findItem(changed, 'bias')), 'biasRearward');
  });
  test('a larger front bore, a new pad compound, a higher ABS position; the rear unchanged', () => {
    assert.equal(changeDirection(findItem(changed, 'frontMaster')), 'boreLarger');
    assert.ok(Math.abs(findItem(changed, 'frontMaster').delta.value - 1.3) < 1e-9);
    assert.equal(changeDirection(findItem(changed, 'pads')), 'padsChanged');
    assert.equal(findItem(changed, 'pads').delta, null);
    assert.equal(changeDirection(findItem(changed, 'abs')), 'absUp');
    assert.equal(findItem(changed, 'abs').delta.value, 2);
    assert.equal(changeDirection(findItem(changed, 'rearMaster')), 'unchanged');
    assert.equal(changed.changedCount, 4);
  });
  test('a pad compound differing only in case is the same', () => {
    const c = brakesOf(fixture, edited([{ group: 'FrontBrakes', key: 'BrakePads', value: 'medium FRICTION' }]));
    assert.equal(findItem(c, 'pads').status, 'same');
  });
});

describe('hydraulics, in millimeters only', () => {
  test('piston area is π(d/2)²: 17.8 mm is 248.85 mm²', () => {
    assert.ok(Math.abs(pistonArea(findItem(same, 'frontMaster').baseline) - Math.PI * 8.9 ** 2) < 1e-9);
  });
  test('the same force makes less pressure in the larger bore', () => {
    const item = findItem(changed, 'frontMaster');
    const a = pressure(500, item.baseline);
    const b = pressure(500, item.comparison);
    assert.ok(Math.abs(a - 500 / (Math.PI * 8.9 ** 2)) < 1e-9);
    assert.ok(b < a);
    assert.ok(Math.abs(relativeChange(a, b) - ((17.8 / 19.1) ** 2 - 1) * 100) < 1e-9);
  });
  test('travel for the same volume, comparison over baseline, is the inverse area ratio', () => {
    const item = findItem(changed, 'frontMaster');
    assert.ok(Math.abs(travelRatio(item.baseline, item.comparison) - (17.8 / 19.1) ** 2) < 1e-12);
  });
  test('inches, zero and no bore give no hydraulics', () => {
    const inches = readBrakeValue('0.75 in', 'frontMaster');
    assert.equal(inches.unit, 'in');
    assert.equal(pistonArea(inches), null);
    assert.equal(pressure(500, null), null);
    assert.equal(readBrakeValue('0 mm', 'frontMaster'), 'unsupported');
  });
});

describe('conventions and other cars', () => {
  const rows = (entries) =>
    entries.map(([path, baseline, comparison, kind = 'setting']) => {
      const parts = path.split('.');
      return { path, section: parts[0], group: parts.length > 2 ? parts[parts.length - 2] : null, key: parts[parts.length - 1], kind, baseline, comparison };
    });
  test('another bias key is shown but never split', () => {
    const c = compareBrakes(rows([['Chassis.Front.BrakeBias', '56.0%', '57.0%']]));
    const bias = findItem(c, 'bias');
    assert.equal(bias.frontPercentage, false);
    assert.equal(distribution(c, 'baseline'), null);
    assert.equal(biasDelta(c), null);
    assert.equal(changeDirection(bias), 'biasChanged');
  });
  test('the LED strip is found, kept out of the change count, and given its swatch', () => {
    const c = compareBrakes(rows([['Chassis.FrontBrakes.NightLedStripColor', 'Yellow', 'Blue'], ['Chassis.InCarAdjustments.BrakePressureBias', '52.0%', '52.0%']]));
    const led = findItem(c, 'led');
    assert.equal(changeDirection(led), 'ledChanged');
    assert.equal(c.changedCount, 0);
    assert.equal(ledSwatch(led.baseline), 'yellow');
    assert.equal(ledSwatch({ raw: 'Teal', value: null, unit: 'text', decimals: 0 }), null);
  });
  test('other brake keys are kept as written', () => {
    const c = compareBrakes(rows([['Chassis.FrontBrakes.BrakeDuctOpening', '3', '4'], ['Chassis.Rear.BrakeLines', 'Steel', 'Braided']]));
    assert.equal(c.items.length, 2);
    assert.ok(c.items.every((i) => i.param === 'other' && i.status === 'changed'));
    assert.equal(changeDirection(c.items[0]), 'otherChanged');
  });
  test('a bias outside 0-100% or as text is unsupported, never drawn', () => {
    const c = compareBrakes(rows([['Chassis.InCarAdjustments.BrakePressureBias', '120%', 'Front']]));
    assert.equal(c.items.length, 0);
    assert.equal(c.unsupported.length, 1);
  });
  test('a value only one setup has gets no delta', () => {
    const c = brakesOf(fixture, edited([{ group: 'InCarAdjustments', key: 'AbsSetting', value: null }]));
    assert.equal(findItem(c, 'abs').status, 'onlyBaseline');
    assert.equal(findItem(c, 'abs').delta, null);
  });
});

describe('drawings never change values', () => {
  test('bores drawn about their mean, exaggerated, within limits', () => {
    const mean = meanBore(changed);
    const item = findItem(changed, 'frontMaster');
    assert.ok(boreRadius(item.comparison, mean, 5) > boreRadius(item.baseline, mean, 5));
    assert.ok(boreRadius(item.comparison, mean, 10) <= 44);
    assert.equal(boreRadius(null, mean, 5), 24);
    assert.equal(item.comparison.value, 19.1);
  });
  test('the balance bar tilts with the bias, capped', () => {
    assert.equal(balanceTilt(50), 0);
    assert.ok(balanceTilt(55) > 0);
    assert.equal(balanceTilt(90), 30);
    assert.equal(balanceTilt(null), 0);
  });
});

describe('the Setup Engineer’s facts', () => {
  const facts = brakeEngineerFacts(changed, { baseline: 'Fixed (rev 1)', comparison: 'Fixed (rev 2)', car: 'BMW M4 GT3 EVO' }).join('\n');
  test('lists each value as iRacing wrote it, the bias in percentage points and the split', () => {
    assert.match(facts, /brake bias \[Chassis\.InCarAdjustments\.BrakePressureBias\]: 51\.00% -> 49\.50%, delta -1\.50% \(percentage points of front bias\)/);
    assert.match(facts, /Baseline nominal line pressure split: 51\.00% front \/ 49\.00% rear/);
    assert.match(facts, /front master cylinder bore .*: 17\.8 mm -> 19\.1 mm, delta \+1\.3 mm/);
    assert.match(facts, /ABS setting .*: 3 \(ABS\) -> 5 \(ABS\)/);
  });
  test('works out the hydraulics from the bores and says what isn’t known', () => {
    assert.match(facts, /Front master cylinder piston area 248\.8 -> 286\.5 mm²/);
    assert.match(facts, /pedal ratio and balance bar geometry/);
    assert.doesNotMatch(facts, /−/);
  });
  test('the LED never reaches the advice, and the rule says so', () => {
    const led = compareBrakes([{ path: 'Chassis.FrontBrakes.NightLedStripColor', section: 'Chassis', group: 'FrontBrakes', key: 'NightLedStripColor', kind: 'setting', baseline: 'Red', comparison: 'Blue' }]);
    const text = brakeEngineerFacts(led, { baseline: 'a', comparison: 'b', car: null }).join('\n');
    assert.match(text, /lighting only, never part of brake advice/);
    assert.match(text, /No brake value differs/);
    assert.match(BRAKES_ENGINEER_RULE, /leave the LED strip color out/);
    assert.match(BRAKES_ENGINEER_RULE, /Never call either setup better/);
    assert.match(BRAKES_ENGINEER_RULE, /percentage points/);
  });
});
