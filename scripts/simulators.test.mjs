// Multi-simulator rules, no database: npm run test:simulators
// The matrix is the one the collector builds in, so these hold for both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptsLapsFrom,
  channelAvailable,
  CHANNELS,
  DEFAULT_SIMULATOR,
  findSimulator,
  lapRefusal,
  SIMULATORS,
} from '../src/lib/simulators.ts';

import { simulatorCatalog } from '../src/lib/simulatorCatalogs.ts';
import { fillGaps, lapSamplesFromText } from '../src/lib/lapData.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('only iRacing and ACC are claimed as supported', () => {
  assert.deepEqual(SIMULATORS.filter((s) => s.status === 'supported').map((s) => s.id), ['iracing', 'acc']);
  assert.equal(DEFAULT_SIMULATOR, 'iracing');
});

test('every target simulator is listed, with sources and licensing noted', () => {
  assert.deepEqual(SIMULATORS.map((s) => s.id), ['iracing', 'acc', 'ac', 'ams2', 'lmu', 'rf2', 'r3e', 'acevo', 'f1']);
  for (const simulator of SIMULATORS) {
    assert.ok(simulator.sources.length > 0, simulator.id);
    assert.ok(simulator.licensing, simulator.id);
    assert.ok(simulator.interfaces.length > 0, simulator.id);
  }
});

// The simulators the collector has an adapter for (SimulatorRegistry): only they can have checked a channel in the game
const WITH_ADAPTER = ['iracing', 'acc'];

test('a simulator only lists real channels, and one with no adapter never says collected', () => {
  for (const simulator of SIMULATORS) {
    for (const [channel, { support }] of Object.entries(simulator.channels)) {
      assert.ok(CHANNELS.includes(channel), `${simulator.id}: ${channel}`);
      if (!WITH_ADAPTER.includes(simulator.id)) assert.ok(!support.startsWith('collected'), `${simulator.id}: ${channel}`);
    }
  }
  // An adapter marks channels collected one at a time as they're checked, and ACC's passed the checklist (2026-11-06)
  assert.equal(findSimulator('acc').status, 'supported');
});

test('laps are only accepted from a tested simulator, and never an unknown one', () => {
  assert.equal(acceptsLapsFrom('iracing'), true);
  assert.equal(acceptsLapsFrom('acc'), true);
  assert.equal(acceptsLapsFrom('ams2'), false);
  assert.equal(acceptsLapsFrom('nonsense'), false);
});

test('an old collector is never refused, and a new format or simulator is, with a reason', () => {
  assert.equal(lapRefusal(undefined, undefined), null);
  assert.equal(lapRefusal(null, null), null);
  assert.equal(lapRefusal('iracing', 1), null);
  assert.equal(lapRefusal('ams2', 1), 'simulatorNotSupported');
  // ACC's laps only from an adapter that writes them as iRacing's
  assert.equal(lapRefusal('acc', 1, '2'), null);
  assert.equal(lapRefusal('acc', 1, '1'), 'adapterVersionNotSupported');
  assert.equal(lapRefusal('acc', 1, null), 'adapterVersionNotSupported');
  assert.equal(lapRefusal('iracing', 1, null), null);
  assert.equal(lapRefusal('iracing', 2), 'payloadVersionNotSupported');
});

test('a channel only shows where it has really been collected', () => {
  assert.equal(channelAvailable('iracing', 'brake'), true);
  assert.equal(channelAvailable('iracing', 'geoPosition'), true);
  assert.equal(channelAvailable('iracing', 'wheelSpeed'), false);
  assert.equal(channelAvailable('acc', 'brake'), true); // checked against the Spa recording
  assert.equal(channelAvailable('acc', 'fuelLevel'), true); // liters, from the second Spa recording
  assert.equal(channelAvailable('acc', 'slipRatio'), false); // documented: what it holds isn't confirmed
  assert.equal(channelAvailable('acc', 'steeringAngle'), false);
  assert.equal(findSimulator('acc').channels.rideHeightAxle.support, 'unavailable');
  assert.equal(channelAvailable('nonsense', 'brake'), false);
});

test('laps from before simulators existed stay valid: every schema change is additive', () => {
  assert.match(source('src/lib/users.ts'), /for \(const statement of SIMULATOR_SCHEMA\) await client\.query\(statement\);/);
  const statements = source('src/lib/simulatorSchema.ts');
  assert.match(statements, /"CollectorLaps" ADD COLUMN IF NOT EXISTS simulator TEXT NOT NULL DEFAULT 'iracing'/);
  // No statement of this work drops, renames or rewrites anything
  const code = statements.replace(/^\s*\/\/.*$/gm, '').replaceAll('ON DELETE SET NULL', '');
  assert.doesNotMatch(code, /\bDROP\b|\bRENAME\b|ALTER COLUMN|\bUPDATE\b|\bDELETE\b/);
});

test('another simulator can never write to iRacing track data, and neither path reads across', () => {
  const laps = source('src/lib/collectorLaps.ts');
  // The iRacing-only writes are guarded together
  assert.match(laps, /if \(simulator === DEFAULT_SIMULATOR\) \{\s+await saveTrackLength/);
  assert.match(laps, /simulator === DEFAULT_SIMULATOR && hasPosition\) await saveTrackShapeFromLap/);
  assert.match(laps, /if \(simulator === DEFAULT_SIMULATOR\) await saveTrackShapeFromLap/);
  // and the backfill only reads iRacing's laps
  assert.match(laps, /l\.simulator = '\$\{DEFAULT_SIMULATOR\}'/);
});

test('the website\'s ACC cars are the collector\'s: the same ids and names', () => {
  const collector = [...source('collector/RacingCoach.Collector.Core/AccCars.cs').matchAll(/new\("([^"]+)", "([^"]+)"/g)].map(([, key, name]) => ({ key, name }));
  assert.ok(collector.length > 40);
  assert.deepEqual(simulatorCatalog('acc').cars, collector);
  // Spa is what ACC called it in the recordings (AccSpaRecordingTests)
  assert.ok(simulatorCatalog('acc').tracks.some((track) => track.key === 'Spa'));
  assert.deepEqual(simulatorCatalog('iracing'), { tracks: [], cars: [] });
});

test('an empty pedal or speed cell is filled from its neighbours, never read as 0', () => {
  const lap = lapSamplesFromText('Speed,LapDistPct,Brake,Throttle,SteeringWheelAngle\n40,0.1,0.5,0,\n,0.2,,0.7,\n42,0.3,0.25,,\n');
  assert.deepEqual(lap.speeds, [40, 40, 42]);
  assert.deepEqual(lap.brakes, [0.5, 0.5, 0.25]);
  assert.deepEqual(lap.throttles, [0, 0.7, 0.7]);
  // A channel the simulator doesn't give stays unavailable
  assert.ok(lap.steerings.every(Number.isNaN));
  const leading = [NaN, NaN, 3, NaN];
  fillGaps(leading);
  assert.deepEqual(leading, [3, 3, 3, 3]);
  const none = [NaN, NaN];
  fillGaps(none);
  assert.deepEqual(none, [0, 0]);
});
