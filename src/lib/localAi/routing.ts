// Where one model call goes (docs/local-ai.md): a local server or the feature's cloud model. Pure, with the clock
// passed in, so `node --test` covers every case; src/lib/localAi/state.ts keeps the live state it reads.

import { HEARTBEAT_STALE_MS, type LocalAiMode, type LocalModelId } from './config.ts';

// What the Mac's agent reports every 10 s (local-ai/gateway.ts). Times are the Mac's and only shown; availability
// is judged by when the website received it.
export type Heartbeat = {
  serverId: string;
  sentAt: number;
  agentVersion: string;
  runtime: 'ok' | 'down';
  installedModels: string[];
  loadedModels: string[];
  activeRequests: number;
  maxConcurrency: number;
  queueDepth: number;
  freeMemoryBytes: number | null;
  totalMemoryBytes: number | null;
  accepting: boolean;
  developmentMode: boolean;
};

export type ServerSnapshot = {
  id: string;
  enabled: boolean;
  maxConcurrency: number;
  heartbeat: Heartbeat | null;
  receivedAt: number | null;
  // This web server's local requests running on it now
  inFlight: number;
  circuit: CircuitState;
};

// Why a call went where it did. Every event row has one (src/lib/localAi/events.ts).
export const ROUTE_REASONS = [
  'local', // sent to a local server
  'cloudOnlyMode',
  'developmentMode',
  'notMapped', // Automatic, but the feature has no local model
  'noServer', // no local server registered and enabled
  'localOffline', // no heartbeat for 30 s, or the agent says Ollama is down
  'localNotAccepting', // the agent says it isn't taking requests (development switch on the Mac)
  'localBusy', // every local slot in use
  'circuitOpen', // too many recent local failures
  'modelUnavailable', // no server has the model installed
  'contextTooLarge', // the request is too big for the local model's context
  'localFailed', // the local attempt failed before giving output
  'localTimeout',
  'localInvalidOutput', // the local model answered, but not in the shape the caller needs
  'settingsUnavailable', // the settings couldn't be read: cloud, to be safe
] as const;
export type RouteReason = (typeof ROUTE_REASONS)[number];

// Reasons where the feature would have gone local: the cloud call is a fallback
export const FALLBACK_REASONS: ReadonlySet<RouteReason> = new Set([
  'localOffline',
  'localNotAccepting',
  'localBusy',
  'circuitOpen',
  'modelUnavailable',
  'contextTooLarge',
  'localFailed',
  'localTimeout',
  'localInvalidOutput',
]);

export type Availability =
  | { available: true }
  | { available: false; reason: 'localOffline' | 'localNotAccepting' | 'disabled' };

export function serverAvailability(server: ServerSnapshot, now: number, staleMs = HEARTBEAT_STALE_MS): Availability {
  if (!server.enabled) return { available: false, reason: 'disabled' };
  if (!server.heartbeat || server.receivedAt === null || now - server.receivedAt > staleMs) {
    return { available: false, reason: 'localOffline' };
  }
  if (server.heartbeat.runtime !== 'ok') return { available: false, reason: 'localOffline' };
  if (!server.heartbeat.accepting || server.heartbeat.developmentMode) return { available: false, reason: 'localNotAccepting' };
  return { available: true };
}

// The local slots a server has: the lower of what the Admin page set and what the Mac says it allows
export const serverCapacity = (server: ServerSnapshot) =>
  Math.max(0, Math.min(server.maxConcurrency, server.heartbeat?.maxConcurrency ?? server.maxConcurrency));

// ---- Circuit breaker: closed (normal), open (local skipped), halfOpen (one trial request at a time) ----

export type CircuitState = { status: 'closed' | 'open' | 'halfOpen'; failures: number; openedAt: number | null; trialInFlight: boolean };

export const closedCircuit = (): CircuitState => ({ status: 'closed', failures: 0, openedAt: null, trialInFlight: false });

// Whether a request may try the server now, and the state to keep if it does
export function circuitAllows(state: CircuitState, now: number, openMs: number): { allowed: boolean; next: CircuitState } {
  if (state.status === 'closed') return { allowed: true, next: state };
  if (state.status === 'open') {
    if (state.openedAt !== null && now - state.openedAt >= openMs) {
      return { allowed: true, next: { ...state, status: 'halfOpen', trialInFlight: true } };
    }
    return { allowed: false, next: state };
  }
  // halfOpen: one trial at a time
  if (state.trialInFlight) return { allowed: false, next: state };
  return { allowed: true, next: { ...state, trialInFlight: true } };
}

export function circuitAfter(state: CircuitState, ok: boolean, now: number, failureThreshold: number): CircuitState {
  if (ok) return closedCircuit();
  const failures = state.failures + 1;
  if (state.status === 'halfOpen' || failures >= failureThreshold) {
    return { status: 'open', failures, openedAt: now, trialInFlight: false };
  }
  return { ...state, failures, trialInFlight: false };
}

// ---- The decision ----

export type RoutePlan = { target: 'local'; serverId: string; model: LocalModelId } | { target: 'cloud'; reason: RouteReason };

export type RouteInput = {
  mode: LocalAiMode;
  model: LocalModelId | null; // the feature's local model
  servers: ServerSnapshot[];
  now: number;
  circuitOpenMs: number;
  estimatedTokens: number;
  contextLimit: number; // the model's context times the allowed share
  force?: boolean; // the Admin's test console: ignore the mode
};

// The local server for a call, or why it goes to the cloud. Among servers that can take it, the one with the most
// free slots, preferring one that has the model loaded already. Doesn't take the slot: the caller does, atomically
// (state.ts), and treats a slot it can't get as localBusy.
export function decideRoute(input: RouteInput): RoutePlan {
  if (!input.force) {
    if (input.mode === 'cloudOnly') return { target: 'cloud', reason: 'cloudOnlyMode' };
    if (input.mode === 'development') return { target: 'cloud', reason: 'developmentMode' };
  }
  if (!input.model) return { target: 'cloud', reason: 'notMapped' };
  const enabled = input.servers.filter((server) => server.enabled);
  if (enabled.length === 0) return { target: 'cloud', reason: 'noServer' };
  if (input.estimatedTokens > input.contextLimit) return { target: 'cloud', reason: 'contextTooLarge' };

  const available = enabled.filter((server) => serverAvailability(server, input.now).available);
  if (available.length === 0) {
    const reasons = enabled.map((server) => serverAvailability(server, input.now));
    const notAccepting = reasons.some((r) => !r.available && r.reason === 'localNotAccepting');
    return { target: 'cloud', reason: notAccepting ? 'localNotAccepting' : 'localOffline' };
  }
  const withModel = available.filter((server) => server.heartbeat?.installedModels.includes(input.model!));
  if (withModel.length === 0) return { target: 'cloud', reason: 'modelUnavailable' };
  const closed = withModel.filter((server) => circuitAllows(server.circuit, input.now, input.circuitOpenMs).allowed);
  if (closed.length === 0) return { target: 'cloud', reason: 'circuitOpen' };
  const free = closed.filter((server) => server.inFlight < serverCapacity(server));
  if (free.length === 0) return { target: 'cloud', reason: 'localBusy' };

  const loaded = (server: ServerSnapshot) => (server.heartbeat?.loadedModels.includes(input.model!) ? 1 : 0);
  const best = [...free].sort(
    (a, b) => loaded(b) - loaded(a) || serverCapacity(b) - b.inFlight - (serverCapacity(a) - a.inFlight) || a.id.localeCompare(b.id)
  )[0];
  return { target: 'local', serverId: best.id, model: input.model };
}
