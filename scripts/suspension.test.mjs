// The Setups page's Suspension tab: npm run test:suspension (docs/setups.md)
//
// suspensionGeometry.ts against the real CarSetup capture (the BMW M4 GT3 EVO's fixed.sto as iRacing showed it) and
// changed copies of it, through the same parser and comparison the tab uses: which values are found and where, the
// deltas, the derived height differences, Hooke's law in the spring's own units, the bump rubber contact, the damper
// and ARB readings, missing and unreadable values, the drawings' scales, and the Setup Engineer's facts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCarSetupYaml } from '../src/lib/setupYaml.ts';
import { compareSetups } from '../src/lib/setupCompare.ts';
import {
  arbBladeAngle,
  axleMean,
  bumpEngaged,
  changeDirection,
  compareSuspension,
  damperScopes,
  findItem,
  formatSuspension,
  gapScale,
  heightAsymmetry,
  heightDifference,
  heightOffset,
  heightReference,
  MAX_HEIGHT_OFFSET,
  percentChange,
  readSuspensionValue,
  springCompression,
  SUSPENSION_ENGINEER_RULE,
  suspensionEngineerFacts,
  toneOf,
  topicOf,
  visibleKinds,
} from '../src/lib/suspensionGeometry.ts';

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

// The fixture with a box's key given a new value (or removed with null), e.g. { group: 'LeftFront', key: 'RideHeight', value: '55.0 mm' }
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
const suspensionOf = (a, b) => compareSuspension(compareSetups(setup(a), setup(b)).rows);

const comparison = edited([
  { group: 'LeftFront', key: 'RideHeight', value: '55.4 mm' },
  { group: 'RightFront', key: 'RideHeight', value: '55.4 mm' },
  { group: 'LeftFront', key: 'SpringRate', value: '253 N/mm' },
  { group: 'RightRear', key: 'BumpRubberGap', value: '40 mm' },
  { group: 'FrontDampers', key: 'LowSpeedCompressionDamping', value: '9 clicks' },
  { group: 'RearDampers', key: 'HighSpeedReboundDamping', value: '8 clicks' },
  { group: 'Rear', key: 'ArbBlades', value: '4' },
]);
const changed = suspensionOf(fixture, comparison);
const same = suspensionOf(fixture, fixture);

describe('values found in the real setup', () => {
  test('every corner’s ride height, spring rate and bump rubber gap, in iRacing’s units', () => {
    for (const corner of ['LF', 'RF', 'LR', 'RR']) {
      for (const param of ['rideHeight', 'springRate', 'bumpGap', 'cornerWeight']) assert.ok(findItem(same, corner, param), `${corner}.${param}`);
    }
    assert.equal(findItem(same, 'LF', 'rideHeight').baseline.raw.trim(), '57.4 mm');
    assert.deepEqual(
      { value: findItem(same, 'LR', 'springRate').baseline.value, unit: findItem(same, 'LR', 'springRate').baseline.unit },
      { value: 179, unit: 'N/mm' }
    );
    assert.equal(findItem(same, 'RR', 'bumpGap').baseline.value, 50);
  });
  test('corner weights are readings, the rest settings', () => {
    assert.equal(findItem(same, 'LF', 'cornerWeight').reading, true);
    assert.equal(findItem(same, 'LF', 'rideHeight').reading, false);
  });
  test('dampers per axle, low and high speed, compression and rebound, in clicks', () => {
    assert.equal(same.dampers, 'axle');
    assert.deepEqual(damperScopes(same), ['front', 'rear']);
    for (const axle of ['front', 'rear']) for (const p of ['lsComp', 'hsComp', 'lsRbd', 'hsRbd']) assert.equal(findItem(same, axle, p)?.baseline.unit, 'clicks', `${axle}.${p}`);
    assert.equal(findItem(same, 'front', 'hsComp').baseline.value, 12);
  });
  test('the anti-roll bars from FrontBrakes and Rear, as settings', () => {
    assert.equal(findItem(same, 'front', 'arb').baseline.value, 5);
    assert.equal(findItem(same, 'rear', 'arb').baseline.value, 3);
    assert.equal(findItem(same, 'front', 'arb').path, 'Chassis.FrontBrakes.ArbBlades');
  });
  test('camber, toe, tires and the in-car settings aren’t suspension', () => {
    assert.ok(!same.items.some((i) => /Camber|Toe|Pressure|BrakePressureBias|CrossWeight/.test(i.key)));
    assert.equal(same.unsupported.length, 0);
  });
});

describe('deltas and directions', () => {
  test('identical setups have nothing changed', () => {
    assert.equal(same.changedCount, 0);
    assert.ok(same.items.every((i) => i.status === 'same'));
  });
  test('the changed copy’s changes, comparison minus baseline', () => {
    assert.equal(changed.changedCount, 7);
    assert.deepEqual(findItem(changed, 'LF', 'rideHeight').delta, { value: -2, unit: 'mm', decimals: 1 });
    assert.equal(changeDirection(findItem(changed, 'LF', 'rideHeight')), 'lower');
    assert.equal(changeDirection(findItem(changed, 'LF', 'springRate')), 'stiffer');
    assert.equal(changeDirection(findItem(changed, 'RR', 'bumpGap')), 'gapSmaller');
    assert.equal(changeDirection(findItem(changed, 'front', 'lsComp')), 'clicksUp');
    assert.equal(changeDirection(findItem(changed, 'rear', 'hsRbd')), 'clicksDown');
    assert.equal(changeDirection(findItem(changed, 'rear', 'arb')), 'settingUp');
    assert.equal(changeDirection(findItem(changed, 'LR', 'rideHeight')), 'unchanged');
  });
  test('spring rate change as a percentage of the baseline: 223 to 253 N/mm is +13.5%', () => {
    assert.ok(Math.abs(percentChange(findItem(changed, 'LF', 'springRate')) - 13.4529) < 1e-3);
    assert.equal(percentChange(findItem(changed, 'RF', 'springRate')), 0);
  });
  test('topics: low- and high-speed damping apart, never a better setup', () => {
    assert.equal(topicOf({ param: 'lsComp' }), 'damperLow');
    assert.equal(topicOf({ param: 'hsRbd' }), 'damperHigh');
    assert.equal(topicOf({ param: 'arb' }), 'arb');
  });
  test('tones: neutral when unchanged, the setup’s color otherwise', () => {
    assert.equal(toneOf(findItem(changed, 'LR', 'rideHeight'), 'baseline'), 'align-unchanged');
    assert.equal(toneOf(findItem(changed, 'LF', 'rideHeight'), 'comparison'), 'align-comparison');
  });
});

describe('derived heights', () => {
  test('axle means and rear minus front: 83.3 - 57.4 = +25.9 mm, then +27.9 mm', () => {
    assert.equal(axleMean(same, 'front', 'baseline').value, 57.4);
    assert.ok(Math.abs(heightDifference(changed, 'baseline').value - 25.9) < 1e-9);
    assert.ok(Math.abs(heightDifference(changed, 'comparison').value - 27.9) < 1e-9);
  });
  test('right minus left, found when it appears', () => {
    const lopsided = suspensionOf(fixture, edited([{ group: 'RightRear', key: 'RideHeight', value: '84.3 mm' }]));
    assert.equal(heightAsymmetry(lopsided, 'rear', 'baseline').value, 0);
    assert.ok(Math.abs(heightAsymmetry(lopsided, 'rear', 'comparison').value - 1) < 1e-9);
  });
  test('no height difference without all four in one unit', () => {
    const inches = suspensionOf(fixture, edited([{ group: 'LeftRear', key: 'RideHeight', value: '3.28 in' }]));
    assert.equal(heightDifference(inches, 'comparison'), null);
    assert.equal(findItem(inches, 'LR', 'rideHeight').status, 'unitsDiffer');
    assert.equal(findItem(inches, 'LR', 'rideHeight').delta, null);
  });
});

describe('demonstrations, in the values’ own units', () => {
  test('Hooke’s law: 1000 N on 223 N/mm is 4.484 mm of spring compression', () => {
    const c = springCompression(1000, findItem(same, 'LF', 'springRate').baseline);
    assert.equal(c.unit, 'mm');
    assert.ok(Math.abs(c.value - 1000 / 223) < 1e-12);
  });
  test('lb/in springs take lbf and give inches; anything else gives nothing', () => {
    assert.deepEqual(springCompression(250, readSuspensionValue('1250 lbs/in', 'springRate')), { value: 0.2, unit: 'in' });
    assert.equal(springCompression(1000, null), null);
    assert.equal(springCompression(1000, { raw: '0 N/mm', value: 0, unit: 'N/mm', decimals: 0 }), null);
  });
  test('bump rubber: a 15 mm gap touches at 15 mm, not at 14.5, and only in its own unit', () => {
    const gap = findItem(same, 'LF', 'bumpGap').baseline;
    assert.equal(bumpEngaged(15, 'mm', gap), true);
    assert.equal(bumpEngaged(14.5, 'mm', gap), false);
    assert.equal(bumpEngaged(1, 'in', gap), null);
    assert.equal(bumpEngaged(1, 'mm', null), null);
  });
});

describe('drawing scales change the drawing, never the values', () => {
  test('ride heights drawn about the mean of all of them, the rear above the front, exaggerated and capped', () => {
    const reference = heightReference(same);
    const front = findItem(same, 'LF', 'rideHeight').baseline;
    const rear = findItem(same, 'LR', 'rideHeight').baseline;
    assert.ok(heightOffset(rear, reference, 1).offset > 0 && heightOffset(front, reference, 1).offset < 0);
    assert.ok(Math.abs(heightOffset(rear, reference, 2).offset - 2 * heightOffset(rear, reference, 1).offset) < 1e-9);
    assert.equal(heightOffset(rear, reference, 10).clamped, false);
    const capped = heightOffset({ ...rear, value: 120 }, reference, 10);
    assert.equal(capped.offset, MAX_HEIGHT_OFFSET);
    assert.equal(capped.clamped, true);
    assert.equal(rear.value, 83.3);
  });
  test('the bump rubber’s scale fits the larger gap at the corner to the span', () => {
    assert.equal(gapScale(changed, 'RR', 70), 70 / 50);
    assert.equal(gapScale(same, 'LF', 70), 70 / 15);
  });
  test('ARB blades turn by setting, capped; display modes show one setup or both', () => {
    assert.equal(arbBladeAngle(3), 45);
    assert.equal(arbBladeAngle(12), 90);
    assert.deepEqual(visibleKinds('overlay'), ['baseline', 'comparison']);
    assert.deepEqual(visibleKinds('comparison'), ['comparison']);
  });
});

describe('other cars’ shapes and unreadable values', () => {
  const rows = (entries) =>
    entries.map(([path, baseline, comparison, kind = 'setting']) => {
      const parts = path.split('.');
      return { path, section: parts[0], group: parts.length > 2 ? parts[parts.length - 2] : null, key: parts[parts.length - 1], kind, baseline, comparison };
    });
  test('dampers per corner, ARB blade pairs and perch offsets', () => {
    const c = compareSuspension(
      rows([
        ['Dampers.LeftFrontDamper.LsCompDamping', '-4 clicks', '-2 clicks'],
        ['Dampers.RightFrontDamper.HsRbdDamping', '10', '12'],
        ['Chassis.Front.ArbBlades', '2-2', '3-2'],
        ['Chassis.LeftFront.SpringPerchOffset', '45.0 mm', '46.5 mm'],
      ])
    );
    assert.equal(c.dampers, 'corner');
    assert.deepEqual(damperScopes(c), ['LF', 'RF']);
    assert.equal(findItem(c, 'LF', 'lsComp').delta.value, 2);
    assert.equal(findItem(c, 'RF', 'hsRbd').baseline.unit, 'clicks');
    const arb = findItem(c, 'front', 'arb');
    assert.deepEqual(arb.delta.pair, [1, 0]);
    assert.equal(changeDirection(arb), 'settingChanged');
    assert.equal(formatSuspension(arb.baseline), '2–2');
    assert.equal(findItem(c, 'LF', 'perchOffset').status, 'changed');
  });
  test('a ride height in an unknown unit or as text is listed unsupported, never drawn', () => {
    const c = compareSuspension(rows([['Chassis.LeftFront.RideHeight', '57 furlongs', '57 mm'], ['Chassis.RightFront.SpringRate', 'Soft', 'Medium']]));
    assert.equal(c.items.length, 0);
    assert.equal(c.unsupported.length, 2);
  });
  test('a plain Bump key outside any damper box isn’t a damper', () => {
    const c = compareSuspension(rows([['Chassis.Front.Bump', '3', '4']]));
    assert.equal(c.items.length, 0);
    assert.equal(c.dampers, 'none');
  });
  test('a value only one setup has gets no delta', () => {
    const c = suspensionOf(fixture, edited([{ group: 'LeftFront', key: 'BumpRubberGap', value: null }]));
    assert.equal(findItem(c, 'LF', 'bumpGap').status, 'onlyBaseline');
    assert.equal(findItem(c, 'LF', 'bumpGap').delta, null);
  });
  test('formatting keeps iRacing’s decimals and uses a real minus', () => {
    assert.equal(formatSuspension(findItem(changed, 'LF', 'rideHeight').delta, true), '−2.0 mm');
    assert.equal(formatSuspension(findItem(changed, 'LF', 'springRate').delta, true), '+30 N/mm');
    assert.equal(formatSuspension(null), '—');
  });
});

describe('the Setup Engineer’s facts', () => {
  const facts = suspensionEngineerFacts(changed, { baseline: 'Fixed (rev 1)', comparison: 'Fixed (rev 2)', car: 'BMW M4 GT3 EVO' }).join('\n');
  test('lists the setups, each value as iRacing wrote it, the deltas and the derived heights', () => {
    assert.match(facts, /baseline "Fixed \(rev 1\)" -> comparison "Fixed \(rev 2\)"/);
    assert.match(facts, /Left front spring rate \[Chassis\.LeftFront\.SpringRate\]: 223 N\/mm -> 253 N\/mm, delta \+30 N\/mm \(\+13\.5%\)/);
    assert.match(facts, /Front low-speed compression damping .*: 7 clicks -> 9 clicks, delta \+2/);
    assert.match(facts, /Baseline rear mean ride height minus front mean: \+25\.9 mm/);
    assert.doesNotMatch(facts, /−/);
  });
  test('says what isn’t known, so nothing is assumed', () => {
    assert.match(facts, /motion ratios/);
    assert.match(facts, /damping force of a click/);
    assert.match(facts, /Unchanged suspension values:/);
  });
  test('the rule keeps principles apart from hypotheses and never picks a better setup', () => {
    assert.match(SUSPENSION_ENGINEER_RULE, /Never call either setup better/);
    assert.match(SUSPENSION_ENGINEER_RULE, /never turn a spring rate into a wheel rate/);
    assert.match(SUSPENSION_ENGINEER_RULE, /never say a higher anti-roll bar setting is stiffer/);
  });
});
