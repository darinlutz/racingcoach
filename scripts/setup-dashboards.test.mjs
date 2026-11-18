// The Setups page's Aerodynamics, Drivetrain, Fuel, Electronics and Other tabs: npm run test:setup-dashboards
// (docs/setups.md)
//
// setupDashboards.ts against the real CarSetup capture (the BMW M4 GT3 EVO's fixed.sto as iRacing showed it) and changed
// copies of it: each dashboard's parameters and roles, readings kept apart, the aero balance and heights at speed,
// drivetrain drawings, fuel in litres with a density and a plan only from the driver's numbers, electronics dials,
// the illustrative throttle, and the Setup Engineer's facts and rules.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCarSetupYaml } from '../src/lib/setupYaml.ts';
import { compareSetups } from '../src/lib/setupCompare.ts';
import {
  aeroBalance,
  byRole,
  compareDashboard,
  DASHBOARD_ENGINEER_RULES,
  dashboardEngineerFacts,
  dialRange,
  formatDash,
  frictionFaces,
  fuelLitres,
  fuelMassKg,
  fuelPlan,
  heightAtSpeedDifference,
  illustrativeThrottle,
  isSetupDashboard,
  lapsForDuration,
  preloadShare,
  SETUP_DASHBOARDS,
  wingDrawAngle,
} from '../src/lib/setupDashboards.ts';

const fixture = fs.readFileSync(new URL('./fixtures/setups/bmwm4gt3-fixed-carsetup.yaml', import.meta.url), 'utf8');

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
const rowsOf = (a, b) => compareSetups(setup(a), setup(b)).rows;
const comparison = edited([
  { group: 'Rear', key: 'WingAngle', value: '8 degrees' },
  { group: 'AeroBalanceCalc', key: 'FrontDownforce', value: '42.1%' },
  { group: 'GearsDifferential', key: 'DiffPreload', value: '110 Nm' },
  { group: 'GearsDifferential', key: 'FrictionFaces', value: '8' },
  { group: 'Rear', key: 'FuelLevel', value: '62.5 L' },
  { group: 'InCarAdjustments', key: 'TcSetting', value: '5 (TC)' },
]);
const rows = rowsOf(fixture, comparison);
const same = (d) => compareDashboard(d, rowsOf(fixture, fixture));

describe('the five dashboards', () => {
  test('their names', () => {
    assert.deepEqual([...SETUP_DASHBOARDS], ['aero', 'drivetrain', 'fuel', 'electronics', 'other']);
    assert.equal(isSetupDashboard('fuel'), true);
    assert.equal(isSetupDashboard('tires'), false);
  });
  test('aero: the wing and splitter as settings, iRacing’s calculator as readings', () => {
    const a = same('aero');
    assert.equal(byRole(a, 'wingAngle').path, 'Chassis.Rear.WingAngle');
    assert.equal(byRole(a, 'wingAngle').reading, false);
    assert.equal(byRole(a, 'splitter').baseline.value, 50.6);
    for (const role of ['frontRhSpeed', 'rearRhSpeed', 'wingSetting', 'frontDownforce']) assert.equal(byRole(a, role).reading, true, role);
  });
  test('drivetrain, fuel and electronics from the capture; ABS borrowed from brakes; nothing other', () => {
    assert.equal(byRole(same('drivetrain'), 'gearStack').baseline.raw.trim(), 'FIA');
    assert.equal(byRole(same('fuel'), 'fuelLevel').baseline.value, 50);
    const e = same('electronics');
    assert.equal(byRole(e, 'tc').baseline.value, 3);
    assert.equal(byRole(e, 'abs').borrowed, true);
    assert.equal(same('other').items.length, 0);
  });
});

describe('changes', () => {
  test('setting changes are counted, calculator readings are not', () => {
    const a = compareDashboard('aero', rows);
    assert.equal(byRole(a, 'wingAngle').delta.value, 2);
    assert.equal(byRole(a, 'frontDownforce').status, 'changed');
    assert.equal(a.changedCount, 1);
  });
  test('aero balance from FrontDownforce: 42.1% front is 57.9% rear', () => {
    const a = compareDashboard('aero', rows);
    assert.deepEqual(aeroBalance(a, 'comparison'), { front: 42.1, rear: 57.9, decimals: 1 });
    assert.deepEqual(heightAtSpeedDifference(a, 'baseline'), { value: 20, unit: 'mm', decimals: 0 });
  });
  test('the wing is drawn exaggerated and capped, its value unchanged', () => {
    assert.ok(Math.abs(wingDrawAngle(6, 1) - 3.6) < 1e-9);
    assert.equal(wingDrawAngle(30, 10), 35);
    assert.equal(wingDrawAngle(null, 5), 0);
  });
  test('drivetrain: preload relative to the larger, friction faces counted', () => {
    const d = compareDashboard('drivetrain', rows);
    assert.ok(Math.abs(preloadShare(d, 'baseline') - 85 / 110) < 1e-12);
    assert.equal(preloadShare(d, 'comparison'), 1);
    assert.equal(frictionFaces(d, 'comparison'), 8);
    assert.equal(d.changedCount, 2);
  });
});

describe('fuel', () => {
  test('litres, and gallons converted exactly', () => {
    const f = compareDashboard('fuel', rows);
    assert.equal(fuelLitres(f, 'comparison'), 62.5);
    const g = compareDashboard('fuel', rowsOf(fixture, edited([{ group: 'Rear', key: 'FuelLevel', value: '10.0 gal' }])));
    assert.ok(Math.abs(fuelLitres(g, 'comparison') - 37.85411784) < 1e-9);
  });
  test('mass only for a density the driver gives', () => {
    assert.equal(fuelMassKg(50, 0.75), 37.5);
    assert.equal(fuelMassKg(50, NaN), null);
    assert.equal(fuelMassKg(50, 0), null);
  });
  test('the plan from the driver’s laps, consumption and reserve', () => {
    assert.deepEqual(fuelPlan(50, 20, 2.3, 1), { required: 47, lapsCovered: 49 / 2.3, surplus: 3 });
    assert.equal(fuelPlan(50, 0, 2.3, 1), null);
    assert.equal(fuelPlan(null, 20, 2.3, 1), null);
    assert.equal(lapsForDuration(60, 125), 29);
    assert.equal(lapsForDuration(60, 0), null);
  });
});

describe('electronics and other', () => {
  test('dials cover the larger of the two settings and at least 10', () => {
    const e = compareDashboard('electronics', rows);
    assert.equal(dialRange(byRole(e, 'tc')), 10);
    assert.equal(formatDash(byRole(e, 'tc').comparison), '5');
    assert.equal(formatDash(byRole(e, 'tc').delta, true), '+2');
  });
  test('the throttle illustration is linear without a setting and bends with it', () => {
    assert.equal(illustrativeThrottle(40, null), 40);
    assert.ok(illustrativeThrottle(40, 5) > 40);
    assert.ok(illustrativeThrottle(40, 1) < 40);
    assert.equal(illustrativeThrottle(100, 5), 100);
  });
});

describe('the Setup Engineer’s facts', () => {
  test('aero: values as iRacing wrote them, calculator readings marked, the balance as a share', () => {
    const facts = dashboardEngineerFacts('aero', compareDashboard('aero', rows), { baseline: 'a', comparison: 'b', car: 'BMW M4 GT3 EVO' }).join('\n');
    assert.match(facts, /WingAngle \[Chassis\.Rear\.WingAngle\]: 6 degrees -> 8 degrees, delta \+2 degrees/);
    assert.match(facts, /FrontDownforce \(iRacing's own calculation, not a setting\)/);
    assert.match(facts, /Comparison aero balance from iRacing's calculator: 42\.1% front \/ 57\.9% rear/);
    assert.match(facts, /Not known: total downforce/);
  });
  test('fuel never plans without the driver’s numbers; other says when there’s nothing', () => {
    assert.match(dashboardEngineerFacts('fuel', compareDashboard('fuel', rows), { baseline: 'a', comparison: 'b', car: null }).join('\n'), /never assume them/);
    assert.match(dashboardEngineerFacts('other', same('other'), { baseline: 'a', comparison: 'b', car: null }).join('\n'), /Neither setup has other parameters/);
  });
  test('every rule keeps principles from predictions and never picks a better setup', () => {
    for (const d of SETUP_DASHBOARDS) assert.match(DASHBOARD_ENGINEER_RULES[d], /Never call either setup better/);
    assert.match(DASHBOARD_ENGINEER_RULES.electronics, /Never say what a setting number does/);
  });
});
