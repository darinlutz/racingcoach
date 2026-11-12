// The broadcast's common timeline (docs/live-video.md): live telemetry reaches a viewer within a second or two of the
// car, the OBS video tens of seconds later, so in synchronized mode everything drawn from telemetry (the map's cars,
// the leaderboard, race graphics, commentary) is shown on the video's delayed timeline instead of as it arrives.
//
// The clocks involved, never mixed up:
//   - simulator time: iRacing's SessionTime, in the collector's input samples (seconds from the session's start)
//   - server receipt time: when the website got the collector's update (Date.now() on the server); the TV's pictures
//     carry it as `at`, the only wall-clock time telemetry has (the collector sends no capture time of its own)
//   - viewer time: Date.now() in the browser, turned into server time with the clock offset each picture gives
//   - video time: when a frame was ingested by Cloudflare, only known when the HLS playlist has
//     EXT-X-PROGRAM-DATE-TIME (hls.js's playingDate); otherwise the player's latency estimate (hls.js latency) or a
//     manual calibration is all there is
//   - commentary time: when a line is due to be heard, its event's server time plus the delay
//
// Pure (no imports, no timers), for the TV and the Live Racing page alike; npm run test:live-video.

// A sample of anything on the timeline: its server time and its number, for duplicates
export type TimelineEntry<T> = { at: number; seq: number; value: T };
export type PushResult = 'added' | 'duplicate' | 'outOfOrder' | 'tooOld';

export type TimelineStats = {
  received: number;
  duplicates: number;
  outOfOrder: number;
  tooOld: number;
  // Pictures that had to be skipped because the delayed position had already passed them when they arrived
  late: number;
};

// A bounded buffer of timestamped pictures: keeps maxAgeMs behind the newest, and never more than maxEntries, so a
// viewer's memory can't grow however long the broadcast runs
export class TimelineBuffer<T> {
  private entries: TimelineEntry<T>[] = [];
  readonly stats: TimelineStats = { received: 0, duplicates: 0, outOfOrder: 0, tooOld: 0, late: 0 };
  // The delayed position last asked for, so a picture arriving behind it counts as late
  private playhead = -Infinity;

  constructor(
    private maxAgeMs: number,
    private maxEntries = 600
  ) {}

  setMaxAge(ms: number): void {
    this.maxAgeMs = ms;
    this.prune();
  }

  push(at: number, seq: number, value: T): PushResult {
    this.stats.received++;
    if (!Number.isFinite(at)) {
      this.stats.tooOld++;
      return 'tooOld';
    }
    const newest = this.entries[this.entries.length - 1];
    if (newest && at < newest.at - this.maxAgeMs) {
      this.stats.tooOld++;
      return 'tooOld';
    }
    if (this.entries.some((e) => e.seq === seq || e.at === at)) {
      this.stats.duplicates++;
      return 'duplicate';
    }
    if (at < this.playhead) this.stats.late++;
    let result: PushResult = 'added';
    if (newest && at < newest.at) {
      result = 'outOfOrder';
      this.stats.outOfOrder++;
      const i = this.entries.findIndex((e) => e.at > at);
      this.entries.splice(i, 0, { at, seq, value });
    } else {
      this.entries.push({ at, seq, value });
    }
    this.prune();
    return result;
  }

  private prune(): void {
    const newest = this.entries[this.entries.length - 1];
    if (!newest) return;
    // One picture older than the window stays, so there's always something to show at its far end
    const firstKept = this.entries.findIndex((e) => e.at >= newest.at - this.maxAgeMs);
    const drop = Math.max(firstKept - 1, 0, this.entries.length - this.maxEntries);
    if (drop > 0) this.entries.splice(0, drop);
  }

  get size(): number {
    return this.entries.length;
  }

  // How much time the buffer holds, newest minus oldest (ms)
  get spanMs(): number {
    return this.entries.length < 2 ? 0 : this.entries[this.entries.length - 1].at - this.entries[0].at;
  }

  newest(): TimelineEntry<T> | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  // The pictures either side of server time t, and how far between them t is (0-1). Before the oldest, the oldest
  // alone (behind: the buffer doesn't reach back that far yet); after the newest, the newest alone
  frameAt(t: number): { before: TimelineEntry<T>; after: TimelineEntry<T> | null; alpha: number; behind: boolean } | null {
    this.playhead = Math.max(this.playhead, t);
    if (this.entries.length === 0) return null;
    if (t <= this.entries[0].at) return { before: this.entries[0], after: null, alpha: 0, behind: t < this.entries[0].at };
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const before = this.entries[i];
      if (before.at <= t) {
        const after = this.entries[i + 1] ?? null;
        const alpha = after ? (t - before.at) / (after.at - before.at) : 0;
        return { before, after, alpha: Math.min(Math.max(alpha, 0), 1), behind: false };
      }
    }
    return null;
  }

  clear(): void {
    this.entries = [];
    this.playhead = -Infinity;
  }
}

// From a to b the short way round the lap (-0.5 to 0.5)
export const wrapDelta = (a: number, b: number) => ((((b - a) % 1) + 1.5) % 1) - 0.5;
const wrap = (pct: number) => ((pct % 1) + 1) % 1;

// A car's lap position between two pictures, across the start/finish line when it's crossed
export function interpolatePct(a: number | null, b: number | null, alpha: number): number | null {
  if (a == null) return b == null ? null : alpha >= 0.5 ? b : null;
  if (b == null) return alpha < 0.5 ? a : null;
  const delta = wrapDelta(a, b);
  // Further apart than a car goes in a second or two: a reset or a tow, shown where it ends up rather than flown to
  if (Math.abs(delta) > 0.25) return alpha < 0.5 ? a : b;
  return wrap(a + delta * alpha);
}

// A car's pace round the lap (laps per second) between two pictures; null when it can't be told
export function rateBetween(a: number | null, aAt: number, b: number | null, bAt: number): number | null {
  if (a == null || b == null || bAt <= aAt) return null;
  const delta = wrapDelta(a, b);
  if (Math.abs(delta) > 0.25) return null;
  // A racing car laps in 20 s at the quickest: anything faster is a bad reading
  const rate = delta / ((bAt - aAt) / 1000);
  return Math.abs(rate) > 0.05 ? null : rate;
}

export type DelayBasis = 'off' | 'measured' | 'estimated' | 'manual' | 'none';

export type DelayInputs = {
  syncEnabled: boolean;
  mode: 'auto' | 'manual';
  manualOffsetMs: number;
  maxBufferMs: number;
  // Server now minus the wall-clock time of the frame on screen (EXT-X-PROGRAM-DATE-TIME): a measurement
  measuredLatencyMs: number | null;
  // The player's own estimate of how far behind live it is (hls.js latency): an estimate
  estimatedLatencyMs: number | null;
};

export type DelayResult = {
  delayMs: number;
  basis: DelayBasis;
  // The delay wanted was more than the viewer buffers: shown at maxBufferMs, synchronization degraded
  clamped: boolean;
  degraded: boolean;
};

// How far behind live the telemetry is shown. Telemetry already arrives about a second after the car (the collector's
// half-second updates plus the network), video much later, so only the video's latency is waited for; the manual
// offset trims what's left (and is the whole delay in manual mode)
export function effectiveDelay(input: DelayInputs): DelayResult {
  if (!input.syncEnabled) return { delayMs: 0, basis: 'off', clamped: false, degraded: false };
  let wanted: number;
  let basis: DelayBasis;
  if (input.mode === 'manual') {
    wanted = input.manualOffsetMs;
    basis = 'manual';
  } else if (input.measuredLatencyMs != null && Number.isFinite(input.measuredLatencyMs)) {
    wanted = input.measuredLatencyMs + input.manualOffsetMs;
    basis = 'measured';
  } else if (input.estimatedLatencyMs != null && Number.isFinite(input.estimatedLatencyMs)) {
    wanted = input.estimatedLatencyMs + input.manualOffsetMs;
    basis = 'estimated';
  } else {
    // No timing from the player yet: the calibrated offset, if any, else live
    wanted = input.manualOffsetMs;
    basis = input.manualOffsetMs !== 0 ? 'manual' : 'none';
  }
  const delayMs = Math.round(Math.min(Math.max(wanted, 0), input.maxBufferMs));
  const clamped = wanted > input.maxBufferMs;
  return { delayMs, basis, clamped, degraded: clamped || basis === 'none' };
}

// Holding the delay steady. Every change to the delay shown changes how fast the delayed timeline plays (a delay
// growing 150 ms every 250 ms plays it at 0.4×), while the map moves the cars between pictures at their real pace, so
// they jump at every picture: choppy, jagged telemetry. The player's latency estimate is never still (it falls each time
// a segment arrives and creeps up until the next, and every stall adds to it), so following it does exactly that.
// Instead: the delay is set once and held; only when what's wanted has been more than DELAY_DEADBAND_MS off for
// DELAY_SETTLE_MS does it glide there, at DELAY_GLIDE_RATE of real time (a speed change nobody sees), until it's
// within DELAY_ON_TARGET_MS. A change of the calibrated offset (the Admin page's Offset) is the viewer's own
// adjustment, so it applies at once; so does a jump of more than DELAY_SNAP_MS (a new stream) and the first delay
export const DELAY_DEADBAND_MS = 2000;
export const DELAY_SETTLE_MS = 5000;
export const DELAY_GLIDE_RATE = 0.05;
export const DELAY_ON_TARGET_MS = 250;
export const DELAY_SNAP_MS = 15_000;

export type DelayHold = {
  applied: number;
  // The offset the applied delay includes, so a change of it is applied as such
  offsetMs: number | null;
  // Since when what's wanted has been outside the deadband, or null
  offSince: number | null;
  gliding: boolean;
};

export const newDelayHold = (): DelayHold => ({ applied: 0, offsetMs: null, offSince: null, gliding: false });

// One step: the delay to show now. target is effectiveDelay's delayMs, offsetMs the calibrated offset it includes
// (null when synchronization is off), dtMs the time since the last step
export function holdDelay(hold: DelayHold, target: number, offsetMs: number | null, now: number, dtMs: number): DelayHold {
  const next = { ...hold };
  if (target <= 0 || offsetMs == null) return newDelayHold();
  if (hold.applied <= 0 || Math.abs(target - hold.applied) > DELAY_SNAP_MS) return { applied: target, offsetMs, offSince: null, gliding: false };
  if (hold.offsetMs != null && offsetMs !== hold.offsetMs) {
    // The calibration moved: by exactly that much, now, and the rest of the hold carries on as it was
    next.applied = Math.max(hold.applied + (offsetMs - hold.offsetMs), 0);
    next.offsetMs = offsetMs;
    return next;
  }
  next.offsetMs = offsetMs;
  const diff = target - hold.applied;
  if (hold.gliding) {
    if (Math.abs(diff) <= DELAY_ON_TARGET_MS) return { ...next, applied: target, gliding: false, offSince: null };
    const step = Math.min(Math.abs(diff), DELAY_GLIDE_RATE * Math.max(dtMs, 0));
    return { ...next, applied: hold.applied + Math.sign(diff) * step };
  }
  if (Math.abs(diff) <= DELAY_DEADBAND_MS) return { ...next, offSince: null };
  const offSince = hold.offSince ?? now;
  if (now - offSince >= DELAY_SETTLE_MS) return { ...next, offSince, gliding: true };
  return { ...next, offSince };
}

// The middle of the recent latency readings, so one segment's sawtooth or a single odd reading doesn't count
export function medianOf(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The difference left between video and telemetry once the delay is applied, when the video's frame time is
// measured: positive means the telemetry is ahead of the picture. Null when there's nothing measured to compare
export function syncErrorMs(measuredLatencyMs: number | null, appliedDelayMs: number, manualOffsetMs: number): number | null {
  if (measuredLatencyMs == null) return null;
  return Math.round(measuredLatencyMs + manualOffsetMs - appliedDelayMs);
}

// When a commentary line about an event should be heard: at the event's moment on the presentation timeline, never
// earlier. The commentary is asked for as soon as the live event arrives, so the AI and speech take up the delay rather
// than adding to it, and the event's own time is used once: arrival time is not added again.
//   eventAtServer: the event's server time; clockOffset: server minus this browser's clock; delayMs: the delay now.
// Returns this browser's Date.now() time to start the line at, or null to play it at once
export function commentaryNotBefore(eventAtServer: number | null, clockOffset: number, delayMs: number): number | null {
  if (eventAtServer == null || delayMs <= 0) return null;
  return eventAtServer - clockOffset + delayMs;
}

// How long a line queued now has to wait, and whether it's already too late to be worth hearing
export function commentaryWait(notBefore: number | null, now: number, staleAfterMs: number): { waitMs: number; stale: boolean } {
  if (notBefore == null) return { waitMs: 0, stale: false };
  const waitMs = Math.max(notBefore - now, 0);
  return { waitMs, stale: now - notBefore > staleAfterMs };
}
