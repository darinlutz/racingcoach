import { Pool } from 'pg';
import { z } from 'zod';

const insertSchema = z.object({
  track_key: z.string().trim().min(1).max(200),
  track_name: z.string().trim().min(1).max(300),
  config_name: z.string().trim().max(200).nullable().optional(),
  number_of_corners: z.number().int().min(0).max(200).nullable().optional(),
  track_category: z.enum(['Road Course', 'Oval', 'Dirt']).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
}).strict();

const globalForMcp = globalThis as typeof globalThis & { mcpDbPool?: Pool };
function pool(): Pool {
  if (!globalForMcp.mcpDbPool) {
    const connectionString = process.env.MCP_DATABASE_URL;
    if (!connectionString) throw new Error('MCP_DATABASE_URL not configured');
    globalForMcp.mcpDbPool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  }
  return globalForMcp.mcpDbPool;
}
export const definitions = [
  { name: 'list_tracks', description: 'List tracks (maximum 100)', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'get_track', description: 'Find one track by exact track_key', inputSchema: { type: 'object', properties: { track_key: { type: 'string' } }, required: ['track_key'], additionalProperties: false } },
  { name: 'insert_track', description: 'Insert one new track; does not modify existing tracks', inputSchema: { type: 'object', properties: {
    track_key: { type: 'string' }, track_name: { type: 'string' }, config_name: { type: ['string', 'null'] },
    number_of_corners: { type: ['integer', 'null'] }, track_category: { type: ['string', 'null'], enum: ['Road Course', 'Oval', 'Dirt', null] },
    notes: { type: ['string', 'null'] },
  }, required: ['track_key', 'track_name'], additionalProperties: false } },
];
export async function runTool(name: string, args: unknown, subject: string): Promise<unknown> {
  const db = pool();
  if (name === 'list_tracks') {
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict().parse(args ?? {});
    const result = await db.query('SELECT id, track_key, track_name, config_name, number_of_corners, track_category FROM racingcoach."Tracks" ORDER BY id LIMIT $1', [parsed.limit]);
    return result.rows;
  }
  if (name === 'get_track') {
    const parsed = z.object({ track_key: z.string().min(1) }).strict().parse(args);
    const result = await db.query('SELECT * FROM racingcoach."Tracks" WHERE track_key = $1 LIMIT 1', [parsed.track_key]);
    return result.rows[0] ?? null;
  }
  if (name === 'insert_track') {
    const data = insertSchema.parse(args);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Serializes competing MCP inserts of the same key, even if the legacy table has no unique constraint.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [data.track_key.toLowerCase()]);
      const existing = await client.query('SELECT id FROM racingcoach."Tracks" WHERE lower(track_key) = lower($1) LIMIT 1', [data.track_key]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return { error: 'Track key already exists', existing_id: existing.rows[0].id };
      }
      const result = await client.query(
        'INSERT INTO racingcoach."Tracks" (track_key, track_name, notes, config_name, number_of_corners, track_category, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING id, track_key, track_name, config_name, number_of_corners, track_category',
        [data.track_key, data.track_name, data.notes ?? null, data.config_name ?? null, data.number_of_corners ?? null, data.track_category ?? null]
      );
      // A dedicated append-only audit table must be provisioned before enabling writes.
      await client.query('INSERT INTO racingcoach."McpAuditLog" (actor_subject, action, track_id, details) VALUES ($1,$2,$3,$4::jsonb)', [subject, 'insert_track', result.rows[0].id, JSON.stringify(data)]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  throw new Error('Unknown tool');
}
