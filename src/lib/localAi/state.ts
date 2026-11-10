// The live state of the local AI servers on this web server (docs/local-ai.md): each one's latest heartbeat (when it
// arrived, by this server's clock), the local requests running on it now, and its circuit breaker. In memory, like
// Live Racing's positions: a heartbeat arrives every 10 s, so writing each to Postgres would be 8,640 writes a day
// per Mac for nothing; after a restart a server counts as offline until its next heartbeat (at most 10 s). With more
// than one web server instance each would hold its own, and the Mac would need to reach each (see the docs).
// Kept on globalThis so Next.js's development reloads don't start it over.

import { closedCircuit, circuitAfter, circuitAllows, serverCapacity, type CircuitState, type Heartbeat, type RouteReason } from './routing.ts';
import { NonceCache } from './signing.ts';

type LiveServer = { heartbeat: Heartbeat | null; receivedAt: number | null; inFlight: number; circuit: CircuitState };

type State = {
  servers: Map<string, LiveServer>;
  nonces: NonceCache;
  // Capacity and circuit settings last read, so acquire() can decide synchronously
  capacity: Map<string, number>;
  circuitOpenMs: number;
  circuitFailures: number;
};

const KEY = Symbol.for('racingcoach.localAi.state');
const globalState = globalThis as unknown as { [KEY]?: State };

function state(): State {
  globalState[KEY] ??= {
    servers: new Map(),
    nonces: new NonceCache(),
    capacity: new Map(),
    circuitOpenMs: 60_000,
    circuitFailures: 3,
  };
  return globalState[KEY];
}

function server(id: string): LiveServer {
  const servers = state().servers;
  let entry = servers.get(id);
  if (!entry) {
    entry = { heartbeat: null, receivedAt: null, inFlight: 0, circuit: closedCircuit() };
    servers.set(id, entry);
  }
  return entry;
}

export const heartbeatNonces = () => state().nonces;

export function recordHeartbeat(heartbeat: Heartbeat, receivedAt: number = Date.now()) {
  const entry = server(heartbeat.serverId);
  entry.heartbeat = heartbeat;
  entry.receivedAt = receivedAt;
}

export function liveServer(id: string): Readonly<LiveServer> {
  return server(id);
}

export function configureCapacity(id: string, maxConcurrency: number) {
  state().capacity.set(id, maxConcurrency);
}

export function configureCircuit(openMs: number, failures: number) {
  state().circuitOpenMs = openMs;
  state().circuitFailures = failures;
}

// Takes a slot (and, for a half-open circuit, its one trial). Synchronous, so two calls can't both take the last slot.
export function acquireLocalSlot(id: string, now: number = Date.now()): RouteReason | null {
  const s = state();
  const entry = server(id);
  const capacity = serverCapacity({
    id,
    enabled: true,
    maxConcurrency: s.capacity.get(id) ?? 2,
    heartbeat: entry.heartbeat,
    receivedAt: entry.receivedAt,
    inFlight: entry.inFlight,
    circuit: entry.circuit,
  });
  if (entry.inFlight >= capacity) return 'localBusy';
  const circuit = circuitAllows(entry.circuit, now, s.circuitOpenMs);
  if (!circuit.allowed) return 'circuitOpen';
  entry.circuit = circuit.next;
  entry.inFlight += 1;
  return null;
}

export function releaseLocalSlot(id: string) {
  const entry = server(id);
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  // A trial that ended without a verdict (canceled) frees the trial for the next request
  if (entry.circuit.status === 'halfOpen') entry.circuit = { ...entry.circuit, trialInFlight: false };
}

export function reportLocalResult(id: string, ok: boolean, now: number = Date.now()) {
  const entry = server(id);
  const before = entry.circuit.status;
  entry.circuit = circuitAfter(entry.circuit, ok, now, state().circuitFailures);
  if (before !== entry.circuit.status) {
    console.warn(`Local AI server ${id}: circuit ${before} -> ${entry.circuit.status} (${entry.circuit.failures} failures)`);
  }
}

// For the tests
export function resetLocalAiState() {
  delete globalState[KEY];
}
