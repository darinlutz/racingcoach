// Rotation Model tests: npm run test:rotation
//
// 1. Scenarios: each fixture in rotation-model/fixtures (made by scripts/rotation-model-fixtures.mjs) goes
//    through src/lib/rotationModel.ts and must reach the conclusion the fixture expects.
// 2. Regression: the states and events must match rotation-model/fixtures/golden.json. After an intended change
//    to the model or config, rewrite it with ROTATION_UPDATE_GOLDEN=1 and review the diff.
// 3. Parity: the collector's C# model (collector/RotationModel.Replay) runs the same fixtures; every sample's
//    numbers, states and events must match the Node model's within PARITY tolerances. Skipped when the .NET
//    SDK isn't installed (ROTATION_REQUIRE_DOTNET=1 makes that a failure).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RotationModel } from '../src/lib/rotationModel.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = join(root, 'rotation-model');
const fixtureDir = join(modelDir, 'fixtures');
const configPath = join(modelDir, 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json') && f !== 'golden.json').sort();
const fixtures = fixtureFiles.map((f) => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8')));

// C# and Node may differ in the last bits of exp/atan2/tan, which can move a threshold crossing by a sample
export const PARITY = {
  absolute: 1e-6, // numbers: |a - b| <= absolute + relative·|a|
  relative: 1e-6,
  boundarySamples: 2, // a state may differ only within this many samples of a state change
  eventSeconds: 2 / 60, // event start/end times
};

function runNode(fixture) {
  const model = new RotationModel(config, fixture.calibration);
  const results = [];
  const events = [];
  for (const sample of fixture.samples) {
    results.push(model.update(sample));
    events.push(...model.takeEvents());
  }
  model.finish();
  events.push(...model.takeEvents());
  return { results, events };
}

const node = new Map(fixtures.map((f) => [f.name, runNode(f)]));

// Time since the fixture's first sample
const rel = (fixture, time) => time - fixture.samples[0].time;

for (const fixture of fixtures) {
  test(`scenario ${fixture.name}: ${fixture.description}`, () => {
    const { results, events } = node.get(fixture.name);
    const expect = fixture.expect;
    for (const r of results) {
      for (const [key, value] of Object.entries(r)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} is ${value} at ${r.timestamp}`);
      }
      if (!r.isValid) assert.equal(r.displayLabel, '', `label shown on an invalid sample at ${r.timestamp}`);
      assert.ok(r.confidence >= 0 && r.confidence <= 1);
      assert.ok(r.understeerSeverity >= 0 && r.understeerSeverity <= 100);
      assert.ok(r.oversteerSeverity >= 0 && r.oversteerSeverity <= 100);
    }

    for (const want of expect.events) {
      const found = events.filter((e) => e.eventType === want.eventType);
      assert.equal(found.length, want.count, `${want.eventType} events: ${JSON.stringify(found.map((e) => rel(fixture, e.startTime)))}`);
      for (const e of found) {
        const start = rel(fixture, e.startTime);
        assert.ok(start >= want.startBetween[0] && start <= want.startBetween[1], `${want.eventType} started at ${start.toFixed(2)} s`);
        if (want.oversteerType) assert.equal(e.oversteerType, want.oversteerType);
      }
    }
    if (expect.events.length === 0) assert.deepEqual(events.map((e) => e.eventType), []);
    for (const type of expect.noEventsOf ?? []) assert.ok(!events.some((e) => e.eventType === type), `unexpected ${type}`);
    if (expect.neverLabel) assert.ok(results.every((r) => r.displayLabel === ''), 'a label was shown');
    if (expect.alwaysUnknown) assert.ok(results.every((r) => r.state === 'UNKNOWN'));
    if (expect.reasonSeen) assert.ok(results.some((r) => r.invalidReason === expect.reasonSeen), `never saw ${expect.reasonSeen}`);
    if (expect.capability) assert.ok(results.every((r) => r.capability === expect.capability));
    if (expect.neutralBetween) {
      const [a, b] = expect.neutralBetween;
      const inside = results.filter((r) => r.timestamp !== null && rel(fixture, r.timestamp) >= a && rel(fixture, r.timestamp) <= b);
      assert.ok(inside.length > 0 && inside.every((r) => r.state === 'NEUTRAL'));
    }
  });
}

test('identical input gives identical output (determinism)', () => {
  for (const fixture of fixtures) {
    assert.deepEqual(runNode(fixture), node.get(fixture.name));
  }
});

// Run-length states and rounded events: small enough to keep in git, enough to catch a changed conclusion
function summary(fixture) {
  const { results, events } = node.get(fixture.name);
  const states = [];
  results.forEach((r, i) => {
    if (states.length === 0 || states.at(-1)[0] !== r.state) states.push([r.state, i]);
  });
  const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  return {
    states,
    events: events.map((e) => ({
      eventType: e.eventType,
      startTime: round(e.startTime),
      endTime: round(e.endTime),
      peakSeverity: round(e.peakSeverity),
      oversteerType: e.oversteerType,
      endReason: e.endReason,
    })),
  };
}

test('regression: matches rotation-model/fixtures/golden.json', () => {
  const goldenPath = join(fixtureDir, 'golden.json');
  const current = Object.fromEntries(fixtures.map((f) => [f.name, summary(f)]));
  if (process.env.ROTATION_UPDATE_GOLDEN === '1') {
    writeFileSync(goldenPath, JSON.stringify({ modelVersion: config.modelVersion, fixtures: current }, null, 1) + '\n');
    return;
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  for (const name of Object.keys(current)) assert.deepEqual(current[name], golden.fixtures[name], name);
});

function dotnetAvailable() {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasDotnet = dotnetAvailable();
test('parity: C# collector model matches the Node model', { skip: !hasDotnet && process.env.ROTATION_REQUIRE_DOTNET !== '1' && 'the .NET SDK is not installed' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'rotation-parity-'));
  execFileSync(
    'dotnet',
    ['run', '--project', join(root, 'collector', 'RotationModel.Replay'), '-c', 'Release', '--', configPath, out, ...fixtureFiles.map((f) => join(fixtureDir, f))],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );

  const report = [];
  for (const fixture of fixtures) {
    const cs = JSON.parse(readFileSync(join(out, `${fixture.name}.results.json`), 'utf8'));
    const js = node.get(fixture.name);
    assert.equal(cs.results.length, js.results.length, fixture.name);

    // Samples near a state change in either model may differ by a threshold crossing
    const changes = [];
    js.results.forEach((r, i) => {
      if (i > 0 && (r.state !== js.results[i - 1].state || cs.results[i].state !== cs.results[i - 1].state)) changes.push(i);
    });
    const nearChange = (i) => changes.some((c) => Math.abs(c - i) <= PARITY.boundarySamples);

    let maxDiff = 0;
    let stateMismatches = 0;
    js.results.forEach((a, i) => {
      const b = cs.results[i];
      for (const [key, value] of Object.entries(a)) {
        if (typeof value === 'number') {
          assert.equal(typeof b[key], 'number', `${fixture.name}[${i}].${key}: C# ${b[key]}, Node ${value}`);
          const diff = Math.abs(value - b[key]);
          maxDiff = Math.max(maxDiff, diff);
          if (!nearChange(i)) {
            assert.ok(diff <= PARITY.absolute + PARITY.relative * Math.abs(value), `${fixture.name}[${i}].${key}: C# ${b[key]}, Node ${value}`);
          }
        } else if (!nearChange(i) || !['state', 'displayLabel', 'oversteerType'].includes(key)) {
          assert.equal(b[key], value, `${fixture.name}[${i}].${key}`);
        }
      }
      if (a.state !== b.state) stateMismatches++;
    });

    assert.equal(cs.events.length, js.events.length, `${fixture.name}: event count`);
    js.events.forEach((a, i) => {
      const b = cs.events[i];
      assert.equal(b.eventType, a.eventType);
      assert.equal(b.endReason, a.endReason);
      assert.ok(Math.abs(b.startTime - a.startTime) <= PARITY.eventSeconds, `${fixture.name}: event ${i} start`);
      assert.ok(Math.abs(b.endTime - a.endTime) <= PARITY.eventSeconds, `${fixture.name}: event ${i} end`);
    });
    report.push(`${fixture.name}: max |Δ| ${maxDiff.toExponential(1)}, ${stateMismatches} state mismatches, ${js.events.length} events`);
  }
  console.log(report.join('\n'));
});
