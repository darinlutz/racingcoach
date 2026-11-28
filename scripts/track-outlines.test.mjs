// Live Racing's outline from several laps (src/lib/trackOutlineMedian.ts): npm run test:track-outlines

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianOutline, MIN_MEDIAN_LAPS } from '../src/lib/trackOutlineMedian.ts';
import { outlineLengthFeet, outlinePlausible } from '../src/lib/trackDataTrust.ts';

const POINTS = 500;
const CENTER = [34.8433, 136.5405];
// A circle about 1 km across, its point i at i / POINTS of the lap; off is [from, to, degrees] where the lap ran wide
function lap(off = null) {
  return {
    kind: 'latlon',
    points: Array.from({ length: POINTS }, (_, i) => {
      const a = (2 * Math.PI * i) / POINTS;
      const wide = off && i >= off[0] && i < off[1] ? off[2] : 0;
      const r = 0.0045 + wide;
      return [CENTER[0] + r * Math.sin(a), CENTER[1] + (r * Math.cos(a)) / Math.cos((CENTER[0] * Math.PI) / 180)];
    }),
  };
}

test('every lap off the track at a different place gives the clean outline', () => {
  const laps = [lap([20, 40, 0.0006]), lap([150, 170, 0.0008]), lap([300, 320, 0.0005]), lap([420, 440, 0.0007])];
  const median = medianOutline(laps);
  const clean = lap();
  assert.ok(median);
  const worst = Math.max(...median.points.map((p, i) => Math.hypot(p[0] - clean.points[i][0], p[1] - clean.points[i][1])));
  assert.ok(worst < 1e-6, `strays ${worst} degrees`);
  const length = outlineLengthFeet(clean.points);
  assert.ok(outlinePlausible(median.points, length, CENTER));
});

test('needs at least MIN_MEDIAN_LAPS laps of the same size', () => {
  assert.equal(MIN_MEDIAN_LAPS, 3);
  assert.equal(medianOutline([lap(), lap()]), null);
  assert.equal(medianOutline([]), null);
  assert.equal(medianOutline([lap(), lap(), { kind: 'latlon', points: lap().points.slice(1) }]), null);
  assert.ok(medianOutline([lap(), lap(), lap()]));
});

test('an approximate (meters) outline is never mixed in', () => {
  assert.equal(medianOutline([lap(), lap(), { kind: 'meters', points: lap().points }]), null);
});
