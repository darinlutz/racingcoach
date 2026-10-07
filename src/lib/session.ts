import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { query } from './db';
import { ensureUserSchema, getUserById, type User } from './users';

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Only a hash of the token is stored, so a leaked database can't be used to
// hijack live sessions.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: number): Promise<void> {
  await ensureUserSchema();
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await query('INSERT INTO racingcoach."Sessions" (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    await ensureUserSchema();
    const [row] = await query('SELECT user_id, expires_at FROM racingcoach."Sessions" WHERE token_hash = $1', [hashToken(token)]);
    // BIGINT columns come back from pg as strings
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return await getUserById(Number(row.user_id));
  } catch (error) {
    console.error('Session lookup error:', error);
    return null;
  }
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await ensureUserSchema();
    await query('DELETE FROM racingcoach."Sessions" WHERE token_hash = $1', [hashToken(token)]);
  }
  cookieStore.delete(SESSION_COOKIE);
}
