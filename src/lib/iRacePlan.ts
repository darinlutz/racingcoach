// Minimal client for the iRacePlan API (https://iraceplan.com/api/v1), authenticated with each user's
// own API key. Only the read endpoints the Race & Qualy Trends tab needs.

const BASE_URL = 'https://iraceplan.com/api/v1';

export class IRacePlanAuthError extends Error {
  constructor() {
    super('iRacePlan rejected the API key');
  }
}

async function get<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (response.status === 401 || response.status === 403) throw new IRacePlanAuthError();
  if (!response.ok) throw new Error(`iRacePlan ${path} returned ${response.status}`);
  return (await response.json()) as T;
}

export type IRacePlanMe = {
  user: { id: number; iracing_profile: { customer_id: number; display_name: string } | null };
};

export type ScheduleRace = {
  id: number; // planning ID
  name: string;
  start_at: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  type: 'individual' | 'team';
};

export type DriverParticipation = {
  driver: { iracing_id: number; name: string };
  laps_completed: number | null;
  laps_led: number | null;
  incidents: number | null;
  best_lap_time: number | null; // ten-thousandths of a second, -1 when none
  average_lap: number | null;
  old_irating: number | null;
  new_irating: number | null;
  old_safety_rating: number | null;
  new_safety_rating: number | null;
};

export type Planning = {
  id: number;
  session: { start_at: string; end_at: string; name: string };
  car: string;
  type: 'individual' | 'team';
  track: { iracing_id: number; name: string };
  result: {
    // Positions are 0-based, as in iRacing's own results
    finish_position_in_class: number | null;
    starting_position_in_class: number | null;
    reason_out: string | null;
    driver_participations: DriverParticipation[];
  } | null;
};

export type Series = { name: string; category: { name: string } | null };

export const fetchMe = (apiKey: string) => get<IRacePlanMe>(apiKey, '/user/me');

// Every planned race between two times; a single call covers the user's whole history
export const fetchSchedule = (apiKey: string, from: Date, to: Date) =>
  get<{ schedule: { races: ScheduleRace[] } }>(
    apiKey,
    `/schedule?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
  ).then((data) => data.schedule.races);

export const fetchPlanning = (apiKey: string, id: number) =>
  get<{ planning: Planning }>(apiKey, `/plannings/${id}`).then((data) => data.planning);

export const fetchSeries = (apiKey: string) =>
  get<{ series: Series[] }>(apiKey, '/series?limit=1000').then((data) => data.series);
