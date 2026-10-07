import { createHash, randomBytes } from 'node:crypto';
import { query, transaction } from './db';
import { ensureUserSchema, getUserById, updatePassword, type User } from './users';

const RESET_TTL_MS = 60 * 60 * 1000;

// Only a hash of the token is stored, so a leaked database can't be used to
// reset anyone's password.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Returns the raw token to put in the emailed link. Any earlier unused link
// for this user stops working.
export async function createPasswordResetToken(userId: number): Promise<string> {
  await ensureUserSchema();
  const token = randomBytes(32).toString('hex');
  await transaction(async (client) => {
    await client.query('DELETE FROM racingcoach."PasswordResets" WHERE user_id = $1', [userId]);
    await client.query('INSERT INTO racingcoach."PasswordResets" (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      userId,
      Date.now() + RESET_TTL_MS,
    ]);
  });
  return token;
}

export async function getPasswordResetUser(token: string): Promise<User | null> {
  await ensureUserSchema();
  const [row] = await query('SELECT user_id, expires_at FROM racingcoach."PasswordResets" WHERE token_hash = $1', [
    hashToken(token),
  ]);
  // BIGINT columns come back from pg as strings
  if (!row || Number(row.expires_at) < Date.now()) return null;
  return getUserById(Number(row.user_id));
}

// Returns false when the link is invalid, expired, or already used.
export async function resetPasswordWithToken(token: string, password: string): Promise<boolean> {
  const user = await getPasswordResetUser(token);
  if (!user) return false;
  await updatePassword(user.id, password);
  await query('DELETE FROM racingcoach."PasswordResets" WHERE user_id = $1', [user.id]);
  return true;
}
