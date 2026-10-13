// Calibrates the Rotation Model for one car from recorded laps, and checks iRacing's telemetry conventions.
// See rotation-model/README.md (Calibration, Validation).
//
//   node scripts/rotation-calibrate.mjs --car "Porsche 911 GT3 R (992)" --db [--limit 40]
//   node scripts/rotation-calibrate.mjs --car "Porsche 911 GT3 R (992)" path\to\laps-folder lap.csv ...
//
// Options:
//   --db              read the car's uploaded laps from DATABASE_URL (read-only; .env.local is used if set there)
//   --limit <n>       laps to read with --db (default 40, most recent first, off-track laps left out)
//   --car-id <id>     iRacing's CarPath for the car (e.g. porsche992rgt3), so the collector matches it exactly
//   --wheelbase <m>   the car's wheelbase, to also report the effective steering ratio it implies
//   --write           add (or replace) the car in rotation-model/calibrations.json
//
// It never fits from laps it can't trust: only steady, non-saturated cornering (no brakes, low steering and yaw
// rate changes, under half the car's peak lateral acceleration, small sideslip when known) counts as the car's
// normal response, so spins, slides and the limit itself aren't learned as normal.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { rotationSamplesFromCsv, analyzeRotationLap } from '../src/lib/rotationAnalysis.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'rotation-model', 'config.json'), 'utf8'));
const calibrationsPath = join(root, 'rotation-model', 'calibrations.json');

// Steady, non-saturated cornering only
const FIT = {
  minSteerRad: 0.02,
  maxSteerRateRadPerSec: 0.3,
  maxYawAccelRadPerSec2: 0.15,
  maxBrake: 0.05,
  maxLongAccelMps2: 3,
  maxLatAccelShareOfPeak: 0.5,
  maxSideslipDeg: 3,
  maxVertDeviationMps2: 3,
  binMps: 5,
  minBinSamples: 60, // a second of steady cornering
};

function parseArgs(argv) {
  const options = { files: [], limit: 40 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--car') options.car = argv[++i];
    else if (a === '--car-id') options.carId = argv[++i];
    else if (a === '--wheelbase') options.wheelbase = Number(argv[++i]);
    else if (a === '--limit') options.limit = Number(argv[++i]);
    else if (a === '--db') options.db = true;
    else if (a === '--write') options.write = true;
    else options.files.push(a);
  }
  return options;
}

function csvFiles(path) {
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((f) => csvFiles(join(path, f)));
  return extname(path).toLowerCase() === '.csv' ? [path] : [];
}

async function lapsFromDb(car, limit) {
  let url = process.env.DATABASE_URL;
  const envFile = join(root, '.env.local');
  if (!url && existsSync(envFile)) url = readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!url) throw new Error('DATABASE_URL is not set');
  const pg = createRequire(join(root, 'package.json'))('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, lap_number, csv_gzip FROM racingcoach."CollectorLaps"
        WHERE lower(car) = lower($1) AND NOT off_track ORDER BY recorded_at DESC LIMIT $2`,
      [car, limit]
    );
    return rows.map((r) => ({ id: r.id, lapNumber: r.lap_number, csv: gunzipSync(r.csv_gzip).toString('utf8') }));
  } finally {
    await client.end();
  }
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const fmt = (x, digits = 3) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(digits));

// Least-squares slope through the origin and correlation of y on x
function fitThroughOrigin(xs, ys) {
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
    syy += ys[i] * ys[i];
  }
  return { slope: sxx ? sxy / sxx : null, correlation: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n: xs.length };
}

// Checks iRacing's conventions against the data: signs, and whether VelocityX/Y are in the car's frame
function checkConventions(laps) {
  const steerYaw = [];
  const latX = [], latY = [];
  const yawDot = [], yawRates = [];
  const bodyErr = [], worldErr = [];
  for (const { samples } of laps) {
    for (let i = 1; i < samples.length - 1; i++) {
      const s = samples[i];
      const p = samples[i - 1];
      const n = samples[i + 1];
      if (s.speed === null || s.speed < config.validity.minSpeedMps || s.yawRate === null || s.steeringWheelAngle === null) continue;
      if (Math.abs(s.yawRate) > 0.1 && Math.abs(s.steeringWheelAngle) > 0.05) steerYaw.push(Math.sign(s.yawRate) === Math.sign(s.steeringWheelAngle) ? 1 : 0);
      if (s.latAccel !== null && Math.abs(s.speed * s.yawRate) > 3) {
        latX.push(s.speed * s.yawRate);
        latY.push(s.latAccel);
      }
      if (s.yaw !== null && p.yaw !== null && n.yaw !== null && n.time !== null && p.time !== null && n.time > p.time) {
        let d = n.yaw - p.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        yawDot.push(d / (n.time - p.time));
        yawRates.push(s.yawRate);
      }
      if (s.velocityX !== null && s.velocityY !== null) {
        bodyErr.push(Math.abs(s.velocityX - s.speed) / s.speed);
        if (s.yaw !== null) {
          const vf = s.velocityX * Math.cos(s.yaw) + s.velocityY * Math.sin(s.yaw);
          worldErr.push(Math.abs(vf - s.speed) / s.speed);
        }
      }
    }
  }
  const agree = steerYaw.length ? steerYaw.reduce((a, b) => a + b, 0) / steerYaw.length : null;
  const lat = fitThroughOrigin(latX, latY);
  const yaw = fitThroughOrigin(yawRates, yawDot);
  console.log('\nConventions (iRacing telemetry vs the model\'s assumptions)');
  console.log(`  SteeringWheelAngle and YawRate have the same sign in ${fmt(agree === null ? null : agree * 100, 1)}% of turning samples (n=${steerYaw.length}).`);
  console.log(`    → conventions.steeringSign should be ${agree === null ? '(no data)' : agree > 0.9 ? '1 (as configured)' : agree < 0.1 ? '-1' : 'unclear: check the data'}`);
  console.log(`  LatAccel ≈ ${fmt(lat.slope)} × Speed·YawRate (correlation ${fmt(lat.correlation)}, n=${lat.n}).`);
  console.log(`    → LatAccel is ${lat.slope === null ? '(no data)' : Math.abs(Math.abs(lat.slope) - 1) < 0.2 && Math.abs(lat.correlation) > 0.9 ? `kinematic, sign ${Math.sign(lat.slope)} (latAccelSign "auto" finds this)` : 'NOT a clean v·r: check gravity/frame before trusting the residual check'}`);
  console.log(`  d(Yaw)/dt ≈ ${fmt(yaw.slope)} × YawRate (correlation ${fmt(yaw.correlation)}, n=${yaw.n}).`);
  if (bodyErr.length) {
    console.log(`  VelocityX vs Speed: median relative difference ${fmt(median(bodyErr) * 100, 2)}% as the car's forward velocity (body frame), ${fmt(worldErr.length ? median(worldErr) * 100 : null, 2)}% after rotating by Yaw (world frame).`);
    const body = median(bodyErr);
    const world = worldErr.length ? median(worldErr) : Infinity;
    console.log(`    → conventions.velocityFrame should be ${body < 0.05 && body < world ? '"body" (as configured)' : world < 0.05 ? '"world"' : 'unclear: neither matches Speed'}`);
  } else {
    console.log('  VelocityX/VelocityY: not in these laps (recorded before the collector saved them), so the velocity frame and sideslip can\'t be checked.');
  }
}

function fit(laps) {
  // Peak lateral acceleration of the car in these laps (98th percentile, so a single spike doesn't count)
  const lateral = laps.flatMap(({ samples }) => samples.filter((s) => s.speed !== null && s.yawRate !== null).map((s) => Math.abs(s.latAccel ?? s.speed * s.yawRate)));
  const peak = percentile(lateral, 98) ?? 0;
  const bins = new Map();
  let used = 0;
  for (const { samples } of laps) {
    for (let i = 1; i < samples.length - 1; i++) {
      const s = samples[i];
      const p = samples[i - 1];
      const n = samples[i + 1];
      if ([s.time, p.time, n.time, s.speed, s.steeringWheelAngle, s.yawRate, p.steeringWheelAngle, n.steeringWheelAngle, p.yawRate, n.yawRate].some((x) => x === null)) continue;
      const dt = n.time - p.time;
      if (!(dt > 0 && dt < 0.1)) continue;
      const steer = s.steeringWheelAngle * config.conventions.steeringSign;
      if (s.speed < config.validity.minSpeedMps || Math.abs(steer) < FIT.minSteerRad || Math.abs(s.yawRate) < config.validity.minTurnYawRate) continue;
      if (Math.sign(steer) !== Math.sign(s.yawRate)) continue;
      if (Math.abs((n.steeringWheelAngle - p.steeringWheelAngle) / dt) > FIT.maxSteerRateRadPerSec) continue;
      if (Math.abs((n.yawRate - p.yawRate) / dt) > FIT.maxYawAccelRadPerSec2) continue;
      if ((s.brake ?? 0) > FIT.maxBrake || Math.abs(s.longAccel ?? 0) > FIT.maxLongAccelMps2) continue;
      if (Math.abs(s.latAccel ?? s.speed * s.yawRate) > FIT.maxLatAccelShareOfPeak * peak) continue;
      if (s.vertAccel !== null && Math.abs(s.vertAccel - 9.81) > FIT.maxVertDeviationMps2) continue;
      if (s.velocityX !== null && s.velocityY !== null && Math.abs(Math.atan2(s.velocityY, s.velocityX)) * (180 / Math.PI) > FIT.maxSideslipDeg) continue;
      const bin = Math.floor(s.speed / FIT.binMps);
      if (!bins.has(bin)) bins.set(bin, { speeds: [], gains: [] });
      bins.get(bin).speeds.push(s.speed);
      bins.get(bin).gains.push(s.yawRate / steer);
      used++;
    }
  }
  const table = [...bins.entries()]
    .filter(([, b]) => b.gains.length >= FIT.minBinSamples)
    .sort((a, b) => a[0] - b[0])
    .map(([bin, b]) => ({
      bin,
      speed: median(b.speeds),
      gain: median(b.gains),
      spread: (percentile(b.gains, 75) - percentile(b.gains, 25)) / median(b.gains),
      n: b.gains.length,
    }));
  // v / gain = Rs·L + Rs·Ku·v², least squares weighted by samples
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const row of table) {
    const x = row.speed * row.speed;
    const y = row.speed / row.gain;
    sw += row.n; sx += row.n * x; sy += row.n * y; sxx += row.n * x * x; sxy += row.n * x * y;
  }
  const det = sw * sxx - sx * sx;
  const b = table.length >= 2 && det !== 0 ? (sw * sxy - sx * sy) / det : 0;
  const a = table.length >= 2 && det !== 0 ? (sy - b * sx) / sw : table.length === 1 ? table[0].speed / table[0].gain : null;
  return { table, a, b, peak, used };
}

const options = parseArgs(process.argv.slice(2));
if (!options.car || (!options.db && options.files.length === 0)) {
  console.error('Usage: node scripts/rotation-calibrate.mjs --car "<iRacing car name>" (--db | <csv files or folders>) [--car-id <CarPath>] [--wheelbase <m>] [--write]');
  process.exit(1);
}

const raw = options.db
  ? await lapsFromDb(options.car, options.limit)
  : options.files.flatMap(csvFiles).map((path) => ({ id: path, lapNumber: null, csv: readFileSync(path, 'utf8') }));
const laps = raw.map((lap) => ({ ...lap, ...rotationSamplesFromCsv(lap.csv) })).filter((lap) => lap.missing.length === 0);
console.log(`${options.car}: ${raw.length} laps read, ${laps.length} with the columns the model needs.`);
if (laps.length === 0) process.exit(1);

checkConventions(laps);

const result = fit(laps);
console.log(`\nNormal (steady, non-saturated) yaw response: ${result.used} samples, peak lateral acceleration ${fmt(result.peak, 1)} m/s²`);
console.log('  speed (m/s)  yaw rate per rad of wheel  spread (IQR)  samples  fit');
for (const row of result.table) {
  const fitted = result.a !== null ? row.speed / (result.a + result.b * row.speed * row.speed) : null;
  console.log(`  ${fmt(row.speed, 1).padStart(10)}  ${fmt(row.gain, 4).padStart(24)}  ${fmt(row.spread * 100, 0).padStart(10)}%  ${String(row.n).padStart(7)}  ${fmt(fitted, 4)}`);
}
if (result.a === null || !(result.a > 0) || result.table.length < 2) {
  console.log('\nNot enough clean, steady cornering at two or more speeds to calibrate this car. Drive more laps (or check the conventions above).');
  process.exit(1);
}
console.log(`\nRs·L = ${fmt(result.a, 2)} m, Rs·Ku = ${fmt(result.b, 5)} s²`);
if (Number.isFinite(options.wheelbase) && options.wheelbase > 0) {
  console.log(`With a ${options.wheelbase} m wheelbase: effective steering ratio ${fmt(result.a / options.wheelbase, 1)}:1, Ku ${fmt(result.b / (result.a / options.wheelbase), 5)} s²/m`);
}

const speeds = result.table.map((r) => r.speed);
const calibration = {
  calibrationId: `${(options.carId ?? options.car).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}`,
  calibrationVersion: '1.0.0',
  carId: options.carId ?? null,
  carNames: [options.car],
  wheelbaseMeters: Number.isFinite(options.wheelbase) && options.wheelbase > 0 ? options.wheelbase : null,
  steeringRatio: null,
  cgToFrontAxleMeters: null,
  cgToRearAxleMeters: null,
  understeerGradient: null,
  effectiveSteerLength: Math.round(result.a * 1000) / 1000,
  effectiveUndersteerTerm: Math.round(result.b * 1e6) / 1e6,
  yawReferenceModel: 'identified-bicycle',
  yawGainMap: result.table.map((r) => ({ speedMps: Math.round(r.speed * 10) / 10, gainPerRad: Math.round(r.gain * 1e4) / 1e4 })),
  // A little past the speeds the fit saw, no further
  validSpeedRangeMps: [Math.max(config.validity.minSpeedMps, Math.floor(Math.min(...speeds) - FIT.binMps)), Math.ceil(Math.max(...speeds) + FIT.binMps)],
  overrides: null,
  source: `rotation-calibrate.mjs: ${laps.length} laps, ${result.used} steady samples, ${new Date().toISOString().slice(0, 10)}`,
};

// How the calibrated model sees these same laps: the spread of normal yaw response, and event counts to tune with
const deficits = [];
const sideslips = [];
let events = 0, understeer = 0, oversteer = 0, valid = 0, total = 0;
for (const lap of laps) {
  const analysis = analyzeRotationLap(lap, config, calibration);
  events += analysis.events.length;
  understeer += analysis.summary.understeerEvents;
  oversteer += analysis.summary.oversteerEvents;
  valid += analysis.validShare * lap.samples.length;
  total += lap.samples.length;
}
for (const lap of laps) {
  for (const s of lap.samples) {
    if (s.velocityX !== null && s.velocityY !== null && s.speed !== null && s.speed >= config.validity.minSpeedMps) sideslips.push(Math.atan2(s.velocityY, s.velocityX) * (180 / Math.PI));
    if (s.speed !== null && s.yawRate !== null && s.steeringWheelAngle !== null && s.speed >= config.validity.minSpeedMps) {
      const ref = (s.speed * s.steeringWheelAngle) / (result.a + result.b * s.speed * s.speed);
      if (Math.abs(ref) >= config.validity.minTurnYawRate) deficits.push(1 - s.yawRate / ref);
    }
  }
}
console.log(`\nWith this calibration, on these laps: ${fmt((valid / Math.max(total, 1)) * 100, 0)}% of samples judged, ${understeer} understeer and ${oversteer} oversteer events (${fmt(events / laps.length, 1)} per lap).`);
console.log(`  Yaw deficit (1 - actual/expected) in turns: p10 ${fmt(percentile(deficits, 10))}, median ${fmt(median(deficits))}, p90 ${fmt(percentile(deficits, 90))}; understeer evidence starts at ${config.understeer.yawDeficitStart}, oversteer at ${-config.oversteer.yawExcessStart}.`);
if (sideslips.length) console.log(`  Sideslip (°): p5 ${fmt(percentile(sideslips, 5), 1)}, median ${fmt(median(sideslips), 1)}, p95 ${fmt(percentile(sideslips, 95), 1)}; oversteer sideslip evidence starts at ${config.oversteer.sideslipStartDeg}° outward.`);
console.log('  Review the events against the laps before trusting them (rotation-model/README.md, Validation).');

console.log('\n' + JSON.stringify(calibration, null, 2));
if (options.write) {
  const file = JSON.parse(readFileSync(calibrationsPath, 'utf8'));
  file.calibrations = file.calibrations.filter(
    (c) => !(c.carNames.some((n) => n.toLowerCase() === options.car.toLowerCase()) || (options.carId && c.carId === options.carId))
  );
  file.calibrations.push(calibration);
  writeFileSync(calibrationsPath, JSON.stringify(file, null, 2) + '\n');
  console.log(`\nSaved to ${calibrationsPath}. Run npm run test:rotation, then release the collector so it builds the calibration in.`);
}
