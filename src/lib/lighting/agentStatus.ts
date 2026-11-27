// What each lighting agent last said about itself (POST /api/lighting/devices/heartbeat), for the Admin page's
// Lighting Control dashboard: kept in this server's memory only, as it changes every few seconds and means nothing
// after a restart. Controllers' private network addresses are never kept here: only names, counts and states.

export type AgentControllerStatus = {
  id: string;
  name: string;
  online: boolean;
  firmware: string | null;
  lastAckMs: number | null;
  latencyMs: number | null;
};

export type AgentStatus = {
  version: string | null;
  mode: string | null;
  scene: string | null;
  activeOverride: string | null;
  lastEventSequence: number | null;
  // From the collector's update reaching the server to the controllers acknowledging, as the agent measured it
  lastEventLatencyMs: number | null;
  controllers: AgentControllerStatus[];
  receivedAt: number;
};

const store = globalThis as unknown as { racingcoachLightingAgents?: Map<number, AgentStatus> };
const statuses = (store.racingcoachLightingAgents ??= new Map());

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const num = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : null;

// The agent's own report, kept to known fields and sizes
export function parseAgentStatus(body: unknown, now = Date.now()): AgentStatus {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const controllers = Array.isArray(b.controllers) ? b.controllers.slice(0, 32) : [];
  return {
    version: text(b.version, 40),
    mode: text(b.mode, 20),
    scene: text(b.scene, 80),
    activeOverride: text(b.activeOverride, 80),
    lastEventSequence: num(b.lastEventSequence, 1e12),
    lastEventLatencyMs: num(b.lastEventLatencyMs, 600_000),
    controllers: controllers.map((c, i) => {
      const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      return {
        id: text(r.id, 40) ?? String(i),
        name: text(r.name, 80) ?? `Controller ${i + 1}`,
        online: r.online === true,
        firmware: text(r.firmware, 40),
        lastAckMs: num(r.lastAckMs, 86_400_000),
        latencyMs: num(r.latencyMs, 600_000),
      };
    }),
    receivedAt: now,
  };
}

export function recordAgentStatus(deviceId: number, status: AgentStatus): void {
  statuses.set(deviceId, status);
}

export function agentStatus(deviceId: number): AgentStatus | null {
  return statuses.get(deviceId) ?? null;
}

export function forgetAgentStatus(deviceId: number): void {
  statuses.delete(deviceId);
}
