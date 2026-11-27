// The lighting event contract (docs/lighting/README.md): what the RacingCoach Lighting Agent on the owner's Mac
// receives about the driver's live session. Pure: no I/O, timers or imports, so Node's test runner and the agent
// (lighting-agent/, which copies the types) read it as it is.
//
// Events are made from the collector's live updates (src/lib/liveRacing.ts), never stored: each driver's newest state
// and a short history are kept in server memory by hub.ts. Every event carries the server's epoch (a new one each
// time the server starts) and a sequence number counting up within it, so an agent can drop duplicates, ignore
// out-of-order arrivals and tell when it must take a new snapshot instead of resuming.

export const LIGHTING_SCHEMA_VERSION = 1;

export type LightingSimulator = 'iracing' | 'acc' | 'ac';

// live: from the collector; test: from the Admin page's Test Lab, which never touches the live race data
export type LightingEventSource = 'live' | 'test';

export type LightingEventType =
  | 'pitLimiter.changed'
  // The driver's session started or changed (a new subsession, session or track)
  | 'session.changed'
  // The collector closed, iRacing closed, or the driver's live updates stopped: overrides end
  | 'session.ended';

// The driver's state as the lighting needs it: never the telemetry samples themselves
export type LightingState = {
  simulator: LightingSimulator;
  sessionId: string;
  // true on, false off, null when the simulator doesn't say
  pitLimiterActive: boolean | null;
  onTrack: boolean;
};

export type LightingEvent = {
  schemaVersion: typeof LIGHTING_SCHEMA_VERSION;
  eventId: string;
  eventType: LightingEventType;
  source: LightingEventSource;
  simulator: LightingSimulator | null;
  sessionId: string | null;
  epoch: string;
  sequence: number;
  timestampUtc: string;
  data: Record<string, unknown>;
};

// What lighting needs from a live update (LiveUpdate's fields, kept loose so this file imports nothing)
export type LightingUpdate = {
  simulator?: LightingSimulator | null;
  pitLimiterActive?: boolean | null;
  onTrack: boolean;
  track: string;
  trackKey?: string | null;
  sessionType?: string | null;
  sessionName?: string | null;
  field?: { subSessionId: number } | null;
};

// One session: the subsession online (0 offline), the session's type and name, and the track
export function lightingSessionId(update: LightingUpdate): string {
  return [
    update.field?.subSessionId ?? 'offline',
    update.sessionType ?? '',
    update.sessionName ?? '',
    update.trackKey ?? update.track,
  ].join('|');
}

export function lightingStateOf(update: LightingUpdate): LightingState {
  return {
    simulator: update.simulator ?? 'iracing',
    sessionId: lightingSessionId(update),
    pitLimiterActive: update.pitLimiterActive ?? null,
    onTrack: update.onTrack,
  };
}

export type EventDraft = { eventType: LightingEventType; data: Record<string, unknown> };

// The events a change of state makes, in order. A new session first says so; the pit limiter's change is told
// whenever its value differs, null included (unknown is a state the lights must leave the blue for)
export function lightingChanges(before: LightingState | null, after: LightingState | null): EventDraft[] {
  if (!after) return before ? [{ eventType: 'session.ended', data: { reason: 'collectorClosed' } }] : [];
  const drafts: EventDraft[] = [];
  if (!before || before.sessionId !== after.sessionId || before.simulator !== after.simulator) {
    drafts.push({ eventType: 'session.changed', data: { onTrack: after.onTrack } });
  }
  if (!before || before.pitLimiterActive !== after.pitLimiterActive) {
    drafts.push({ eventType: 'pitLimiter.changed', data: { active: after.pitLimiterActive } });
  }
  return drafts;
}

// Telemetry is fresh while the collector's last update is this recent. The collector sends twice a second in the car
// (and at once when the pit limiter changes), every 5 s in the garage, so 5 s means it stopped while driving
export const FRESH_TELEMETRY_MS = 5_000;

export function telemetryFresh(ageMs: number | null, freshMs = FRESH_TELEMETRY_MS): boolean {
  return ageMs !== null && ageMs >= 0 && ageMs <= freshMs;
}

// An agent's position in the stream: Last-Event-ID is "<epoch>:<sequence>"
export function parseStreamPosition(value: string | null): { epoch: string; sequence: number } | null {
  const match = value?.match(/^([A-Za-z0-9-]{1,64}):(\d{1,12})$/);
  return match ? { epoch: match[1], sequence: Number(match[2]) } : null;
}

export const streamPosition = (event: Pick<LightingEvent, 'epoch' | 'sequence'>) => `${event.epoch}:${event.sequence}`;
