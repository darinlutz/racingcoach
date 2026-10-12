// Reads a Garage 61 stint export ("Garage 61 - <session> - Export - <timestamp>.csv"): one row per
// lap with its time, sectors, fuel and weather. Used by the Stint Analysis and Multi-Lap Analysis tabs.

import { formatSpeed, type Units } from '@/lib/units';

export type StintLap = {
  run: number;
  lap: number;
  lapSeconds: number;
  startedAt: string;
  driver: string;
  clean: boolean;
  pitIn: boolean;
  pitOut: boolean;
  trackTempC: number;
  airTempC: number;
  relativeHumidity: number; // 0-1
  windVelocity: number; // m/s
  windDirection: number; // radians
  cloudCover: number;
  airPressure: number; // Pa
  trackUsage: number;
  precipitation: number; // 0-1
  trackWetness: number;
  fuelLevel: number; // liters at the start of the lap
  fuelUsed: number; // liters
  sectors: (number | null)[]; // seconds; null when the lap has no time for that sector
};

export type StintExport = { fileName: string; sectorCount: number; laps: StintLap[] };

const REQUIRED_COLUMNS = [
  'Run', 'Lap', 'Lap time', 'Started at', 'Driver', 'Clean', 'Pit in', 'Pit out', 'Fuel level', 'Fuel used', 'Track temp', 'Track usage', 'Air temperature',
  'Cloud cover', 'Air pressure', 'Wind velocity', 'Wind direction', 'Relative humidity',
  'Precipitation', 'Track Wetness',
];

// A stint export is recognized by its header rather than its file name
export async function isStintExport(file: File) {
  const header = (await file.slice(0, 4096).text()).split(/\r?\n/)[0];
  return header.startsWith('Run,Lap,Lap time,') && header.includes('Track temp');
}

export async function parseStintExport(file: File): Promise<StintExport> {
  const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0].split(',').map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`missing columns: ${missing.join(', ')}`);

  const column = (name: string) => header.indexOf(name);
  // "Sector 1" ... "Sector N"; the count depends on the track
  const sectorColumns = header.flatMap((name, index) => (/^Sector \d+$/.test(name) ? [index] : []));
  const laps: StintLap[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const num = (name: string) => parseFloat(cells[column(name)]);
    const lap: StintLap = {
      run: num('Run'),
      lap: num('Lap'),
      lapSeconds: num('Lap time'),
      startedAt: cells[column('Started at')],
      driver: cells[column('Driver')],
      clean: cells[column('Clean')] === '1',
      pitIn: cells[column('Pit in')] === '1',
      pitOut: cells[column('Pit out')] === '1',
      trackTempC: num('Track temp'),
      airTempC: num('Air temperature'),
      relativeHumidity: num('Relative humidity'),
      windVelocity: num('Wind velocity'),
      windDirection: num('Wind direction'),
      cloudCover: num('Cloud cover'),
      airPressure: num('Air pressure'),
      trackUsage: num('Track usage'),
      precipitation: num('Precipitation'),
      trackWetness: num('Track Wetness'),
      fuelLevel: num('Fuel level'),
      fuelUsed: num('Fuel used'),
      sectors: sectorColumns.map((index) => {
        const value = parseFloat(cells[index]);
        return Number.isNaN(value) ? null : value;
      }),
    };
    // Skip rows without real conditions (e.g. a trailing zero-filled lap)
    if (Number.isNaN(lap.lapSeconds) || !(lap.airPressure > 0)) continue;
    laps.push(lap);
  }
  if (laps.length === 0) throw new Error('no laps with weather data');
  return { fileName: file.name, sectorCount: sectorColumns.length, laps };
}

// 110.8992 -> "1:50.899"
export function formatSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`;
}

// compass: the eight directions from N clockwise, in the user's language (dictionary weather.compass)
export function formatWind(
  velocity: number,
  radians: number,
  units: Units,
  compass: string[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
) {
  const points = compass;
  const degrees = ((((radians * 180) / Math.PI) % 360) + 360) % 360;
  return `${formatSpeed(velocity, units)} ${points[Math.round(degrees / 45) % 8]}`;
}

// iRacing sky values: 0 clear, 1 partly cloudy, 2 mostly cloudy, 3 overcast (names: dictionary weather.clouds)
export function formatClouds(value: number, names: string[] = ['Clear', 'Partly cloudy', 'Mostly cloudy', 'Overcast']) {
  return names[value] ?? String(value);
}

// Pa -> inHg (Standard) or hPa (Metric)
export function formatPressure(pascals: number, units: Units) {
  return units === 'metric' ? `${(pascals / 100).toFixed(1)} hPa` : `${(pascals / 3386.389).toFixed(2)} inHg`;
}
