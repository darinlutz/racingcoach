// Shared helpers for reading Garage 61 lap CSVs and measuring focus areas
// (used by the Multi-Lap Analysis and Lap Compare tabs).

import type { TrackBounds } from './trackLocations';

// start/end are fractions of a lap (LapDistPct); brakepointTarget and throttlePickupTarget are in
// feet; maxBrakeTarget is a percent. The targets come only from the user's Target Lap (targetLapTargets.ts);
// each is null without one of this track, or when it has none in the area
export type Area = {
  name: string;
  start: number | null;
  end: number | null;
  brakepointTarget: number | null;
  maxBrakeTarget: number | null;
  throttlePickupTarget: number | null;
};
// location and bounds: where the track is, for Lap Compare's satellite picture (TrackSatellite)
export type Track = {
  name: string;
  fileName: string;
  lengthFeet: number | null;
  areas: Area[];
  location?: { latitude: number; longitude: number } | null;
  bounds?: TrackBounds | null;
};

export type LapFile = {
  file: File;
  driverName: string;
  carName: string;
  trackName: string;
  lapTime: string;
  fileId: string;
};

const MAX_CSV_BYTES = 25 * 1024 * 1024;

// Garage 61 - {driverName} - {carName} - {trackName} - {lapTime} - {uniqueFileID}.csv
const FILE_NAME_PATTERN = /^Garage 61 - (.+?) - (.+?) - (.+) - (\d+\.\d{2}\.\d{3}) - ([A-Za-z0-9]+)\.csv$/i;

// P2PActive is left out on purpose: some files don't have it, and it's ignored when present.
const EXPECTED_COLUMNS = [
  'Speed', 'LapDistPct', 'Lat', 'Lon', 'Brake', 'Throttle', 'RPM', 'SteeringWheelAngle', 'Gear',
  'Clutch', 'ABSActive', 'DRSActive', 'LatAccel', 'LongAccel', 'VertAccel', 'Yaw',
  'YawRate', 'PositionType',
];

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Track names from Track Data, Garage 61 and iRacing (the RacingCoach collector) can differ slightly, e.g.
// "Circuit de Spa-Francorchamps (Grand Prix Pits)" and "(Grand Prix Pit)", so compare them ignoring case,
// punctuation and a plural "s"
function normalizeTrackName(name: string) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
    .join(' ');
}

export function sameTrackName(a: string, b: string) {
  return normalizeTrackName(a) === normalizeTrackName(b);
}

// 78.683 -> "01.18.683", the lap time format in lap file names
export function secondsToLapTime(seconds: number) {
  const millis = Math.round(seconds * 1000);
  const minutes = Math.floor(millis / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}.${String(secs).padStart(2, '0')}.${String(millis % 1000).padStart(3, '0')}`;
}

// "01.18.683" -> 78.683
export function lapTimeToSeconds(lapTime: string) {
  const [minutes, seconds, millis] = lapTime.split('.').map(Number);
  return minutes * 60 + seconds + millis / 1000;
}

// "01.18.683" -> "1:18.683"
export function formatLapTime(lapTime: string) {
  const [minutes, seconds, millis] = lapTime.split('.');
  return `${Number(minutes)}:${seconds}.${millis}`;
}

// Added to the AI coaches' prompts; the data they're given already writes lap times this way (formatSeconds in
// stintExport.ts), and this keeps lap times the model works out itself (e.g. a theoretical lap) the same
export const LAP_TIME_RULE =
  ' Write every whole-lap time (a lap, or the best, average, worst or theoretical lap) in minutes, seconds and ' +
  'thousandths, e.g. "2:10.568", never as a number of seconds such as "130.568 s". Times through a focus area or ' +
  'part of the lap, gaps between laps and standard deviations stay in seconds, e.g. "0.452 s".';

// speeds are in m/s, as exported by Garage 61
export const MPH_PER_METER_PER_SECOND = 2.23694;

// steerings is SteeringWheelAngle in radians, positive to the left (0 where the CSV has none).
// lats/lons are the car's position in degrees; NaN where the CSV has none (laps the collector hasn't
// added positions to yet, see IbtEnricher.cs). alts is the car's altitude (m), NaN where the CSV has none. yaws is iRacing's Yaw (radians, NaN where the CSV has none).
export type LapSamples = {
  pcts: number[];
  brakes: number[];
  speeds: number[];
  throttles: number[];
  steerings: number[];
  lats: number[];
  lons: number[];
  alts: number[];
  yaws: number[];
  // RPM and Gear (NaN when the lap file has no such column)
  rpms: number[];
  gears: number[];
  // YawRate (rad/s, positive turning left) and VelocityX/VelocityY (m/s in the car's frame: forward and left),
  // NaN when the lap file has no such column (Garage 61 exports and laps from collectors before the Rotation
  // Model have no VelocityX/VelocityY)
  yawRates: number[];
  velocityXs: number[];
  velocityYs: number[];
  // Each tire's surface temperatures, or carcass ones in laps without them (°C, NaN when the lap file has neither),
  // and which those are for each tire (null when it has neither)
  tireTemps: Record<TireCorner, TireTemps>;
  tireLayers: Record<TireCorner, TireLayer | null>;
  // iRacing's SessionTime (s, NaN when the lap file has no such column, as Garage 61 exports don't)
  sessionTimes: number[];
  // Each tire's pressure (kPa, NaN when the lap file has no such column)
  tirePressures: Record<TireCorner, number[]>;
  // Each corner's ride height (m, NaN when the lap file has no such column)
  rideHeights: Record<TireCorner, number[]>;
  // Water and oil temperatures (°C), fuel left (kg) and fuel use (kg/h), NaN when the lap file has no such column
  engine: EngineSamples;
};

export type EngineSamples = { waterTemps: number[]; oilTemps: number[]; fuelKgs: number[]; fuelKgPerHour: number[] };

// The fuel density used when a lap file has FuelLevel but not the car's FuelKgPerLtr: iRacing's usual petrol
const DEFAULT_FUEL_KG_PER_LTR = 0.75;

export const TIRE_CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
export type TireCorner = (typeof TIRE_CORNERS)[number];

// A tire's outer, middle and inner temperatures (°C), one per sample
export type TireTemps = { outer: number[]; middle: number[]; inner: number[] };
export type TireLayer = 'surface' | 'carcass';

// iRacing's tire temperature columns go left, middle, right across the tire, so the outer edge is the left one
// on the left-side tires and the right one on the right-side tires. The surface ones (LFtempL, LFtempM, LFtempR,
// ...) are only in .ibt files, which the collector copies them from after each stint; laps without them use the
// carcass ones (LFtempCL, LFtempCM, LFtempCR, ...), which live telemetry only updates in the pit stall.
function tireTempColumns(corner: TireCorner, header: string[]): Record<keyof TireTemps, string> {
  const [outer, inner] = corner[0] === 'L' ? ['L', 'R'] : ['R', 'L'];
  const layer = header.includes(`${corner}tempM`) ? '' : 'C';
  return { outer: `${corner}temp${layer}${outer}`, middle: `${corner}temp${layer}M`, inner: `${corner}temp${layer}${inner}` };
}

function tireLayer(corner: TireCorner, header: string[]): TireLayer | null {
  if (header.includes(`${corner}tempM`)) return 'surface';
  return header.includes(`${corner}tempCM`) ? 'carcass' : null;
}

// Brake (0-1) above this counts as the driver being on the brakes
export const BRAKE_THRESHOLD = 0;

// Throttle (0-1) at or above this counts as the driver being back on the power
export const THROTTLE_THRESHOLD = 0.1;

// Reads the LapDistPct, Brake, Throttle, Speed, SteeringWheelAngle, Lat, Lon, Alt, Yaw, YawRate, VelocityX, VelocityY, RPM, Gear, tire temperature, tire pressure, ride height and engine columns. LapDistPct is unwrapped so it keeps
// increasing past the start/finish line (e.g. 0.999 -> 1.001 instead of 0.001).
export async function readLapSamples(file: File): Promise<LapSamples> {
  return lapSamplesFromText(await file.text());
}

// readLapSamples for a CSV already read into a string (e.g. a collector lap on the server)
export function lapSamplesFromText(text: string): LapSamples {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((c) => c.trim());
  const pctColumn = header.indexOf('LapDistPct');
  const brakeColumn = header.indexOf('Brake');
  const speedColumn = header.indexOf('Speed');
  const throttleColumn = header.indexOf('Throttle');
  const steeringColumn = header.indexOf('SteeringWheelAngle');
  const latColumn = header.indexOf('Lat');
  const lonColumn = header.indexOf('Lon');
  const altColumn = header.indexOf('Alt');
  const yawColumn = header.indexOf('Yaw');
  const rpmColumn = header.indexOf('RPM');
  const gearColumn = header.indexOf('Gear');
  const yawRateColumn = header.indexOf('YawRate');
  const velocityXColumn = header.indexOf('VelocityX');
  const velocityYColumn = header.indexOf('VelocityY');
  const sessionTimeColumn = header.indexOf('SessionTime');
  const pcts: number[] = [];
  const brakes: number[] = [];
  const speeds: number[] = [];
  const throttles: number[] = [];
  const steerings: number[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  const alts: number[] = [];
  const yaws: number[] = [];
  const rpms: number[] = [];
  const gears: number[] = [];
  const yawRates: number[] = [];
  const velocityXs: number[] = [];
  const velocityYs: number[] = [];
  const sessionTimes: number[] = [];
  const tireLayers = Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, tireLayer(corner, header)])) as Record<TireCorner, TireLayer | null>;
  const tireTemps = Object.fromEntries(
    TIRE_CORNERS.map((corner): [TireCorner, TireTemps] => [corner, { outer: [], middle: [], inner: [] }])
  ) as Record<TireCorner, TireTemps>;
  const tireColumns = TIRE_CORNERS.flatMap((corner) =>
    Object.entries(tireTempColumns(corner, header)).map(([edge, name]) => ({
      values: tireTemps[corner][edge as keyof TireTemps],
      column: header.indexOf(name),
    }))
  );
  const tirePressures = Object.fromEntries(
    TIRE_CORNERS.map((corner): [TireCorner, number[]] => [corner, []])
  ) as Record<TireCorner, number[]>;
  const rideHeights = Object.fromEntries(
    TIRE_CORNERS.map((corner): [TireCorner, number[]] => [corner, []])
  ) as Record<TireCorner, number[]>;
  for (const corner of TIRE_CORNERS) {
    tireColumns.push(
      { values: tirePressures[corner], column: header.indexOf(`${corner}pressure`) },
      { values: rideHeights[corner], column: header.indexOf(`${corner}rideHeight`) }
    );
  }
  const engine: EngineSamples = { waterTemps: [], oilTemps: [], fuelKgs: [], fuelKgPerHour: [] };
  const fuelLiters: number[] = [];
  tireColumns.push(
    { values: engine.waterTemps, column: header.indexOf('WaterTemp') },
    { values: engine.oilTemps, column: header.indexOf('OilTemp') },
    { values: engine.fuelKgPerHour, column: header.indexOf('FuelUsePerHour') },
    { values: fuelLiters, column: header.indexOf('FuelLevel') }
  );
  const densityColumn = header.indexOf('FuelKgPerLtr');
  let offset = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const value = parseFloat(cells[pctColumn]);
    if (Number.isNaN(value)) continue;
    if (pcts.length === 0 && value > 0.5) offset = -1; // Lap starts just before the line
    if (pcts.length > 0 && value + offset < pcts[pcts.length - 1] - 0.5) offset += 1;
    pcts.push(value + offset);
    brakes.push(parseFloat(cells[brakeColumn]) || 0);
    speeds.push(parseFloat(cells[speedColumn]) || 0);
    throttles.push(parseFloat(cells[throttleColumn]) || 0);
    steerings.push(parseFloat(cells[steeringColumn]) || 0);
    // parseFloat of a missing or empty cell is NaN
    lats.push(latColumn < 0 ? NaN : parseFloat(cells[latColumn]));
    lons.push(lonColumn < 0 ? NaN : parseFloat(cells[lonColumn]));
    alts.push(altColumn < 0 ? NaN : parseFloat(cells[altColumn]));
    yaws.push(yawColumn < 0 ? NaN : parseFloat(cells[yawColumn]));
    rpms.push(rpmColumn < 0 ? NaN : parseFloat(cells[rpmColumn]));
    gears.push(gearColumn < 0 ? NaN : parseFloat(cells[gearColumn]));
    yawRates.push(yawRateColumn < 0 ? NaN : parseFloat(cells[yawRateColumn]));
    velocityXs.push(velocityXColumn < 0 ? NaN : parseFloat(cells[velocityXColumn]));
    velocityYs.push(velocityYColumn < 0 ? NaN : parseFloat(cells[velocityYColumn]));
    sessionTimes.push(sessionTimeColumn < 0 ? NaN : parseFloat(cells[sessionTimeColumn]));
    for (const { values, column } of tireColumns) values.push(column < 0 ? NaN : parseFloat(cells[column]));
    const density = densityColumn < 0 ? NaN : parseFloat(cells[densityColumn]);
    engine.fuelKgs.push(fuelLiters[fuelLiters.length - 1] * (density > 0 ? density : DEFAULT_FUEL_KG_PER_LTR));
  }
  return {
    pcts, brakes, speeds, throttles, steerings, lats, lons, alts, yaws, rpms, gears, yawRates, velocityXs, velocityYs,
    tireTemps, tireLayers, sessionTimes, tirePressures, rideHeights, engine,
  };
}

// Fractional sample index where the lap first reaches `target`, at or after `from`
export function crossingIndex(pcts: number[], target: number, from: number) {
  for (let i = Math.max(1, Math.ceil(from)); i < pcts.length; i++) {
    if (pcts[i - 1] < target && pcts[i] >= target) {
      return i - 1 + (target - pcts[i - 1]) / (pcts[i] - pcts[i - 1]);
    }
  }
  return null;
}

// The Brake and Throttle samples (0-1) through a focus area, for charting (throttle without downshift
// blips, see withoutThrottleBlips), with each sample's unwrapped
// lap position. Same stretch of samples areaStats measures; null if the lap doesn't cover the area.
// domain is the area's start and end as lap positions (an end past the start/finish line is > 1).
// times is each sample's time from the start of the lap (s), spaced like areaStats counts them.
// steerings is the steering wheel angle at each sample (radians, positive to the left), speeds the speed (m/s).
// positions is the car's [lat, lon] at each sample, or null if the lap has no track positions there.
// altitudes is the car's altitude (m) at each sample, or null without positions or Alt there.
// headings is where the car points at each sample, as a compass bearing (radians clockwise from north),
// or null without positions or Yaw (see lapHeadings).
// tireTemps is each tire's temperatures (°C) at each sample, or null if the lap has none there;
// tirePressures the same for each tire's pressure (kPa), and rideHeights for each corner's ride height (m). engine is RPM, Gear and the lap file's EngineSamples at each
// sample, NaN where it has none. handling is what the Slip & Balance charts are worked out from (see HandlingSamples).
export type AreaTrace = {
  pcts: number[];
  times: number[];
  brakes: number[];
  throttles: number[];
  steerings: number[];
  speeds: number[];
  positions: [number, number][] | null;
  altitudes: number[] | null;
  headings: number[] | null;
  tireTemps: Record<TireCorner, TireTemps> | null;
  tirePressures: Record<TireCorner, number[]> | null;
  rideHeights: Record<TireCorner, number[]> | null;
  engine: EngineSamples & { rpms: number[]; gears: number[] };
  handling: HandlingSamples;
  domain: [number, number];
};

// Downshift throttle blips (the engine revved to match a lower gear) read as spikes in a pedal trace.
// A blip is a pulse that rises from (near) 0% and drops back to 0%; it's flattened to 0% if it's
// shorter than BLIP_MAX_SAMPLES or the brake is on during it. Throttle that was already on (the lift
// as braking starts) and a pickup that stays on are real and kept.
const PEDAL_OFF = 0.02;
const BLIP_MAX_SAMPLES = 24; // 0.4 s at 60 Hz

export function withoutThrottleBlips(brakes: number[], throttles: number[]): number[] {
  const out = [...throttles];
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= PEDAL_OFF || out[i - 1] > PEDAL_OFF) continue;
    // A pulse starts at i (the previous sample is off); find where it ends
    let j = i;
    let braking = false;
    while (j < out.length && out[j] > PEDAL_OFF) {
      braking ||= brakes[j] > PEDAL_OFF;
      j++;
    }
    // Only pulses that drop back to off inside the area are judged
    if (j < out.length && (j - i < BLIP_MAX_SAMPLES || braking)) out.fill(0, i, j);
    i = j;
  }
  return out;
}

// Samples this far apart (before and after) give the direction the car is travelling, for lapHeadings
const TRAVEL_SPAN = 3;
// Slower than this (m/s) the travel direction is too noisy to calibrate against
const MIN_CALIBRATION_SPEED = 10;
// How consistently Yaw has to line up with the travel direction (0-1) to be trusted
const MIN_HEADING_AGREEMENT = 0.9;

// The compass bearing (radians clockwise from north) the car points at each sample. iRacing's Yaw is
// the car's orientation but from a track-specific zero and direction, so it's lined up with the
// direction the car travels (from Lat/Lon) over the whole lap: the sign and offset that agree best.
// Away from slides the car points where it goes, so the offset is the average difference.
// null when the lap has no Yaw, too few positions, or the two don't agree.
export function lapHeadings({ speeds, lats, lons, yaws }: LapSamples): number[] | null {
  if (!yaws.some(Number.isFinite)) return null;
  const sums = { 1: [0, 0], [-1]: [0, 0] } as Record<1 | -1, [number, number]>;
  let count = 0;
  for (let i = TRAVEL_SPAN; i < yaws.length - TRAVEL_SPAN; i += 2) {
    const [a, b] = [i - TRAVEL_SPAN, i + TRAVEL_SPAN];
    if (speeds[i] < MIN_CALIBRATION_SPEED || ![lats[a], lons[a], lats[b], lons[b], yaws[i]].every(Number.isFinite)) continue;
    const east = (lons[b] - lons[a]) * Math.cos((lats[i] * Math.PI) / 180);
    const north = lats[b] - lats[a];
    if (east === 0 && north === 0) continue;
    const bearing = Math.atan2(east, north);
    for (const sign of [1, -1] as const) {
      sums[sign][0] += Math.cos(bearing - sign * yaws[i]);
      sums[sign][1] += Math.sin(bearing - sign * yaws[i]);
    }
    count++;
  }
  if (count < 20) return null;
  const sign = Math.hypot(...sums[1]) >= Math.hypot(...sums[-1]) ? 1 : -1;
  if (Math.hypot(...sums[sign]) / count < MIN_HEADING_AGREEMENT) return null;
  const offset = Math.atan2(sums[sign][1], sums[sign][0]);
  return yaws.map((yaw) => sign * yaw + offset);
}

export function areaTrace(
  samples: LapSamples,
  lapSeconds: number,
  start: number,
  end: number
): AreaTrace | null {
  const { pcts, brakes, throttles, steerings, speeds, lats, lons } = samples;
  const startIndex = crossingIndex(pcts, start, 0);
  if (startIndex === null) return null;
  const domainEnd = end < start ? end + 1 : end;
  const endIndex = crossingIndex(pcts, domainEnd, startIndex);
  if (endIndex === null) return null;
  const from = Math.floor(startIndex);
  const to = Math.min(Math.ceil(endIndex), pcts.length - 1) + 1;
  const areaBrakes = brakes.slice(from, to);
  const positions = lats.slice(from, to).map((lat, i): [number, number] => [lat, lons[from + i]]);
  const sampleSeconds = lapSeconds / pcts.length;
  const hasPositions = positions.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  const altitudes = samples.alts.slice(from, to);
  const headings = hasPositions ? lapHeadings(samples)?.slice(from, to) ?? null : null;
  const tireTemps = Object.fromEntries(
    TIRE_CORNERS.map((corner) => {
      const { outer, middle, inner } = samples.tireTemps[corner];
      return [corner, { outer: outer.slice(from, to), middle: middle.slice(from, to), inner: inner.slice(from, to) }];
    })
  ) as Record<TireCorner, TireTemps>;
  const hasTireTemps = TIRE_CORNERS.some((corner) => tireTemps[corner].middle.some(Number.isFinite));
  const tirePressures = Object.fromEntries(
    TIRE_CORNERS.map((corner): [TireCorner, number[]] => [corner, samples.tirePressures[corner].slice(from, to)])
  ) as Record<TireCorner, number[]>;
  const hasTirePressures = TIRE_CORNERS.some((corner) => tirePressures[corner].some(Number.isFinite));
  const rideHeights = Object.fromEntries(
    TIRE_CORNERS.map((corner): [TireCorner, number[]] => [corner, samples.rideHeights[corner].slice(from, to)])
  ) as Record<TireCorner, number[]>;
  const hasRideHeights = TIRE_CORNERS.some((corner) => rideHeights[corner].some(Number.isFinite));
  return {
    pcts: pcts.slice(from, to),
    times: Array.from({ length: to - from }, (_, i) => (from + i) * sampleSeconds),
    brakes: areaBrakes,
    throttles: withoutThrottleBlips(areaBrakes, throttles.slice(from, to)),
    steerings: steerings.slice(from, to),
    speeds: speeds.slice(from, to),
    positions: hasPositions ? positions : null,
    altitudes: hasPositions && altitudes.every(Number.isFinite) ? altitudes : null,
    headings: headings && headings.every(Number.isFinite) ? headings : null,
    tireTemps: hasTireTemps ? tireTemps : null,
    tirePressures: hasTirePressures ? tirePressures : null,
    rideHeights: hasRideHeights ? rideHeights : null,
    engine: {
      rpms: samples.rpms.slice(from, to),
      gears: samples.gears.slice(from, to),
      waterTemps: samples.engine.waterTemps.slice(from, to),
      oilTemps: samples.engine.oilTemps.slice(from, to),
      fuelKgs: samples.engine.fuelKgs.slice(from, to),
      fuelKgPerHour: samples.engine.fuelKgPerHour.slice(from, to),
    },
    handling: {
      yawRates: samples.yawRates.slice(from, to),
      sideslips: lapSideslips(samples).slice(from, to),
      rearWheelSlips: rearWheelSlips(samples).slice(from, to),
    },
    domain: [start, domainEnd],
  };
}

// At each sample (NaN where the lap can't tell): yawRates is YawRate (rad/s, positive turning left); sideslips
// the car's sideslip angle (rad, positive when it travels to the left of where it points); rearWheelSlips the
// rear wheels' longitudinal slip (0.05 = turning 5% faster than the car is going, wheelspin; negative is
// locking up)
export type HandlingSamples = { yawRates: number[]; sideslips: number[]; rearWheelSlips: number[] };

// Slower than this (m/s) sideslip and wheel slip are left out: dividing by a small speed only gives noise
const MIN_SLIP_SPEED = 10;

// The sideslip angle from VelocityX/VelocityY when the lap has them, otherwise from where the car points
// (lapHeadings, from Yaw) against the direction it travels (from Lat/Lon, TRAVEL_SPAN samples either side)
function lapSideslips(samples: LapSamples): number[] {
  const { speeds, velocityXs, velocityYs, lats, lons } = samples;
  if (velocityXs.some(Number.isFinite)) {
    return velocityXs.map((vx, i) =>
      speeds[i] >= MIN_SLIP_SPEED && vx > 0 && Number.isFinite(velocityYs[i]) ? Math.atan2(velocityYs[i], vx) : NaN
    );
  }
  const headings = lapHeadings(samples);
  return speeds.map((speed, i) => {
    const [a, b] = [i - TRAVEL_SPAN, i + TRAVEL_SPAN];
    if (!headings || speed < MIN_SLIP_SPEED || a < 0 || b >= speeds.length) return NaN;
    if (![lats[a], lons[a], lats[b], lons[b], headings[i]].every(Number.isFinite)) return NaN;
    const east = (lons[b] - lons[a]) * Math.cos((lats[i] * Math.PI) / 180);
    const north = lats[b] - lats[a];
    // Compass bearings turn clockwise, so travelling left of the nose is a smaller bearing than the heading
    const slip = headings[i] - Math.atan2(east, north);
    return Math.atan2(Math.sin(slip), Math.cos(slip));
  });
}

// Each gear's car speed per engine RPM (m/s per rpm) with the rear wheels rolling, the median through the lap
// off the brakes, where wheelspin is rare; used to tell the rear wheels' speed from RPM (rear-wheel drive)
function gearSpeedRatios({ speeds, rpms, gears, brakes }: LapSamples) {
  const byGear = new Map<number, number[]>();
  gears.forEach((gear, i) => {
    if (gear >= 1 && rpms[i] > 1000 && speeds[i] >= MIN_SLIP_SPEED && brakes[i] <= 0.02) {
      if (!byGear.has(gear)) byGear.set(gear, []);
      byGear.get(gear)!.push(speeds[i] / rpms[i]);
    }
  });
  return new Map(
    [...byGear].filter(([, ratios]) => ratios.length >= 30).map(([gear, ratios]) => {
      const sorted = ratios.sort((x, y) => x - y);
      return [gear, sorted[Math.floor(sorted.length / 2)]] as const;
    })
  );
}

// Samples this close (0.15 s at 60 Hz) to a gear change are left out: the clutch is open and RPM jumps
const SHIFT_SAMPLES = 9;

// The rear wheels' longitudinal slip, from how fast RPM says they turn in the gear against the car's speed.
// iRacing records no wheel speeds, so this is only for rear-wheel-drive cars, and the front wheels' is unknown.
function rearWheelSlips(samples: LapSamples): number[] {
  const { speeds, rpms, gears } = samples;
  const ratios = gearSpeedRatios(samples);
  return speeds.map((speed, i) => {
    const ratio = ratios.get(gears[i]);
    if (ratio === undefined || speed < MIN_SLIP_SPEED || !Number.isFinite(rpms[i])) return NaN;
    for (let j = Math.max(1, i - SHIFT_SAMPLES); j <= Math.min(gears.length - 1, i + SHIFT_SAMPLES); j++) {
      if (gears[j] !== gears[j - 1]) return NaN;
    }
    return (rpms[i] * ratio - speed) / speed;
  });
}

// The lap's time (s from the start of the lap) when it reached a lap position, interpolated between
// samples the same way areaStats interpolates its start and end crossings
export function timeAtPosition({ pcts, times }: AreaTrace, pct: number) {
  if (pct <= pcts[0]) return times[0];
  const last = pcts.length - 1;
  if (pct >= pcts[last]) return times[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pcts[mid] <= pct) lo = mid;
    else hi = mid;
  }
  const fraction = pcts[hi] > pcts[lo] ? (pct - pcts[lo]) / (pcts[hi] - pcts[lo]) : 0;
  return times[lo] + fraction * (times[hi] - times[lo]);
}

// Seconds spent between start and end, the highest Brake value (0-1) in that
// stretch, the lowest speed (m/s) in it, and the speed (m/s) at the end of it. Samples are evenly spaced (60 Hz), so each one is
// lapSeconds / sampleCount long.
export function areaStats({ pcts, brakes, speeds, throttles }: LapSamples, lapSeconds: number, start: number, end: number) {
  const startIndex = crossingIndex(pcts, start, 0);
  if (startIndex === null) return null;
  // An area that crosses the start/finish line ends on the next lap
  const endIndex = crossingIndex(pcts, end < start ? end + 1 : end, startIndex);
  if (endIndex === null) return null;

  let maxBrake = 0;
  let brakePct: number | null = null; // Lap position where Brake first goes over 0%
  let throttlePct: number | null = null; // Lap position where the throttle comes back after that first braking zone
  let released = false; // Brake has dropped back to 0% after the first braking zone
  for (let i = Math.floor(startIndex); i <= Math.ceil(endIndex) && i < brakes.length; i++) {
    maxBrake = Math.max(maxBrake, brakes[i]);
    if (brakePct !== null && !released && brakes[i] <= BRAKE_THRESHOLD) released = true;
    if (released && throttlePct === null && throttles[i] >= THROTTLE_THRESHOLD) throttlePct = pcts[i];
    if (brakePct === null && brakes[i] > BRAKE_THRESHOLD) {
      const prev = i - 1;
      brakePct =
        prev >= 0 && brakes[prev] <= BRAKE_THRESHOLD
          ? pcts[prev] +
            ((BRAKE_THRESHOLD - brakes[prev]) / (brakes[i] - brakes[prev])) * (pcts[i] - pcts[prev])
          : pcts[i];
    }
  }
  // Interpolate between the samples on either side of the start and end lines
  const entryBefore = Math.floor(startIndex);
  const entryAfter = Math.min(entryBefore + 1, speeds.length - 1);
  const entrySpeed = speeds[entryBefore] + (startIndex - entryBefore) * (speeds[entryAfter] - speeds[entryBefore]);

  const before = Math.floor(endIndex);
  const after = Math.min(before + 1, speeds.length - 1);
  const exitSpeed = speeds[before] + (endIndex - before) * (speeds[after] - speeds[before]);

  let minSpeed = exitSpeed;
  for (let i = Math.ceil(startIndex); i <= before; i++) minSpeed = Math.min(minSpeed, speeds[i]);

  return { seconds: ((endIndex - startIndex) * lapSeconds) / pcts.length, maxBrake, brakePct, throttlePct, entrySpeed, minSpeed, exitSpeed };
}

export type AreaStats = NonNullable<ReturnType<typeof areaStats>>;

// Unwrapped LapDistPct -> feet from the start/finish line (used for brake and throttle points)
export function brakeFeet(brakePct: number, lengthFeet: number) {
  const lapFraction = ((brakePct % 1) + 1) % 1; // Back to 0-1 after unwrapping
  return Math.round(lapFraction * lengthFeet);
}

// Why parseLapFile refused a file; the tabs show it in the user's language (dictionary laps.errors)
export class LapFileError extends Error {
  constructor(
    public code: 'notCsv' | 'tooLarge' | 'badName' | 'missingColumns',
    public columns: string[] = []
  ) {
    super(code);
  }
}

// The text for a file parseLapFile refused, from the dictionary's laps.errors
export function lapFileErrorText(error: unknown, messages: Record<LapFileError['code'], string>): string {
  if (error instanceof LapFileError) return messages[error.code].replace('{columns}', error.columns.join(', '));
  return error instanceof Error ? error.message : String(error);
}

export async function parseLapFile(file: File): Promise<LapFile> {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new LapFileError('notCsv');
  }
  if (file.size > MAX_CSV_BYTES) {
    throw new LapFileError('tooLarge');
  }

  const match = file.name.match(FILE_NAME_PATTERN);
  if (!match) {
    throw new LapFileError('badName');
  }

  const header = (await file.slice(0, 4096).text()).split(/\r?\n/)[0].split(',').map((c) => c.trim());
  const missing = EXPECTED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new LapFileError('missingColumns', missing);
  }

  const [, driverName, carName, trackName, lapTime, fileId] = match;
  return { file, driverName, carName, trackName, lapTime, fileId };
}
