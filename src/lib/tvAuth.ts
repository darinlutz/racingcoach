import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { isUniqueViolation, query } from './db';
import { pairingCodeFrom } from './tvPairingCode';
import { ensureUserSchema, getUserById, type User } from './users';

// TV Broadcast Mode's sign-in (src/app/tv/). A TV never sees a password or the account's own session: it asks for a
// pairing code (startPairing), shows it, and the user types it on the TV Link page (src/app/tv/link/) of a browser
// they're signed in to (approvePairing). The TV's next check (claimPairing) then gets a TV session of its own, in the
// HttpOnly tv_session cookie. Only the /api/tv routes accept it (getTvSession; getCurrentUser never reads it), so a
// TV can watch the user's Live Racing drivers and ask for Race Announcer commentary, and nothing else. It expires
// after TV_SESSION_DAYS and the user can revoke it on the TV Link page; the TV can unpair itself too.
//
// Only hashes are stored: of the pairing code, of the TV's pairing secret (the tv_pairing cookie, so only the TV that
// asked for a code can claim it once approved) and of the TV session's token.

export const TV_SESSION_COOKIE = 'tv_session';
export const TV_PAIRING_COOKIE = 'tv_pairing';

const PAIRING_TTL_MS = 10 * 60_000;
export const TV_SESSION_DAYS = 30;
// The most TVs one account has paired at once; pairing another ends the oldest
const MAX_TV_SESSIONS = 10;
// How often a TV session's last_seen_at is written
const SEEN_INTERVAL_MS = 60_000;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  expires,
});

// What the TV is, from its browser, for the user's list of paired TVs (Fire TV models are "AFT…" in the user agent)
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  if (/\bAFT\w*|Fire ?TV/i.test(ua)) return 'Fire TV (Silk)';
  if (/Silk/i.test(ua)) return 'Amazon Silk';
  if (/Android TV|GoogleTV|BRAVIA|AndroidTV/i.test(ua)) return 'Android TV';
  if (/Tizen|Web0S|WebOS|SmartTV|SMART-TV|HbbTV|Roku/i.test(ua)) return 'Smart TV browser';
  if (/iPhone|iPad|Android/i.test(ua)) return 'Mobile browser';
  return 'Web browser';
}

export type PairingStatus =
  | { status: 'pending'; code: string | null; expiresAt: number }
  | { status: 'paired' }
  | { status: 'expired' }
  | { status: 'none' };

// A new pairing code for this TV, valid for PAIRING_TTL_MS; the TV keeps the secret that claims it
export async function startPairing(userAgent: string | null): Promise<{ code: string; expiresAt: number }> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."TvPairings" WHERE expires_at < now() - interval \'1 hour\'');
  const secret = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; ; attempt++) {
    const bytes = randomBytes(32);
    let i = 0;
    const code = pairingCodeFrom(() => (i < bytes.length ? bytes[i++] : randomBytes(1)[0]));
    try {
      await query(
        `INSERT INTO racingcoach."TvPairings" (code_hash, device_hash, label, expires_at) VALUES ($1, $2, $3, $4)`,
        [hash(code), hash(secret), deviceLabel(userAgent), expiresAt]
      );
      (await cookies()).set(TV_PAIRING_COOKIE, secret, cookieOptions(expiresAt));
      return { code, expiresAt: expiresAt.getTime() };
    } catch (error) {
      // Another TV has the same code right now: draw again
      if (!isUniqueViolation(error) || attempt >= 4) throw error;
    }
  }
}

// The signed-in user typed this code: the TV that shows it may now claim a TV session for them. False when no TV is
// waiting with it (wrong, expired or already used).
export async function approvePairing(userId: number, code: string): Promise<{ label: string } | null> {
  await ensureUserSchema();
  const [row] = await query<{ label: string }>(
    `UPDATE racingcoach."TvPairings" SET user_id = $1, approved_at = now()
     WHERE code_hash = $2 AND expires_at > now() AND approved_at IS NULL
     RETURNING label`,
    [userId, hash(code)]
  );
  return row ?? null;
}

// The TV asks whether its code was entered. Once it was, the pairing is used up and the TV gets its TV session.
export async function claimPairing(): Promise<PairingStatus> {
  const cookieStore = await cookies();
  const secret = cookieStore.get(TV_PAIRING_COOKIE)?.value;
  if (!secret) return { status: 'none' };
  await ensureUserSchema();
  const [row] = await query<{ id: number; user_id: number | null; label: string; expires_at: Date }>(
    'SELECT id, user_id, label, expires_at FROM racingcoach."TvPairings" WHERE device_hash = $1',
    [hash(secret)]
  );
  if (!row) {
    cookieStore.delete(TV_PAIRING_COOKIE);
    return { status: 'expired' };
  }
  if (row.user_id == null) {
    if (new Date(row.expires_at).getTime() < Date.now()) return { status: 'expired' };
    // The code itself isn't kept, so a reloaded TV page asks for a new one
    return { status: 'pending', code: null, expiresAt: new Date(row.expires_at).getTime() };
  }
  // Claimed once: deleting the row is what makes a second claim impossible
  const claimed = await query('DELETE FROM racingcoach."TvPairings" WHERE id = $1 RETURNING id', [row.id]);
  cookieStore.delete(TV_PAIRING_COOKIE);
  if (claimed.length === 0) return { status: 'expired' };
  await createTvSession(row.user_id, row.label);
  return { status: 'paired' };
}

async function createTvSession(userId: number, label: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TV_SESSION_DAYS * 86_400_000);
  await query(
    'INSERT INTO racingcoach."TvSessions" (token_hash, user_id, label, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, now())',
    [hash(token), userId, label, expiresAt]
  );
  // Ends the oldest beyond MAX_TV_SESSIONS, and forgets ones long ended
  await query(
    `UPDATE racingcoach."TvSessions" SET revoked_at = now()
     WHERE id IN (SELECT id FROM racingcoach."TvSessions" WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
                  ORDER BY created_at DESC OFFSET $2)`,
    [userId, MAX_TV_SESSIONS]
  );
  await query(
    `DELETE FROM racingcoach."TvSessions" WHERE user_id = $1 AND (expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days')`,
    [userId]
  );
  (await cookies()).set(TV_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export type TvSession = { id: number; user: User };

const lastSeenWritten = new Map<number, number>();

// The TV session of this request's tv_session cookie, and its account; null when there is none, or it expired or was
// revoked
export async function getTvSession(): Promise<TvSession | null> {
  const token = (await cookies()).get(TV_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    await ensureUserSchema();
    const [row] = await query<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM racingcoach."TvSessions"
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash(token)]
    );
    if (!row) return null;
    const user = await getUserById(row.user_id);
    if (!user) return null;
    if (Date.now() - (lastSeenWritten.get(row.id) ?? 0) > SEEN_INTERVAL_MS) {
      lastSeenWritten.set(row.id, Date.now());
      await query('UPDATE racingcoach."TvSessions" SET last_seen_at = now() WHERE id = $1', [row.id]);
    }
    return { id: row.id, user };
  } catch (error) {
    console.error('TV session lookup error:', error);
    return null;
  }
}

// Whether a TV session is still good, for the live stream, which checks it while it stays open
export async function isTvSessionActive(id: number): Promise<boolean> {
  const rows = await query(
    'SELECT 1 FROM racingcoach."TvSessions" WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [id]
  );
  return rows.length > 0;
}

export type PairedTv = { id: number; label: string; createdAt: string; lastSeenAt: string | null; expiresAt: string };

// The user's paired TVs, newest first
export async function listTvSessions(userId: number): Promise<PairedTv[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; label: string; created_at: Date; last_seen_at: Date | null; expires_at: Date }>(
    `SELECT id, label, created_at, last_seen_at, expires_at FROM racingcoach."TvSessions"
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    expiresAt: new Date(r.expires_at).toISOString(),
  }));
}

// Ends one of the user's TV sessions; the TV is unpaired at its next request (the live stream within seconds)
export async function revokeTvSession(userId: number, id: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query(
    'UPDATE racingcoach."TvSessions" SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

// The TV unpairs itself
export async function endTvSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TV_SESSION_COOKIE)?.value;
  if (token) {
    await ensureUserSchema();
    await query('UPDATE racingcoach."TvSessions" SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hash(token)]);
  }
  cookieStore.delete(TV_SESSION_COOKIE);
}

// Counts attempts per key (an IP address, an account) in this server's memory: true once more than max were made in
// the last windowMs. Guards asking for pairing codes and typing them in.
const attempts = new Map<string, number[]>();
export function overAttemptLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 10_000) {
    for (const [k, times] of attempts) if (times.every((at) => now - at >= windowMs)) attempts.delete(k);
  }
  return recent.length > max;
}
