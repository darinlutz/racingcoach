// Lap Compare's Tire Temperature Comparison (src/lib/tireTempComparison.ts): npm run test:tire-temps

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lapSamplesFromText, TIRE_CORNERS } from '../src/lib/lapData.ts';
import {
  compareTire,
  compareTires,
  deltaColor,
  formatCelsiusDelta,
  formatDelta,
  formatTireSpread,
  shownDelta,
  summarizeTires,
  tireChannel,
  tireDeltaSeries,
  tireSeriesReason,
  treadSpread,
} from '../src/lib/tireTempComparison.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

// A trace varying around a temperature, so it counts as continuous; the wiggle averages to zero over the whole array
const wiggle = (value, n) => Array.from({ length: n }, (_, i) => value + (i % 2 === 0 ? 0.5 : -0.5));
const steady = (value, n) => Array.from({ length: n }, () => value);
const samplePcts = (n, start = 0, end = 1) => Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));
// A place on track that's a sample of the 100-sample test laps below, as a real lap's 60 Hz samples are far closer together
const ON_SAMPLE = 50 / 99;

function tires(temps) {
  return Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, temps[corner] ?? temps.all]));
}

// A lap whose every tire reads these (or per corner); the area is the whole lap unless given
function lap({ inner = 90, middle = 92, outer = 94, n = 100, layer = 'surface', build = wiggle, pcts = samplePcts(n), sessionStart = 100, corners } = {}) {
  const trace = { inner: build(inner, n), middle: build(middle, n), outer: build(outer, n) };
  const tireTemps = tires({ all: trace, ...corners });
  return {
    lap: {
      pcts,
      tireTemps,
      tireLayers: Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, layer])),
      sessionTimes: pcts.map((_, i) => sessionStart + i / 60),
    },
    area: { pcts, tireTemps },
  };
}

test('a positive delta means the Compare lap ran hotter', () => {
  const { deltas, reason } = compareTire(lap(), lap({ inner: 95, middle: 97, outer: 99 }), 'LF', 'area', 0.5);
  assert.equal(reason, null);
  close(deltas.avg, 5);
  close(deltas.inner, 5);
  close(deltas.middle, 5);
  close(deltas.outer, 5);
});

test('a negative delta means the Compare lap ran cooler', () => {
  const { deltas } = compareTire(lap({ inner: 95, middle: 97, outer: 99 }), lap(), 'RR', 'area', 0.5);
  close(deltas.avg, -5);
});

test('equal temperatures give zero, and no extreme in the summary', () => {
  const comparisons = compareTires(lap(), lap(), 'area', 0.5);
  close(comparisons.LF.deltas.avg, 0);
  assert.equal(comparisons.LF.reason, null);
  const summary = summarizeTires(comparisons);
  assert.equal(summary.comparable, 4);
  assert.equal(summary.largestPositive, null);
  assert.equal(summary.largestNegative, null);
  assert.equal(summary.largestAbsolute, null);
  close(summary.frontAxle, 0);
});

test('MaximumDelta is the difference of the maxima, not the largest pointwise difference', () => {
  // The laps peak at different places: pointwise the gap reaches 20, but their highest readings differ by 0
  const n = 100;
  const spike = (at) => Array.from({ length: n }, (_, i) => (i === at ? 110 : i % 2 ? 90 : 90.5));
  const trace = (at) => ({ inner: spike(at), middle: spike(at), outer: spike(at) });
  const { deltas } = compareTire(lap({ corners: { LF: trace(10) } }), lap({ corners: { LF: trace(80) } }), 'LF', 'area', 0.5);
  close(deltas.max, 0);
});

test('min and max are of single readings in the scope, so a sample has its own', () => {
  const target = lap({ inner: 90, middle: 92, outer: 94, build: steady });
  target.lap.tireTemps.LF = { inner: wiggle(90, 100), middle: wiggle(92, 100), outer: wiggle(94, 100) };
  target.area.tireTemps = target.lap.tireTemps;
  const { target: reading } = compareTire(target, target, 'LF', 'sample', 0);
  close(reading.min, 90.5);
  close(reading.max, 94.5);
});

test('a missing Target or Compare lap is N/A, keeping the other lap’s reading', () => {
  const empty = lap();
  empty.area = { pcts: empty.area.pcts, tireTemps: null };
  const noTarget = compareTire(empty, lap(), 'LF', 'area', 0.5);
  assert.equal(noTarget.reason, 'noTarget');
  assert.equal(noTarget.deltas.avg, null);
  assert.notEqual(noTarget.compare.avg, null);
  assert.equal(compareTire(lap(), empty, 'LF', 'area', 0.5).reason, 'noCompare');
  assert.equal(compareTire(empty, empty, 'LF', 'area', 0.5).reason, 'noData');
});

test('missing readings are never treated as 0', () => {
  const missing = { inner: steady(NaN, 100), middle: steady(NaN, 100), outer: steady(NaN, 100) };
  const { target, reason } = compareTire(lap({ corners: { LF: missing } }), lap(), 'LF', 'sample', ON_SAMPLE);
  assert.equal(reason, 'noTarget');
  assert.deepEqual(target.segments, { inner: null, middle: null, outer: null });
});

test('partial I/M/O: edges both laps have compare; the average, min, max and spread are N/A', () => {
  const noOuter = { inner: wiggle(90, 100), middle: wiggle(92, 100), outer: steady(NaN, 100) };
  const { deltas, reason, target } = compareTire(lap({ corners: { LF: noOuter } }), lap({ inner: 93, middle: 96 }), 'LF', 'area', 0.5);
  assert.equal(reason, 'partial');
  close(deltas.inner, 3);
  close(deltas.middle, 4);
  assert.equal(deltas.outer, null);
  assert.equal(deltas.avg, null);
  assert.equal(deltas.min, null);
  assert.equal(deltas.max, null);
  assert.equal(deltas.spread, null);
  assert.equal(target.avg, null);
});

test('an edge covering too little of the scope isn’t averaged', () => {
  const sparse = wiggle(90, 100).map((v, i) => (i < 20 ? v : NaN));
  const { target } = compareTire(lap({ corners: { LF: { inner: sparse, middle: wiggle(92, 100), outer: wiggle(94, 100) } } }), lap(), 'LF', 'area', 0.5);
  assert.equal(target.segments.inner, null);
  assert.notEqual(target.segments.middle, null);
});

test('laps are matched by place on track, not by sample index', () => {
  // The Compare lap has twice the samples, so the same index is a very different place on track
  const rising = (n) => Array.from({ length: n }, (_, i) => 80 + (20 * i) / (n - 1));
  const trace = (n) => ({ inner: rising(n), middle: rising(n), outer: rising(n) });
  const target = lap({ corners: { LF: trace(100) } });
  const compare = lap({ n: 200, corners: { LF: trace(200) } });
  const { deltas, reason } = compareTire(target, compare, 'LF', 'sample', ON_SAMPLE);
  assert.equal(reason, null);
  assert.ok(deltas.avg !== null && Math.abs(deltas.avg) < 0.2, `delta ${deltas.avg} should be near 0 at the same place on track`);
  const series = tireDeltaSeries(target.area, compare.area, 'LF');
  assert.ok(series.delta.every((delta) => Number.isFinite(delta) && Math.abs(delta) < 0.2));
});

test('a lap with no sample near the crosshair is N/A rather than the nearest one', () => {
  const short = lap({ pcts: samplePcts(100, 0, 0.3) });
  const { deltas, reason } = compareTire(lap(), short, 'LF', 'sample', 0.9);
  assert.equal(reason, 'misaligned');
  assert.equal(deltas.avg, null);
  const series = tireDeltaSeries(lap().area, short.area, 'LF');
  assert.ok(Number.isNaN(series.delta[series.delta.length - 1]));
  assert.ok(Number.isFinite(series.delta[0]));
});

test('a held pit reading is a snapshot: shown, never subtracted, and has no trace', () => {
  const snapshot = lap({ layer: 'carcass', build: steady, inner: 70, middle: 71, outer: 72 });
  assert.equal(tireChannel(snapshot.lap, 'LF').continuous, false);
  assert.equal(tireChannel(lap().lap, 'LF').continuous, true);
  for (const scope of ['sample', 'area', 'lap']) {
    const { deltas, reason, target } = compareTire(snapshot, snapshot, 'LF', scope, ON_SAMPLE);
    assert.equal(reason, 'snapshot');
    assert.equal(deltas.avg, null);
    close(target.avg, 71);
  }
  assert.equal(tireSeriesReason(snapshot, snapshot, 'LF'), 'snapshot');
});

test('surface and carcass temperatures are never compared', () => {
  const carcass = lap({ layer: 'carcass' });
  assert.equal(compareTire(lap(), carcass, 'LF', 'area', 0.5).reason, 'layerMismatch');
  assert.equal(compareTire(carcass, lap(), 'LF', 'lap', 0.5).deltas.avg, null);
  assert.equal(tireSeriesReason(lap(), carcass, 'LF'), 'layerMismatch');
  // Two continuous carcass laps (from an .ibt) are the same kind of measurement
  assert.equal(compareTire(carcass, carcass, 'LF', 'area', 0.5).reason, null);
});

test('scopes don’t mix: Sample reads the crosshair, Lap the whole lap, Focus area only the area', () => {
  const n = 100;
  const pcts = samplePcts(n);
  const rising = Array.from({ length: n }, (_, i) => 80 + (20 * i) / (n - 1));
  const input = (offset) => {
    const shifted = { inner: rising.map((v) => v + offset), middle: rising.map((v) => v + offset), outer: rising.map((v) => v + offset) };
    return {
      lap: { pcts, tireTemps: tires({ all: shifted }), tireLayers: Object.fromEntries(TIRE_CORNERS.map((c) => [c, 'surface'])), sessionTimes: pcts.map((_, i) => 500 + i) },
      area: { pcts: pcts.slice(0, 10), tireTemps: tires({ all: { inner: rising.slice(0, 10), middle: rising.slice(0, 10), outer: rising.slice(0, 10) } }) },
    };
  };
  const a = input(0);
  const b = input(3);
  const lapScope = compareTire(a, b, 'LF', 'lap', 0.05);
  const areaScope = compareTire(a, b, 'LF', 'area', 0.05);
  const sampleScope = compareTire(a, b, 'LF', 'sample', 0.05);
  close(lapScope.deltas.avg, 3);
  close(areaScope.deltas.avg, 0);
  close(lapScope.target.avg, 90);
  assert.ok(areaScope.target.avg < 82);
  // Only the sample has a timestamp
  assert.equal(lapScope.targetSessionTime, null);
  assert.equal(areaScope.targetSessionTime, null);
  assert.equal(sampleScope.targetSessionTime, 505);
});

test('the session scope is N/A: Lap Compare only has two laps', () => {
  const { reason, deltas, target } = compareTire(lap(), lap(), 'LF', 'session', 0.5);
  assert.equal(reason, 'session');
  assert.equal(deltas.avg, null);
  assert.equal(target.avg, null);
});

test('the cursor changes a sample’s deltas, and changing a lap changes them at once', () => {
  const n = 100;
  const rising = Array.from({ length: n }, (_, i) => 80 + (20 * i) / (n - 1));
  const rise = { inner: rising, middle: rising, outer: rising };
  const flat = lap({ inner: 90, middle: 90, outer: 90 });
  const risingLap = lap({ corners: { LF: rise } });
  const early = compareTire(flat, risingLap, 'LF', 'sample', 0).deltas.avg;
  const late = compareTire(flat, risingLap, 'LF', 'sample', 1).deltas.avg;
  assert.ok(early < 0);
  assert.ok(late > 0);
  const other = lap({ inner: 100, middle: 100, outer: 100 });
  assert.ok(compareTire(flat, other, 'LF', 'sample', 0).deltas.avg > 9);
});

test('spread is the absolute inner to outer difference, and its delta Compare minus Target', () => {
  assert.equal(treadSpread({ inner: 90, middle: 92, outer: 96 }), 6);
  assert.equal(treadSpread({ inner: 96, middle: 92, outer: 90 }), 6);
  assert.equal(treadSpread({ inner: null, middle: 92, outer: 90 }), null);
  const { deltas, targetSpread, compareSpread } = compareTire(lap({ inner: 90, outer: 94 }), lap({ inner: 100, outer: 90 }), 'LF', 'area', 0.5);
  close(targetSpread, 4);
  close(compareSpread, 10);
  close(deltas.spread, 6);
});

test('the summary uses only comparable tires, and an axle needs both of its', () => {
  const cold = { inner: wiggle(85, 100), middle: wiggle(87, 100), outer: wiggle(89, 100) }; // -5
  const noData = { inner: steady(NaN, 100), middle: steady(NaN, 100), outer: steady(NaN, 100) };
  const compare = lap({ inner: 100, middle: 102, outer: 104, corners: { RF: cold, RR: noData } }); // +10 on the others
  const summary = summarizeTires(compareTires(lap(), compare, 'area', 0.5));
  assert.equal(summary.comparable, 3);
  assert.equal(summary.largestPositive.corner, 'LF');
  close(summary.largestPositive.delta, 10);
  assert.equal(summary.largestNegative.corner, 'RF');
  close(summary.largestNegative.delta, -5);
  close(summary.largestAbsolute.delta, 10);
  close(summary.frontAxle, 2.5);
  assert.equal(summary.rearAxle, null);
  assert.equal(summary.largestSpread, null);
});

test('largest spread difference keeps its sign', () => {
  const narrow = lap({ inner: 92, middle: 92, outer: 92 });
  const wide = { inner: wiggle(85, 100), middle: wiggle(92, 100), outer: wiggle(99, 100) };
  const summary = summarizeTires(compareTires(lap({ corners: { LR: wide } }), narrow, 'area', 0.5));
  assert.equal(summary.largestSpread.corner, 'LR');
  close(summary.largestSpread.delta, -14);
});

test('units: a delta and a spread convert without °F’s offset', () => {
  assert.equal(formatCelsiusDelta(10, 'standard', 'en-US'), '+18.0°');
  assert.equal(formatCelsiusDelta(10, 'metric', 'en-US'), '+10.0°');
  assert.equal(formatCelsiusDelta(-5, 'standard', 'en-US'), '−9.0°');
  assert.equal(formatTireSpread(5, 'standard', 'en-US'), '9.0°');
  // As the two temperatures read on screen: 90.04 and 91.26 read 90.0 and 91.3, shown 1.3 apart
  assert.equal(shownDelta(91.26, 90.04, 'metric'), 1.3);
  assert.equal(shownDelta(90, 90, 'standard'), 0);
  assert.equal(formatDelta(0, 'en-US'), '0.0°');
  assert.equal(formatDelta(-0.04, 'en-US'), '0.0°');
  assert.equal(formatCelsiusDelta(1.5, 'metric', 'de'), '+1,5°');
});

test('the delta color scale is symmetric and centered on zero', () => {
  assert.match(deltaColor(0), /0%/);
  assert.match(deltaColor(10), /var\(--delta-hot\) 100%/);
  assert.match(deltaColor(-10), /var\(--delta-cool\) 100%/);
  assert.match(deltaColor(50), /100%/);
  assert.equal(deltaColor(5).replace('--delta-hot', 'X'), deltaColor(-5).replace('--delta-cool', 'X'));
});

test('the lap file parser says which layer a tire’s temperatures are, and reads SessionTime', () => {
  const row = (values) => values.join(',');
  const surface = lapSamplesFromText(
    [
      row(['LapDistPct', 'SessionTime', 'LFtempL', 'LFtempM', 'LFtempR', 'LFtempCL', 'LFtempCM', 'LFtempCR']),
      row([0.1, 500.5, 80, 81, 82, 70, 71, 72]),
    ].join('\n')
  );
  assert.equal(surface.tireLayers.LF, 'surface');
  assert.equal(surface.tireLayers.RF, null);
  assert.equal(surface.sessionTimes[0], 500.5);
  // Outer is the left column on left tires
  assert.equal(surface.tireTemps.LF.outer[0], 80);
  assert.equal(surface.tireTemps.LF.inner[0], 82);

  const carcass = lapSamplesFromText([row(['LapDistPct', 'RRtempCL', 'RRtempCM', 'RRtempCR']), row([0.1, 70, 71, 72])].join('\n'));
  assert.equal(carcass.tireLayers.RR, 'carcass');
  assert.ok(Number.isNaN(carcass.sessionTimes[0]));
  // Outer is the right column on right tires
  assert.equal(carcass.tireTemps.RR.outer[0], 72);
});
