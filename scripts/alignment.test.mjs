// The Setups page's Wheel Alignment Engineering Comparison: npm run test:alignment (docs/setups.md)
//
// alignmentGeometry.ts against the real CarSetup capture (the BMW M4 GT3 EVO's fixed.sto as iRacing showed it) and a
// changed copy of it, through the same parser and comparison the Compare tab uses: which values are found, the deltas,
// the sign conventions of the drawings (camber lean, toe direction, left and right, front and rear views), the axle
// total, the display modes, the exaggeration, missing and unreadable values, and the Setup Engineer's facts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCarSetupYaml } from '../src/lib/setupYaml.ts';
import { compareSetups } from '../src/lib/setupCompare.ts';
import {
  ALIGNMENT_ENGINEER_RULE,
  alignmentEngineerFacts,
  asymmetries,
  camberLayers,
  camberRotation,
  changeDirection,
  compareAlignment,
  findItem,
  formatAlignment,
  MAX_DRAWN_ANGLE,
  SCHEMATIC_DEG_PER_MM,
  toeDrawing,
  toeLayers,
  topicOf,
  viewCorners,
} from '../src/lib/alignmentGeometry.ts';

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

// The fixture with lines replaced, e.g. a box's key given a new value: edit('LeftFront', 'Camber', '-3.5 deg')
function edited(edits) {
  const lines = fixture.split(/\r?\n/);
  let group = null;
  const out = [];
  for (const line of lines) {
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
const alignmentOf = (a, b) => compareAlignment(compareSetups(setup(a), setup(b)).rows);

const baseline = fixture;
const comparison = edited([
  { group: 'LeftFront', key: 'Camber', value: '-3.5 deg' },
  { group: 'RightFront', key: 'Camber', value: '-3.5 deg' },
  { group: 'RightRear', key: 'ToeIn', value: '+2.0 mm' },
  { group: 'FrontBrakes', key: 'TotalToeIn', value: '-2.0 mm' },
]);
const changed = alignmentOf(baseline, comparison);

describe('finding the alignment values', () => {
  test('reads every camber, the rear toe and the front total toe by path', () => {
    const ids = changed.items.map((i) => i.id);
    assert.deepEqual(ids, ['front.totalToe', 'LF.camber', 'RF.camber', 'LR.camber', 'LR.toe', 'RR.camber', 'RR.toe']);
    assert.equal(findItem(changed, 'LF', 'camber').path, 'Chassis.LeftFront.Camber');
    assert.equal(findItem(changed, 'front', 'totalToe').path, 'Chassis.FrontBrakes.TotalToeIn');
    assert.equal(changed.frontToe, 'total');
    assert.equal(changed.rearToe, 'perWheel');
    assert.equal(changed.unsupported.length, 0);
  });

  test('keeps the values, units and decimals iRacing wrote', () => {
    const lf = findItem(changed, 'LF', 'camber');
    assert.deepEqual(lf.baseline, { raw: '-4.0 deg', value: -4, unit: 'deg', decimals: 1 });
    assert.deepEqual(lf.comparison, { raw: '-3.5 deg', value: -3.5, unit: 'deg', decimals: 1 });
    assert.deepEqual(lf.delta, { value: 0.5, unit: 'deg', decimals: 1 });
    assert.equal(formatAlignment(lf.baseline), '−4.0°');
    assert.equal(formatAlignment(lf.delta, true), '+0.5°');
    const rr = findItem(changed, 'RR', 'toe');
    assert.equal(formatAlignment(rr.baseline, true), '+1.5 mm');
    assert.equal(formatAlignment(rr.delta, true), '+0.5 mm');
    assert.equal(findItem(changed, 'front', 'totalToe').toeSign, 'in');
  });

  test('counts only what changed', () => {
    assert.equal(changed.changedCount, 4);
    assert.equal(findItem(changed, 'LR', 'camber').status, 'same');
    assert.equal(findItem(changed, 'LR', 'toe').status, 'same');
  });

  test('ignores readings and non-alignment settings', () => {
    assert.ok(!changed.items.some((i) => /SpringRate|RideHeight|CornerWeight/.test(i.path)));
  });
});

describe('camber', () => {
  test('negative camber leans the top inward in the front view (car’s left on the screen’s right)', () => {
    assert.deepEqual(viewCorners('front'), ['RF', 'LF']);
    // RF is on the screen's left: its top leans right (toward the centerline), clockwise, positive
    assert.ok(camberRotation(-4, 'RF', 'front', 1).angle > 0);
    // LF is on the screen's right: its top leans left, counterclockwise, negative
    assert.ok(camberRotation(-4, 'LF', 'front', 1).angle < 0);
  });

  test('negative camber leans the top inward in the rear view (car’s left on the left)', () => {
    assert.deepEqual(viewCorners('rear'), ['LR', 'RR']);
    assert.ok(camberRotation(-3, 'LR', 'rear', 1).angle > 0);
    assert.ok(camberRotation(-3, 'RR', 'rear', 1).angle < 0);
  });

  test('positive camber leans the top outward', () => {
    assert.ok(camberRotation(2, 'RF', 'front', 1).angle < 0);
    assert.ok(camberRotation(2, 'LF', 'front', 1).angle > 0);
    assert.ok(camberRotation(2, 'LR', 'rear', 1).angle < 0);
    assert.ok(camberRotation(2, 'RR', 'rear', 1).angle > 0);
  });

  test('the baseline’s -4.0° leans in further than the comparison’s -3.5°', () => {
    const [b, c] = camberLayers(changed, 'LF', 'front', 'overlay', 1);
    assert.equal(Math.abs(b.angle), 4);
    assert.equal(Math.abs(c.angle), 3.5);
    assert.ok(Math.abs(b.angle) > Math.abs(c.angle));
  });

  test('describes the change without judging it', () => {
    assert.equal(changeDirection(findItem(changed, 'LF', 'camber')), 'lessNegativeCamber');
    const more = alignmentOf(comparison, baseline);
    assert.equal(changeDirection(findItem(more, 'LF', 'camber')), 'moreNegativeCamber');
    assert.equal(changeDirection(findItem(changed, 'LR', 'camber')), 'unchanged');
    assert.equal(topicOf(findItem(changed, 'LF', 'camber')), 'camberFront');
    assert.equal(topicOf(findItem(changed, 'RR', 'toe')), 'toeRear');
  });

  test('crossing zero is toward positive or negative', () => {
    const plus = alignmentOf(baseline, edited([{ group: 'LeftFront', key: 'Camber', value: '+0.5 deg' }]));
    assert.equal(changeDirection(findItem(plus, 'LF', 'camber')), 'towardPositiveCamber');
  });
});

describe('toe', () => {
  test('toe-in turns the front of a left wheel clockwise and of a right wheel counterclockwise', () => {
    const lr = toeDrawing(changed, 'LR', 'baseline', 1);
    const rr = toeDrawing(changed, 'RR', 'baseline', 1);
    assert.ok(lr.angle > 0);
    assert.ok(rr.angle < 0);
    assert.equal(lr.toeIn, 1.5);
  });

  test('toe-out turns them the other way', () => {
    const out = alignmentOf(baseline, edited([{ group: 'LeftRear', key: 'ToeIn', value: '-1.0 mm' }]));
    assert.ok(toeDrawing(out, 'LR', 'comparison', 1).angle < 0);
    assert.equal(changeDirection(findItem(out, 'LR', 'toe')), 'moreToeOut');
    assert.equal(changeDirection(findItem(changed, 'RR', 'toe')), 'moreToeIn');
  });

  test('a ToeOut key is positive toe-out', () => {
    const yaml = edited([{ group: 'LeftRear', key: 'ToeIn', value: null }]);
    const withOut = yaml.replace(/(  LeftRear:\n(?:   .*\n)*?   Camber: -3.3 deg)/, '$1\n   ToeOut: +1.0 mm');
    const result = alignmentOf(withOut, withOut);
    const lr = findItem(result, 'LR', 'toe');
    assert.equal(lr.toeSign, 'out');
    assert.ok(toeDrawing(result, 'LR', 'baseline', 1).angle < 0, 'positive toe-out turns the left wheel’s front outward');
  });

  test('toe in mm is drawn schematically, never converted to an angle', () => {
    const lr = toeDrawing(changed, 'LR', 'baseline', 1);
    assert.equal(lr.schematic, true);
    assert.equal(lr.angle, 1.5 * SCHEMATIC_DEG_PER_MM);
    assert.equal(lr.unit, 'mm');
  });

  test('toe in degrees is drawn at its real angle', () => {
    const deg = edited([{ group: 'LeftRear', key: 'ToeIn', value: '+0.10 deg' }]);
    const result = alignmentOf(deg, deg);
    const lr = toeDrawing(result, 'LR', 'baseline', 1);
    assert.equal(lr.schematic, false);
    assert.equal(lr.angle, 0.1);
  });

  test('front total toe is never one wheel’s value: split evenly as a labelled illustration', () => {
    const lf = toeDrawing(changed, 'LF', 'baseline', 1);
    const rf = toeDrawing(changed, 'RF', 'baseline', 1);
    assert.equal(lf.fromAxleTotal, true);
    assert.equal(lf.toeIn, -1.5); // half of -3.0 mm, toe-out
    assert.ok(lf.angle < 0 && rf.angle > 0, 'toe-out turns the fronts outward');
    assert.equal(Math.abs(lf.angle), Math.abs(rf.angle));
    // The wheels carry no value of their own: the axle total is shown with the axle
    const [b] = toeLayers(changed, 'LF', 'overlay', 1);
    assert.equal(b.label, null);
    assert.equal(b.fromAxleTotal, true);
  });
});

describe('display modes and exaggeration', () => {
  test('overlay shows both setups, the others one', () => {
    const visible = (mode) => camberLayers(changed, 'LF', 'front', mode, 5).map((l) => l.visible);
    assert.deepEqual(visible('overlay'), [true, true]);
    assert.deepEqual(visible('baseline'), [true, false]);
    assert.deepEqual(visible('comparison'), [false, true]);
  });

  test('exaggeration changes the drawing, never the values', () => {
    const at1 = camberLayers(changed, 'LF', 'front', 'overlay', 1);
    const at5 = camberLayers(changed, 'LF', 'front', 'overlay', 5);
    assert.equal(at5[1].angle, at1[1].angle * 5);
    assert.equal(at1[0].label, at5[0].label);
    assert.equal(findItem(changed, 'LF', 'camber').baseline.value, -4);
    assert.equal(findItem(changed, 'LF', 'camber').delta.value, 0.5);
  });

  test('no wheel is drawn past the drawing’s limit', () => {
    const drawn = camberRotation(-4, 'LF', 'front', 10);
    assert.equal(drawn.angle, -MAX_DRAWN_ANGLE);
    assert.equal(drawn.clamped, true);
  });
});

describe('identical, missing and unreadable values', () => {
  test('identical setups have no changes and every wheel drawn unchanged', () => {
    const same = alignmentOf(baseline, baseline);
    assert.equal(same.changedCount, 0);
    assert.ok(same.items.every((i) => i.status === 'same' && i.delta.value === 0));
    assert.ok(camberLayers(same, 'RR', 'rear', 'overlay', 5).every((l) => l.unchanged));
  });

  test('a value only one setup has is drawn for that one only, with no delta', () => {
    const without = edited([{ group: 'LeftFront', key: 'Camber', value: null }]);
    const result = alignmentOf(baseline, without);
    const lf = findItem(result, 'LF', 'camber');
    assert.equal(lf.status, 'onlyBaseline');
    assert.equal(lf.delta, null);
    const [b, c] = camberLayers(result, 'LF', 'front', 'overlay', 5);
    assert.notEqual(b.angle, null);
    assert.equal(c.angle, null);
    assert.equal(changeDirection(lf), 'onlyBaseline');
  });

  test('a corner with no values has none, and nothing is invented', () => {
    const without = edited([
      { group: 'RightRear', key: 'Camber', value: null },
      { group: 'RightRear', key: 'ToeIn', value: null },
    ]);
    const result = alignmentOf(without, without);
    assert.equal(result.items.filter((i) => i.scope === 'RR').length, 0);
    assert.equal(toeDrawing(result, 'RR', 'baseline', 5), null);
    assert.ok(camberLayers(result, 'RR', 'rear', 'overlay', 5).every((l) => l.angle === null));
  });

  test('a camber in an unexpected unit is listed as unsupported, never drawn', () => {
    const odd = edited([{ group: 'LeftFront', key: 'Camber', value: '-4.0 mm' }]);
    const result = alignmentOf(odd, odd);
    assert.equal(findItem(result, 'LF', 'camber'), null);
    assert.equal(result.unsupported.length, 1);
    assert.equal(result.unsupported[0].path, 'Chassis.LeftFront.Camber');
    assert.equal(result.unsupported[0].baselineRaw, '-4.0 mm');
  });

  test('a fraction or text toe is unsupported too', () => {
    const odd = edited([{ group: 'LeftRear', key: 'ToeIn', value: '1/16 in' }]);
    const result = alignmentOf(odd, odd);
    assert.equal(findItem(result, 'LR', 'toe'), null);
    assert.ok(result.unsupported.some((i) => i.path === 'Chassis.LeftRear.ToeIn'));
  });

  test('different units on the two sides give no delta', () => {
    const deg = edited([{ group: 'LeftRear', key: 'ToeIn', value: '+0.10 deg' }]);
    const lr = findItem(alignmentOf(baseline, deg), 'LR', 'toe');
    assert.equal(lr.status, 'unitsDiffer');
    assert.equal(lr.delta, null);
  });

  test('another car’s setup gives nothing to compare', () => {
    const rows = compareSetups(setup(baseline), { car: 'Porsche 911 GT3 R', carKey: 'porsche992rgt3', parameters: parseCarSetupYaml(comparison).parameters }).rows;
    assert.equal(compareAlignment(rows).items.length, 0);
  });
});

describe('switching setups', () => {
  test('each pair is worked out from its own rows', () => {
    const first = alignmentOf(baseline, comparison);
    const second = alignmentOf(comparison, baseline);
    assert.equal(findItem(first, 'LF', 'camber').delta.value, 0.5);
    assert.equal(findItem(second, 'LF', 'camber').delta.value, -0.5);
    assert.equal(findItem(first, 'LF', 'camber').delta.value, 0.5, 'unchanged by the second');
  });
});

describe('asymmetry', () => {
  test('finds a left/right difference that appears in the comparison', () => {
    const asym = asymmetries(changed);
    const rearToe = asym.find((a) => a.axle === 'rear' && a.param === 'toe');
    assert.deepEqual({ baseline: rearToe.baseline, comparison: rearToe.comparison }, { baseline: 0, comparison: -0.5 });
    assert.ok(!asym.some((a) => a.param === 'camber'), 'both cambers moved together');
  });
});

describe('the Setup Engineer’s facts', () => {
  const facts = alignmentEngineerFacts(changed, { baseline: 'fixed (rev 1)', comparison: 'fixed (rev 2)', car: 'BMW M4 GT3 EVO' }).join('\n');

  test('lists the setups, each value as iRacing wrote it, the deltas and the units', () => {
    assert.match(facts, /baseline "fixed \(rev 1\)" -> comparison "fixed \(rev 2\)"/);
    assert.match(facts, /Left front camber \[Chassis\.LeftFront\.Camber\]: -4\.0 deg -> -3\.5 deg, delta \+0\.5°/);
    assert.match(facts, /Right rear toe \[Chassis\.RightRear\.ToeIn\]: \+1\.5 mm -> \+2\.0 mm, delta \+0\.5 mm \(positive means toe-in/);
    assert.match(facts, /Front axle total toe \[Chassis\.FrontBrakes\.TotalToeIn\]: -3\.0 mm -> -2\.0 mm.*an axle total/);
  });

  test('says what’s unchanged, missing and not convertible', () => {
    assert.match(facts, /Unchanged alignment values:\n(?:.*\n)*- Left rear camber/);
    assert.match(facts, /Not in these setups.*front toe per wheel.*caster/);
    assert.match(facts, /never convert it to degrees/);
    assert.match(facts, /Left minus right toe on the rear axle: baseline ±0\.0 mm, comparison -0\.5 mm/);
  });

  test('the rule keeps principles apart from hypotheses and never picks a better setup', () => {
    assert.match(ALIGNMENT_ENGINEER_RULE, /hypotheses/);
    assert.match(ALIGNMENT_ENGINEER_RULE, /Never call either setup better/);
    for (const topic of ['corner entry', 'turn-in response', 'mid-corner balance', 'braking stability', 'rear stability', 'contact patch', 'tire wear', 'straight-line']) {
      assert.ok(ALIGNMENT_ENGINEER_RULE.includes(topic), topic);
    }
  });
});
