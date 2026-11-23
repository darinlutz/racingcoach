// The Race Strategist's numbers (src/lib/raceStrategist.ts): fuel, the pit window, what a stop costs and where the
// driver would come back out on track after one. Pure (no I/O, timers or imports with code), so Node's tests run it
// directly (npm run test:race-strategy). Everything comes from the collector's live updates and the Race Broadcast's
// tracker (src/lib/broadcastTracker.ts, which sees every car go on and off pit road):
//
// - Fuel: the fuel left and the average used per green lap (the collector's fuelLevel and fuelPerLap, liters), the
//   tank's size from the share of it left (fuelLevelPct), and the laps to the end from the session's laps left, or its
//   time left over the driver's pace. The lap being driven counts as a whole lap, which is the margin.
// - What a stop costs: measured, never assumed. The laps that touched pit road, less as many green laps, for the
//   driver's own stops first, else the median of their class's, else of the whole field's (TrackerPitCar.pitLosses).
// - Where the driver comes out: every car's place on the road (CarIdxLap + CarIdxLapDistPct) as time at the driver's
//   pace; a stop costing L seconds puts every car less than L behind the driver ahead of them. The field is taken as it
//   is now, at everyone's present pace, so it's a projection, labelled so, and says which of the cars ahead still have
//   fewer stops than the driver would.

export type StrategyCar = {
  idx: number;
  driver: string | null;
  number: string | null;
  carClass: string | null;
  // CarIdxLap (the lap being driven) and CarIdxLapDistPct
  lap: number | null;
  pct: number | null;
  lapsDone: number | null;
  position: number | null;
  classPosition: number | null;
  onPitRoad: boolean;
  // From the tracker: on pit road for how long now, stops seen, the last one's time on pit road and completed laps
  // when it ended, and what each stop cost (seconds)
  secondsOnPitRoad: number | null;
  pitStops: number;
  lastPitSeconds: number | null;
  lastPitLap: number | null;
  pitLosses: number[];
};

export type StrategyInput = {
  isRace: boolean;
  myCarIdx: number | null;
  cars: StrategyCar[];
  // The driver's own lap being driven and how far round it (when the field doesn't have their car)
  lap: number | null;
  pct: number | null;
  // Liters; fuelLevelPct 0-1
  fuelLevel: number | null;
  fuelPerLap: number | null;
  fuelLevelPct: number | null;
  sessionLapsRemain: number | null;
  sessionTimeRemain: number | null;
  // The driver's lap times, seconds
  bestLapTime: number | null;
  lastLapTime: number | null;
  // Average of the driver's recent clean laps, when known (the tracker's CarStats.average)
  averageLapTime: number | null;
};

export type FuelPlan = {
  level: number;
  perLap: number | null;
  // The tank's size, from the share of it left; null when not known
  capacity: number | null;
  lapsOfFuel: number | null;
  lapsToGo: number | null;
  lapsToGoFrom: 'laps' | 'time' | null;
  // Liters to the end, and how many more than in the tank (0 when it's enough)
  neededToFinish: number | null;
  short: number | null;
  // Stops needed to finish, and liters to add now to finish (null when the tank can't hold it)
  stopsNeeded: number | null;
  addNowToFinish: number | null;
  // Laps from now: the last lap to come in on before the fuel runs out, and the first from which one stop gets to the end
  latestStopInLaps: number | null;
  earliestOneStopInLaps: number | null;
};

export type PitLoss = {
  seconds: number;
  from: 'own' | 'class' | 'field';
  stops: number;
  min: number;
  max: number;
};

export type ExitCar = { driver: string; number: string | null; carClass: string | null; gap: number; sameClass: boolean };

export type PitExit = {
  lossSeconds: number;
  classPositionNow: number;
  classPositionAfter: number;
  positionNow: number;
  positionAfter: number;
  // Cars of the driver's class who'd get by while they stop, closest first
  passedBy: { driver: string; number: string | null; gapNow: number; onPitRoad: boolean }[];
  // The cars of their class just ahead and behind after the stop, seconds on the road
  aheadAfter: ExitCar | null;
  behindAfter: ExitCar | null;
  // Any car within TRAFFIC_SECONDS on the road where they rejoin, any class (lapped cars included)
  traffic: ExitCar[];
  // Of the class's cars ahead after the stop, those with no more stops than the driver has now (and not stopping now),
  // who'd still have one to make if they need as many
  aheadYetToStop: string[];
};

export const TRAFFIC_SECONDS = 1.5;

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function myCar(input: Pick<StrategyInput, 'cars' | 'myCarIdx'>): StrategyCar | null {
  return input.myCarIdx == null ? null : input.cars.find((c) => c.idx === input.myCarIdx) ?? null;
}

// The driver's lap time to judge time on the road by: their recent clean average, else best, else last
export function strategyPace(input: Pick<StrategyInput, 'averageLapTime' | 'bestLapTime' | 'lastLapTime'>): number | null {
  for (const t of [input.averageLapTime, input.bestLapTime, input.lastLapTime]) if (t != null && t > 0) return t;
  return null;
}

// Laps to the end: the session's laps left, else its time left over the pace (the race ends at the line after the
// clock runs out, so one more than whole laps fit)
export function lapsToGo(input: StrategyInput): { laps: number; from: 'laps' | 'time' } | null {
  if (input.sessionLapsRemain != null) return { laps: input.sessionLapsRemain, from: 'laps' };
  const pace = strategyPace(input);
  if (input.sessionTimeRemain != null && pace) return { laps: Math.floor(input.sessionTimeRemain / pace) + 1, from: 'time' };
  return null;
}

export function fuelPlan(input: StrategyInput): FuelPlan | null {
  const level = input.fuelLevel;
  if (level == null) return null;
  const perLap = input.fuelPerLap != null && input.fuelPerLap > 0 ? input.fuelPerLap : null;
  const capacity = input.fuelLevelPct != null && input.fuelLevelPct >= 0.02 ? level / input.fuelLevelPct : null;
  const toGo = lapsToGo(input);
  const plan: FuelPlan = {
    level,
    perLap,
    capacity: capacity != null ? round1(capacity) : null,
    lapsOfFuel: perLap ? level / perLap : null,
    lapsToGo: toGo?.laps ?? null,
    lapsToGoFrom: toGo?.from ?? null,
    neededToFinish: null,
    short: null,
    stopsNeeded: null,
    addNowToFinish: null,
    latestStopInLaps: null,
    earliestOneStopInLaps: null,
  };
  if (!perLap) return plan;
  const lapsOfFuel = level / perLap;
  // Come in on a lap that still has the fuel to reach pit road: the last whole lap the tank covers
  plan.latestStopInLaps = Math.max(0, Math.floor(lapsOfFuel) - 1);
  if (!toGo) return plan;
  const needed = toGo.laps * perLap;
  plan.neededToFinish = needed;
  plan.short = Math.max(0, needed - level);
  if (plan.short === 0) {
    plan.stopsNeeded = 0;
    plan.latestStopInLaps = null;
    return plan;
  }
  if (capacity != null) {
    plan.stopsNeeded = Math.ceil(plan.short / capacity);
    plan.addNowToFinish = plan.short <= capacity - level ? plan.short : null;
    // One stop is enough once the laps after it fit in a full tank
    const lapsPerTank = capacity / perLap;
    const earliest = Math.max(0, Math.ceil(toGo.laps - lapsPerTank));
    plan.earliestOneStopInLaps = earliest <= plan.latestStopInLaps ? earliest : null;
  } else {
    plan.addNowToFinish = plan.short;
  }
  return plan;
}

// What a stop costs: the driver's own measured stops, else their class's, else the field's (median of each car's)
export function pitLoss(input: Pick<StrategyInput, 'cars' | 'myCarIdx'>): PitLoss | null {
  const me = myCar(input);
  const pick = (losses: number[], from: PitLoss['from']): PitLoss | null =>
    losses.length
      ? { seconds: round1(median(losses)), from, stops: losses.length, min: Math.min(...losses), max: Math.max(...losses) }
      : null;
  const own = pick(me?.pitLosses ?? [], 'own');
  if (own) return own;
  const others = input.cars.filter((c) => c.idx !== input.myCarIdx);
  const sameClass = others.filter((c) => (c.carClass ?? null) === (me?.carClass ?? null)).flatMap((c) => c.pitLosses);
  return pick(sameClass, 'class') ?? pick(others.flatMap((c) => c.pitLosses), 'field');
}

const progressOf = (car: Pick<StrategyCar, 'lap' | 'pct'>) =>
  car.lap != null && car.lap >= 0 && car.pct != null && car.pct >= 0 ? car.lap + car.pct : null;

// Where the driver would come out after a stop costing lossSeconds, the field taken as it is now; null outside a race,
// or without the driver's place on the road or a pace
export function projectPitExit(input: StrategyInput, lossSeconds: number): PitExit | null {
  if (!input.isRace || !(lossSeconds > 0)) return null;
  const me = myCar(input);
  const pace = strategyPace(input);
  const mine = me ? progressOf(me) : progressOf(input);
  if (!me || mine == null || !pace) return null;
  const myClass = me.carClass ?? null;
  const cars = input.cars
    .filter((c) => c.idx !== me.idx && c.driver)
    .map((c) => ({ car: c, progress: progressOf(c) }))
    .filter((c): c is { car: StrategyCar; progress: number } => c.progress != null)
    .map(({ car, progress }) => ({
      car,
      // A car on pit road now still has the rest of its stop to lose: about as much as the driver's, less its time
      // there so far
      aheadNow: (progress - mine) * pace - (car.onPitRoad ? Math.max(0, lossSeconds - (car.secondsOnPitRoad ?? 0)) : 0),
      sameClass: (car.carClass ?? null) === myClass,
    }));
  const classCars = cars.filter((c) => c.sameClass);
  const classPositionNow = 1 + classCars.filter((c) => c.aheadNow > 0).length;
  const positionNow = 1 + cars.filter((c) => c.aheadNow > 0).length;
  const after = (c: (typeof cars)[number]) => c.aheadNow + lossSeconds;
  const label = (c: (typeof cars)[number], gap: number): ExitCar => ({
    driver: c.car.driver!,
    number: c.car.number,
    carClass: c.car.carClass,
    gap: round1(gap),
    sameClass: c.sameClass,
  });
  const aheadAfter = classCars.filter((c) => after(c) > 0).sort((a, b) => after(a) - after(b))[0] ?? null;
  const behindAfter = classCars.filter((c) => after(c) <= 0).sort((a, b) => after(b) - after(a))[0] ?? null;
  // On the road, laps apart or not: the gap wrapped into half a lap either way
  const roadGap = (c: (typeof cars)[number]) => {
    const laps = after(c) / pace;
    return (laps - Math.round(laps)) * pace;
  };
  const myStops = me.pitStops;
  return {
    lossSeconds: round1(lossSeconds),
    classPositionNow,
    classPositionAfter: 1 + classCars.filter((c) => after(c) > 0).length,
    positionNow,
    positionAfter: 1 + cars.filter((c) => after(c) > 0).length,
    passedBy: classCars
      .filter((c) => c.aheadNow <= 0 && after(c) > 0)
      .sort((a, b) => b.aheadNow - a.aheadNow)
      .map((c) => ({ driver: c.car.driver!, number: c.car.number, gapNow: round1(-c.aheadNow), onPitRoad: c.car.onPitRoad })),
    aheadAfter: aheadAfter ? label(aheadAfter, after(aheadAfter)) : null,
    behindAfter: behindAfter ? label(behindAfter, -after(behindAfter)) : null,
    traffic: cars
      .filter((c) => !c.car.onPitRoad && Math.abs(roadGap(c)) <= TRAFFIC_SECONDS)
      .sort((a, b) => Math.abs(roadGap(a)) - Math.abs(roadGap(b)))
      .slice(0, 4)
      .map((c) => label(c, roadGap(c))),
    aheadYetToStop: classCars.filter((c) => after(c) > 0 && !c.car.onPitRoad && c.car.pitStops <= myStops).map((c) => c.car.driver!),
  };
}

// Cars on pit road now, and the stops seen, for the strategist's facts
export function pitActivity(input: Pick<StrategyInput, 'cars' | 'myCarIdx'>): {
  onPitRoad: StrategyCar[];
  stopped: StrategyCar[];
} {
  const others = input.cars.filter((c) => c.idx !== input.myCarIdx && c.driver);
  return {
    onPitRoad: others.filter((c) => c.onPitRoad),
    stopped: others.filter((c) => c.pitStops > 0),
  };
}
