// Race & Qualy Trends tab, browser side. iRacing event result JSON files are a few hundred KB each and
// list every driver in every session, so the browser reads them and keeps one small record per driver per
// event; only the chosen driver's records are posted to /api/race-trends.

import type { RaceEvent } from '@/lib/raceTrends';

export const MAX_RESULT_FILE_BYTES = 25 * 1024 * 1024;

// "Sports_Car" -> "Sports Car"
export const categoryLabel = (category: string) => category.replace(/_/g, ' ');

type DriverRow = {
  cust_id: number;
  display_name: string;
  oldi_rating: number;
  newi_rating: number;
  starting_position_in_class: number;
  finish_position_in_class: number;
  incidents: number;
  laps_complete: number;
  car_name: string;
  driver_results?: DriverRow[];
};

type SessionResult = { simsession_number: number; simsession_name: string; results: DriverRow[] };

type ResultData = {
  subsession_id: number;
  start_time: string;
  series_name: string;
  license_category: string;
  event_strength_of_field: number;
  track: { track_name: string; config_name?: string };
  session_results: SessionResult[];
};

export type ResultFile = {
  fileId: string;
  file: File;
  startTime: string;
  seriesName: string;
  trackName: string;
  // One record per driver in the race, by cust_id; the rest of the file is not kept
  drivers: Map<number, { name: string; event: RaceEvent }>;
};

// Team events nest each driver's row under the team's row
const flatten = (rows: DriverRow[]) => rows.flatMap((row) => (row.driver_results?.length ? row.driver_results : [row]));

const findDriver = (session: SessionResult | undefined, custId: number) =>
  session ? flatten(session.results).find((row) => row.cust_id === custId) : undefined;

// The main event is session 0; the others are practice (-2) and qualifying (-1)
const sessionNamed = (data: ResultData, name: string, number: number) =>
  data.session_results.find((s) => s.simsession_name === name) ??
  data.session_results.find((s) => s.simsession_number === number);

export async function parseResultFile(file: File): Promise<ResultFile> {
  if (file.size > MAX_RESULT_FILE_BYTES) throw new Error('File is over 25MB');

  let json: { type?: string; data?: ResultData } & Partial<ResultData>;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('Not a valid JSON file');
  }
  // Files saved from the iRacing site wrap the result in { type: "event_result", data }; the raw API does not
  const data = (json.data ?? json) as ResultData;
  if (typeof data.subsession_id !== 'number' || !Array.isArray(data.session_results)) {
    throw new Error('Not an iRacing event result file');
  }

  const raceSession = sessionNamed(data, 'RACE', 0);
  const qualySession = sessionNamed(data, 'QUALIFY', -1);
  const track = [data.track?.track_name, data.track?.config_name].filter(Boolean).join(' - ');
  const position = (value: number | undefined) => (value === undefined || value < 0 ? null : value + 1);

  const drivers: ResultFile['drivers'] = new Map();
  for (const race of flatten(raceSession?.results ?? [])) {
    const qualy = findDriver(qualySession, race.cust_id);
    drivers.set(race.cust_id, {
      name: race.display_name,
      event: {
        subsessionId: data.subsession_id,
        startTime: data.start_time,
        series: data.series_name,
        track,
        category: data.license_category,
        car: race.car_name,
        // -1 when the event did not count for iRating (e.g. unofficial 13th week races)
        oldIRating: race.oldi_rating,
        newIRating: race.newi_rating,
        strengthOfField: data.event_strength_of_field,
        qualifyPosition: position(qualy?.finish_position_in_class),
        startPosition: position(race.starting_position_in_class),
        finishPosition: position(race.finish_position_in_class),
        incidents: race.incidents,
        lapsComplete: race.laps_complete,
      },
    });
  }

  return {
    fileId: String(data.subsession_id),
    file,
    startTime: data.start_time,
    seriesName: data.series_name,
    trackName: data.track?.track_name ?? '',
    drivers,
  };
}

// Drivers who appear in the most files first; the uploader is normally the one driver in every file
export function driversByAppearances(files: ResultFile[]) {
  const counts = new Map<number, { custId: number; name: string; files: number }>();
  for (const f of files) {
    for (const [custId, { name }] of f.drivers) {
      const entry = counts.get(custId) ?? { custId, name, files: 0 };
      entry.files += 1;
      counts.set(custId, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
}

// The chosen driver's record from each event they raced in
export function raceEventsFor(files: ResultFile[], custId: number): RaceEvent[] {
  return files.flatMap((f) => {
    const entry = f.drivers.get(custId);
    return entry ? [entry.event] : [];
  });
}
