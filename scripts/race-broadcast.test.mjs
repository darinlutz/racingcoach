// The Race Broadcast's pure parts against simulated races: the field-wide tracker (src/lib/broadcastTracker.ts), the
// Commentary Director (src/lib/broadcastDirector.ts), the factual check (src/lib/broadcastValidation.ts), the
// preferences (src/lib/broadcastSettings.ts) and the playback queue (src/lib/tvAudio.ts). The AI and the voices aren't
// called; the last test prints what the Director chose through a whole simulated race, so its pacing can be read.
// npm run test:broadcast

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastTracker, TRACKER_CONFIG } from '../src/lib/broadcastTracker.ts';
import { classify, commitDecision, direct, intensityFor, newDirectorState, relevance } from '../src/lib/broadcastDirector.ts';
import { checkLine, deliveryText, fitToSeconds } from '../src/lib/broadcastValidation.ts';
import { broadcastSettingsPatch, DEFAULT_BROADCAST_SETTINGS, lineVolume, parseBroadcastSettings } from '../src/lib/broadcastSettings.ts';
import { CommentaryQueue } from '../src/lib/tvAudio.ts';

const TICK = 500;
const T0 = Date.UTC(2026, 9, 29, 18, 0, 0);

// A simulated race: each car runs at its lap time from its starting progress (laps), 2 updates a second like the
// collector; positions are by progress, as timing would have them
class Sim {
  constructor({ cars, lapsTotal = 20, myCarIdx = 0, state = 4, sessionType = 'Race', timeRemain = null }) {
    this.cars = cars.map((c) => ({ carClass: 'GT3', lapTime: 100, progress: 0, onPitRoad: false, offTrack: false, lastLapTime: null, best: null, ...c }));
    this.lapsTotal = lapsTotal;
    this.myCarIdx = myCarIdx;
    this.state = state;
    this.sessionType = sessionType;
    this.timeRemain = timeRemain;
    this.at = T0;
    this.tracker = new BroadcastTracker();
    this.events = [];
    this.seq = 0;
  }
  car(idx) {
    return this.cars.find((c) => c.idx === idx);
  }
  snapshot() {
    const ranked = (list) => [...list].sort((a, b) => b.progress - a.progress);
    const overall = ranked(this.cars);
    return {
      at: this.at,
      sessionType: this.sessionType,
      sessionState: this.state,
      lapsTotal: this.lapsTotal,
      timeRemain: this.timeRemain,
      myCarIdx: this.myCarIdx,
      cars: this.cars.map((c) => ({
        idx: c.idx,
        name: c.name,
        number: String(c.idx + 1),
        car: c.car ?? 'Porsche 911 GT3 R (992)',
        carClass: c.carClass,
        pct: c.missing ? null : ((c.progress % 1) + 1) % 1,
        lap: c.missing ? null : Math.floor(c.progress),
        lapsDone: Math.floor(c.progress),
        rate: c.stopped ? 0.0005 : c.onPitRoad ? 1 / (c.lapTime * 4) : 1 / c.lapTime,
        position: overall.indexOf(c) + 1,
        classPosition: ranked(this.cars.filter((o) => o.carClass === c.carClass)).indexOf(c) + 1,
        onPitRoad: c.onPitRoad,
        offTrack: c.offTrack,
        lastLapTime: c.lastLapTime,
        bestLapTime: c.best,
      })),
    };
  }
  // Moves the cars on by ms, feeding the tracker every TICK; returns the events
  run(ms) {
    const found = [];
    for (let t = 0; t < ms; t += TICK) {
      this.at += TICK;
      if (this.timeRemain != null) this.timeRemain = Math.max(0, this.timeRemain - TICK / 1000);
      for (const c of this.cars) {
        const before = Math.floor(c.progress);
        const speed = c.stopped ? 0.0005 : c.onPitRoad ? 1 / (c.lapTime * 4) : 1 / c.lapTime;
        c.progress += (speed * TICK) / 1000;
        if (Math.floor(c.progress) > before && !c.missing) {
          c.lastLapTime = c.lapTime + (c.idx % 3) * 0.05;
          c.best = c.best === null ? c.lastLapTime : Math.min(c.best, c.lastLapTime);
        }
      }
      for (const event of this.tracker.update(this.snapshot())) {
        const numbered = { seq: ++this.seq, at: this.at, event };
        this.events.push(numbered);
        found.push(event);
      }
    }
    return found;
  }
}

const field = (n, gapLaps = 0.02, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ idx: i, name: `Driver${String.fromCharCode(65 + i)} Racer`, progress: 1 - i * gapLaps, ...extra }));

const ctxFor = (sim, overrides = {}) => ({
  isRace: true,
  phase: sim.tracker.phase(),
  raceProgress: sim.tracker.raceProgress(),
  userIdx: sim.myCarIdx,
  userPosition: null,
  storylines: sim.tracker.storylines(),
  ...overrides,
});

const settings = (patch = {}) => ({ ...DEFAULT_BROADCAST_SETTINGS, ...patch });
const n = (event, seq = 1, at = T0) => ({ seq, at, event });

describe('tracker: race lifecycle', () => {
  test('the grid, then the start, with the driver\'s grid position', () => {
    const sim = new Sim({ cars: field(6), state: 3, myCarIdx: 3 });
    const pre = sim.run(1000);
    assert.equal(pre.filter((e) => e.type === 'preRace').length, 1);
    assert.equal(pre.find((e) => e.type === 'preRace').starters, 6);
    sim.state = 4;
    const start = sim.run(1000);
    const raceStart = start.find((e) => e.type === 'raceStart');
    assert.ok(raceStart);
    assert.equal(raceStart.userGrid, 4);
    assert.equal(sim.tracker.phase(), 'opening');
  });

  test('final lap, the winner with the margin, and the driver\'s finish', () => {
    const sim = new Sim({ cars: field(4, 0.004), lapsTotal: 3, myCarIdx: 2 });
    sim.run(500);
    for (const c of sim.cars) c.progress += 1.0;
    const events = sim.run(100_000);
    const finalLap = events.find((e) => e.type === 'finalLap');
    assert.ok(finalLap, 'final lap');
    assert.equal(finalLap.lapsTotal, 3);
    sim.state = 5;
    const end = sim.run(TICK);
    const won = end.find((e) => e.type === 'raceWon');
    assert.ok(won);
    assert.equal(won.winner, 'DriverA Racer');
    assert.ok(won.margin > 0.3 && won.margin < 0.5, `margin ${won.margin}`);
    assert.equal(won.userWon, false);
    const finished = [...end, ...sim.run(110_000)].find((e) => e.type === 'driverFinished');
    assert.ok(finished);
    assert.equal(finished.position, 3);
  });
});

describe('tracker: passes', () => {
  test('the driver passing a car is called once, with both names and the new position', () => {
    const sim = new Sim({ cars: field(3, 0.004), myCarIdx: 1 });
    sim.run(30_000);
    sim.car(1).lapTime = 98;
    const passes = sim.run(60_000).filter((e) => e.type === 'overtake');
    assert.equal(passes.length, 1);
    assert.deepEqual([passes[0].driver, passes[0].passed, passes[0].position, passes[0].user], ['DriverB Racer', 'DriverA Racer', 1, 'gained']);
  });

  test('cars swapping back and forth inside the confirmation time are not a pass', () => {
    const sim = new Sim({ cars: field(2, 0.0005), myCarIdx: 5 });
    sim.run(20_000);
    const events = [];
    for (let i = 0; i < 6; i++) {
      const [a, b] = [sim.car(0), sim.car(1)];
      [a.progress, b.progress] = [b.progress, a.progress];
      events.push(...sim.run(TICK));
    }
    assert.equal(events.filter((e) => e.type === 'overtake').length, 0);
  });

  test('a lap counter that lags the line crossing is not a pass', () => {
    const sim = new Sim({ cars: field(2, 0.01), myCarIdx: 5 });
    sim.run(20_000);
    // car 0 crosses the line: pct wraps but CarIdxLap counts up a sample late
    const tracker = new BroadcastTracker();
    const base = { at: T0, sessionType: 'Race', sessionState: 4, lapsTotal: 20, timeRemain: null, myCarIdx: 5 };
    const car = (idx, pct, lap) => ({ idx, name: `D${idx}`, carClass: 'GT3', pct, lap, rate: 0.01, position: idx + 1 });
    let events = [];
    events = events.concat(tracker.update({ ...base, cars: [car(0, 0.995, 4), car(1, 0.985, 4)] }));
    events = events.concat(tracker.update({ ...base, at: T0 + 500, cars: [car(0, 0.001, 4), car(1, 0.99, 4)] }));
    events = events.concat(tracker.update({ ...base, at: T0 + 1000, cars: [car(0, 0.006, 5), car(1, 0.995, 4)] }));
    events = events.concat(tracker.update({ ...base, at: T0 + 3500, cars: [car(0, 0.03, 5), car(1, 0.02, 5)] }));
    assert.equal(events.filter((e) => e.type === 'overtake').length, 0);
  });

  test('multiclass: a faster class lapping through is not an overtake, and class positions are used', () => {
    const cars = [
      { idx: 0, name: 'Proto One', carClass: 'LMP2', progress: 0.99, lapTime: 90 },
      { idx: 1, name: 'Gt Two', carClass: 'GT3', progress: 1.0, lapTime: 100 },
      { idx: 2, name: 'Gt Three', carClass: 'GT3', progress: 0.995, lapTime: 99 },
    ];
    const sim = new Sim({ cars, myCarIdx: 2 });
    const events = sim.run(60_000).filter((e) => e.type === 'overtake');
    assert.ok(sim.tracker.multiClass);
    assert.ok(events.every((e) => e.idx !== 0 && e.passedIdx !== 0), 'no pass across classes');
    const mine = events.find((e) => e.idx === 2);
    assert.ok(mine, 'same-class pass');
    assert.equal(mine.position, 1, 'class position');
  });
});

describe('tracker: battles, pits, incidents, storylines', () => {
  test('a battle starts once, repeats only when the gap really changes, and reports the closing rate', () => {
    // car 1 is 0.8 s behind car 0 and slowly closing
    const sim = new Sim({ cars: [{ idx: 0, name: 'Front Runner', progress: 1.008 }, { idx: 1, name: 'Chase Driver', progress: 1.0, lapTime: 99.9 }], myCarIdx: 1 });
    const events = sim.run(400_000).filter((e) => e.type === 'battle');
    assert.equal(events.filter((e) => e.phase === 'start').length, 1);
    const updates = events.filter((e) => e.phase === 'closing' || e.phase === 'veryClose');
    assert.ok(updates.length >= 1);
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].previousGap === null || Math.abs(events[i].gap - events[i].previousGap) >= 0.2 || events[i].phase !== 'closing');
    }
    assert.ok(events.every((e) => e.user));
  });

  test('a pit stop elsewhere is reported in and out with its time on pit road', () => {
    const sim = new Sim({ cars: field(4, 0.05), myCarIdx: 0 });
    sim.run(5000);
    sim.car(2).onPitRoad = true;
    const into = sim.run(1000);
    assert.ok(into.some((e) => e.type === 'pitStop' && e.phase === 'in' && e.idx === 2));
    sim.run(30_000);
    sim.car(2).onPitRoad = false;
    const out = sim.run(1000).find((e) => e.type === 'pitStop' && e.phase === 'out');
    assert.ok(out);
    assert.ok(out.seconds >= 30 && out.seconds <= 32, `seconds ${out.seconds}`);
  });

  test('incidents: one elsewhere is reported, one by the driver is left to nearbyIncident, two together are one', () => {
    const sim = new Sim({ cars: field(6, 0.1), myCarIdx: 0 });
    sim.run(5000);
    sim.car(1).stopped = true; // 0.1 laps from the driver: not nearby
    sim.car(3).stopped = true;
    sim.car(3).progress = sim.car(1).progress - 0.005; // with car 1
    const events = sim.run(TICK).filter((e) => e.type === 'fieldIncident');
    assert.equal(events.length, 1);
    assert.equal(events[0].idx, 1);
    assert.deepEqual(events[0].others, ['DriverD Racer']);
    const near = new Sim({ cars: field(3, 0.01), myCarIdx: 0 });
    near.run(5000);
    near.car(1).offTrack = true;
    assert.equal(near.run(TICK).filter((e) => e.type === 'fieldIncident').length, 0);
  });

  test('a recovery drive is a storyline, with the places measured', () => {
    const sim = new Sim({ cars: field(8, 0.003), state: 3, myCarIdx: 1 });
    sim.run(1000);
    sim.state = 4;
    sim.run(1000);
    // the driver drops to the back, then comes back through
    sim.car(1).progress -= 0.03;
    sim.run(60_000);
    sim.car(1).lapTime = 96;
    const stories = sim.run(200_000).filter((e) => e.type === 'storyline' && e.storyline.kind === 'recovery');
    assert.ok(stories.length >= 1, 'recovery storyline');
    const facts = stories[0].storyline.facts;
    assert.equal(facts.startPosition, 2);
    assert.equal(facts.worstPosition, 8);
    assert.ok(facts.regained >= 2);
  });

  test('missing telemetry never throws or invents events', () => {
    const tracker = new BroadcastTracker();
    for (let i = 0; i < 20; i++) {
      const events = tracker.update({
        at: T0 + i * TICK,
        sessionType: null,
        sessionState: null,
        lapsTotal: null,
        timeRemain: null,
        myCarIdx: null,
        cars: [{ idx: 0, name: null }, { idx: 1, name: 'X Y', pct: null, lap: null }],
      });
      assert.ok(events.every((e) => e.type === 'raceSummary' || e.type === 'statsUpdate'));
    }
    assert.equal(tracker.carStats(0), null);
  });
});

describe('director: priorities and coverage', () => {
  const overtake = (over) => ({ type: 'overtake', idx: 5, driver: 'Mid Field', passedIdx: 6, passed: 'Back Marker', position: 14, carClass: 'GT3', multiClass: false, user: null, finalLap: false, ...over });

  test('a critical incident elsewhere beats the driver\'s personal best', () => {
    const state = newDirectorState('s');
    const { decision } = direct({
      events: [
        n({ type: 'lapComplete', lap: 5, lapTime: 100.1, bestLapTime: 100.1, newBest: true }, 1),
        n({ type: 'fieldIncident', idx: 9, driver: 'The Leader', others: [], kind: 'slowed', position: 1, leader: true }, 2),
      ],
      now: T0 + 1000,
      settings: settings(),
      speakers: ['lead', 'color'],
      ctx: { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 0, userPosition: 12, storylines: [] },
      state,
    });
    assert.equal(decision.selected.event.type, 'fieldIncident');
    assert.equal(decision.selected.priority, 0);
    assert.ok(decision.intensity <= 4, 'a crash is called seriously');
  });

  test('the driver\'s pass for 15th beats an unrelated pass for 14th; balanced coverage narrows the gap', () => {
    const ctx = { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 0, userPosition: 15, storylines: [] };
    const events = [n(overtake({}), 1), n(overtake({ idx: 0, driver: 'Me Driver', passedIdx: 7, passed: 'Other One', position: 15, user: 'gained' }), 2)];
    const { decision } = direct({ events, now: T0 + 500, settings: settings(), speakers: ['lead', 'color'], ctx, state: newDirectorState('s') });
    assert.equal(decision.selected.seq, 2);
    assert.ok(relevance('userOvertake', 'balanced') < relevance('userOvertake', 'user'));
    assert.ok(relevance('userOvertake', 'maxUser') > relevance('userOvertake', 'user'));
    assert.equal(relevance('leadBattle', 'balanced'), relevance('leadBattle', 'maxUser'));
  });

  test('when the driver has had most of the airtime, the field gets the nod', () => {
    const ctx = { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 0, userPosition: 15, storylines: [] };
    const state = newDirectorState('s');
    state.coverage = Array.from({ length: 20 }, () => ({ user: true, idx: null }));
    const events = [
      n({ type: 'battle', phase: 'start', aheadIdx: 3, ahead: 'A A', behindIdx: 4, behind: 'B B', position: 3, carClass: null, gap: 0.7, previousGap: null, closingPerLap: null, laps: 0, user: false }, 1),
      n({ type: 'lapComplete', lap: 5, lapTime: 100, bestLapTime: 99, newBest: false }, 2),
      n({ type: 'pitExit' }, 3),
    ];
    const { decision } = direct({ events, now: T0 + 500, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.equal(decision.selected.event.type, 'battle');
  });

  test('the driver\'s position change and the tracker\'s named pass are one moment', () => {
    const ctx = { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 0, userPosition: 8, storylines: [] };
    const events = [n({ type: 'positionGained', from: 9, to: 8, passed: null }, 1), n(overtake({ idx: 0, driver: 'Me', passedIdx: 3, passed: 'You', position: 8, user: 'gained' }), 2)];
    const { decision, diagnostics } = direct({ events, now: T0 + 500, settings: settings(), speakers: ['lead', 'color'], ctx, state: newDirectorState('s') });
    assert.equal(decision.selected.event.type, 'overtake');
    assert.equal(diagnostics.find((d) => d.seq === 1).reason, 'sameMoment');
  });
});

describe('director: intensity', () => {
  const ctx = (phase) => ({ isRace: true, phase, raceProgress: phase === 'finalLaps' ? 0.98 : 0.5, userIdx: 0, userPosition: 5, storylines: [] });
  const pass = (over) => ({ type: 'overtake', idx: 3, driver: 'X', passedIdx: 4, passed: 'Y', position: 1, carClass: null, multiClass: false, user: null, finalLap: false, ...over });

  test('the driver\'s midrace pass for 14th is 3, into the podium late on is 4', () => {
    const state = newDirectorState('s');
    const mid = classify(n(pass({ idx: 0, position: 14, user: 'gained' })), ctx('middle'));
    assert.equal(mid.priority, 1);
    assert.equal(intensityFor(mid, ctx('middle'), state, T0, 5).lead, 3);
    const late = classify(n(pass({ idx: 0, position: 3, user: 'gained' })), ctx('finalQuarter'));
    assert.equal(intensityFor(late, ctx('finalQuarter'), state, T0, 5).lead, 4);
  });

  test('a last-lap pass for the win is 5; the same pass mid-race is not', () => {
    const state = newDirectorState('s');
    const win = classify(n(pass({ finalLap: true })), ctx('finalLaps'));
    assert.equal(intensityFor(win, ctx('finalLaps'), state, T0, 5).lead, 5);
    const mid = classify(n(pass({})), ctx('middle'));
    assert.equal(intensityFor(mid, ctx('middle'), state, T0, 5).lead, 4);
  });

  test('the driver being involved never makes 5 on its own, and 5 stays rare', () => {
    const state = newDirectorState('s');
    const types = [
      { type: 'overtake', idx: 0, driver: 'Me', passedIdx: 4, passed: 'Y', position: 2, carClass: null, multiClass: false, user: 'gained', finalLap: false },
      { type: 'battle', phase: 'veryClose', aheadIdx: 1, ahead: 'A', behindIdx: 0, behind: 'Me', position: 1, carClass: null, gap: 0.1, previousGap: 0.5, closingPerLap: 0.3, laps: 4, user: true },
      { type: 'incident', added: 4, total: 8 },
      { type: 'fieldIncident', idx: 2, driver: 'L', others: ['M', 'N'], kind: 'slowed', position: 1, leader: true },
      { type: 'leaderChange', leader: 'Me', previous: 'A' },
    ];
    let fives = 0;
    for (const phase of ['opening', 'middle', 'finalQuarter', 'finalLaps']) {
      for (const e of types) {
        const level = intensityFor(classify(n(e), ctx(phase)), ctx(phase), state, T0, 5).lead;
        if (level === 5) fives++;
      }
    }
    assert.equal(fives, 0);
  });

  test('the listener\'s maximum caps the voice, not the call; the analyst sits a level under in big moments', () => {
    const state = newDirectorState('s');
    const { decision } = direct({
      events: [n(pass({ finalLap: true }), 1, T0)],
      now: T0 + 200,
      settings: settings({ maxIntensity: 3 }),
      speakers: ['lead', 'color'],
      ctx: ctx('finalLaps'),
      state,
    });
    assert.ok(decision, 'still announced');
    assert.equal(decision.intensity, 3);
    const lead = classify(n({ type: 'leaderChange', leader: 'A', previous: 'B' }), ctx('middle'));
    const both = intensityFor(lead, ctx('middle'), state, T0, 5);
    assert.equal(both.lead, 4);
    assert.equal(both.color, 3);
  });

  test('a continuing battle moves one level at a time', () => {
    const state = newDirectorState('s');
    state.level = 1;
    state.levelAt = T0;
    const battle = classify(
      n({ type: 'battle', phase: 'veryClose', aheadIdx: 1, ahead: 'A', behindIdx: 0, behind: 'Me', position: 1, carClass: null, gap: 0.1, previousGap: 0.5, closingPerLap: 0.3, laps: 4, user: true }),
      ctx('finalLaps')
    );
    assert.equal(intensityFor(battle, ctx('finalLaps'), state, T0 + 5000, 5).lead, 2);
    assert.equal(intensityFor(battle, ctx('finalLaps'), state, T0 + 60_000, 5).lead, 4);
  });
});

describe('director: pacing, modes and repetition', () => {
  const ctx = { isRace: true, phase: 'middle', raceProgress: 0.5, userIdx: 0, userPosition: 10, storylines: [] };
  const battle = (gap, seq, at) =>
    n({ type: 'battle', phase: 'closing', aheadIdx: 1, ahead: 'A', behindIdx: 0, behind: 'Me', position: 9, carClass: null, gap, previousGap: gap + 0.3, closingPerLap: 0.2, laps: 2, user: true }, seq, at);

  test('broadcast off, and no announcers, say nothing', () => {
    for (const [s, speakers] of [[settings({ mode: 'off' }), ['lead']], [settings(), []]]) {
      const { decision, diagnostics } = direct({ events: [battle(0.5, 1, T0)], now: T0, settings: s, speakers, ctx, state: newDirectorState('s') });
      assert.equal(decision, null);
      assert.equal(diagnostics[0].verdict, 'suppressed');
    }
  });

  test('quiet mode keeps only critical moments and the driver\'s big ones', () => {
    const run = (event) => direct({ events: [n(event, 1, T0)], now: T0, settings: settings({ mode: 'quiet' }), speakers: ['lead', 'color'], ctx, state: newDirectorState('s') }).decision;
    assert.equal(run({ type: 'statsUpdate' }), null);
    assert.equal(run({ type: 'pitStop', phase: 'out', idx: 4, driver: 'X', position: 9, positionBefore: 7, seconds: 30 }), null);
    assert.ok(run({ type: 'positionGained', from: 10, to: 9, passed: 'Y' }));
    const d = run({ type: 'raceStart', starters: 20, userGrid: 10 });
    assert.equal(d.format, 'leadColor');
  });

  test('while the last lines are still playing, only the important replace them', () => {
    const state = newDirectorState('s');
    state.busyUntil = T0 + 8000;
    state.busyPriority = 2;
    const routine = direct({ events: [n({ type: 'pitExit' }, 1, T0)], now: T0, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.equal(routine.decision, null);
    assert.equal(routine.diagnostics[0].reason, 'busy');
    const big = direct({ events: [n({ type: 'positionLost', from: 9, to: 10, passedBy: 'Y' }, 2, T0)], now: T0, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.ok(big.decision);
    assert.equal(big.decision.replaceQueued, true);
    state.busyPriority = 1;
    const equal = direct({ events: [n({ type: 'positionLost', from: 10, to: 11, passedBy: 'Z' }, 3, T0)], now: T0, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.equal(equal.decision, null, 'an equally important line waits for the one playing');
  });

  test('a gap already reported isn\'t reported again; a real change is', () => {
    const state = newDirectorState('s');
    const first = direct({ events: [battle(0.6, 1, T0)], now: T0, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    commitDecision(state, first.decision, T0, 4000, first.decision.format, 0);
    const same = direct({ events: [battle(0.55, 2, T0 + 30_000)], now: T0 + 30_000, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.equal(same.decision, null);
    assert.equal(same.diagnostics[0].reason, 'gapUnchanged');
    const soon = direct({ events: [battle(0.2, 3, T0 + 6000)], now: T0 + 6000, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.equal(soon.diagnostics[0].reason, 'repeat');
    const changed = direct({ events: [battle(0.2, 4, T0 + 30_000)], now: T0 + 30_000, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.ok(changed.decision);
  });

  test('a stale event is dropped, and statistics follow the preference', () => {
    const stale = direct({ events: [n({ type: 'pitExit' }, 1, T0)], now: T0 + 60_000, settings: settings(), speakers: ['lead'], ctx, state: newDirectorState('s') });
    assert.equal(stale.diagnostics[0].reason, 'stale');
    const state = newDirectorState('s');
    const off = direct({ events: [n({ type: 'statsUpdate' }, 1, T0)], now: T0, settings: settings({ statistics: false }), speakers: ['lead', 'color'], ctx, state });
    assert.equal(off.diagnostics[0].reason, 'statisticsOff');
    const on = direct({ events: [n({ type: 'statsUpdate' }, 1, T0)], now: T0, settings: settings(), speakers: ['lead', 'color'], ctx, state });
    assert.ok(on.decision);
  });

  test('formats: one voice when only one is on, a routine lap is the Lead alone', () => {
    const one = (speakers, event) => direct({ events: [n(event, 1, T0)], now: T0, settings: settings(), speakers, ctx, state: newDirectorState('s') }).decision;
    assert.equal(one(['color'], { type: 'raceStart', starters: 20, userGrid: 4 }).format, 'color');
    assert.equal(one(['lead'], { type: 'statsUpdate' }).format, 'lead');
    assert.equal(one(['lead', 'color'], { type: 'lapComplete', lap: 4, lapTime: 101, bestLapTime: 100, newBest: false }).format, 'lead');
  });
});

describe('validation', () => {
  const facts = {
    allowedNames: ['Darin Lutz', 'Maria Martinez'],
    fieldNames: ['Darin Lutz', 'Maria Martinez', 'Tom Thompson', 'Sam Lutz2'],
    allowedNumbers: [9, 12],
    allowedDecimals: ['0.4', '1:42.318'],
  };
  test('drivers it wasn\'t told about are refused', () => {
    assert.deepEqual(checkLine('Lutz is closing on Martinez.', facts), { ok: true });
    assert.equal(checkLine('Thompson is struggling behind them.', facts).reason, 'unsupportedDriver');
    assert.deepEqual(checkLine('That gap belongs to Lutz.', facts), { ok: true }, 'a shared last name passes');
  });
  test('numbers it wasn\'t given are refused', () => {
    assert.deepEqual(checkLine('Lutz in P9, gap 0.4, a 1:42.3.', facts), { ok: true });
    assert.equal(checkLine('He has gained 5 places.', facts).reason, 'unsupportedNumber');
    assert.equal(checkLine('Gap is 0.7 now.', facts).reason, 'unsupportedNumber');
  });
  test('delivery text for the intensity', () => {
    assert.equal(deliveryText('HUGE move!!', 1), 'Huge move.');
    assert.equal(deliveryText('He goes! And again! And again!', 3), 'He goes! And again. And again.');
    assert.equal(deliveryText('He goes! And again! And again!', 5), 'He goes! And again! And again.');
    assert.equal(deliveryText('The GT3 field', 1), 'The GT3 field');
  });
  test('a long line is cut at a sentence end', () => {
    const text = 'One two three four five. Six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.';
    assert.equal(fitToSeconds(text, 2), 'One two three four five.');
  });
});

describe('settings and playback', () => {
  test('preferences are validated and filled in with the defaults', () => {
    assert.equal(broadcastSettingsPatch({ mode: 'loud' }), null);
    assert.equal(broadcastSettingsPatch({ maxIntensity: 6 }), null);
    assert.deepEqual(broadcastSettingsPatch({ maxIntensity: 3, leadVolume: 140 }), { maxIntensity: 3, leadVolume: 100 });
    const parsed = parseBroadcastSettings({ mode: 'quiet', focus: 'nobody', statistics: false });
    assert.equal(parsed.mode, 'quiet');
    assert.equal(parsed.focus, 'user');
    assert.equal(parsed.statistics, false);
    assert.equal(lineVolume({ ...parsed, masterVolume: 50, colorVolume: 80 }, 'color'), 0.4);
  });

  test('a more important commentary replaces lower-priority lines still waiting; expired lines are dropped', () => {
    const q = new CommentaryQueue();
    q.push([{ speaker: 'lead', text: 'routine', audio: 'a', priority: 3 }, { speaker: 'color', text: 'analysis', audio: 'b', priority: 3 }], 0);
    q.push([{ speaker: 'lead', text: 'big moment', audio: 'c', priority: 1 }], 100, true);
    assert.equal(q.size, 1);
    assert.equal(q.next(200).text, 'big moment');
    q.push([{ speaker: 'lead', text: 'old news', audio: 'd', priority: 2, expiresAt: 1000 }], 300);
    assert.equal(q.next(2000), null);
    assert.equal(q.dropped, 3);
  });
});

describe('a simulated race through the Director', () => {
  test('pacing, coverage and intensity over a 12-car race', () => {
    const cars = field(12, 0.004);
    cars[7].lapTime = 99.3; // the driver, P8, is quicker than the cars ahead
    cars[1].lapTime = 99.8; // a fight for the lead develops
    const sim = new Sim({ cars, myCarIdx: 7, state: 3, lapsTotal: 12 });
    sim.run(2000);
    sim.state = 4;
    const state = newDirectorState('race');
    const report = [];
    let after = 0;
    let busy = 0;
    for (let t = 0; t < 1_150_000; t += 1000) {
      sim.run(1000);
      if (t === 400_000) sim.car(3).stopped = true;
      if (t === 420_000) sim.car(3).stopped = false;
      if (sim.tracker.lapsRemaining() === 0 && sim.state === 4) sim.state = 5;
      const events = sim.events.filter((e) => e.seq > after);
      if (events.length === 0) continue;
      after = sim.seq;
      const { decision } = direct({ events, now: sim.at, settings: settings(), speakers: ['lead', 'color'], ctx: ctxFor(sim), state });
      if (!decision) continue;
      const lines = decision.format === 'leadColorLead' ? 3 : decision.format.length > 5 ? 2 : 1;
      commitDecision(state, decision, sim.at, lines * 5000, decision.format, sim.myCarIdx);
      busy += lines * 5000;
      report.push(
        `${String(Math.round((sim.at - T0) / 1000)).padStart(5)}s  P${decision.selected.priority} i${decision.intensity}/${decision.colorIntensity} ${decision.format.padEnd(13)} ${decision.selected.event.type}${decision.userRelated ? '  (driver)' : ''}`
      );
    }
    console.log(`\nDirector's choices through the simulated race:\n${report.join('\n')}\n`);
    assert.ok(report.length >= 10, 'the race gets commentary');
    assert.ok(report.some((r) => r.includes('raceStart')));
    assert.ok(report.some((r) => r.includes('(driver)')) && report.some((r) => !r.includes('(driver)')), 'the driver and the field');
    assert.ok(report.filter((r) => / i5\//.test(r)).length <= 2, 'level 5 is rare');
    assert.ok(busy < 1_150_000 * 0.6, 'there is silence too');
    assert.equal(TRACKER_CONFIG.passConfirmMs, 2000);
  });
});
