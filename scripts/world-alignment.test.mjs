// Placing ACC's world coordinates on the earth (src/lib/worldAlignment.ts), from the two real Spa recordings the
// collector's tests use: npm run test:simulators. No database.
//
// There's no iRacing Spa outline in the repository, so the second recording (another drive of the same track in the
// same ACC world) stands in for it: turned, moved and put at Spa's latitude, with its start line moved. Fitting the
// first recording's lap to it must find that turn and offset again, so the first lap lands where it really was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  ALIGNMENT_STEPS,
  alignmentCurrent,
  fitWorldAlignment,
  lapSteps,
  outlineHash,
  outlineLapPcts,
  worldToLatLon,
} from '../src/lib/worldAlignment.ts';

const fixture = (name) =>
  new URL(`../collector/RacingCoach.Collector.Core.Tests/Fixtures/${name}`, import.meta.url);

// An ACC raw recording (AccRawRecording.cs): each sample's completed laps, normalizedCarPosition and the player's
// carCoordinates (found by playerCarID in carID, as AccSharedMemory.ReadGraphics does)
function readRecording(name) {
  const bytes = gunzipSync(readFileSync(fixture(name)));
  assert.equal(bytes.subarray(0, 8).toString('ascii'), 'RCACCRAW');
  const [physicsSize, graphicsSize, staticSize] = [bytes.readInt32LE(12), bytes.readInt32LE(16), bytes.readInt32LE(20)];
  const samples = [];
  let at = 24;
  while (at + 9 <= bytes.length) {
    const kind = bytes[at];
    at += 9;
    if (kind === 1) {
      at += staticSize;
      continue;
    }
    if (at + physicsSize + graphicsSize > bytes.length) break;
    const g = at + physicsSize;
    at += physicsSize + graphicsSize;
    const active = Math.min(bytes.readInt32LE(g + 252), 60);
    const player = bytes.readInt32LE(g + 1216);
    for (let i = 0; i < active; i++) {
      if (bytes.readInt32LE(g + 976 + 4 * i) !== player) continue;
      samples.push({
        laps: bytes.readInt32LE(g + 132),
        pct: bytes.readFloatLE(g + 248),
        x: bytes.readFloatLE(g + 256 + 12 * i),
        y: bytes.readFloatLE(g + 260 + 12 * i),
        z: bytes.readFloatLE(g + 264 + 12 * i),
      });
      break;
    }
  }
  return samples;
}

// The one whole lap of each recording
const lapA = readRecording('acc-spa-huracan-gt3-evo-lap.accraw.gz').filter((s) => s.laps === 1);
const lapB = readRecording('acc-spa-huracan-gt3-evo-off-track-pit-entry.accraw.gz').filter((s) => s.laps === 2);
const asLap = (samples) => ({ pcts: samples.map((s) => s.pct), xs: samples.map((s) => s.x), zs: samples.map((s) => s.z) });

const R = 6371008.8;
const rad = Math.PI / 180;
const SPA = [50.437, 5.971];
// Where a world position really is in the stand-in: east, north = turn(-x, z) + offset, at Spa
function placed(angle, east, north) {
  return (x, z) => {
    const [e, n] = [-x, z];
    const [ee, nn] = [Math.cos(angle) * e - Math.sin(angle) * n + east, Math.sin(angle) * e + Math.cos(angle) * n + north];
    return [SPA[0] + (nn / R) / rad, SPA[1] + (ee / (R * Math.cos(SPA[0] * rad))) / rad];
  };
}
// The stand-in iRacing outline: lap B's steps, placed, with its start line `shift` steps after ACC's
function outlineFrom(samples, truth, shift = 0, stretch = 1) {
  const steps = lapSteps(...Object.values(asLap(samples)));
  assert.ok(steps);
  return steps.map((_, i) => {
    const [e, n] = steps[(i + shift) % ALIGNMENT_STEPS];
    // steps are already (-x, z); undo that for truth, which takes the world's x and z
    return truth(-e * stretch, n * stretch);
  });
}
const metersBetween = ([a, b], [c, d]) => Math.hypot((a - c) * R * rad, (b - d) * R * Math.cos(a * rad) * rad);

test('the recordings have a whole lap of world coordinates each', () => {
  assert.ok(lapA.length > 9000 && lapB.length > 9000);
  assert.ok(lapSteps(...Object.values(asLap(lapA))));
});

test('one Spa drive is laid on another to within a couple of meters, with the turn and start line found', () => {
  const angle = 37 * rad;
  const truth = placed(angle, 812.5, -233.1);
  const result = fitWorldAlignment(asLap(lapA), outlineFrom(lapB, truth, 10), 'spa gp');
  assert.equal(result.ok, true, JSON.stringify(result));
  const { alignment } = result;
  assert.ok(Math.abs(alignment.angle - angle) < 0.1 * rad, `angle off by ${(alignment.angle - angle) / rad}°`);
  assert.equal(alignment.startOffset, -10 / ALIGNMENT_STEPS);
  assert.ok(alignment.rmsMeters < 5, `rms ${alignment.rmsMeters}`);
  assert.equal(alignment.trackKey, 'spa gp');
  // Every sample of lap A lands where it really was
  const errors = lapA.map((s) => metersBetween(worldToLatLon(alignment, s.x, s.z), truth(s.x, s.z)));
  const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
  assert.ok(mean < 2, `mean error ${mean.toFixed(2)} m`);
  assert.ok(Math.max(...errors) < 4, `worst error ${Math.max(...errors).toFixed(2)} m`);
});

test('two laps of one track go through the same alignment, so their lines differ exactly as they did', () => {
  const truth = placed(-120 * rad, -40, 95);
  const { alignment } = fitWorldAlignment(asLap(lapA), outlineFrom(lapB, truth), 'spa gp');
  // Ten samples of each lap: the distance between them on the earth is the distance between them in ACC
  for (let k = 0; k < 10; k++) {
    const [a, b] = [lapA[k * 900], lapB[k * 900]];
    const inAcc = Math.hypot(a.x - b.x, a.z - b.z);
    const onEarth = metersBetween(worldToLatLon(alignment, a.x, a.z), worldToLatLon(alignment, b.x, b.z));
    assert.ok(Math.abs(inAcc - onEarth) < 0.05, `${inAcc} vs ${onEarth}`);
  }
});

// The distance between two lap positions, the short way round
const pctGap = (a, b) => Math.abs(a - b - Math.round(a - b));

test('every sample gets the lap position iRacing would give it, so focus areas cut both laps at the same places', () => {
  // The stand-in outline's start line is 10 steps (2% of the lap) before ACC's: an iRacing lap position is ACC's
  // minus 0.02 here, as the two recordings are of the same ACC spline
  const truth = placed(37 * rad, 812.5, -233.1);
  const outline = outlineFrom(lapB, truth, 10);
  const { alignment } = fitWorldAlignment(asLap(lapA), outline, 'spa gp');
  const pcts = outlineLapPcts(alignment, outline, asLap(lapA));
  assert.equal(pcts.length, lapA.length);
  assert.ok(pcts.every((p) => p >= 0 && p < 1));
  // The stand-in's lap B turns into pit entry at the end (a real outline is only ever from a clean lap), so its last
  // few percent aren't the track's line and are left out
  const gaps = lapA.flatMap((s, i) => (s.pct < 0.94 ? [pctGap(pcts[i], s.pct - 0.02)] : []));
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  // A step of the outline is 0.2% of the lap (about 14 m at Spa)
  assert.ok(mean < 0.0005, `mean ${(mean * 100).toFixed(3)}% of the lap out`);
  assert.ok(Math.max(...gaps) < 0.0015, `worst ${(Math.max(...gaps) * 100).toFixed(3)}% of the lap out`);
  // Never backwards round the lap: it crosses iRacing's line once, just after ACC's
  let wraps = 0;
  for (let i = 1; i < pcts.length; i++) {
    const step = pcts[i] - pcts[i - 1];
    if (step < -0.5) wraps++;
    else assert.ok(step >= 0, `sample ${i} goes back ${step}`);
  }
  assert.equal(wraps, 1);
});

test('a lap without world coordinates is moved by the start line offset alone', () => {
  const outline = outlineFrom(lapB, placed(1, 2, 3), 10);
  const { alignment } = fitWorldAlignment(asLap(lapA), outline, 'spa gp');
  const lap = { pcts: [0, 0.25, 0.5, NaN, 0.99], xs: [], zs: [] };
  const pcts = outlineLapPcts(alignment, outline, lap);
  for (const [i, expected] of [[0, 0.98], [1, 0.23], [2, 0.48], [4, 0.97]]) assert.ok(pctGap(pcts[i], expected) < 1e-9, `${i}: ${pcts[i]}`);
  assert.ok(Number.isNaN(pcts[3]));
});

test('a lap that isnt the outlines track is refused', () => {
  const truth = placed(0.5, 0, 0);
  const outline = outlineFrom(lapB, truth);
  // Driven the other way round
  const reversed = fitWorldAlignment({ ...asLap(lapA), pcts: lapA.map((s) => 1 - s.pct) }, outline, 'x');
  assert.equal(reversed.ok, false);
  assert.equal(reversed.reason, 'shape');
  // Not mirrored (as if ACC's x were east): the track's mirror image doesn't fit
  const unmirrored = fitWorldAlignment({ ...asLap(lapA), xs: lapA.map((s) => -s.x) }, outline, 'x');
  assert.equal(unmirrored.ok, false);
  // A layout 20% longer round
  const longer = fitWorldAlignment(asLap(lapA), outlineFrom(lapB, truth, 0, 1.2), 'x');
  assert.equal(longer.ok, false);
  assert.equal(longer.reason, 'length');
  // An outline that isn't 500 points, or a lap that covers half the track
  assert.equal(fitWorldAlignment(asLap(lapA), outline.slice(0, 100), 'x').reason, 'outline');
  const half = lapA.filter((s) => s.pct < 0.5);
  assert.equal(fitWorldAlignment(asLap(half), outline, 'x').reason, 'lapCoverage');
});

test('a stored alignment is only used for the track and outline it was fitted to', () => {
  const outline = outlineFrom(lapB, placed(1, 2, 3));
  const { alignment } = fitWorldAlignment(asLap(lapA), outline, 'spa gp');
  assert.equal(alignmentCurrent(alignment, 'SPA GP', outline), true);
  assert.equal(alignmentCurrent(alignment, 'monza full', outline), false);
  const relearned = outline.map(([lat, lon]) => [lat + 1e-6, lon]);
  assert.notEqual(outlineHash(relearned), outlineHash(outline));
  assert.equal(alignmentCurrent(alignment, 'spa gp', relearned), false);
  assert.equal(alignmentCurrent(null, 'spa gp', outline), false);
  assert.equal(alignmentCurrent({ ...alignment, angle: 'x' }, 'spa gp', outline), false);
});

// Every lap CSV the analysis reads goes through world positions; only Download My Data has the stored file as it is
test('lap reads place world coordinates, except the personal data export', () => {
  const source = readFileSync(new URL('../src/lib/collectorLaps.ts', import.meta.url), 'utf8');
  const reads = ['readCollectorLapCsv', 'readCollectorLapsById', 'readCollectorLapsByClientId'];
  for (const name of reads) {
    const body = source.slice(source.indexOf(`export async function ${name}(`));
    const end = body.indexOf('\nexport ', 10);
    assert.match(body.slice(0, end), /lapCsvText/, name);
  }
});
