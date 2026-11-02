// Step-up sign-in for Privacy & Data Rights: before an export is made or anything is deleted, the signed-in user proves
// again it's them, so a session left open on a shared computer (or a stolen cookie) can't take or destroy their data.
// Accounts with a password re-enter it; accounts made through Google sign-in get a 6-digit code by email. Either marks
// this sign-in session as re-authenticated for REAUTH_WINDOW_MS ("Sessions".reauthenticated_at).
import { createHash, randomInt } from 'node:crypto';
import { cookies } from 'next/headers';
import { overAttemptLimit } from './tvAuth';
import { query } from './db';
import { REAUTH_WINDOW_MS } from './privacyRules';
import { ensureUserSchema, verifyUserPassword, type User } from './users';

const SESSION_COOKIE = 'session';
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function sessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hash(token) : null;
}

async function markSession(): Promise<void> {
  const tokenHash = await sessionHash();
  if (tokenHash) {
    await query('UPDATE racingcoach."Sessions" SET reauthenticated_at = $1 WHERE token_hash = $2', [Date.now(), tokenHash]);
  }
}

// Whether this sign-in session re-authenticated within the window
export async function isRecentlyReauthenticated(user: User): Promise<boolean> {
  await ensureUserSchema();
  const tokenHash = await sessionHash();
  if (!tokenHash) return false;
  const [row] = await query('SELECT reauthenticated_at FROM racingcoach."Sessions" WHERE token_hash = $1 AND user_id = $2', [
    tokenHash,
    user.id,
  ]);
  const at = row?.reauthenticated_at === null || row?.reauthenticated_at === undefined ? null : Number(row.reauthenticated_at);
  return at !== null && Date.now() - at < REAUTH_WINDOW_MS;
}

export type ReauthResult = 'ok' | 'wrong' | 'tooMany' | 'expired';

// Re-entering the account's password: 5 tries in 15 minutes per account
export async function reauthenticateWithPassword(user: User, password: string): Promise<ReauthResult> {
  if (overAttemptLimit(`privacy-reauth:${user.id}`, MAX_CODE_ATTEMPTS, CODE_TTL_MS)) return 'tooMany';
  if (!user.hasPassword || !(await verifyUserPassword(user.id, password))) return 'wrong';
  await markSession();
  return 'ok';
}

// A new code for an account without a password (any earlier one stops working); answers it for the email. At most 3
// codes in 15 minutes per account.
export async function createReauthCode(user: User): Promise<string | null> {
  await ensureUserSchema();
  if (overAttemptLimit(`privacy-reauth-code:${user.id}`, 3, CODE_TTL_MS)) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await query(
    `INSERT INTO racingcoach."PrivacyReauthCodes" (user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [user.id, hash(`${user.id}:${code}`), new Date(Date.now() + CODE_TTL_MS)]
  );
  return code;
}

export async function reauthenticateWithCode(user: User, code: string): Promise<ReauthResult> {
  await ensureUserSchema();
  const [row] = await query(
    `UPDATE racingcoach."PrivacyReauthCodes" SET attempts = attempts + 1 WHERE user_id = $1
     RETURNING code_hash, expires_at, attempts`,
    [user.id]
  );
  if (!row) return 'expired';
  if (new Date(row.expires_at as string).getTime() < Date.now()) return 'expired';
  if (Number(row.attempts) > MAX_CODE_ATTEMPTS) return 'tooMany';
  if (!/^\d{6}$/.test(code) || row.code_hash !== hash(`${user.id}:${code}`)) return 'wrong';
  await query('DELETE FROM racingcoach."PrivacyReauthCodes" WHERE user_id = $1', [user.id]);
  await markSession();
  return 'ok';
}
