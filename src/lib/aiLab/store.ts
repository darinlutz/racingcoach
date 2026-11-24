import { query } from '@/lib/db';
import { ensureLocalAiSchema } from '@/lib/localAi/store';
import { ensureUserSchema } from '@/lib/users';
import { DEFAULT_AI_LAB_SETTINGS, parseAiLabSettings, type AiLabSettings, type LabParams } from './rules';

// AI Lab's tables and settings (docs/AI_LAB_SETUP.md). Created lazily, additive only (CREATE ... IF NOT EXISTS),
// like Local AI's, so a problem here can't stop the site. The lab is kept apart from production: its settings are
// their own "SiteSettings" row (key ai_lab), which chatModel() and the Local AI router never read.
//
// "AiLabPrompts" and "AiLabBenchmarks" are the playground's saved prompts and results: written by Admins, with no
// user column (NON_PERSONAL_TABLES). "AiLabAuditLog" records every AI Lab action that changes something or costs
// money (who, what, the outcome), with the Admin's ID, cleared to NULL when that account is deleted (the inventory's
// uploadsAsCoach). Kept a year.

export const AI_LAB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS racingcoach."AiLabPrompts" (
     id BIGSERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     system_prompt TEXT NOT NULL DEFAULT '',
     user_prompt TEXT NOT NULL,
     params JSONB NOT NULL DEFAULT '{}'::jsonb,
     models JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS racingcoach."AiLabBenchmarks" (
     id BIGSERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     system_prompt TEXT NOT NULL DEFAULT '',
     user_prompt TEXT NOT NULL,
     results JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ai_lab_benchmarks_created ON racingcoach."AiLabBenchmarks" (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS racingcoach."AiLabAuditLog" (
     id BIGSERIAL PRIMARY KEY,
     at TIMESTAMPTZ NOT NULL DEFAULT now(),
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     action TEXT NOT NULL,
     target TEXT,
     outcome TEXT NOT NULL,
     detail JSONB
   )`,
  `CREATE INDEX IF NOT EXISTS ai_lab_audit_at ON racingcoach."AiLabAuditLog" (at DESC)`,
];

export const MAX_SAVED_PROMPTS = 500;
export const MAX_SAVED_BENCHMARKS = 1000;
export const AUDIT_RETENTION_DAYS = 365;

const globalForSchema = globalThis as unknown as { aiLabSchema?: Promise<void> };

export function ensureAiLabSchema(): Promise<void> {
  globalForSchema.aiLabSchema ??= (async () => {
    await ensureLocalAiSchema();
    for (const statement of AI_LAB_SCHEMA) await query(statement);
  })().catch((error) => {
    globalForSchema.aiLabSchema = undefined;
    throw error;
  });
  return globalForSchema.aiLabSchema;
}

// ---- Settings ----

const SETTINGS_KEY = 'ai_lab';

export async function getAiLabSettings(): Promise<AiLabSettings> {
  await ensureUserSchema();
  const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [SETTINGS_KEY]);
  if (!rows[0]) return { ...DEFAULT_AI_LAB_SETTINGS, modelParams: {} };
  try {
    return parseAiLabSettings(JSON.parse(rows[0].value));
  } catch {
    console.error('AI Lab settings are not valid JSON; using the defaults');
    return { ...DEFAULT_AI_LAB_SETTINGS, modelParams: {} };
  }
}

export async function saveAiLabSettings(settings: AiLabSettings, userId: number): Promise<AiLabSettings> {
  const clean = parseAiLabSettings(settings);
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(clean), userId]
  );
  return clean;
}

// ---- Audit ----

export type AuditEntry = { action: string; target?: string | null; outcome: 'ok' | 'refused' | 'failed'; detail?: Record<string, unknown> };

// Never fails the action it records; also logged, so it's in Render's logs even if the database write fails
export async function audit(userId: number, entry: AuditEntry): Promise<void> {
  console.log(`AI Lab: ${entry.action}${entry.target ? ` ${entry.target}` : ''} by user ${userId}: ${entry.outcome}`);
  try {
    await ensureAiLabSchema();
    await query(
      `INSERT INTO racingcoach."AiLabAuditLog" (user_id, action, target, outcome, detail) VALUES ($1, $2, $3, $4, $5)`,
      [userId, entry.action, entry.target?.slice(0, 200) ?? null, entry.outcome, entry.detail ? JSON.stringify(entry.detail) : null]
    );
  } catch (error) {
    console.error('Failed to write the AI Lab audit log:', error);
  }
}

export async function readAudit(limit = 50) {
  await ensureAiLabSchema();
  const rows = await query<{ id: string; at: Date; user_id: number | null; name: string | null; action: string; target: string | null; outcome: string; detail: unknown }>(
    `SELECT a.id, a.at, a.user_id, u.user_name AS name, a.action, a.target, a.outcome, a.detail
     FROM racingcoach."AiLabAuditLog" a LEFT JOIN racingcoach."Users" u ON u.id = a.user_id
     ORDER BY a.at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  );
  return rows.map((r) => ({ id: Number(r.id), at: r.at.toISOString(), user: r.name ?? (r.user_id ? `#${r.user_id}` : null), action: r.action, target: r.target, outcome: r.outcome, detail: r.detail }));
}

export async function purgeOldAudit(): Promise<void> {
  await ensureAiLabSchema();
  await query(`DELETE FROM racingcoach."AiLabAuditLog" WHERE at < now() - make_interval(days => $1)`, [AUDIT_RETENTION_DAYS]);
}

// ---- Spend ----

// What the playground's cloud models cost today (UTC), from their inference events' list-price costs
export async function labCloudSpendTodayUsd(): Promise<number> {
  await ensureLocalAiSchema();
  const rows = await query<{ total: string | null }>(
    `SELECT sum(cost_usd)::text AS total FROM racingcoach."AiInferenceEvents"
     WHERE source = 'aiLab' AND provider <> 'Local' AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
  );
  return Number(rows[0]?.total ?? 0);
}

// ---- Saved prompts ----

export type SavedPrompt = { id: number; name: string; system: string; prompt: string; params: LabParams; models: string[]; updatedAt: string };

export async function listPrompts(): Promise<SavedPrompt[]> {
  await ensureAiLabSchema();
  const rows = await query<{ id: string; name: string; system_prompt: string; user_prompt: string; params: LabParams; models: string[]; updated_at: Date }>(
    `SELECT id, name, system_prompt, user_prompt, params, models, updated_at FROM racingcoach."AiLabPrompts" ORDER BY updated_at DESC LIMIT $1`,
    [MAX_SAVED_PROMPTS]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, system: r.system_prompt, prompt: r.user_prompt, params: r.params, models: r.models, updatedAt: r.updated_at.toISOString() }));
}

export async function savePrompt(p: Omit<SavedPrompt, 'id' | 'updatedAt'> & { id?: number | null }): Promise<number> {
  await ensureAiLabSchema();
  if (p.id) {
    await query(
      `UPDATE racingcoach."AiLabPrompts" SET name = $2, system_prompt = $3, user_prompt = $4, params = $5, models = $6, updated_at = now() WHERE id = $1`,
      [p.id, p.name, p.system, p.prompt, JSON.stringify(p.params), JSON.stringify(p.models)]
    );
    return p.id;
  }
  const count = await query<{ n: string }>('SELECT count(*)::text AS n FROM racingcoach."AiLabPrompts"');
  if (Number(count[0].n) >= MAX_SAVED_PROMPTS) throw new Error('Too many saved prompts');
  const rows = await query<{ id: string }>(
    `INSERT INTO racingcoach."AiLabPrompts" (name, system_prompt, user_prompt, params, models) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [p.name, p.system, p.prompt, JSON.stringify(p.params), JSON.stringify(p.models)]
  );
  return Number(rows[0].id);
}

export async function deletePrompt(id: number): Promise<void> {
  await ensureAiLabSchema();
  await query('DELETE FROM racingcoach."AiLabPrompts" WHERE id = $1', [id]);
}

// ---- Benchmarks ----

export type BenchmarkResult = { model: string; provider: string; text: string; error: string | null; metrics: Record<string, unknown> | null };
export type SavedBenchmark = { id: number; name: string; system: string; prompt: string; results: BenchmarkResult[]; createdAt: string };

export async function listBenchmarks(limit = 50): Promise<SavedBenchmark[]> {
  await ensureAiLabSchema();
  const rows = await query<{ id: string; name: string; system_prompt: string; user_prompt: string; results: BenchmarkResult[]; created_at: Date }>(
    `SELECT id, name, system_prompt, user_prompt, results, created_at FROM racingcoach."AiLabBenchmarks" ORDER BY created_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, system: r.system_prompt, prompt: r.user_prompt, results: r.results, createdAt: r.created_at.toISOString() }));
}

export async function saveBenchmark(b: Omit<SavedBenchmark, 'id' | 'createdAt'>): Promise<number> {
  await ensureAiLabSchema();
  const count = await query<{ n: string }>('SELECT count(*)::text AS n FROM racingcoach."AiLabBenchmarks"');
  if (Number(count[0].n) >= MAX_SAVED_BENCHMARKS) throw new Error('Too many saved benchmarks');
  const rows = await query<{ id: string }>(
    `INSERT INTO racingcoach."AiLabBenchmarks" (name, system_prompt, user_prompt, results) VALUES ($1, $2, $3, $4) RETURNING id`,
    [b.name, b.system, b.prompt, JSON.stringify(b.results)]
  );
  return Number(rows[0].id);
}

export async function deleteBenchmark(id: number): Promise<void> {
  await ensureAiLabSchema();
  await query('DELETE FROM racingcoach."AiLabBenchmarks" WHERE id = $1', [id]);
}
