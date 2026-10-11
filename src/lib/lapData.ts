// Shared helpers for reading Garage 61 lap CSVs and measuring focus areas
// (used by the Multi-Lap Analysis and Lap Compare tabs).

// start/end are fractions of a lap (LapDistPct); brakepointTarget and throttlePickupTarget are in
// feet; maxBrakeTarget is a percent. Each is null if missing in the config
export type Area = {
  name: string;
  start: number | null;
  end: number | null;
  brakepointTarget: number | null;
  maxBrakeTarget: number | null;
  throttlePickupTarget: number | null;
};
export type Track = { name: string; fileName: string; lengthFeet: number | null; areas: Area[] };

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

// speeds are in m/s, as exported by Garage 61
export const MPH_PER_METER_PER_SECOND = 2.23694;

export type LapSamples = { pcts: number[]; brakes: number[]; speeds: number[]; throttles: number[] };

// Brake (0-1) above this counts as the driver being on the brakes
const BRAKE_THRESHOLD = 0;

// Throttle (0-1) at or above this counts as the driver being back on the power
const THROTTLE_THRESHOLD = 0.1;

// Reads the LapDistPct, Brake, Throttle and Speed columns. LapDistPct is unwrapped so it keeps
// increasing past the start/finish line (e.g. 0.999 -> 1.001 instead of 0.001).
export async function readLapSamples(file: File): Promise<LapSamples> {
  const lines = (await file.text()).split(/\r?\n/);
  const header = lines[0].split(',').map((c) => c.trim());
  const pctColumn = header.indexOf('LapDistPct');
  const brakeColumn = header.indexOf('Brake');
  const speedColumn = header.indexOf('Speed');
  const throttleColumn = header.indexOf('Throttle');
  const pcts: number[] = [];
  const brakes: number[] = [];
  const speeds: number[] = [];
  const throttles: number[] = [];
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
  }
  return { pcts, brakes, speeds, throttles };
}

// Fractional sample index where the lap first reaches `target`, at or after `from`
function crossingIndex(pcts: number[], target: number, from: number) {
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
export type AreaTrace = { pcts: number[]; brakes: number[]; throttles: number[]; domain: [number, number] };

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

export function areaTrace({ pcts, brakes, throttles }: LapSamples, start: number, end: number): AreaTrace | null {
  const startIndex = crossingIndex(pcts, start, 0);
  if (startIndex === null) return null;
  const domainEnd = end < start ? end + 1 : end;
  const endIndex = crossingIndex(pcts, domainEnd, startIndex);
  if (endIndex === null) return null;
  const from = Math.floor(startIndex);
  const to = Math.min(Math.ceil(endIndex), pcts.length - 1) + 1;
  const areaBrakes = brakes.slice(from, to);
  return {
    pcts: pcts.slice(from, to),
    brakes: areaBrakes,
    throttles: withoutThrottleBlips(areaBrakes, throttles.slice(from, to)),
    domain: [start, domainEnd],
  };
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

export async function parseLapFile(file: File): Promise<LapFile> {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('only CSV files are supported');
  }
  if (file.size > MAX_CSV_BYTES) {
    throw new Error('file is too large (25 MB max)');
  }

  const match = file.name.match(FILE_NAME_PATTERN);
  if (!match) {
    throw new Error(
      'file name must look like "Garage 61 - Driver - Car - Track - 01.18.683 - ID.csv"'
    );
  }

  const header = (await file.slice(0, 4096).text()).split(/\r?\n/)[0].split(',').map((c) => c.trim());
  const missing = EXPECTED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`missing columns: ${missing.join(', ')}`);
  }

  const [, driverName, carName, trackName, lapTime, fileId] = match;
  return { file, driverName, carName, trackName, lapTime, fileId };
}
