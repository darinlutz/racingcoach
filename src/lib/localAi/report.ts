import { query } from '@/lib/db';
import { HEARTBEAT_STALE_MS, type LocalAiSettings } from './config';
import { cloudflareAccessHeaders, localAiSecret } from './localModel';
import { serverSnapshots } from './router';
import { serverAvailability, serverCapacity, type CircuitState, type Heartbeat } from './routing';
import { ensureLocalAiSchema, getLocalAiSettings, listLocalAiServers, type LocalAiServer } from './store';

// The Admin page's AI Inference Monitoring (docs/local-ai.md): counts from racingcoach."AiInferenceEvents", the rows
// written as each model call finished, so they're what the providers actually did, not routing guesses. A
// logical request is one model call; it has one attempt, or two when a local attempt fell back to the cloud, so
// requests are counted by logical_request_id and attempts per model. No prompts, answers or users are stored.

export const MONITORING_RANGES = ['today', '24h', '7d', '30d', 'all'] as const;
export type MonitoringRange = (typeof MONITORING_RANGES)[number];

export type MonitoringFilters = {
  range: MonitoringRange;
  timeZone: string;
  provider: string | null;
  model: string | null;
  feature: string | null;
};

export function parseMonitoringFilters(params: URLSearchParams): MonitoringFilters {
  const range = params.get('range');
  const zone = params.get('tz') ?? 'UTC';
  let timeZone = 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    timeZone = zone;
  } catch {
    // an unknown zone: UTC
  }
  const text = (name: string) => {
    const value = params.get(name);
    return value && value.length <= 100 ? value : null;
  };
  return {
    range: (MONITORING_RANGES as readonly string[]).includes(range ?? '') ? (range as MonitoringRange) : '24h',
    timeZone,
    provider: text('provider'),
    model: text('model'),
    feature: text('feature'),
  };
}

function where(filters: MonitoringFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  if (filters.range === 'today') {
    params.push(filters.timeZone);
    parts.push(`started_at >= (date_trunc('day', now() AT TIME ZONE $${params.length}) AT TIME ZONE $${params.length})`);
  } else if (filters.range !== 'all') {
    parts.push(`started_at >= now() - interval '${{ '24h': '24 hours', '7d': '7 days', '30d': '30 days' }[filters.range]}'`);
  }
  for (const [column, value] of [
    ['provider', filters.provider],
    ['requested_model', filters.model],
    ['feature', filters.feature],
  ] as const) {
    if (value) {
      params.push(value);
      parts.push(`${column} = $${params.length}`);
    }
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export type ModelUsageRow = {
  provider: string;
  model: string;
  actualModels: string[];
  attempts: number;
  completed: number;
  failed: number;
  timedOut: number;
  canceled: number;
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number | null;
  lastUsed: string | null;
};

export type RecentAttempt = {
  id: string;
  logicalRequestId: string;
  attempt: number;
  startedAt: string;
  feature: string;
  source: string;
  provider: string;
  serverId: string | null;
  requestedModel: string;
  actualModel: string | null;
  status: string;
  routeReason: string;
  isFallback: boolean;
  errorKind: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  costUsd: number | null;
};

export type InferenceReport = {
  totals: {
    requests: number;
    successfulRequests: number;
    attempts: number;
    localAttempts: number;
    cloudAttempts: number;
    localRequests: number;
    cloudRequests: number;
    localShare: number | null;
    fallbacks: number;
    costUsd: number;
    avgLatencyMs: number | null;
  };
  byModel: ModelUsageRow[];
  byFeature: { feature: string; attempts: number; local: number; cloud: number; fallbacks: number }[];
  recent: RecentAttempt[];
  options: { providers: string[]; models: string[]; features: string[] };
};

const n = (value: unknown) => Number(value ?? 0);
const nullable = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function readInferenceReport(filters: MonitoringFilters): Promise<InferenceReport> {
  await ensureLocalAiSchema();
  const { sql, params } = where(filters);
  const table = 'racingcoach."AiInferenceEvents"';
  const [totals, byModel, byFeature, recent, options] = await Promise.all([
    query(
      `WITH e AS (SELECT * FROM ${table} ${sql}),
            logical AS (
              SELECT logical_request_id,
                     bool_or(status = 'completed') AS ok,
                     bool_or(status = 'completed' AND provider = 'Local') AS local_ok
              FROM e GROUP BY logical_request_id)
       SELECT (SELECT count(*) FROM logical) AS requests,
              (SELECT count(*) FILTER (WHERE ok) FROM logical) AS successful,
              (SELECT count(*) FILTER (WHERE local_ok) FROM logical) AS local_requests,
              (SELECT count(*) FILTER (WHERE ok AND NOT local_ok) FROM logical) AS cloud_requests,
              count(*) AS attempts,
              count(*) FILTER (WHERE provider = 'Local') AS local_attempts,
              count(*) FILTER (WHERE provider <> 'Local') AS cloud_attempts,
              count(*) FILTER (WHERE is_fallback) AS fallbacks,
              COALESCE(sum(cost_usd), 0) AS cost,
              avg(latency_ms) FILTER (WHERE status = 'completed') AS latency
       FROM e`,
      params
    ),
    query(
      `SELECT provider, requested_model,
              array_remove(array_agg(DISTINCT actual_model), NULL) AS actual_models,
              count(*) AS attempts,
              count(*) FILTER (WHERE status = 'completed') AS completed,
              count(*) FILTER (WHERE status = 'failed') AS failed,
              count(*) FILTER (WHERE status = 'timedOut') AS timed_out,
              count(*) FILTER (WHERE status = 'canceled') AS canceled,
              count(*) FILTER (WHERE is_fallback) AS fallbacks,
              COALESCE(sum(input_tokens), 0) AS input_tokens,
              COALESCE(sum(output_tokens), 0) AS output_tokens,
              COALESCE(sum(cost_usd), 0) AS cost,
              avg(latency_ms) FILTER (WHERE status = 'completed') AS latency,
              max(started_at) AS last_used
       FROM ${table} ${sql}
       GROUP BY provider, requested_model
       ORDER BY count(*) DESC, requested_model`,
      params
    ),
    query(
      // Logical requests per feature (like the totals), and which provider completed each
      `SELECT feature, count(DISTINCT logical_request_id) AS attempts,
              count(DISTINCT logical_request_id) FILTER (WHERE status = 'completed' AND provider = 'Local') AS local,
              count(DISTINCT logical_request_id) FILTER (WHERE status = 'completed' AND provider <> 'Local') AS cloud,
              count(*) FILTER (WHERE is_fallback) AS fallbacks
       FROM ${table} ${sql} GROUP BY feature ORDER BY count(DISTINCT logical_request_id) DESC`,
      params
    ),
    query(
      `SELECT id, logical_request_id, attempt, started_at, feature, source, provider, server_id, requested_model,
              actual_model, status, route_reason, is_fallback, error_kind, input_tokens, output_tokens, latency_ms, cost_usd
       FROM ${table} ${sql} ORDER BY started_at DESC, attempt DESC LIMIT 50`,
      params
    ),
    query(
      `SELECT array_agg(DISTINCT provider) AS providers, array_agg(DISTINCT requested_model) AS models,
              array_agg(DISTINCT feature) AS features
       FROM ${table} WHERE started_at >= now() - interval '90 days'`
    ),
  ]);
  const t = totals[0] ?? {};
  const successful = n(t.successful);
  return {
    totals: {
      requests: n(t.requests),
      successfulRequests: successful,
      attempts: n(t.attempts),
      localAttempts: n(t.local_attempts),
      cloudAttempts: n(t.cloud_attempts),
      localRequests: n(t.local_requests),
      cloudRequests: n(t.cloud_requests),
      localShare: successful > 0 ? n(t.local_requests) / successful : null,
      fallbacks: n(t.fallbacks),
      costUsd: n(t.cost),
      avgLatencyMs: t.latency === null || t.latency === undefined ? null : Math.round(Number(t.latency)),
    },
    byModel: byModel.map((row) => ({
      provider: row.provider,
      model: row.requested_model,
      actualModels: row.actual_models ?? [],
      attempts: n(row.attempts),
      completed: n(row.completed),
      failed: n(row.failed),
      timedOut: n(row.timed_out),
      canceled: n(row.canceled),
      fallbacks: n(row.fallbacks),
      inputTokens: n(row.input_tokens),
      outputTokens: n(row.output_tokens),
      costUsd: n(row.cost),
      avgLatencyMs: row.latency === null ? null : Math.round(Number(row.latency)),
      lastUsed: row.last_used ? new Date(row.last_used).toISOString() : null,
    })),
    byFeature: byFeature.map((row) => ({
      feature: row.feature,
      attempts: n(row.attempts),
      local: n(row.local),
      cloud: n(row.cloud),
      fallbacks: n(row.fallbacks),
    })),
    recent: recent.map((row) => ({
      id: row.id,
      logicalRequestId: row.logical_request_id,
      attempt: n(row.attempt),
      startedAt: new Date(row.started_at).toISOString(),
      feature: row.feature,
      source: row.source,
      provider: row.provider,
      serverId: row.server_id,
      requestedModel: row.requested_model,
      actualModel: row.actual_model,
      status: row.status,
      routeReason: row.route_reason,
      isFallback: row.is_fallback,
      errorKind: row.error_kind,
      inputTokens: nullable(row.input_tokens),
      outputTokens: nullable(row.output_tokens),
      latencyMs: n(row.latency_ms),
      costUsd: nullable(row.cost_usd),
    })),
    options: {
      providers: (options[0]?.providers ?? []).filter(Boolean).sort(),
      models: (options[0]?.models ?? []).filter(Boolean).sort(),
      features: (options[0]?.features ?? []).filter(Boolean).sort(),
    },
  };
}

// ---- Live status ----

export type ServerStatus = LocalAiServer & {
  online: boolean;
  availability: string; // 'available', or why not
  heartbeat: Heartbeat | null;
  receivedAt: string | null;
  inFlight: number;
  capacity: number;
  circuit: CircuitState;
};

export type LocalAiStatus = {
  settings: LocalAiSettings;
  servers: ServerStatus[];
  configured: { sharedSecret: boolean; cloudflareAccess: boolean };
  heartbeatStaleMs: number;
  now: string;
};

export async function readLocalAiStatus(): Promise<LocalAiStatus> {
  const [settings, servers] = await Promise.all([getLocalAiSettings(), listLocalAiServers(true)]);
  const now = Date.now();
  const snapshots = serverSnapshots(servers);
  return {
    settings,
    servers: servers.map((server, index) => {
      const snapshot = snapshots[index];
      const availability = serverAvailability(snapshot, now);
      return {
        ...server,
        online: availability.available,
        availability: availability.available ? 'available' : availability.reason,
        heartbeat: snapshot.heartbeat,
        receivedAt: snapshot.receivedAt ? new Date(snapshot.receivedAt).toISOString() : null,
        inFlight: snapshot.inFlight,
        capacity: serverCapacity(snapshot),
        circuit: snapshot.circuit,
      };
    }),
    configured: { sharedSecret: Boolean(localAiSecret()), cloudflareAccess: Object.keys(cloudflareAccessHeaders()).length > 0 },
    heartbeatStaleMs: HEARTBEAT_STALE_MS,
    now: new Date(now).toISOString(),
  };
}
