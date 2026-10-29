import { readLiveDrivers, readRaceEvents, type FieldCar, type LiveDriver, type RaceEvent } from './liveRacing';
import { sessionFlag, type FlagKind, type FlagNote } from './raceFlags';
import type { User } from './users';

// TV Broadcast Mode's picture of the race (src/app/tv/): what the TV shows, worked out here from the Live Racing
// drivers the paired account may watch (readLiveDrivers, src/lib/liveRacing.ts), so the TV only draws it. Sent by
// GET /api/tv/stream (Server-Sent Events) whenever it changes, or by GET /api/tv/state to TVs that can't keep the
// stream open. Only what the collector sent: anything it didn't is null, shown as a dash, never guessed.

// The leaderboard's rows on a 1080p screen: the leaders, and around the focused driver when they're further back
export const TV_ROWS = 20;
const TOP_ROWS_WHEN_SPLIT = 10;
// The newest few race events, for the event feed
const TV_EVENTS = 6;

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
  // The car of the driver the TV follows, and of other RacingCoach.app drivers the account watches
  isFocus: boolean;
  isWatched: boolean;
  fastest: boolean;
};

export type TvEvent = { seq: number; at: number; event: RaceEvent };

export type TvFocus = {
  driverId: number;
  driver: string;
  isMe: boolean;
  offline: boolean;
  track: string;
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
  coachSpeaking: boolean;
  eventSeq: number;
  // null when the driver's collector doesn't send the field (before 1.52.0)
  rows: TvRow[] | null;
  multiClass: boolean;
  events: TvEvent[];
};

export type TvState = {
  // Server time (ms since the epoch) of this picture, for the events' ages
  at: number;
  drivers: { id: number; name: string; isMe: boolean; offline: boolean; track: string }[];
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

function leaderboard(focused: LiveDriver, watched: Set<string>): { rows: TvRow[]; multiClass: boolean } | null {
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
      isFocus: car.idx === field.myCarIdx,
      isWatched: watched.has(`${field.subSessionId}:${car.idx}`),
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

// The TV's picture for the account, following driverId when it may watch them, else the account's own driving, else
// the first driver listed
export async function readTvState(viewer: User, driverId: number | null): Promise<TvState> {
  const drivers = await readLiveDrivers(viewer, null);
  const focused =
    drivers.find((d) => d.userId === driverId) ?? drivers.find((d) => d.isMe) ?? drivers.find((d) => !d.offline) ?? drivers[0] ?? null;
  let focus: TvFocus | null = null;
  if (focused) {
    const watched = new Set(
      drivers.filter((d) => d.field?.myCarIdx != null).map((d) => `${d.field!.subSessionId}:${d.field!.myCarIdx}`)
    );
    const board = leaderboard(focused, watched);
    const flag = sessionFlag(focused.sessionFlags, focused.sessionState);
    const found = focused.offline ? null : await readRaceEvents(viewer, focused.userId, 0);
    focus = {
      driverId: focused.userId,
      driver: focused.driver,
      isMe: focused.isMe,
      offline: focused.offline,
      track: focused.track,
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
      coachSpeaking: !!focused.coachSpeaking,
      eventSeq: focused.eventSeq,
      rows: board?.rows ?? null,
      multiClass: board?.multiClass ?? false,
      events: (found?.events ?? []).slice(-TV_EVENTS).reverse(),
    };
  }
  return {
    at: Date.now(),
    drivers: drivers.map((d) => ({ id: d.userId, name: d.driver, isMe: d.isMe, offline: d.offline, track: d.track })),
    focus,
  };
}
