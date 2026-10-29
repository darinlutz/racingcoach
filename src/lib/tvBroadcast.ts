import { readLiveDrivers, readRaceEvents, type FieldCar, type InputSample, type LiveDriver, type RaceEvent } from './liveRacing';
import { sessionFlag, type FlagKind, type FlagNote } from './raceFlags';
import type { User } from './users';

// TV Broadcast Mode's picture of the race (src/app/tv/): what the TV shows, worked out here from the Live Racing
// drivers the paired account may watch (readLiveDrivers, src/lib/liveRacing.ts), so the TV only draws it. Sent by
// GET /api/tv/stream (Server-Sent Events) whenever it changes, or by GET /api/tv/state to TVs that can't keep the
// stream open. Only what the collector sent: anything it didn't is null, shown as a dash, never guessed. The map's
// dots carry how old their position is (ageMs), so the TV moves them on between pictures as the Live Racing map does.

// The leaderboard's rows on a 1080p screen: the leaders, and around the focused driver when they're further back
export const TV_ROWS = 15;
const TOP_ROWS_WHEN_SPLIT = 7;
// The newest few race events, for the event feed
const TV_EVENTS = 6;
// The followed driver's inputs sent with each picture: the last few seconds (the TV keeps a longer trace itself)
const TV_INPUTS_S = 3;
// The drivers' dot colors, as on the Live Racing page: the account's own red, the others in turn by account
export const TV_ME_COLOR = '#DE3341';
const TV_COLORS = ['#3B8BFF', '#2EB872', '#E3A82B', '#A855F7', '#14B8A6', '#F97316', '#EC4899', '#84CC16'];

// A gap: the leader, laps down, or seconds
export type TvGap = { leader: true } | { laps: number } | { seconds: number } | null;

export type TvRow = {
  idx: number;
  position: number | null;
  classPosition: number | null;
  number: string | null;
  name: string;
  car: string | null;
  carClass: string | null;
  classColor: string | null;
  countryCode: string | null;
  lap: number | null;
  gap: TvGap;
  interval: TvGap;
  lastLapTime: number | null;
  bestLapTime: number | null;
  onPitRoad: boolean;
  offTrack: boolean;
  // The driver's iRacing flair (normally their country), for the flag's label
  flair: string | null;
  iRating: number | null;
  // The car of the driver the TV follows; and the dot color of RacingCoach.app drivers the account watches
  isFocus: boolean;
  watchColor: string | null;
  isMe: boolean;
  fastest: boolean;
};

// A dot on the track map, as the Live Racing map draws it (MapCar in src/components/LiveTrackMap.tsx), with how old
// its position is instead of when it was sampled
export type TvMapCar = {
  id: string;
  label: string;
  color: string;
  pct: number | null;
  speed: number;
  rate?: number;
  ageMs: number;
  moving: boolean;
  highlight: boolean;
  fieldCar?: boolean;
  dim?: boolean;
};

export type TvEvent = { seq: number; at: number; event: RaceEvent };

export type TvFocus = {
  driverId: number;
  driver: string;
  color: string;
  isMe: boolean;
  offline: boolean;
  track: string;
  // iRacing's track key, for the map (GET /api/tv/outline), and whether a driver on it sent an approximate outline
  trackKey: string | null;
  approximateOutlineFrom: number | null;
  car: string;
  sessionType: string | null;
  sessionName: string | null;
  isRace: boolean;
  // Changes with the session (subsession, session, track), so the TV starts its commentary afresh
  sessionKey: string;
  flag: FlagKind | null;
  flagNotes: FlagNote[];
  lap: number | null;
  lapsTotal: number | null;
  lapsRemain: number | null;
  timeRemain: number | null;
  position: number | null;
  carsInSession: number | null;
  lastLapTime: number | null;
  bestLapTime: number | null;
  incidents: number | null;
  onTrack: boolean;
  onPitRoad: boolean;
  deltaToBest: number | null;
  coachSpeaking: boolean;
  eventSeq: number;
  // null when the driver's collector doesn't send the field (before 1.52.0)
  rows: TvRow[] | null;
  multiClass: boolean;
  events: TvEvent[];
  // The map's dots: the watched drivers on this track, and the other cars in the followed driver's session
  mapCars: TvMapCar[];
  // The followed driver's inputs over the last TV_INPUTS_S seconds (InputSample: SessionTime first), oldest first,
  // the newest inputsAgeMs old; null from collectors before 1.52.0
  inputs: InputSample[] | null;
  inputsAgeMs: number;
};

export type TvState = {
  // Server time (ms since the epoch) of this picture, for the events' ages
  at: number;
  drivers: { id: number; name: string; color: string; isMe: boolean; offline: boolean; track: string }[];
  focus: TvFocus | null;
};

const positive = (n: number | null | undefined) => (n != null && n > 0 ? n : null);

function runningOrder(cars: FieldCar[]): FieldCar[] {
  const progress = (car: FieldCar) => (car.lapsDone ?? 0) + (car.pct ?? 0);
  return [...cars].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || progress(b) - progress(a) || a.idx - b.idx
  );
}

// The gap from car back to to, as the Live Racing leaderboard works it out: race time (CarIdxF2Time) or laps down in a
// race, the difference between best laps otherwise
export function gapBetween(car: FieldCar, to: FieldCar | undefined, isRace: boolean): TvGap {
  if (!to || car === to) return null;
  if (isRace) {
    const lapsDown = (to.lapsDone ?? 0) - (car.lapsDone ?? 0) - ((car.pct ?? 0) > (to.pct ?? 0) ? 1 : 0);
    if (lapsDown >= 1) return { laps: lapsDown };
    if (car.f2Time == null || to.f2Time == null || !car.position) return null;
    return { seconds: Math.max(0, car.f2Time - to.f2Time) };
  }
  if (!positive(car.bestLapTime) || !positive(to.bestLapTime)) return null;
  return { seconds: Math.max(0, car.bestLapTime! - to.bestLapTime!) };
}

function leaderboard(focused: LiveDriver, watched: Map<string, LiveDriver & { color: string }>): { rows: TvRow[]; multiClass: boolean } | null {
  const field = focused.field;
  if (!field) return null;
  const isRace = focused.sessionType?.toLowerCase() === 'race';
  const order = runningOrder(field.cars.filter((car) => car.details));
  const bests = order.map((c) => c.bestLapTime).filter((t): t is number => t != null && t > 0);
  const fastest = bests.length > 0 ? Math.min(...bests) : null;
  const fastestCar = order.find((c) => c.bestLapTime === fastest);
  const leader = order[0];
  const rows = order.map((car, i): TvRow => {
    const d = car.details!;
    return {
      idx: car.idx,
      position: car.position ?? null,
      classPosition: car.classPosition ?? null,
      number: d.number ?? null,
      name: d.name,
      car: d.car ?? null,
      carClass: d.carClass ?? null,
      classColor: d.classColor ?? null,
      countryCode: d.countryCode,
      lap: positive(car.lap),
      gap: car === leader ? { leader: true } : gapBetween(car, isRace ? leader : fastestCar, isRace),
      interval: i === 0 ? null : gapBetween(car, order[i - 1], isRace),
      lastLapTime: positive(car.lastLapTime),
      bestLapTime: positive(car.bestLapTime),
      onPitRoad: !!car.onPitRoad,
      offTrack: !!car.offTrack,
      flair: d.flair ?? null,
      iRating: d.iRating ?? null,
      isFocus: car.idx === field.myCarIdx,
      watchColor: watched.get(`${field.subSessionId}:${car.idx}`)?.color ?? null,
      isMe: !!watched.get(`${field.subSessionId}:${car.idx}`)?.isMe,
      fastest: fastest != null && car.bestLapTime === fastest,
    };
  });
  const multiClass = new Set(order.map((c) => c.details?.carClass ?? '')).size > 1;
  return { rows: windowRows(rows), multiClass };
}

// The first TV_ROWS rows, or, when the focused car is further back, the leaders and the cars around it
export function windowRows<T extends { isFocus: boolean }>(rows: T[]): T[] {
  if (rows.length <= TV_ROWS) return rows;
  const at = rows.findIndex((r) => r.isFocus);
  if (at < TV_ROWS) return rows.slice(0, TV_ROWS);
  const around = TV_ROWS - TOP_ROWS_WHEN_SPLIT;
  const start = Math.min(Math.max(at - Math.floor(around / 2), TOP_ROWS_WHEN_SPLIT), rows.length - around);
  return [...rows.slice(0, TOP_ROWS_WHEN_SPLIT), ...rows.slice(start, start + around)];
}

// Each driver's dot color, as the Live Racing page gives them
function driverColors(drivers: LiveDriver[]): Map<number, string> {
  const colors = new Map<number, string>();
  let next = 0;
  for (const d of [...drivers].sort((a, b) => a.userId - b.userId)) {
    colors.set(d.userId, d.isMe ? TV_ME_COLOR : TV_COLORS[next++ % TV_COLORS.length]);
  }
  return colors;
}

const sameTrack = (a: LiveDriver, b: LiveDriver) =>
  a.trackKey && b.trackKey ? a.trackKey.toLowerCase() === b.trackKey.toLowerCase() : a.track === b.track;

// The map's dots: every watched driver on the followed driver's track, then the other cars in the followed driver's
// session (not the watched drivers' own, drawn already), as the Live Racing page draws them
function mapCars(focused: LiveDriver, drivers: LiveDriver[], colors: Map<number, string>): TvMapCar[] {
  const here = drivers.filter((d) => sameTrack(d, focused));
  const cars: TvMapCar[] = here.map((d) => ({
    id: `driver:${d.userId}`,
    label: d.driver,
    color: colors.get(d.userId) ?? TV_COLORS[0],
    pct: d.onTrack && !d.offline && d.pct != null ? d.pct : null,
    speed: d.speed ?? 0,
    ageMs: d.ageMs,
    moving: d.onTrack && !d.offline,
    highlight: d.userId === focused.userId,
    dim: !!d.onPitRoad,
  }));
  const field = focused.field;
  if (field && !focused.offline) {
    const ours = new Set(
      here
        .filter((d) => d.field?.myCarIdx != null && (field.subSessionId > 0 ? d.field.subSessionId === field.subSessionId : d === focused))
        .map((d) => d.field!.myCarIdx!)
    );
    for (const car of field.cars) {
      if (ours.has(car.idx) || !car.details) continue;
      cars.push({
        id: `car:${field.subSessionId}:${car.idx}`,
        label: car.details.number ?? '',
        color: car.details.classColor ?? '#cbd5e1',
        pct: car.pct ?? null,
        speed: 0,
        rate: car.rate ?? 0,
        ageMs: focused.ageMs,
        moving: true,
        highlight: false,
        fieldCar: true,
        dim: !!car.onPitRoad || !!car.offTrack,
      });
    }
  }
  return cars;
}

// The inputs of the last TV_INPUTS_S seconds, rounded, so each picture stays small
function recentInputs(inputs: InputSample[] | null): InputSample[] | null {
  if (!inputs) return null;
  if (inputs.length === 0) return [];
  const latest = inputs[inputs.length - 1][0];
  const round = (n: number | null, places: number) => (n == null ? null : Number(n.toFixed(places)));
  return inputs
    .filter((s) => s[0] > latest - TV_INPUTS_S)
    .map(([time, throttle, brake, steering, gear, speed, delta]) => [
      Number(time.toFixed(3)),
      round(throttle, 3),
      round(brake, 3),
      round(steering, 3),
      gear,
      round(speed, 2),
      round(delta, 3),
    ]);
}

// The TV's picture for the account, following driverId when it may watch them, else the account's own driving, else
// the first driver listed
export async function readTvState(viewer: User, driverId: number | null): Promise<TvState> {
  const pick = (list: LiveDriver[]) =>
    list.find((d) => d.userId === driverId) ?? list.find((d) => d.isMe) ?? list.find((d) => !d.offline) ?? list[0] ?? null;
  // The inputs come only for the driver asked for: ask again when the one followed turns out to be someone else
  let drivers = await readLiveDrivers(viewer, driverId ?? viewer.id);
  let focused = pick(drivers);
  if (focused && focused.inputs === null && focused.userId !== (driverId ?? viewer.id)) {
    drivers = await readLiveDrivers(viewer, focused.userId);
    focused = pick(drivers);
  }
  const colors = driverColors(drivers);
  let focus: TvFocus | null = null;
  if (focused) {
    const watched = new Map(
      drivers
        .filter((d) => d.field?.myCarIdx != null)
        .map((d) => [`${d.field!.subSessionId}:${d.field!.myCarIdx}`, { ...d, color: colors.get(d.userId) ?? TV_COLORS[0] }])
    );
    const board = leaderboard(focused, watched);
    const flag = sessionFlag(focused.sessionFlags, focused.sessionState);
    const found = focused.offline ? null : await readRaceEvents(viewer, focused.userId, 0);
    focus = {
      driverId: focused.userId,
      driver: focused.driver,
      color: colors.get(focused.userId) ?? TV_COLORS[0],
      isMe: focused.isMe,
      offline: focused.offline,
      track: focused.track,
      trackKey: focused.trackKey ?? null,
      approximateOutlineFrom: drivers.find((d) => sameTrack(d, focused) && d.hasApproximateOutline)?.userId ?? null,
      car: focused.car,
      sessionType: focused.sessionType ?? null,
      sessionName: focused.sessionName ?? null,
      isRace: focused.sessionType?.toLowerCase() === 'race',
      sessionKey: [focused.field?.subSessionId ?? `u${focused.userId}`, focused.sessionType, focused.sessionName, focused.trackKey ?? focused.track].join('|'),
      flag: flag?.flag ?? null,
      flagNotes: flag?.notes ?? [],
      lap: positive(focused.lap),
      lapsTotal: focused.sessionLapsTotal ?? null,
      lapsRemain: focused.sessionLapsRemain ?? null,
      timeRemain: focused.sessionTimeRemain ?? null,
      position: positive(focused.position),
      carsInSession: focused.field?.cars.length ?? null,
      lastLapTime: positive(focused.lastLapTime),
      bestLapTime: positive(focused.bestLapTime),
      incidents: focused.incidents ?? null,
      onTrack: focused.onTrack,
      onPitRoad: !!focused.onPitRoad,
      deltaToBest: focused.deltaToBest ?? null,
      coachSpeaking: !!focused.coachSpeaking,
      eventSeq: focused.eventSeq,
      rows: board?.rows ?? null,
      multiClass: board?.multiClass ?? false,
      // the Race Broadcast's prompts and gap updates aren't events to list
      events: (found?.events ?? [])
        .filter((e) => !['preRace', 'storyline', 'raceSummary', 'statsUpdate'].includes(e.event.type))
        .filter((e) => e.event.type !== 'battle' || e.event.phase === 'start' || e.event.phase === 'veryClose')
        .slice(-TV_EVENTS)
        .reverse(),
      mapCars: mapCars(focused, drivers, colors),
      inputs: recentInputs(focused.inputs),
      inputsAgeMs: focused.ageMs,
    };
  }
  return {
    at: Date.now(),
    drivers: drivers.map((d) => ({
      id: d.userId,
      name: d.driver,
      color: colors.get(d.userId) ?? TV_COLORS[0],
      isMe: d.isMe,
      offline: d.offline,
      track: d.track,
    })),
    focus,
  };
}
