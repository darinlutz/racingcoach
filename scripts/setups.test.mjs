// The Setups page's pure modules: npm run test:setups (docs/setups.md)
//
// setupYaml.ts against a real CarSetup capture (the BMW M4 GT3 EVO's "fixed.sto" as iRacing showed it, from an .ibt's
// session info), stoFile.ts against a file built here in iRacing's layout (iRacing's own .sto files aren't committed),
// and the comparison, change, inspection and fixed-session rules.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractCarSetupSection, parseCarSetupYaml, readValue, formatLike, keyLabel } from '../src/lib/setupYaml.ts';
import { readStoFile, cleanStoFileName } from '../src/lib/stoFile.ts';
import { compareSetups, formatDifference } from '../src/lib/setupCompare.ts';
import { applyChanges, checkProposals, changeSheet } from '../src/lib/setupChanges.ts';
import { fixedSetupSession, inspectionResult, preliminaryValidation } from '../src/lib/setupInspection.ts';

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');
const parsed = parseCarSetupYaml(fixture);
const byPath = new Map(parsed.parameters.map((p) => [p.path, p]));

describe('CarSetup YAML', () => {
  test('reads the update count and every value', () => {
    assert.equal(parsed.updateCount, 5);
    assert.equal(parsed.parameters.length, 68);
    assert.ok(!byPath.has('UpdateCount'));
  });

  test('keeps paths, raw text, numbers and units', () => {
    const spring = byPath.get('Chassis.LeftFront.SpringRate');
    assert.deepEqual(
      { raw: spring.raw, value: spring.value, unit: spring.unit, section: spring.section, group: spring.group, category: spring.category, kind: spring.kind },
      { raw: '223 N/mm', value: 223, unit: 'N/mm', section: 'Chassis', group: 'LeftFront', category: 'suspension', kind: 'setting' }
    );
    assert.equal(byPath.get('Chassis.InCarAdjustments.BrakePressureBias').value, 51);
    assert.equal(byPath.get('Chassis.InCarAdjustments.BrakePressureBias').unit, '%');
    assert.equal(byPath.get('Chassis.InCarAdjustments.BrakePressureBias').decimals, 2);
    assert.equal(byPath.get('Chassis.LeftRear.ToeIn').value, 1.5);
    assert.equal(byPath.get('Chassis.FrontBrakes.TotalToeIn').value, -3);
    assert.equal(byPath.get('Chassis.FrontBrakes.ArbBlades').value, 5);
    assert.equal(byPath.get('Chassis.InCarAdjustments.AbsSetting').value, 3);
    assert.equal(byPath.get('Chassis.InCarAdjustments.AbsSetting').unit, null);
    assert.equal(byPath.get('Chassis.FrontBrakes.BrakePads').value, null);
    assert.deepEqual(byPath.get('TiresAero.LeftFront.LastTempsOMI').values, [35, 35, 35]);
    assert.equal(byPath.get('TiresAero.TireType.TireType').raw, 'Dry');
  });

  test('sorts parameters into categories', () => {
    const cat = (path) => byPath.get(path).category;
    assert.equal(cat('TiresAero.LeftFront.StartingPressure'), 'tires');
    assert.equal(cat('Chassis.LeftFront.Camber'), 'alignment');
    assert.equal(cat('Chassis.LeftRear.ToeIn'), 'alignment');
    assert.equal(cat('Chassis.FrontBrakes.FrontMasterCyl'), 'brakes');
    assert.equal(cat('Chassis.InCarAdjustments.AbsSetting'), 'brakes');
    assert.equal(cat('Chassis.Rear.WingAngle'), 'aero');
    assert.equal(cat('Chassis.FrontBrakes.CenterFrontSplitterHeight'), 'aero');
    assert.equal(cat('Chassis.GearsDifferential.DiffPreload'), 'drivetrain');
    assert.equal(cat('Chassis.Rear.FuelLevel'), 'fuel');
    assert.equal(cat('Chassis.InCarAdjustments.TcSetting'), 'electronics');
    assert.equal(cat('Dampers.FrontDampers.LowSpeedCompressionDamping'), 'suspension');
    assert.equal(cat('Chassis.LeftFront.BumpRubberGap'), 'suspension');
  });

  test('tells readings from settings, and in-car adjustments', () => {
    for (const path of ['TiresAero.LeftFront.LastHotPressure', 'TiresAero.LeftFront.TreadRemaining', 'Chassis.LeftFront.CornerWeight', 'TiresAero.AeroBalanceCalc.WingSetting', 'Chassis.InCarAdjustments.FWtdist']) {
      assert.equal(byPath.get(path).kind, 'reading', path);
    }
    assert.equal(byPath.get('Chassis.InCarAdjustments.BrakePressureBias').inCar, true);
    assert.equal(byPath.get('Chassis.LeftFront.SpringRate').inCar, false);
  });

  test('takes the section out of the whole session info', () => {
    const whole = `WeekendInfo:\n TrackName: twinring fullrc\nDriverInfo:\n DriverSetupName: fixed.sto\n${fixture}`;
    const section = extractCarSetupSection(whole.replace(/\n/g, '\r\n'));
    assert.ok(section.startsWith('CarSetup:\n UpdateCount: 5'));
    assert.ok(!section.includes('...'));
    assert.equal(parseCarSetupYaml(section).parameters.length, 68);
    assert.equal(extractCarSetupSection('WeekendInfo:\n TrackName: x\n'), null);
    assert.equal(extractCarSetupSection('CarSetup:\nDriverInfo:\n x: 1\n'), null);
  });

  test('a car with other keys parses the same way, and junk lines are ignored', () => {
    const other = parseCarSetupYaml('CarSetup:\n UpdateCount: 2\n Chassis:\n  Front:\n   HeaveSpring: 120 N/mm\n   ThirdPerchOffset: 33.0 mm\n  - list item\n Garbage line\n');
    assert.deepEqual(other.parameters.map((p) => p.path), ['Chassis.Front.HeaveSpring', 'Chassis.Front.ThirdPerchOffset']);
  });

  test('values and labels', () => {
    assert.deepEqual(readValue('51.00%'), { value: 51, unit: '%', values: [51], decimals: 2 });
    assert.deepEqual(readValue('-4.0 deg'), { value: -4, unit: 'deg', values: [-4], decimals: 1 });
    assert.equal(readValue('Medium friction').value, null);
    assert.equal(readValue('10 mm, 12 in').values.length, 0);
    assert.equal(formatLike(byPath.get('Chassis.InCarAdjustments.BrakePressureBias'), 52.5), '52.50%');
    assert.equal(formatLike(byPath.get('Chassis.LeftFront.SpringRate'), 230), '230 N/mm');
    assert.equal(formatLike(byPath.get('Chassis.LeftRear.ToeIn'), 1.2), '+1.2 mm');
    assert.equal(formatLike(byPath.get('Chassis.InCarAdjustments.AbsSetting'), 4), '4 (ABS)');
    assert.equal(keyLabel('LowSpeedCompressionDamping'), 'Low Speed Compression Damping');
    assert.equal(keyLabel('FWtdist'), 'FWtdist');
  });
});

// A file in iRacing's layout, built from parts (the payload random, as iRacing's is encrypted)
function makeSto({ version = 3, payload = 64, notes = 'Line one\r\nLine two', ids = 2, lengthField } = {}) {
  const text = Buffer.from(notes + '\u0000', 'utf16le');
  const body = Buffer.alloc(payload, 0xab);
  const signature = Buffer.alloc(32, 0xcd);
  const trailer = Buffer.concat([
    ...Array.from({ length: ids }, (_, i) => Buffer.concat([Buffer.from([1, 0, 0, 0, 16, 0, 0, 0]), Buffer.alloc(16, i + 1)])),
    Buffer.alloc(8),
  ]);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(version, 0);
  header.writeUInt32LE(lengthField ?? 8 + payload + 32 + text.length, 4);
  header.writeUInt32LE(payload, 8);
  header.writeUInt32LE(text.length, 12);
  return new Uint8Array(Buffer.concat([header, body, signature, text, trailer]));
}

describe('.sto files', () => {
  test('reads the container, notes and identifiers, never values', () => {
    const info = readStoFile(makeSto());
    assert.equal(info.status, 'partial');
    assert.equal(info.containerVersion, 3);
    assert.equal(info.payloadBytes, 64);
    assert.equal(info.notes, 'Line one\nLine two');
    assert.deepEqual(info.identifiers, ['01'.repeat(16), '02'.repeat(16)]);
    assert.equal(info.signatureHex, 'cd'.repeat(32));
    assert.ok(!('parameters' in info));
  });

  test('an unknown version is unsupported, nonsense failed', () => {
    assert.equal(readStoFile(makeSto({ version: 4 })).status, 'unsupported');
    assert.equal(readStoFile(makeSto({ lengthField: 5 })).status, 'failed');
    assert.equal(readStoFile(new Uint8Array(10)).status, 'failed');
    assert.equal(readStoFile(new Uint8Array(Buffer.from('hello world, this is not a setup file at all!!!!'))).status, 'unsupported');
  });

  test('a trailer that does not fit is left out', () => {
    const bytes = makeSto({ ids: 1 });
    bytes[bytes.length - 8 - 24] = 7; // the record's kind
    const info = readStoFile(bytes);
    assert.equal(info.status, 'partial');
    assert.deepEqual(info.identifiers, []);
    assert.ok(info.problem);
  });

  test('file names', () => {
    assert.equal(cleanStoFileName('C:\\Users\\me\\fixed.sto'), 'fixed.sto');
    assert.equal(cleanStoFileName('fixed.txt'), null);
    assert.equal(cleanStoFileName('a<b.sto'), null);
  });
});

const setupOf = (parameters, car = 'BMW M4 GT3 EVO', carKey = 'bmwm4gt3') => ({ car, carKey, parameters });

describe('comparison', () => {
  const changed = applyChanges(parsed.parameters, [
    { path: 'Chassis.InCarAdjustments.BrakePressureBias', value: 52.5 },
    { path: 'Chassis.LeftFront.SpringRate', value: 230 },
  ]);

  test('finds the differences, in the values’ units and percentage points', () => {
    const result = compareSetups(setupOf(parsed.parameters), setupOf(changed.parameters));
    assert.equal(result.compatible, true);
    assert.equal(result.counts.changed, 2);
    assert.equal(result.counts.same, 66);
    const bias = result.rows.find((r) => r.path === 'Chassis.InCarAdjustments.BrakePressureBias');
    assert.deepEqual([bias.difference, bias.differenceUnit], [1.5, 'pp']);
    const spring = result.rows.find((r) => r.path === 'Chassis.LeftFront.SpringRate');
    assert.deepEqual([spring.difference, spring.differenceUnit, spring.status], [7, 'N/mm', 'changed']);
    assert.equal(formatDifference(-1.5, 'pp'), '−1.5 pp');
  });

  test('another car is not compared at all', () => {
    const result = compareSetups(setupOf(parsed.parameters), setupOf(parsed.parameters, 'Porsche 911 GT3 R', 'porsche992rgt3'));
    assert.equal(result.compatible, false);
    assert.equal(result.rows.length, 0);
  });

  test('parameters only one setup has, and different units, are said so', () => {
    const a = [...parsed.parameters.slice(0, 3)];
    const b = [{ ...a[0], raw: '23 psi', value: 23, unit: 'psi' }, a[1]];
    const result = compareSetups(setupOf(a), setupOf(b));
    assert.equal(result.rows.find((r) => r.path === a[0].path).status, 'notComparable');
    assert.equal(result.rows.find((r) => r.path === a[2].path).status, 'onlyBaseline');
  });
});

describe('changes and proposals', () => {
  test('a proposal must name a real setting with a number', () => {
    const { kept, rejected } = checkProposals(
      [
        { path: 'Chassis.FrontBrakes.ArbBlades', proposedValue: 3, reason: 'r', expectedEffect: 'e', confidence: 'Medium' },
        { path: 'Chassis.FrontBrakes.ArbBlades', proposedValue: 4, reason: 'r', expectedEffect: 'e', confidence: 'medium' },
        { path: 'Chassis.Front.ArbSetting', proposedValue: 4, reason: 'r', expectedEffect: 'e', confidence: 'high' },
        { path: 'Chassis.LeftFront.CornerWeight', proposedValue: 3200, reason: 'r', expectedEffect: 'e', confidence: 'high' },
        { path: 'Chassis.FrontBrakes.BrakePads', proposedValue: 2, reason: 'r', expectedEffect: 'e', confidence: 'high' },
        { path: 'Chassis.Rear.WingAngle', proposedValue: 6, reason: 'r', expectedEffect: 'e', confidence: 'high' },
      ],
      parsed.parameters,
      { fixedSession: false }
    );
    assert.equal(kept.length, 1);
    assert.deepEqual([kept[0].current, kept[0].proposed, kept[0].confidence], ['5', '3', 'medium']);
    assert.ok(kept[0].warnings.includes('rangeUnknown') && kept[0].warnings.includes('largeStep'));
    assert.deepEqual(rejected.map((r) => r.why), ['duplicate', 'unknownParameter', 'reading', 'notNumeric', 'noChange']);
  });

  test('a fixed setup session keeps in-car adjustments only', () => {
    const { kept, rejected } = checkProposals(
      [
        { path: 'Chassis.FrontBrakes.ArbBlades', proposedValue: 4, reason: 'r', expectedEffect: 'e', confidence: 'low' },
        { path: 'Chassis.InCarAdjustments.BrakePressureBias', proposedValue: 50.123, reason: 'r', expectedEffect: 'e', confidence: 'low' },
      ],
      parsed.parameters,
      { fixedSession: true }
    );
    assert.deepEqual(kept.map((k) => [k.path, k.proposed]), [['Chassis.InCarAdjustments.BrakePressureBias', '50.12%']]);
    assert.equal(rejected[0].why, 'fixedSession');
  });

  test('applying keeps the original and refuses what it can’t change', () => {
    const before = JSON.stringify(parsed.parameters);
    const result = applyChanges(parsed.parameters, [{ path: 'Chassis.Rear.WingAngle', value: 7 }]);
    assert.deepEqual(result.changed, [{ path: 'Chassis.Rear.WingAngle', from: '6 degrees', to: '7 degrees' }]);
    assert.equal(JSON.stringify(parsed.parameters), before);
    assert.equal(applyChanges(parsed.parameters, [{ path: 'Chassis.LeftFront.CornerWeight', value: 1 }]).error, 'reading');
    assert.equal(applyChanges(parsed.parameters, [{ path: 'Nope', value: 1 }]).error, 'unknownParameter');
    const sheet = changeSheet('Setup', result.changed, { from: 'from', to: 'to' });
    assert.ok(sheet.includes('Chassis › Rear › WingAngle: from 6 degrees  to 7 degrees'));
  });
});

describe('inspection and fixed setups', () => {
  test('iRacing’s result', () => {
    assert.equal(inspectionResult(1), 'passed');
    assert.equal(inspectionResult(0), 'failed');
    assert.equal(inspectionResult(null), 'unknown');
    assert.equal(inspectionResult(7), 'unknown');
  });

  test('preliminary validation never claims a pass', () => {
    const v = preliminaryValidation('bmwm4gt3', parsed.parameters);
    assert.equal(v.label, 'preliminary');
    assert.equal(v.noRulesForCar, true);
    assert.equal(v.findings.length, 0);
    const rule = { id: 'minRide', cars: ['bmwm4gt3'], source: 'test', check: () => [{ rule: 'minRide', severity: 'error', path: 'x', message: 'low' }] };
    assert.equal(preliminaryValidation('BMWM4GT3', parsed.parameters, [rule]).findings.length, 1);
    assert.equal(preliminaryValidation('bmwm4gt3', [], [rule]).checkedRules, 0);
  });

  test('a setup named fixed is not a fixed setup session', () => {
    // The capture this fixture came from: IsFixedSetup 0, load type iracing, name fixed.sto
    assert.deepEqual(fixedSetupSession({ fixedSession: false, loadType: 'iracing', name: 'fixed.sto' }), { fixed: false, known: true });
    assert.deepEqual(fixedSetupSession({ fixedSession: true, loadType: 'iracing', name: 'x.sto' }), { fixed: true, known: true });
    assert.deepEqual(fixedSetupSession({ loadType: 'fixed' }), { fixed: true, known: true });
    assert.deepEqual(fixedSetupSession({ loadType: 'iracing', name: 'fixed.sto' }), { fixed: false, known: false });
    assert.deepEqual(fixedSetupSession({ loadType: 'user', name: 'race.sto' }), { fixed: false, known: true });
  });
});
