import { createHash, randomBytes } from 'node:crypto';
import { query } from './db';
import { ensureUserSchema } from './users';

// Upload keys for the telemetry collector (collector/ in this repo). The collector runs on the driver's
// PC and can't use the browser's sign-in cookie, so the user creates a key on the Account page and
// pastes it into the collector once; the collector sends it as `Authorization: Bearer <key>`.
// Each user has at most one key (creating a new one replaces it). Only a hash is stored, so the key
// itself is shown once, when it's created.

const KEY_PREFIX = 'rck_';
// rck_ + 32 random bytes in base64url (43 characters)
const KEY_PATTERN = /^Bearer (rck_[A-Za-z0-9_-]{43})$/;

export type CollectorKeyInfo = {
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function getCollectorKey(userId: number): Promise<CollectorKeyInfo | null> {
  await ensureUserSchema();
  const [row] = await query<{ key_prefix: string; created_at: Date; last_used_at: Date | null }>(
    'SELECT key_prefix, created_at, last_used_at FROM racingcoach."CollectorKeys" WHERE user_id = $1',
    [userId]
  );
  if (!row) return null;
  return {
    keyPrefix: row.key_prefix,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

// Creates the user's key, replacing any earlier one (which stops working). Returns the key itself.
export async function createCollectorKey(userId: number): Promise<{ key: string; info: CollectorKeyInfo }> {
  await ensureUserSchema();
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  const keyPrefix = key.slice(0, KEY_PREFIX.length + 4);
  const [row] = await query<{ created_at: Date }>(
    `INSERT INTO racingcoach."CollectorKeys" (user_id, key_hash, key_prefix) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET key_hash = EXCLUDED.key_hash, key_prefix = EXCLUDED.key_prefix, created_at = now(), last_used_at = NULL
     RETURNING created_at`,
    [userId, hashKey(key), keyPrefix]
  );
  return { key, info: { keyPrefix, createdAt: row.created_at.toISOString(), lastUsedAt: null } };
}

export async function deleteCollectorKey(userId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."CollectorKeys" WHERE user_id = $1', [userId]);
}

// The user ID the request's upload key belongs to, or null if it has none or the key isn't known
export async function authenticateCollector(request: Request): Promise<number | null> {
  const match = KEY_PATTERN.exec(request.headers.get('authorization') ?? '');
  if (!match) return null;
  await ensureUserSchema();
  const [row] = await query<{ user_id: number }>(
    'UPDATE racingcoach."CollectorKeys" SET last_used_at = now() WHERE key_hash = $1 RETURNING user_id',
    [hashKey(match[1])]
  );
  return row ? row.user_id : null;
}
