// The iRacing Setups library's pure parts: npm run test:car-setup-library (docs/setups.md's iRacing setup collection)
//
// setupHtm.ts against iRacing's own garage exports (scripts/fixtures/setups/htm/, see its README), and
// carSetupLibraryRules.ts: names, paths, keys and how an import decides what's new.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { camelKey, cleanHtmFileName, decodeHtm, parseSetupHtm } from '../src/lib/setupHtm.ts';
import {
  carSetupObjectKey,
  cleanCarFolder,
  cleanSetupFileName,
  cleanSetupPath,
  importDecision,
  isCarSetupObjectKey,
  looksLikeText,
  sameSetup,
  setupStem,
} from '../src/lib/carSetupLibraryRules.ts';

import { IRACING_CARS } from '../src/lib/carPictures.ts';
import { carPathForName } from '../src/lib/carModels/carPathByName.ts';

describe('car folders and Car Data', () => {
  // Folders a sim PC's iRacing setups folder has, and the Car Data car each is (resolveCarFolders matches the folder
  // to a car path in IRACING_CARS, then one of its names to Car Data's)
  const folders = {
    bmwm4gt3: 'BMW M4 GT3 EVO',
    'stockcars chevycamarozl12022': 'Next Gen NASCAR Cup Series Chevrolet Camaro ZL1',
  };
  for (const [folder, carDataName] of Object.entries(folders)) {
    test(`${folder} is ${carDataName}, and that name finds only its car path`, () => {
      const entry = IRACING_CARS.find(([carPath]) => carPath === folder);
      assert.ok(entry, folder);
      assert.ok(entry.slice(2).includes(carDataName));
      assert.equal(carPathForName(carDataName), folder);
    });
  }
});

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/setups/htm/${name}`, import.meta.url));
const byPath = (parsed) => new Map(parsed.parameters.map((p) => [p.path, p]));

describe('the .htm setup export', () => {
  test('a GT3 export: its title, boxes, values, units, lists, readings and in-car settings', () => {
    const parsed = parseSetupHtm(fixture('baseline.htm'));
    assert.equal(parsed.status, 'parsed');
    assert.equal(parsed.carPath, 'porsche911rgt3');
    assert.equal(parsed.setupName, 'baseline');
    assert.equal(parsed.track, 'nurburgring combined');
    assert.deepEqual(parsed.warnings, []);
    const p = byPath(parsed);
    const pressure = p.get('LeftFront.StartingPressure');
    assert.equal(pressure.label, 'Starting pressure');
    assert.equal(pressure.section, 'LEFT FRONT');
    assert.equal(pressure.raw, '20.5 psi');
    assert.equal(pressure.value, 20.5);
    assert.equal(pressure.unit, 'psi');
    assert.equal(pressure.category, 'tires');
    assert.equal(pressure.kind, 'setting');
    // One value per line after the label: a list, kept as written, and a reading
    const temps = p.get('LeftFront.LastTempsOMI');
    assert.equal(temps.raw, '112F, 112F, 112F');
    assert.deepEqual(temps.values, [112, 112, 112]);
    assert.equal(temps.kind, 'reading');
    // LEFT FRONT appears again for the chassis: its values have their own paths, in the right categories
    assert.equal(p.get('LeftFront.SpringRate').raw, '1371 lbs/in');
    assert.equal(p.get('LeftFront.SpringRate').category, 'suspension');
    assert.equal(p.get('LeftFront.Camber').category, 'alignment');
    assert.equal(p.get('LeftFront.CornerWeight').kind, 'reading');
    // Values that aren't a plain number and unit are kept, never guessed at
    assert.equal(p.get('Front.ToeIn').raw, '-2/32"');
    assert.equal(p.get('Front.ToeIn').value, null);
    assert.equal(p.get('Front.FuelLevel').category, 'fuel');
    assert.equal(p.get('AeroBalanceCalc.FrontRHAtSpeed').kind, 'reading');
    const bias = p.get('InCarDials.BrakePressureBias');
    assert.equal(bias.inCar, true);
    assert.equal(bias.category, 'brakes');
    assert.equal(p.get('Rear.DiffPreload').category, 'drivetrain');
    // The headings with no colon are the box's description, and the notes are kept
    assert.ok(parsed.sections.find((s) => s.title === 'DRIVER AIDS').description.length >= 5);
    assert.match(parsed.notes, /general starting point/);
  });

  test('a prototype export: "of" lines, gear speeds as readings, every category found', () => {
    const parsed = parseSetupHtm(fixture('iracing_lemans_default.htm'));
    const p = byPath(parsed);
    assert.equal(p.get('Front.ThirdSpringDefl').raw, '0.292 in of 3.090 in');
    assert.equal(p.get('Front.ThirdSpringDefl').kind, 'reading');
    assert.equal(p.get('GearRatios.SpeedInFirst').category, 'drivetrain');
    assert.equal(p.get('GearRatios.SpeedInFirst').kind, 'reading');
    assert.equal(p.get('TractionControl.TractionControlGain').category, 'electronics');
    assert.equal(p.get('Front.ARBSize').raw, 'Medium');
    assert.equal(p.get('AeroCalculator.LD').kind, 'reading');
    const categories = new Set(parsed.parameters.map((x) => x.category));
    for (const c of ['tires', 'suspension', 'alignment', 'brakes', 'aero', 'drivetrain', 'fuel', 'electronics']) assert.ok(categories.has(c), c);
    assert.deepEqual(parsed.warnings, []);
  });

  test('other cars: different boxes and labels, nothing assumed', () => {
    for (const name of ['mx5_charlotte_legends_oval.htm', 'skip_barber_centripetal.htm', 'iracing_w12_baseline_glenboot.htm']) {
      const parsed = parseSetupHtm(fixture(name));
      assert.equal(parsed.status, 'parsed', name);
      assert.deepEqual(parsed.warnings, [], name);
      assert.ok(parsed.parameters.length > 30, name);
      assert.equal(new Set(parsed.parameters.map((x) => x.path)).size, parsed.parameters.length, `${name}: paths are unique`);
    }
    assert.equal(byPath(parseSetupHtm(fixture('mx5_charlotte_legends_oval.htm'))).get('LeftFront.ColdPressure').raw, '30.0 psi');
  });

  test('Latin-1 files, entities, and what isn’t an export', () => {
    assert.equal(decodeHtm(Buffer.from([0x48, 0xf6])).encoding, 'latin-1');
    assert.equal(decodeHtm(Buffer.from([0x48, 0xf6])).text, 'Hö');
    const latin = Buffer.from(
      '<html><head><title>iRacing.com Motorsport Simulations Car Setup</title></head><body><H2><U>FRONT:</U></H2>Wing: <U>5 deg</U><br><br><H2><U>NOTES:</U></H2>caf\xe9<br></body></html>',
      'latin1'
    );
    const parsed = parseSetupHtm(latin);
    assert.equal(parsed.encoding, 'latin-1');
    assert.match(parsed.notes, /café/);
    assert.equal(parseSetupHtm('<html><body>hello</body></html>').status, 'failed');
    assert.equal(parseSetupHtm('<html><head><title>iRacing</title></head><body><H2><U>FRONT:</U></H2></body></html>').status, 'empty');
  });

  test('nothing in a file can become markup: scripts, styles and tags inside values are dropped as text', () => {
    const parsed = parseSetupHtm(
      '<title>iRacing</title><script>alert(1)</script><H2><U>FRONT:</U></H2>Wing: <U>5 deg<img src=x onerror=alert(1)></U><br><br></body>'
    );
    assert.equal(parsed.parameters[0].raw, '5 deg');
    assert.ok(!JSON.stringify(parsed).includes('alert'));
  });

  test('keys', () => {
    assert.equal(camelKey('LEFT FRONT TIRE'), 'LeftFrontTire');
    assert.equal(camelKey('Toe-in'), 'ToeIn');
    assert.equal(camelKey('Front master cyl.'), 'FrontMasterCyl');
    assert.equal(camelKey('Trac Ctrl (TCC) setting'), 'TracCtrlTCCSetting');
    assert.equal(cleanHtmFileName('baseline.htm'), 'baseline.htm');
    assert.equal(cleanHtmFileName('../x.htm'), null);
  });
});

describe('the library’s rules', () => {
  test('car folders, setup paths and file names: no traversal or unsafe names', () => {
    assert.equal(cleanCarFolder('ferrari296gt3'), 'ferrari296gt3');
    assert.equal(cleanCarFolder('mx5 mx52016'), 'mx5 mx52016');
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '', 'C:', 'x\u0000']) assert.equal(cleanCarFolder(bad), null, bad);
    assert.equal(cleanSetupPath('baseline'), 'baseline');
    assert.equal(cleanSetupPath('Season 4\\race'), 'Season 4/race');
    for (const bad of ['../race', 'a/../b', '/etc/passwd', 'a/b/c/d/e', 'x:y', 'a/./b']) assert.equal(cleanSetupPath(bad), null, bad);
    assert.equal(cleanSetupFileName('Baseline.STO', 'sto'), 'Baseline.STO');
    assert.equal(cleanSetupFileName('baseline.htm', 'sto'), null);
    assert.equal(cleanSetupFileName('baseline.html', 'htm'), 'baseline.html');
    assert.equal(setupStem('Baseline.htm'), 'Baseline');
    assert.ok(sameSetup('baseline', 'BASELINE'));
  });

  test('object keys are content-addressed, per car, never from the file name', () => {
    const sha = 'a'.repeat(64);
    assert.equal(carSetupObjectKey('ferrari296gt3', sha, 'sto'), `iracing-setups/ferrari296gt3/${sha}.sto`);
    assert.equal(carSetupObjectKey('mx5 mx52016', sha, 'htm'), `iracing-setups/mx5-mx52016/${sha}.htm`);
    assert.ok(isCarSetupObjectKey(carSetupObjectKey('ferrari296gt3', sha, 'htm')));
    assert.ok(!isCarSetupObjectKey(`telemetry/x/${sha}.sto`));
    assert.throws(() => carSetupObjectKey('ferrari296gt3', '../../x', 'sto'));
  });

  test('an import’s decision: new, unchanged, or changed when either file differs or an .htm appears or goes', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    assert.equal(importDecision(null, { stoSha256: a, htmSha256: null }), 'new');
    assert.equal(importDecision({ stoSha256: a, htmSha256: b }, { stoSha256: a, htmSha256: b }), 'unchanged');
    assert.equal(importDecision({ stoSha256: a, htmSha256: null }, { stoSha256: a, htmSha256: null }), 'unchanged');
    assert.equal(importDecision({ stoSha256: a, htmSha256: b }, { stoSha256: b, htmSha256: b }), 'changed');
    assert.equal(importDecision({ stoSha256: a, htmSha256: null }, { stoSha256: a, htmSha256: b }), 'changed');
    assert.equal(importDecision({ stoSha256: a, htmSha256: b }, { stoSha256: a, htmSha256: null }), 'changed');
  });

  test('binary sent as an .htm is told apart', () => {
    assert.ok(looksLikeText(Buffer.from('<html>')));
    assert.ok(!looksLikeText(Buffer.from([0x3c, 0x00, 0x68])));
  });
});
