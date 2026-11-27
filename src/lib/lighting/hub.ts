import { randomUUID } from 'node:crypto';
import {
  LIGHTING_SCHEMA_VERSION,
  lightingChanges,
  lightingStateOf,
  telemetryFresh,
  type EventDraft,
  type LightingEvent,
  type LightingEventSource,
  type LightingState,
  type LightingUpdate,
} from './events.ts';

// Each driver's lighting state and recent events, in this server's memory (events.ts has the contract). Like Live
// Racing's live state, which feeds it, this assumes one server instance: the event stream must be served by the
// instance the collector posts to. Publishing goes through `bus`, so a Postgres LISTEN/NOTIFY bus can replace the
// in-process one if the site ever runs on several instances (docs/lighting/README.md).
//
// Nothing here is stored: no telemetry samples, only the state lighting needs and the last HISTORY events per driver,
// for agents that reconnect and resume.

const HISTORY = 200;

type Listener = (event: LightingEvent) => void;

type DriverLighting = {
  sequence: number;
  live: LightingState | null;
  // When the collector's last live update arrived (Date.now()), for telemetry freshness
  liveAt: number | null;
  // The Admin page's Test Lab: a simulated state that never touches the live one
  test: LightingState | null;
  history: LightingEvent[];
  listeners: Set<Listener>;
};

const store = globalThis as unknown as { racingcoachLighting?: { epoch: string; drivers: Map<number, DriverLighting> } };
const hub = (store.racingcoachLighting ??= { epoch: randomUUID().slice(0, 8), drivers: new Map() });

// The bus delivers a driver's events to this server's subscribers; replaceable for several instances
export type LightingBus = { publish(userId: number, event: LightingEvent): void };
export const bus: LightingBus = {
  publish(userId, event) {
    for (const listener of driver(userId).listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Lighting listener error:', error);
      }
    }
  },
};

function driver(userId: number): DriverLighting {
  let entry = hub.drivers.get(userId);
  if (!entry) {
    entry = { sequence: 0, live: null, liveAt: null, test: null, history: [], listeners: new Set() };
    hub.drivers.set(userId, entry);
  }
  return entry;
}

function emit(userId: number, drafts: EventDraft[], source: LightingEventSource, state: LightingState | null, now: number) {
  const entry = driver(userId);
  for (const draft of drafts) {
    entry.sequence += 1;
    const event: LightingEvent = {
      schemaVersion: LIGHTING_SCHEMA_VERSION,
      eventId: `${hub.epoch}-${userId}-${entry.sequence}`,
      eventType: draft.eventType,
      source,
      simulator: state?.simulator ?? null,
      sessionId: state?.sessionId ?? null,
      epoch: hub.epoch,
      sequence: entry.sequence,
      timestampUtc: new Date(now).toISOString(),
      data: draft.data,
    };
    entry.history.push(event);
    if (entry.history.length > HISTORY) entry.history.splice(0, entry.history.length - HISTORY);
    bus.publish(userId, event);
  }
}

// A live update from the driver's collector (POST /api/collector/live)
export function recordLightingUpdate(userId: number, update: LightingUpdate, now = Date.now()): void {
  const entry = driver(userId);
  const next = lightingStateOf(update);
  const drafts = lightingChanges(entry.live, next);
  entry.live = next;
  entry.liveAt = now;
  emit(userId, drafts, 'live', next, now);
}

// The collector said the driver has gone (DELETE /api/collector/live)
export function endLightingSession(userId: number, now = Date.now()): void {
  const entry = hub.drivers.get(userId);
  if (!entry?.live) return;
  const before = entry.live;
  entry.live = null;
  entry.liveAt = null;
  emit(userId, lightingChanges(before, null), 'live', before, now);
}

// The Test Lab's simulated events (POST /api/admin/lighting/test): marked test, applied to the test state only
export function emitTestEvent(userId: number, draft: EventDraft, now = Date.now()): void {
  const entry = driver(userId);
  const base: LightingState = entry.test ?? { simulator: 'iracing', sessionId: 'test', pitLimiterActive: false, onTrack: true };
  if (draft.eventType === 'pitLimiter.changed') entry.test = { ...base, pitLimiterActive: draft.data.active === true };
  else if (draft.eventType === 'session.ended') entry.test = null;
  else entry.test = base;
  emit(userId, [draft], 'test', entry.test ?? base, now);
}

export type LightingSnapshot = {
  schemaVersion: typeof LIGHTING_SCHEMA_VERSION;
  epoch: string;
  sequence: number;
  serverTimeUtc: string;
  // null while the driver's collector isn't sending
  live: (LightingState & { telemetryAgeMs: number; fresh: boolean }) | null;
  test: LightingState | null;
};

export function lightingSnapshot(userId: number, now = Date.now()): LightingSnapshot {
  const entry = driver(userId);
  const ageMs = entry.liveAt === null ? null : now - entry.liveAt;
  return {
    schemaVersion: LIGHTING_SCHEMA_VERSION,
    epoch: hub.epoch,
    sequence: entry.sequence,
    serverTimeUtc: new Date(now).toISOString(),
    live: entry.live && ageMs !== null ? { ...entry.live, telemetryAgeMs: ageMs, fresh: telemetryFresh(ageMs) } : null,
    test: entry.test,
  };
}

// The events after an agent's position, or null when it must take a snapshot instead (another epoch, or too old)
export function lightingEventsAfter(userId: number, epoch: string, sequence: number): LightingEvent[] | null {
  const entry = driver(userId);
  if (epoch !== hub.epoch || sequence > entry.sequence) return null;
  const missed = entry.history.filter((e) => e.sequence > sequence);
  if (entry.sequence - sequence > missed.length) return null;
  return missed;
}

export function subscribeLighting(userId: number, listener: Listener): () => void {
  const listeners = driver(userId).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// For tests
export function resetLightingHubForTests(): void {
  hub.drivers.clear();
}
