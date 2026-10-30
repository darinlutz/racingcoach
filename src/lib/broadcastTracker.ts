// The Race Broadcast's view of the whole field (src/lib/broadcastDirector.ts decides what the announcers say about
// it). One BroadcastTracker per live driver's session, fed every live update (recordLiveUpdate in
// src/lib/liveRacing.ts): from every car's CarIdx telemetry it keeps lap times, positions, pit stops and the gaps
// between neighbours, and detects what happens anywhere in the race, not only around the driver: passes, battles and
// their gap trends, pit stops, incidents, the start, the final lap and the finish, plus storylines that last (a
// recovery drive, a charge through the field, a long battle, a leader under pressure). Events about the driver's own
// laps, pit stops and incidents still come from detectRaceEvents.
//
// What the live updates don't have, the broadcast never claims: no sector times, tire wear, fuel, contact between
// cars or official results (session info's results aren't sent live).
//
// Passes are seen on track, by lap progress (CarIdxLap + CarIdxLapDistPct), as CarIdxPosition only changes at the
// timing lines; a pass counts once the passing car has stayed ahead PASS_CONFIRM_MS, so side-by-side cars swapping
// back and forth, or a timing glitch at the line, isn't called. No imports, so Node's tests run it directly
// (npm run test:broadcast).

// A car as the collector sends it (fieldCarSchema with its details), nulls where it sent nothing
export type TrackerCar = {
  idx: number;
  name: string | null;
  number?: string | null;
  car?: string | null;
  carClass?: string | null;
  pct?: number | null;
  rate?: number | null;
  lap?: number | null;
  lapsDone?: number | null;
  position?: number | null;
  classPosition?: number | null;
  onPitRoad?: boolean | null;
  offTrack?: boolean | null;
  lastLapTime?: number | null;
  bestLapTime?: number | null;
};

export type TrackerSnapshot = {
  // ms since the epoch
  at: number;
  sessionType: string | null;
  sessionState: number | null;
  lapsTotal: number | null;
  timeRemain: number | null;
  // The live driver's own car
  myCarIdx: number | null;
  cars: TrackerCar[];
};

export type StorylineKind = 'recovery' | 'charge' | 'longBattle' | 'leaderPressure';

export type Storyline = {
  id: string;
  kind: StorylineKind;
  cars: number[];
  drivers: string[];
  startedAt: number;
  updatedAt: number;
  status: 'active' | 'resolved';
  // What the story is made of, all measured: positions, laps, seconds
  facts: Record<string, number | string | null>;
  // 1 minor, 3 major
  significance: 1 | 2 | 3;
};

export type BattlePhase = 'start' | 'veryClose' | 'closing' | 'pulling' | 'ended';

// What the tracker detects; positions are class positions in a multiclass race, else overall
export type BroadcastEvent =
  | { type: 'preRace'; starters: number; pole: string | null; userGrid: number | null; classes: string[]; lapsTotal: number | null; minutes: number | null }
  | { type: 'raceStart'; starters: number; userGrid: number | null }
  | {
      type: 'overtake';
      idx: number;
      driver: string;
      passedIdx: number;
      passed: string;
      position: number;
      carClass: string | null;
      multiClass: boolean;
      user: 'gained' | 'lost' | null;
      finalLap: boolean;
    }
  | {
      type: 'battle';
      phase: BattlePhase;
      aheadIdx: number;
      ahead: string;
      behindIdx: number;
      behind: string;
      position: number;
      carClass: string | null;
      gap: number;
      previousGap: number | null;
      closingPerLap: number | null;
      laps: number;
      user: boolean;
    }
  | { type: 'pitStop'; phase: 'in' | 'out'; idx: number; driver: string; position: number | null; positionBefore: number | null; seconds: number | null }
  | { type: 'fieldIncident'; idx: number; driver: string; others: string[]; kind: 'offTrack' | 'slowed'; position: number | null; leader: boolean }
  | { type: 'finalLap'; leader: string; lapsTotal: number }
  | { type: 'raceWon'; winner: string; winnerIdx: number; margin: number | null; userWon: boolean }
  | { type: 'driverFinished'; position: number | null; gained: number | null }
  | { type: 'storyline'; storyline: Storyline }
  // Prompts for a race summary or a statistic; the Commentary Director decides whether one is due
  | { type: 'raceSummary' }
  | { type: 'statsUpdate' };

export type SessionPhase =
  | 'practice'
  | 'qualifying'
  | 'session'
  | 'preRace'
  | 'opening'
  | 'middle'
  | 'finalQuarter'
  | 'finalLaps'
  | 'finished';

export type CarStats = {
  idx: number;
  driver: string;
  carClass: string | null;
  car: string | null;
  number: string | null;
  // Class position in a multiclass race, else overall, by timing (CarIdxPosition) and live on track
  position: number | null;
  livePosition: number | null;
  startPosition: number | null;
  gained: number | null;
  cleanLaps: number;
  best: number | null;
  last: number | null;
  average: number | null;
  // Standard deviation of the clean laps, seconds
  consistency: number | null;
  // Average of the last 3 clean laps minus the 3 before; negative is getting faster
  trend: number | null;
  // Rank of the last 3 clean laps' average among the class's cars with as many, 1 fastest
  paceRank: number | null;
  pitStops: number;
  lastPitSeconds: number | null;
};

// iRacing's irsdk_SessionState
const RACING = 4;
const CHECKERED = 5;

export const TRACKER_CONFIG = {
  // A pass counts once held this long, and the same two cars once in PASS_COOLDOWN_MS
  passConfirmMs: 2000,
  passCooldownMs: 8000,
  // Cars this close on the lap can pass each other (laps); further apart it's lapping or a pit cycle
  passMaxLaps: 0.02,
  // Individual passes in the start's first seconds aren't called (except the driver's own)
  startQuietMs: 15_000,
  // Battle bands, seconds
  veryCloseGap: 0.5,
  activeGap: 1.0,
  developingGap: 2.0,
  // A band holds this long before it counts (dropping out of a battle takes longer)
  bandHoldMs: 3000,
  bandDropHoldMs: 6000,
  // A battle's gap is reported again once it changes this much, at most once in battleRepeatMs
  gapChange: 0.3,
  battleRepeatMs: 15_000,
  // A developing battle is worth mentioning once the chaser gains this much a lap
  closingPerLap: 0.2,
  // Incidents: a car counts once in this long; a car slowed suddenly when its pace drops below this share, from at
  // least minSlowedRate (laps a second)
  incidentCooldownMs: 15_000,
  slowedShare: 0.35,
  minSlowedRate: 0.004,
  // Incidents within this much of the driver's car are detectRaceEvents' nearbyIncident
  nearbyLaps: 0.03,
  // Cars this close together in incidents at once are one incident
  multiCarLaps: 0.01,
  // Laps slower than this share of the car's best don't count for its pace
  cleanLapShare: 1.07,
  // Prompts for a summary and a statistic come often; the Commentary Director spaces what's said (by mode and
  // frequency) and lets one through when the announcers are free
  summaryFirstMs: 120_000,
  summaryEveryMs: 60_000,
  statsFirstMs: 75_000,
  statsEveryMs: 45_000,
};

type LapRecord = { time: number; pit: boolean };

type CarState = {
  idx: number;
  name: string | null;
  car: string | null;
  number: string | null;
  carClass: string;
  progress: number | null;
  rate: number | null;
  lapsDone: number | null;
  onPitRoad: boolean;
  offTrack: boolean;
  lastLapTime: number | null;
  laps: LapRecord[];
  pitThisLap: boolean;
  pitEnteredAt: number | null;
  pitPositionBefore: number | null;
  pitStops: number;
  lastPitSeconds: number | null;
  position: number | null;
  classPosition: number | null;
  gridPosition: number | null;
  startPosition: number | null;
  worstPosition: number | null;
  lastIncidentAt: number;
  finished: boolean;
};

type Battle = {
  band: Band;
  candidate: Band;
  candidateSince: number;
  active: boolean;
  laps: number;
  lastLapsDone: number | null;
  lapGaps: number[];
  reportedGap: number | null;
  lastEventAt: number;
  seenAt: number;
};

type Band = 'veryClose' | 'active' | 'developing' | 'none';

const positive = (n: number | null | undefined): number | null => (n != null && n > 0 ? n : null);
const BAND_ORDER: Band[] = ['none', 'developing', 'active', 'veryClose'];
const inBattle = (band: Band) => band === 'active' || band === 'veryClose';

function sessionKind(type: string | null): 'race' | 'practice' | 'qualifying' | 'session' {
  const t = (type ?? '').toLowerCase();
  if (t.includes('race')) return 'race';
  if (t.includes('qual')) return 'qualifying';
  if (t.includes('practice') || t.includes('warmup')) return 'practice';
  return 'session';
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function stdev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 3) return null;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

export class BroadcastTracker {
  private cars = new Map<number, CarState>();
  private battles = new Map<string, Battle>();
  private pendingPasses = new Map<string, number>();
  private passedAt = new Map<string, number>();
  private storylineMap = new Map<string, Storyline & { emittedValue: number }>();
  private kind: 'race' | 'practice' | 'qualifying' | 'session' = 'session';
  private state: number | null = null;
  private lapsTotal: number | null = null;
  private timeRemain: number | null = null;
  private initialTimeRemain: number | null = null;
  private raceStartedAt: number | null = null;
  private preRaceSent = false;
  private finalLapSent = false;
  private wonSent = false;
  private userFinishedSent = false;
  private startedAt: number | null = null;
  private nextSummaryAt = 0;
  private nextStatsAt = 0;
  private now = 0;
  userIdx: number | null = null;

  // More than one class in the session makes positions class positions
  multiClass = false;

  get starters(): number {
    return this.cars.size;
  }

  get isRace(): boolean {
    return this.kind === 'race';
  }

  // Feeds one live update; returns what happened since the one before
  update(snap: TrackerSnapshot): BroadcastEvent[] {
    const events: BroadcastEvent[] = [];
    const before = new Map([...this.cars].map(([idx, c]) => [idx, { ...c }]));
    const previousState = this.state;
    this.now = snap.at;
    this.kind = sessionKind(snap.sessionType);
    this.state = snap.sessionState;
    this.lapsTotal = positive(snap.lapsTotal);
    this.timeRemain = snap.timeRemain ?? null;
    this.userIdx = snap.myCarIdx;
    this.startedAt ??= snap.at;
    // cars without details yet (no class) don't count
    this.multiClass = new Set(snap.cars.map((c) => c.carClass ?? this.cars.get(c.idx)?.carClass).filter(Boolean)).size > 1;
    const racing = this.kind === 'race' && this.state === RACING;

    for (const car of snap.cars) this.updateCar(car);
    // a car that left the session is gone from its next update
    const present = new Set(snap.cars.map((c) => c.idx));
    for (const idx of this.cars.keys()) if (!present.has(idx)) this.cars.delete(idx);

    // The race's lifecycle
    if (this.kind === 'race') {
      if (!this.preRaceSent && this.state != null && this.state < RACING && this.cars.size >= 2) {
        this.preRaceSent = true;
        events.push(this.preRaceEvent());
      }
      if (this.state === RACING && previousState != null && previousState < RACING) {
        this.raceStartedAt = snap.at;
        this.initialTimeRemain = this.timeRemain;
        for (const c of this.cars.values()) c.startPosition = this.rankOf(c) ?? c.gridPosition;
        events.push({ type: 'raceStart', starters: this.cars.size, userGrid: this.userCar()?.startPosition ?? null });
        this.nextSummaryAt = snap.at + TRACKER_CONFIG.summaryFirstMs;
        this.nextStatsAt = snap.at + TRACKER_CONFIG.statsFirstMs;
      }
      if (this.state === RACING && this.initialTimeRemain === null && this.timeRemain != null) this.initialTimeRemain = this.timeRemain;
    }

    const live = this.liveRanks();
    if (racing) {
      events.push(...this.detectPasses(before, live));
      events.push(...this.detectBattles(live));
      events.push(...this.detectPits(before, live));
      events.push(...this.detectFinalLap(before));
    }
    if (this.kind === 'race' && (this.state ?? 0) >= RACING) events.push(...this.detectFinish(before, previousState));
    events.push(...this.detectIncidents(before, live));
    if (this.kind === 'race' && (this.state ?? 0) >= RACING) events.push(...this.updateStorylines(live));
    events.push(...this.ticks(racing));
    return events;
  }

  private updateCar(car: TrackerCar) {
    let c = this.cars.get(car.idx);
    if (!c) {
      c = {
        idx: car.idx,
        name: null,
        car: null,
        number: null,
        carClass: '',
        progress: null,
        rate: null,
        lapsDone: null,
        onPitRoad: false,
        offTrack: false,
        lastLapTime: null,
        laps: [],
        pitThisLap: false,
        pitEnteredAt: null,
        pitPositionBefore: null,
        pitStops: 0,
        lastPitSeconds: null,
        position: null,
        classPosition: null,
        gridPosition: null,
        startPosition: null,
        worstPosition: null,
        lastIncidentAt: 0,
        finished: false,
      };
      this.cars.set(car.idx, c);
    }
    c.name = car.name ?? c.name;
    c.car = car.car ?? c.car;
    c.number = car.number ?? c.number;
    c.carClass = car.carClass ?? c.carClass;
    c.rate = car.rate ?? null;
    c.onPitRoad = !!car.onPitRoad;
    c.offTrack = !!car.offTrack;
    if (c.onPitRoad) c.pitThisLap = true;
    c.position = positive(car.position);
    c.classPosition = positive(car.classPosition);
    c.lapsDone = car.lapsDone ?? c.lapsDone;
    if (this.kind === 'race' && (this.state ?? 0) < RACING) c.gridPosition = this.rankOf(c) ?? c.gridPosition;
    if (c.startPosition != null) {
      const rank = this.rankOf(c);
      if (rank != null) c.worstPosition = Math.max(c.worstPosition ?? rank, rank);
    }

    // Lap progress, unwrapped across the line: LapDistPct wraps and CarIdxLap counts up in different samples
    if (car.pct != null && car.pct >= 0 && car.lap != null && car.lap >= 0) {
      let progress = car.lap + car.pct;
      if (c.progress !== null) {
        while (progress - c.progress < -0.5) progress += 1;
        while (progress - c.progress > 0.5 && progress - 1 >= c.progress - 0.05) progress -= 1;
      }
      c.progress = progress;
    } else {
      c.progress = null;
    }

    const lapTime = positive(car.lastLapTime);
    if (lapTime !== null && lapTime !== c.lastLapTime) {
      if (c.lastLapTime !== null || c.laps.length === 0) c.laps.push({ time: lapTime, pit: c.pitThisLap });
      c.laps = c.laps.slice(-40);
      c.pitThisLap = c.onPitRoad;
    }
    c.lastLapTime = lapTime ?? c.lastLapTime;
  }

  private rankOf(c: Pick<CarState, 'position' | 'classPosition'>): number | null {
    return this.multiClass ? c.classPosition : c.position;
  }

  private userCar(): CarState | null {
    return this.userIdx != null ? this.cars.get(this.userIdx) ?? null : null;
  }

  // Each car's position in its class by lap progress right now, and each class's running order (cars on track)
  private liveRanks(): { rank: Map<number, number>; order: Map<string, number[]> } {
    const byClass = new Map<string, CarState[]>();
    for (const c of this.cars.values()) {
      if (c.progress === null) continue;
      byClass.set(c.carClass, [...(byClass.get(c.carClass) ?? []), c]);
    }
    const rank = new Map<number, number>();
    const order = new Map<string, number[]>();
    for (const [cls, cars] of byClass) {
      const sorted = [...cars].sort((a, b) => b.progress! - a.progress!);
      sorted.forEach((c, i) => rank.set(c.idx, i + 1));
      order.set(cls, sorted.filter((c) => !c.onPitRoad).map((c) => c.idx));
    }
    return { rank, order };
  }

  // Seconds between two cars on track, by the chasing car's pace; null when either isn't on track or it can't tell
  gapBetween(aheadIdx: number, behindIdx: number): number | null {
    const a = this.cars.get(aheadIdx);
    const b = this.cars.get(behindIdx);
    if (!a || !b || a.progress === null || b.progress === null) return null;
    const rate = b.rate && b.rate > 0 ? b.rate : b.laps.length > 0 ? 1 / Math.min(...b.laps.map((l) => l.time)) : null;
    if (!rate) return null;
    return (a.progress - b.progress) / rate;
  }

  private nameOf(idx: number): string | null {
    return this.cars.get(idx)?.name ?? null;
  }

  private detectPasses(before: Map<number, CarState>, live: { rank: Map<number, number> }): BroadcastEvent[] {
    const cfg = TRACKER_CONFIG;
    const events: BroadcastEvent[] = [];
    const now = this.now;
    const cars = [...this.cars.values()].filter((c) => c.progress !== null && !c.onPitRoad);
    for (const a of cars) {
      const pa = before.get(a.idx);
      if (!pa || pa.progress === null || pa.onPitRoad) continue;
      for (const b of cars) {
        if (a === b || a.carClass !== b.carClass) continue;
        const pb = before.get(b.idx);
        if (!pb || pb.progress === null || pb.onPitRoad) continue;
        if (pa.progress < pb.progress && a.progress! > b.progress! && Math.abs(a.progress! - b.progress!) < cfg.passMaxLaps) {
          this.pendingPasses.set(`${a.idx}>${b.idx}`, now);
          this.pendingPasses.delete(`${b.idx}>${a.idx}`);
        }
      }
    }
    for (const [key, since] of this.pendingPasses) {
      if (now - since < cfg.passConfirmMs) continue;
      this.pendingPasses.delete(key);
      const [ai, bi] = key.split('>').map(Number);
      const a = this.cars.get(ai);
      const b = this.cars.get(bi);
      if (!a || !b || a.progress === null || b.progress === null || a.onPitRoad || b.onPitRoad) continue;
      if (a.progress <= b.progress || a.progress - b.progress > cfg.passMaxLaps * 3) continue;
      const pair = [ai, bi].sort((x, y) => x - y).join('-');
      if (now - (this.passedAt.get(pair) ?? 0) < cfg.passCooldownMs) continue;
      const user = ai === this.userIdx ? 'gained' : bi === this.userIdx ? 'lost' : null;
      if (!user && this.raceStartedAt !== null && now - this.raceStartedAt < cfg.startQuietMs) continue;
      if (!a.name || !b.name) continue;
      this.passedAt.set(pair, now);
      events.push({
        type: 'overtake',
        idx: ai,
        driver: a.name,
        passedIdx: bi,
        passed: b.name,
        position: live.rank.get(ai) ?? 0,
        carClass: a.carClass || null,
        multiClass: this.multiClass,
        user,
        finalLap: this.finalLapSent,
      });
    }
    return events;
  }

  private detectBattles(live: { order: Map<string, number[]>; rank: Map<number, number> }): BroadcastEvent[] {
    const cfg = TRACKER_CONFIG;
    const events: BroadcastEvent[] = [];
    const now = this.now;
    for (const order of live.order.values()) {
      for (let i = 0; i + 1 < order.length; i++) {
        const aheadIdx = order[i];
        const behindIdx = order[i + 1];
        const gap = this.gapBetween(aheadIdx, behindIdx);
        if (gap === null || gap < 0 || gap > 30) continue;
        const ahead = this.cars.get(aheadIdx)!;
        const behind = this.cars.get(behindIdx)!;
        if (ahead.offTrack || behind.offTrack) continue;
        const key = `${aheadIdx}-${behindIdx}`;
        const raw: Band = gap < cfg.veryCloseGap ? 'veryClose' : gap < cfg.activeGap ? 'active' : gap < cfg.developingGap ? 'developing' : 'none';
        let b = this.battles.get(key);
        if (!b) {
          b = { band: 'none', candidate: raw, candidateSince: now, active: false, laps: 0, lastLapsDone: behind.lapsDone, lapGaps: [], reportedGap: null, lastEventAt: 0, seenAt: now };
          this.battles.set(key, b);
        }
        b.seenAt = now;
        if (raw !== b.candidate) {
          b.candidate = raw;
          b.candidateSince = now;
        }
        // Gap at each of the chaser's laps, for the closing rate
        if (behind.lapsDone != null && behind.lapsDone !== b.lastLapsDone) {
          b.lastLapsDone = behind.lapsDone;
          b.lapGaps = [...b.lapGaps, gap].slice(-6);
          if (b.active) b.laps++;
        }
        const closingPerLap =
          b.lapGaps.length >= 3
            ? (b.lapGaps[b.lapGaps.length - 3] - b.lapGaps[b.lapGaps.length - 1]) / 2
            : b.lapGaps.length === 2
              ? b.lapGaps[0] - b.lapGaps[1]
              : null;
        const dropping = BAND_ORDER.indexOf(b.candidate) < BAND_ORDER.indexOf(b.band);
        const hold = dropping ? cfg.bandDropHoldMs : cfg.bandHoldMs;
        let phase: BattlePhase | null = null;
        if (b.candidate !== b.band && now - b.candidateSince >= hold) {
          const was = b.band;
          b.band = b.candidate;
          if (inBattle(b.band) && !b.active) {
            b.active = true;
            b.laps = 0;
            phase = 'start';
          } else if (b.band === 'veryClose' && was === 'active') {
            phase = 'veryClose';
          } else if (!inBattle(b.band) && b.active && b.band !== 'developing') {
            b.active = false;
            if (b.laps >= 1) phase = 'ended';
          } else if (b.band === 'none') {
            b.active = false;
          }
        }
        if (!phase && now - b.lastEventAt >= cfg.battleRepeatMs) {
          if (b.active && b.reportedGap !== null && Math.abs(gap - b.reportedGap) >= cfg.gapChange) {
            phase = gap < b.reportedGap ? 'closing' : 'pulling';
          } else if (
            b.band === 'developing' &&
            closingPerLap !== null &&
            closingPerLap >= cfg.closingPerLap &&
            (b.reportedGap === null || b.reportedGap - gap >= cfg.gapChange)
          ) {
            phase = 'closing';
          }
        }
        if (phase && ahead.name && behind.name) {
          events.push({
            type: 'battle',
            phase,
            aheadIdx,
            ahead: ahead.name,
            behindIdx,
            behind: behind.name,
            position: live.rank.get(aheadIdx) ?? 0,
            carClass: ahead.carClass || null,
            gap: Math.round(gap * 100) / 100,
            previousGap: b.reportedGap !== null ? Math.round(b.reportedGap * 100) / 100 : null,
            closingPerLap: closingPerLap !== null ? Math.round(closingPerLap * 100) / 100 : null,
            laps: b.laps,
            user: aheadIdx === this.userIdx || behindIdx === this.userIdx,
          });
          b.reportedGap = gap;
          b.lastEventAt = now;
        }
      }
    }
    for (const [key, b] of this.battles) if (now - b.seenAt > 10_000) this.battles.delete(key);
    return events;
  }

  private detectPits(before: Map<number, CarState>, live: { rank: Map<number, number> }): BroadcastEvent[] {
    const events: BroadcastEvent[] = [];
    for (const c of this.cars.values()) {
      const prev = before.get(c.idx);
      if (!prev) continue;
      if (!prev.onPitRoad && c.onPitRoad) {
        c.pitEnteredAt = this.now;
        c.pitPositionBefore = live.rank.get(c.idx) ?? null;
        if (c.idx !== this.userIdx && c.name) {
          events.push({ type: 'pitStop', phase: 'in', idx: c.idx, driver: c.name, position: c.pitPositionBefore, positionBefore: null, seconds: null });
        }
      } else if (prev.onPitRoad && !c.onPitRoad && c.pitEnteredAt !== null) {
        const seconds = Math.round((this.now - c.pitEnteredAt) / 100) / 10;
        c.pitStops++;
        c.lastPitSeconds = seconds;
        if (c.idx !== this.userIdx && c.name) {
          events.push({
            type: 'pitStop',
            phase: 'out',
            idx: c.idx,
            driver: c.name,
            position: live.rank.get(c.idx) ?? null,
            positionBefore: c.pitPositionBefore,
            seconds,
          });
        }
        c.pitEnteredAt = null;
      }
    }
    return events;
  }

  private detectIncidents(before: Map<number, CarState>, live: { rank: Map<number, number> }): BroadcastEvent[] {
    const cfg = TRACKER_CONFIG;
    const me = this.userCar();
    const found: { car: CarState; kind: 'offTrack' | 'slowed' }[] = [];
    for (const c of this.cars.values()) {
      const prev = before.get(c.idx);
      if (!prev || c.idx === this.userIdx || c.onPitRoad || prev.onPitRoad || c.progress === null || !c.name) continue;
      if (this.now - c.lastIncidentAt < cfg.incidentCooldownMs) continue;
      const wentOff = c.offTrack && !prev.offTrack;
      const slowed = !c.offTrack && prev.rate != null && c.rate != null && prev.rate >= cfg.minSlowedRate && c.rate < prev.rate * cfg.slowedShare;
      if (!wentOff && !slowed) continue;
      // near the driver's car: detectRaceEvents' nearbyIncident
      if (me?.progress != null) {
        const gap = (((c.progress - me.progress) % 1) + 1.5) % 1 - 0.5;
        if (Math.abs(gap) <= cfg.nearbyLaps) continue;
      }
      c.lastIncidentAt = this.now;
      found.push({ car: c, kind: wentOff ? 'offTrack' : 'slowed' });
    }
    // Cars in trouble at the same place at once are one incident, led by the one furthest up
    const events: BroadcastEvent[] = [];
    const used = new Set<number>();
    const sorted = [...found].sort((x, y) => (live.rank.get(x.car.idx) ?? 999) - (live.rank.get(y.car.idx) ?? 999));
    for (const f of sorted) {
      if (used.has(f.car.idx)) continue;
      used.add(f.car.idx);
      const others = sorted.filter(
        (o) => !used.has(o.car.idx) && Math.abs((((o.car.progress! - f.car.progress!) % 1) + 1.5) % 1 - 0.5) <= cfg.multiCarLaps
      );
      for (const o of others) used.add(o.car.idx);
      const rank = live.rank.get(f.car.idx) ?? null;
      events.push({
        type: 'fieldIncident',
        idx: f.car.idx,
        driver: f.car.name!,
        others: others.map((o) => o.car.name!),
        kind: others.some((o) => o.kind === 'slowed') ? 'slowed' : f.kind,
        position: rank,
        leader: rank === 1 && this.kind === 'race',
      });
    }
    return events;
  }

  private detectFinalLap(before: Map<number, CarState>): BroadcastEvent[] {
    if (this.finalLapSent || this.lapsTotal === null) return [];
    const leader = [...this.cars.values()].find((c) => c.position === 1);
    const prev = leader && before.get(leader.idx);
    if (!leader?.name || !prev || leader.lapsDone == null) return [];
    if (leader.lapsDone === this.lapsTotal - 1 && prev.lapsDone !== leader.lapsDone) {
      this.finalLapSent = true;
      return [{ type: 'finalLap', leader: leader.name, lapsTotal: this.lapsTotal }];
    }
    return [];
  }

  private detectFinish(before: Map<number, CarState>, previousState: number | null): BroadcastEvent[] {
    const events: BroadcastEvent[] = [];
    if (!this.wonSent && this.state === CHECKERED && previousState === RACING) {
      this.wonSent = true;
      const winner = [...this.cars.values()].find((c) => c.position === 1);
      const second = [...this.cars.values()].find((c) => c.position === 2);
      if (winner?.name) {
        const margin = second ? this.gapBetween(winner.idx, second.idx) : null;
        events.push({
          type: 'raceWon',
          winner: winner.name,
          winnerIdx: winner.idx,
          margin: margin !== null && margin >= 0 && margin < 60 ? Math.round(margin * 1000) / 1000 : null,
          userWon: winner.idx === this.userIdx,
        });
      }
    }
    const me = this.userCar();
    const prev = me && before.get(me.idx);
    if (!this.userFinishedSent && me && prev && (this.state ?? 0) >= CHECKERED && me.lapsDone != null && me.lapsDone !== prev.lapsDone) {
      this.userFinishedSent = true;
      me.finished = true;
      const position = this.rankOf(me);
      events.push({
        type: 'driverFinished',
        position,
        gained: me.startPosition != null && position != null ? me.startPosition - position : null,
      });
    }
    return events;
  }

  private updateStorylines(live: { rank: Map<number, number> }): BroadcastEvent[] {
    const events: BroadcastEvent[] = [];
    const emit = (story: Storyline, value: number) => {
      const existing = this.storylineMap.get(story.id);
      if (existing && Math.abs(value - existing.emittedValue) < 2 && existing.status === story.status) {
        Object.assign(existing, { ...story, startedAt: existing.startedAt, emittedValue: existing.emittedValue });
        return;
      }
      const saved = { ...story, startedAt: existing?.startedAt ?? story.startedAt, emittedValue: value };
      this.storylineMap.set(story.id, saved);
      const { emittedValue: _value, ...plain } = saved;
      void _value;
      events.push({ type: 'storyline', storyline: plain });
    };
    const now = this.now;
    // Recovery drives and charges, for the driver and the front of the field
    for (const c of this.cars.values()) {
      const rank = this.rankOf(c);
      if (!c.name || c.startPosition == null || rank == null || c.worstPosition == null) continue;
      if (c.idx !== this.userIdx && rank > 10) continue;
      const lost = c.worstPosition - c.startPosition;
      const regained = c.worstPosition - rank;
      if (lost >= 3 && regained >= 2) {
        emit(
          {
            id: `recovery:${c.idx}`,
            kind: 'recovery',
            cars: [c.idx],
            drivers: [c.name],
            startedAt: now,
            updatedAt: now,
            status: 'active',
            facts: { startPosition: c.startPosition, worstPosition: c.worstPosition, position: rank, regained },
            significance: c.idx === this.userIdx || rank <= 3 ? 3 : 2,
          },
          regained
        );
      } else if (c.startPosition - rank >= 3) {
        emit(
          {
            id: `charge:${c.idx}`,
            kind: 'charge',
            cars: [c.idx],
            drivers: [c.name],
            startedAt: now,
            updatedAt: now,
            status: 'active',
            facts: { startPosition: c.startPosition, position: rank, gained: c.startPosition - rank },
            significance: c.idx === this.userIdx || rank <= 3 ? 3 : 2,
          },
          c.startPosition - rank
        );
      }
    }
    // Long battles, and a leader under pressure
    for (const [key, b] of this.battles) {
      const [aheadIdx, behindIdx] = key.split('-').map(Number);
      const ahead = this.nameOf(aheadIdx);
      const behind = this.nameOf(behindIdx);
      if (!ahead || !behind) continue;
      if (b.active && b.laps >= 2) {
        emit(
          {
            id: `battle:${key}`,
            kind: 'longBattle',
            cars: [aheadIdx, behindIdx],
            drivers: [ahead, behind],
            startedAt: now,
            updatedAt: now,
            status: 'active',
            facts: { laps: b.laps, gap: b.reportedGap !== null ? Math.round(b.reportedGap * 10) / 10 : null, position: live.rank.get(aheadIdx) ?? null },
            significance: live.rank.get(aheadIdx) === 1 || aheadIdx === this.userIdx || behindIdx === this.userIdx ? 3 : 2,
          },
          b.laps
        );
      }
      const closing = b.lapGaps.length >= 3 ? (b.lapGaps[b.lapGaps.length - 3] - b.lapGaps[b.lapGaps.length - 1]) / 2 : null;
      if (live.rank.get(aheadIdx) === 1 && b.band !== 'none' && closing !== null && closing >= 0.15 && !this.storylineMap.has(`leader:${aheadIdx}`)) {
        emit(
          {
            id: `leader:${aheadIdx}`,
            kind: 'leaderPressure',
            cars: [aheadIdx, behindIdx],
            drivers: [ahead, behind],
            startedAt: now,
            updatedAt: now,
            status: 'active',
            facts: { gap: Math.round(b.lapGaps[b.lapGaps.length - 1] * 10) / 10, closingPerLap: Math.round(closing * 100) / 100 },
            significance: 3,
          },
          0
        );
      }
    }
    // Battles that broke up end their story
    for (const story of this.storylineMap.values()) {
      if (story.kind === 'longBattle' && story.status === 'active' && !this.battles.get(story.id.slice(7))?.active) {
        story.status = 'resolved';
        story.updatedAt = now;
      }
    }
    return events;
  }

  private ticks(racing: boolean): BroadcastEvent[] {
    const events: BroadcastEvent[] = [];
    const now = this.now;
    const inSession = racing || this.kind === 'practice' || this.kind === 'qualifying';
    if (!inSession) return events;
    if (this.nextSummaryAt === 0) this.nextSummaryAt = (this.startedAt ?? now) + TRACKER_CONFIG.summaryFirstMs;
    if (this.nextStatsAt === 0) this.nextStatsAt = (this.startedAt ?? now) + TRACKER_CONFIG.statsFirstMs;
    if (now >= this.nextSummaryAt) {
      this.nextSummaryAt = now + TRACKER_CONFIG.summaryEveryMs;
      events.push({ type: 'raceSummary' });
    }
    if (now >= this.nextStatsAt) {
      this.nextStatsAt = now + TRACKER_CONFIG.statsEveryMs;
      events.push({ type: 'statsUpdate' });
    }
    return events;
  }

  private preRaceEvent(): BroadcastEvent {
    const pole = [...this.cars.values()].find((c) => this.rankOf(c) === 1 || c.position === 1);
    return {
      type: 'preRace',
      starters: this.cars.size,
      pole: pole?.name ?? null,
      userGrid: this.userCar()?.gridPosition ?? null,
      classes: [...new Set([...this.cars.values()].map((c) => c.carClass).filter(Boolean))],
      lapsTotal: this.lapsTotal,
      minutes: this.lapsTotal === null && this.timeRemain != null ? Math.round(this.timeRemain / 60) : null,
    };
  }

  // Where the session is: practice, qualifying, or the stage of a race
  phase(): SessionPhase {
    if (this.kind !== 'race') return this.kind;
    if (this.state == null || this.state < RACING) return 'preRace';
    if (this.state >= CHECKERED) return 'finished';
    const leader = [...this.cars.values()].find((c) => c.position === 1);
    const leaderLaps = leader?.lapsDone ?? 0;
    // none yet when this server joined the race after the leader's last lap: Math.min of nothing is Infinity
    const leaderBest = leader && leader.laps.length > 0 ? positive(Math.min(...leader.laps.map((l) => l.time))) : null;
    if (leaderLaps < 2) return 'opening';
    if (this.lapsTotal !== null) {
      if (this.lapsTotal - leaderLaps <= 2) return 'finalLaps';
      if (leaderLaps / this.lapsTotal >= 0.75) return 'finalQuarter';
      return 'middle';
    }
    if (this.timeRemain != null) {
      if (leaderBest !== null && this.timeRemain <= 2 * leaderBest) return 'finalLaps';
      if (this.initialTimeRemain && 1 - this.timeRemain / this.initialTimeRemain >= 0.75) return 'finalQuarter';
    }
    return 'middle';
  }

  // How far through the race the leader is, 0-1, or null when it can't tell
  raceProgress(): number | null {
    if (this.kind !== 'race' || (this.state ?? 0) < RACING) return null;
    const leader = [...this.cars.values()].find((c) => c.position === 1);
    if (this.lapsTotal !== null && leader?.lapsDone != null) return Math.min(leader.lapsDone / this.lapsTotal, 1);
    if (this.initialTimeRemain && this.timeRemain != null) return Math.min(Math.max(1 - this.timeRemain / this.initialTimeRemain, 0), 1);
    return null;
  }

  lapsRemaining(): number | null {
    const leader = [...this.cars.values()].find((c) => c.position === 1);
    return this.lapsTotal !== null && leader?.lapsDone != null ? Math.max(this.lapsTotal - leader.lapsDone, 0) : null;
  }

  carStats(idx: number): CarStats | null {
    const c = this.cars.get(idx);
    if (!c?.name) return null;
    const live = this.liveRanks();
    const all = c.laps.filter((l) => !l.pit);
    const best = all.length > 0 ? Math.min(...all.map((l) => l.time)) : null;
    const clean = best !== null ? all.filter((l) => l.time <= best * TRACKER_CONFIG.cleanLapShare).map((l) => l.time) : [];
    const lastThree = clean.slice(-3);
    const threeBefore = clean.slice(-6, -3);
    const position = this.rankOf(c);
    let paceRank: number | null = null;
    if (lastThree.length === 3) {
      const mine = mean(lastThree)!;
      const rivals = [...this.cars.values()]
        .filter((o) => o.carClass === c.carClass)
        .map((o) => {
          const ob = o.laps.filter((l) => !l.pit);
          const obBest = ob.length > 0 ? Math.min(...ob.map((l) => l.time)) : null;
          const oc = obBest !== null ? ob.filter((l) => l.time <= obBest * TRACKER_CONFIG.cleanLapShare).map((l) => l.time).slice(-3) : [];
          return oc.length === 3 ? mean(oc)! : null;
        })
        .filter((v): v is number => v !== null);
      paceRank = rivals.filter((v) => v < mine - 1e-6).length + 1;
    }
    return {
      idx,
      driver: c.name,
      carClass: c.carClass || null,
      car: c.car,
      number: c.number,
      position,
      livePosition: live.rank.get(idx) ?? null,
      startPosition: c.startPosition,
      gained: c.startPosition != null && position != null ? c.startPosition - position : null,
      cleanLaps: clean.length,
      best,
      last: c.lastLapTime,
      average: clean.length >= 2 ? mean(clean.slice(-10)) : null,
      consistency: stdev(clean.slice(-10)),
      trend: lastThree.length === 3 && threeBefore.length === 3 ? mean(lastThree)! - mean(threeBefore)! : null,
      paceRank,
      pitStops: c.pitStops,
      lastPitSeconds: c.lastPitSeconds,
    };
  }

  // The cars just ahead and behind on track in the same class, with the gaps
  neighbors(idx: number): { ahead: { idx: number; driver: string; gap: number } | null; behind: { idx: number; driver: string; gap: number } | null } {
    const c = this.cars.get(idx);
    const order = c ? this.liveRanks().order.get(c.carClass) ?? [] : [];
    const i = order.indexOf(idx);
    const pick = (other: number | undefined, gap: number | null) => {
      const name = other != null ? this.nameOf(other) : null;
      return other != null && name && gap !== null && gap >= 0 && gap < 60 ? { idx: other, driver: name, gap: Math.round(gap * 10) / 10 } : null;
    };
    if (i < 0) return { ahead: null, behind: null };
    return {
      ahead: pick(order[i - 1], i > 0 ? this.gapBetween(order[i - 1], idx) : null),
      behind: pick(order[i + 1], i + 1 < order.length ? this.gapBetween(idx, order[i + 1]) : null),
    };
  }

  // The first n of a class (the user's, else the leader's) by live position
  runningOrder(n: number, carClass?: string | null): { idx: number; driver: string; position: number }[] {
    const live = this.liveRanks();
    const cls = carClass ?? this.userCar()?.carClass ?? [...this.cars.values()][0]?.carClass ?? '';
    return [...this.cars.values()]
      .filter((c) => c.carClass === cls && c.name && live.rank.has(c.idx))
      .sort((a, b) => live.rank.get(a.idx)! - live.rank.get(b.idx)!)
      .slice(0, n)
      .map((c) => ({ idx: c.idx, driver: c.name!, position: live.rank.get(c.idx)! }));
  }

  classOf(idx: number): string | null {
    return this.cars.get(idx)?.carClass || null;
  }

  storylines(): Storyline[] {
    return [...this.storylineMap.values()].map(({ emittedValue: _v, ...story }) => {
      void _v;
      return story;
    });
  }

  // Every car with a driver: its number, car and class
  roster(): { idx: number; driver: string; number: string | null; car: string | null; carClass: string | null }[] {
    return [...this.cars.values()]
      .filter((c) => c.name)
      .map((c) => ({ idx: c.idx, driver: c.name!, number: c.number, car: c.car, carClass: c.carClass || null }));
  }

  // Every driver's name, for checking the announcers only name drivers they were told about
  driverNames(): string[] {
    return [...this.cars.values()].map((c) => c.name).filter((n): n is string => !!n);
  }
}
