// The Race Strategist's numbers (src/lib/raceStrategy.ts) and the Race Broadcast tracker's pit report they come from
// (src/lib/broadcastTracker.ts): fuel and the pit window, what a stop costs, and where the driver rejoins after one.
// All pure. npm run test:race-strategy

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuelPlan, lapsToGo, pitActivity, pitLoss, projectPitExit } from '../src/lib/raceStrategy.ts';
import { BroadcastTracker, pitLosses } from '../src/lib/broadcastTracker.ts';

const car = (over) => ({
  idx: 0,
  driver: 'Me',
  number: '1',
  carClass: 'GT3',
  lap: 10,
  pct: 0.5,
  lapsDone: 9,
  position: 1,
  classPosition: 1,
  onPitRoad: false,
  secondsOnPitRoad: null,
  pitStops: 0,
  lastPitSeconds: null,
  lastPitLap: null,
  pitLosses: [],
  ...over,
});

const input = (over = {}) => ({
  isRace: true,
  myCarIdx: 0,
  cars: [car({})],
  lap: 10,
  pct: 0.5,
  fuelLevel: 40,
  fuelPerLap: 4,
  fuelLevelPct: 0.4,
  sessionLapsRemain: 20,
  sessionTimeRemain: null,
  bestLapTime: 99,
  lastLapTime: 101,
  averageLapTime: 100,
  ...over,
});

// ---- Fuel ----

test('laps to go: the session laps left, else whole laps in the time left plus the one the clock runs out on', () => {
  assert.deepEqual(lapsToGo(input()), { laps: 20, from: 'laps' });
  assert.deepEqual(lapsToGo(input({ sessionLapsRemain: null, sessionTimeRemain: 650 })), { laps: 7, from: 'time' });
  assert.deepEqual(lapsToGo(input({ sessionLapsRemain: null, sessionTimeRemain: 600 })), { laps: 7, from: 'time' });
  assert.equal(lapsToGo(input({ sessionLapsRemain: null, sessionTimeRemain: null })), null);
});

test('fuel plan: short, stops, what to add now and the window', () => {
  // 40 L, 4 a lap: 10 laps of fuel; 20 to go needs 80 L, 40 short; tank 100 L
  const plan = fuelPlan(input());
  assert.equal(plan.capacity, 100);
  assert.equal(plan.lapsOfFuel, 10);
  assert.equal(plan.neededToFinish, 80);
  assert.equal(plan.short, 40);
  assert.equal(plan.stopsNeeded, 1);
  assert.equal(plan.addNowToFinish, 40);
  assert.equal(plan.latestStopInLaps, 9);
  // a full tank is 25 laps, more than the 20 to go: one stop works from now
  assert.equal(plan.earliestOneStopInLaps, 0);
});

test('fuel plan: enough to finish means no stop', () => {
  const plan = fuelPlan(input({ sessionLapsRemain: 8 }));
  assert.equal(plan.short, 0);
  assert.equal(plan.stopsNeeded, 0);
  assert.equal(plan.latestStopInLaps, null);
});

test('fuel plan: a long race needs two stops, and one stop only works late', () => {
  // 60 to go needs 240 L: 200 short, 2 stops of a 100 L tank; the tank can take only 60 now
  const plan = fuelPlan(input({ sessionLapsRemain: 60 }));
  assert.equal(plan.stopsNeeded, 2);
  assert.equal(plan.addNowToFinish, null);
  assert.equal(plan.earliestOneStopInLaps, null);
  // 30 to go: one full tank (25 laps) works from 5 laps from now
  assert.equal(fuelPlan(input({ sessionLapsRemain: 30 })).earliestOneStopInLaps, 5);
});

test('fuel plan: no use per lap yet, no tank size, no fuel data', () => {
  const plan = fuelPlan(input({ fuelPerLap: null }));
  assert.equal(plan.lapsOfFuel, null);
  assert.equal(plan.neededToFinish, null);
  assert.equal(fuelPlan(input({ fuelLevelPct: null })).capacity, null);
  assert.equal(fuelPlan(input({ fuelLevelPct: null })).addNowToFinish, 40);
  assert.equal(fuelPlan(input({ fuelLevel: null })), null);
});

// ---- What a stop costs ----

test('pit loss: own stops first, then the class, then the field; never assumed', () => {
  const others = [car({ idx: 1, driver: 'A', pitLosses: [30, 34] }), car({ idx: 2, driver: 'B', carClass: 'GT4', pitLosses: [50] })];
  assert.deepEqual(pitLoss(input({ cars: [car({ pitLosses: [28] }), ...others] })), { seconds: 28, from: 'own', stops: 1, min: 28, max: 28 });
  assert.deepEqual(pitLoss(input({ cars: [car({}), ...others] })), { seconds: 32, from: 'class', stops: 2, min: 30, max: 34 });
  assert.equal(pitLoss(input({ cars: [car({}), others[1]] })).from, 'field');
  assert.equal(pitLoss(input({ cars: [car({})] })), null);
});

test('tracker pit losses: pit laps less as many clean laps, whole stops only', () => {
  const green = (t = 100) => ({ time: t, pit: false });
  const pit = (t) => ({ time: t, pit: true });
  // in-lap 110 and out-lap 120 against 100s: 30 s
  assert.deepEqual(pitLosses([green(), green(101), pit(110), pit(120), green()]), [30]);
  // the stop's last lap is still being driven: not whole yet
  assert.deepEqual(pitLosses([green(), pit(110), pit(120)], true), []);
  assert.deepEqual(pitLosses([green(), pit(110), pit(120)], false), [30]);
  // a run from the first lap seen (a start from the pits) and a tow are left out
  assert.deepEqual(pitLosses([pit(150), green(), green()]), []);
  assert.deepEqual(pitLosses([green(), pit(400), green()]), []);
});

test('tracker pit report: entries, time on pit road, stops and the laps when they ended', () => {
  const tracker = new BroadcastTracker();
  const snap = (at, onPitRoad, lapsDone, lastLapTime) => ({
    at,
    sessionType: 'Race',
    sessionState: 4,
    lapsTotal: 30,
    timeRemain: null,
    myCarIdx: 0,
    hasWeather: false,
    wet: false,
    cars: [
      { idx: 0, name: 'Me', number: '1', car: 'Car', carClass: 'GT3', pct: 0.5, lap: 5, lapsDone: 4, position: 2, classPosition: 2, onPitRoad: false, lastLapTime: 100 },
      { idx: 1, name: 'Rival', number: '2', car: 'Car', carClass: 'GT3', pct: 0.1, lap: lapsDone + 1, lapsDone, position: 1, classPosition: 1, onPitRoad, lastLapTime },
    ],
  });
  tracker.update(snap(0, false, 4, 100));
  tracker.update(snap(1000, true, 4, 100));
  tracker.update(snap(21_000, true, 4, 100));
  let rival = tracker.pitReport().find((c) => c.idx === 1);
  assert.equal(rival.onPitRoad, true);
  assert.equal(rival.secondsOnPitRoad, 20);
  tracker.update(snap(31_000, false, 5, 130));
  rival = tracker.pitReport().find((c) => c.idx === 1);
  assert.equal(rival.onPitRoad, false);
  assert.equal(rival.pitStops, 1);
  assert.equal(rival.lastPitSeconds, 30);
  assert.equal(rival.lastPitLap, 5);
});

// ---- Where the driver rejoins ----

// Pace 100 s: 0.01 lap is 1 s. Me at 10.5.
const field = () => [
  car({}),
  car({ idx: 1, driver: 'Ahead', number: '7', pct: 0.6, classPosition: 1 }), // 10 s ahead
  car({ idx: 2, driver: 'Close', number: '8', pct: 0.45, classPosition: 3 }), // 5 s behind
  car({ idx: 3, driver: 'Far', number: '9', pct: 0.1, classPosition: 4 }), // 40 s behind
  car({ idx: 4, driver: 'Lapped', number: '50', carClass: 'GT4', lap: 9, pct: 0.25 }), // 125 s behind, a lap down
];

test('pit exit: cars less than the stop behind get by; the cars around the rejoin', () => {
  const exit = projectPitExit(input({ cars: field() }), 30);
  assert.equal(exit.classPositionNow, 2);
  assert.equal(exit.classPositionAfter, 3);
  assert.deepEqual(exit.passedBy.map((c) => c.driver), ['Close']);
  assert.equal(exit.passedBy[0].gapNow, 5);
  assert.equal(exit.aheadAfter.driver, 'Close');
  assert.equal(exit.aheadAfter.gap, 25);
  assert.equal(exit.behindAfter.driver, 'Far');
  assert.equal(exit.behindAfter.gap, 10);
  assert.equal(exit.traffic.length, 0);
  // the GT4 a lap down counts overall
  assert.equal(exit.positionNow, 2);
  assert.equal(exit.positionAfter, 3);
});

test('pit exit: traffic on the road where the driver rejoins, laps apart or not', () => {
  // a 124 s stop puts the lapped GT4 (125 s behind) 1 s behind on the road
  const exit = projectPitExit(input({ cars: field() }), 124);
  assert.deepEqual(exit.traffic.map((c) => [c.driver, c.gap]), [['Lapped', -1]]);
  assert.equal(exit.traffic[0].sameClass, false);
});

test('pit exit: rivals ahead who have not stopped yet', () => {
  const cars = field();
  cars[0].pitStops = 1;
  cars[1].pitStops = 1;
  cars[2].pitStops = 2;
  const exit = projectPitExit(input({ cars }), 30);
  assert.deepEqual(exit.aheadYetToStop, ['Ahead']);
});

test('pit exit: a car on pit road now still has the rest of its stop to lose', () => {
  const cars = field();
  // Close, 5 s behind, has just entered pit road: its whole 30 s stop still to lose, so it stays 5 s behind
  cars[2].onPitRoad = true;
  cars[2].secondsOnPitRoad = 0;
  const exit = projectPitExit(input({ cars }), 30);
  assert.equal(exit.classPositionAfter, 2);
  assert.deepEqual(exit.passedBy, []);
  assert.equal(exit.behindAfter.driver, 'Close');
  assert.equal(exit.behindAfter.gap, 5);
  // nor is a car stopping now one that may still have to stop
  cars[1].onPitRoad = true;
  cars[1].secondsOnPitRoad = 29;
  assert.deepEqual(projectPitExit(input({ cars }), 30).aheadYetToStop, []);
});

test('pit exit: only in a race, with the driver on the road and a pace', () => {
  assert.equal(projectPitExit(input({ cars: field(), isRace: false }), 30), null);
  assert.equal(projectPitExit(input({ cars: field(), myCarIdx: null }), 30), null);
  assert.equal(projectPitExit(input({ cars: field(), averageLapTime: null, bestLapTime: null, lastLapTime: null }), 30), null);
  assert.equal(projectPitExit(input({ cars: field() }), 0), null);
});

test('pit activity: who is on pit road and who has stopped, not the driver', () => {
  const cars = field();
  cars[0].onPitRoad = true;
  cars[1].onPitRoad = true;
  cars[3].pitStops = 1;
  const activity = pitActivity(input({ cars }));
  assert.deepEqual(activity.onPitRoad.map((c) => c.driver), ['Ahead']);
  assert.deepEqual(activity.stopped.map((c) => c.driver), ['Far']);
});
