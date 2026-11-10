import { query } from '@/lib/db';
import { ensureUserSchema } from '@/lib/users';
import { defaultLocalAiSettings, parseLocalAiSettings, type LocalAiSettings } from './config';
import type { Heartbeat } from './routing';

// Local AI's tables and settings (docs/local-ai.md). The settings (mode, feature mappings, timeouts) are one JSON
// row in "SiteSettings", key local_ai, read at most every 5 s per server; no row is Cloud Only. The schema only adds
// (CREATE ... IF NOT EXISTS) and is run lazily the first time local AI is used, not by ensureUserSchema, so a problem
// here can't stop the rest of the site. Neither table holds personal data (NON_PERSONAL_TABLES): servers are the
// owner's machines, and inference events have the feature, the caller's category (Admin, Gold, Silver, Bronze),
// models, tokens and times, never a user, IP address, prompt or answer.

export const LOCAL_AI_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS racingcoach."LocalAiServers" (
     id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
     label TEXT NOT NULL,
     gateway_url TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT true,
     max_concurrency INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrency BETWEEN 1 AND 16),
     last_heartbeat_at TIMESTAMPTZ,
     last_heartbeat JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // One row per model call attempt: a call that tried a local server and then the cloud is two rows with one
  // logical_request_id. cost_usd is the cloud list price of its tokens (src/lib/aiModelPrices.ts); local calls cost 0
  `CREATE TABLE IF NOT EXISTS racingcoach."AiInferenceEvents" (
     id UUID PRIMARY KEY,
     logical_request_id UUID NOT NULL,
     attempt SMALLINT NOT NULL,
     feature TEXT NOT NULL,
     category TEXT,
     source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'testConsole')),
     provider TEXT NOT NULL,
     server_id TEXT,
     requested_model TEXT NOT NULL,
     actual_model TEXT,
     status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timedOut', 'canceled')),
     route_reason TEXT NOT NULL,
     is_fallback BOOLEAN NOT NULL DEFAULT false,
     error_kind TEXT,
     input_tokens INTEGER,
     cached_input_tokens INTEGER,
     output_tokens INTEGER,
     latency_ms INTEGER NOT NULL,
     cost_usd NUMERIC(14, 8),
     started_at TIMESTAMPTZ NOT NULL,
     recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ai_inference_events_started ON racingcoach."AiInferenceEvents" (started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ai_inference_events_model ON racingcoach."AiInferenceEvents" (provider, requested_model, started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_inference_events_feature ON racingcoach."AiInferenceEvents" (feature, started_at)`,
  `CREATE INDEX IF NOT EXISTS ai_inference_events_logical ON racingcoach."AiInferenceEvents" (logical_request_id)`,
];

// Events are kept this long, then deleted by the hourly job (startLocalAiJobs)
export const INFERENCE_EVENT_RETENTION_DAYS = 90;

const globalForSchema = globalThis as unknown as { localAiSchema?: Promise<void> };

export function ensureLocalAiSchema(): Promise<void> {
  globalForSchema.localAiSchema ??= (async () => {
    await ensureUserSchema();
    for (const statement of LOCAL_AI_SCHEMA) await query(statement);
  })().catch((error) => {
    globalForSchema.localAiSchema = undefined;
    throw error;
  });
  return globalForSchema.localAiSchema;
}

// ---- Settings ----

const SETTINGS_KEY = 'local_ai';
const SETTINGS_CACHE_MS = 5_000;
let cachedSettings: { at: number; settings: LocalAiSettings } | null = null;

export async function getLocalAiSettings(): Promise<LocalAiSettings> {
  if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_MS) return cachedSettings.settings;
  await ensureUserSchema();
  const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [SETTINGS_KEY]);
  let raw: unknown = null;
  try {
    raw = rows[0] ? JSON.parse(rows[0].value) : null;
  } catch {
    console.error('Local AI settings are not valid JSON; using Cloud Only');
  }
  const settings = raw ? parseLocalAiSettings(raw) : defaultLocalAiSettings();
  cachedSettings = { at: Date.now(), settings };
  return settings;
}

export async function saveLocalAiSettings(settings: LocalAiSettings, userId: number): Promise<LocalAiSettings> {
  const clean = parseLocalAiSettings(settings);
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(clean), userId]
  );
  cachedSettings = { at: Date.now(), settings: clean };
  return clean;
}

// ---- Servers ----

export type LocalAiServer = {
  id: string;
  label: string;
  gatewayUrl: string;
  enabled: boolean;
  maxConcurrency: number;
  lastHeartbeatAt: string | null;
};

const SERVERS_CACHE_MS = 5_000;
let cachedServers: { at: number; servers: LocalAiServer[] } | null = null;

export async function listLocalAiServers(fresh = false): Promise<LocalAiServer[]> {
  if (!fresh && cachedServers && Date.now() - cachedServers.at < SERVERS_CACHE_MS) return cachedServers.servers;
  await ensureLocalAiSchema();
  const rows = await query<{
    id: string;
    label: string;
    gateway_url: string;
    enabled: boolean;
    max_concurrency: number;
    last_heartbeat_at: Date | null;
  }>(
    `SELECT id, label, gateway_url, enabled, max_concurrency, last_heartbeat_at
     FROM racingcoach."LocalAiServers" ORDER BY id`
  );
  const servers = rows.map((row) => ({
    id: row.id,
    label: row.label,
    gatewayUrl: row.gateway_url,
    enabled: row.enabled,
    maxConcurrency: row.max_concurrency,
    lastHeartbeatAt: row.last_heartbeat_at ? row.last_heartbeat_at.toISOString() : null,
  }));
  cachedServers = { at: Date.now(), servers };
  return servers;
}

export async function saveLocalAiServer(server: Omit<LocalAiServer, 'lastHeartbeatAt'>): Promise<void> {
  await ensureLocalAiSchema();
  await query(
    `INSERT INTO racingcoach."LocalAiServers" (id, label, gateway_url, enabled, max_concurrency)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, gateway_url = EXCLUDED.gateway_url,
       enabled = EXCLUDED.enabled, max_concurrency = EXCLUDED.max_concurrency, updated_at = now()`,
    [server.id, server.label, server.gatewayUrl, server.enabled, server.maxConcurrency]
  );
  cachedServers = null;
}

export async function deleteLocalAiServer(id: string): Promise<void> {
  await ensureLocalAiSchema();
  await query('DELETE FROM racingcoach."LocalAiServers" WHERE id = $1', [id]);
  cachedServers = null;
}

// The latest heartbeat goes to Postgres at most once a minute per server, so the Admin page can say when a server was
// last seen after a restart; availability itself comes from memory (state.ts)
const PERSIST_EVERY_MS = 60_000;
const lastPersisted = new Map<string, number>();

export async function persistHeartbeat(heartbeat: Heartbeat, now: number = Date.now()): Promise<void> {
  const last = lastPersisted.get(heartbeat.serverId) ?? 0;
  if (now - last < PERSIST_EVERY_MS) return;
  lastPersisted.set(heartbeat.serverId, now);
  try {
    await query(
      `UPDATE racingcoach."LocalAiServers" SET last_heartbeat_at = now(), last_heartbeat = $2 WHERE id = $1`,
      [heartbeat.serverId, JSON.stringify(heartbeat)]
    );
  } catch (error) {
    lastPersisted.delete(heartbeat.serverId);
    console.error('Failed to save a local AI heartbeat:', error);
  }
}

// ---- Events ----

export type InferenceEventRow = {
  id: string;
  logicalRequestId: string;
  attempt: number;
  feature: string;
  category: string | null;
  source: 'app' | 'testConsole';
  provider: string;
  serverId: string | null;
  requestedModel: string;
  actualModel: string | null;
  status: 'completed' | 'failed' | 'timedOut' | 'canceled';
  routeReason: string;
  isFallback: boolean;
  errorKind: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  costUsd: number | null;
  startedAt: Date;
};

// Never fails the AI call it records
export async function insertInferenceEvent(row: InferenceEventRow): Promise<void> {
  try {
    await ensureLocalAiSchema();
    await query(
      `INSERT INTO racingcoach."AiInferenceEvents" (id, logical_request_id, attempt, feature, category, source, provider,
         server_id, requested_model, actual_model, status, route_reason, is_fallback, error_kind, input_tokens,
         cached_input_tokens, output_tokens, latency_ms, cost_usd, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.logicalRequestId,
        row.attempt,
        row.feature,
        row.category,
        row.source,
        row.provider,
        row.serverId,
        row.requestedModel,
        row.actualModel,
        row.status,
        row.routeReason,
        row.isFallback,
        row.errorKind,
        row.inputTokens,
        row.cachedInputTokens,
        row.outputTokens,
        row.latencyMs,
        row.costUsd,
        row.startedAt,
      ]
    );
  } catch (error) {
    console.error('Failed to record an AI inference event:', error);
  }
}

export async function purgeOldInferenceEvents(): Promise<number> {
  await ensureLocalAiSchema();
  const rows = await query<{ id: string }>(
    `WITH gone AS (
       DELETE FROM racingcoach."AiInferenceEvents" WHERE started_at < now() - make_interval(days => $1) RETURNING id
     ) SELECT count(*)::text AS id FROM gone`,
    [INFERENCE_EVENT_RETENTION_DAYS]
  );
  return Number(rows[0]?.id ?? 0);
}

// Hourly, on the live server only (src/instrumentation.ts)
export function startLocalAiJobs() {
  const run = () =>
    purgeOldInferenceEvents()
      .then((count) => count > 0 && console.log(`Local AI: deleted ${count} inference events older than ${INFERENCE_EVENT_RETENTION_DAYS} days`))
      .catch((error) => console.error('Failed to purge old AI inference events:', error));
  setTimeout(run, 5 * 60_000).unref?.();
  setInterval(run, 60 * 60_000).unref?.();
}
