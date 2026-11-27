import { createHash, randomBytes } from 'node:crypto';
import { isUniqueViolation, query } from '../db';
import { isAdmin } from '../roles';
import { formatPairingCode, normalizePairingCode, pairingCodeFrom } from '../tvPairingCode';
import { ensureUserSchema, getUserById } from '../users';

// The RacingCoach Lighting Agent's sign-in (docs/lighting/README.md). Like a TV's (src/lib/tvAuth.ts), the agent
// never sees a password: it asks for a pairing code (startDevicePairing), the owner types it on the Admin page's
// Lighting Control (approveDevicePairing), and the agent's next check (claimDevicePairing) gets a device token, which
// it keeps in the Mac's Keychain. It trades that for a short-lived access token (issueAccessToken) to call the
// lighting routes with, and a new one before it expires. The account is always the one that approved the device,
// read from the token: never from anything the agent sends. Revoking a device (the Admin page, or the agent itself)
// ends both tokens at once.
//
// Only hashes are stored: of the pairing code, the agent's pairing secret, the device token and the access token, so
// the database holds nothing that signs in. The tables are in lightingSchema.ts, made by ensureUserSchema.
//
// Lighting Control is for Admins only while it's being built (canUseLighting); LIGHTING_CONTROL=off turns it off.

export const PAIRING_TTL_MS = 10 * 60_000;
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
// How often a device's last_seen_at is written
const SEEN_INTERVAL_MS = 60_000;
// Devices one account may have at once
const MAX_DEVICES = 10;

export const lightingEnabled = () => process.env.LIGHTING_CONTROL !== 'off';
export const canUseLighting = (user: { role: string } | null | undefined) => !!user && lightingEnabled() && isAdmin(user.role);

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

// The tables are made by ensureUserSchema (lightingSchema.ts)
export const ensureLightingSchema = () => ensureUserSchema();

export function cleanDeviceName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return (text || 'Lighting agent').slice(0, 80);
}

// A new pairing code for an agent, valid for PAIRING_TTL_MS; the agent keeps the secret that claims it
export async function startDevicePairing(name: unknown): Promise<{ code: string; pairingSecret: string; expiresAt: number }> {
  await ensureLightingSchema();
  await query(`DELETE FROM racingcoach."LightingDeviceRegistrations" WHERE expires_at < now() - interval '1 hour'`);
  const pairingSecret = token('rclp');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; ; attempt++) {
    const code = pairingCodeFrom(() => randomBytes(1)[0]);
    try {
      await query(
        `INSERT INTO racingcoach."LightingDeviceRegistrations" (code_hash, secret_hash, device_name, expires_at) VALUES ($1, $2, $3, $4)`,
        [hash(code), hash(pairingSecret), cleanDeviceName(name), expiresAt]
      );
      return { code: formatPairingCode(code), pairingSecret, expiresAt: expiresAt.getTime() };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error;
    }
  }
}

// The owner typed the code on the Admin page: the pairing is theirs once claimed. Null when no live code matches
export async function approveDevicePairing(typed: string, userId: number): Promise<{ deviceName: string } | null> {
  const code = normalizePairingCode(typed);
  if (!code) return null;
  await ensureLightingSchema();
  const rows = await query<{ device_name: string }>(
    `UPDATE racingcoach."LightingDeviceRegistrations" SET approved_by = $2, approved_at = now()
     WHERE code_hash = $1 AND expires_at > now() AND approved_by IS NULL AND claimed_at IS NULL
     RETURNING device_name`,
    [hash(code), userId]
  );
  return rows[0] ? { deviceName: rows[0].device_name } : null;
}

export type ClaimResult =
  | { status: 'pending'; expiresAt: number }
  | { status: 'expired' }
  | { status: 'paired'; deviceId: number; deviceToken: string };

// The agent's check: once approved, its device (the token is shown this once, then only its hash is kept)
export async function claimDevicePairing(pairingSecret: string): Promise<ClaimResult> {
  await ensureLightingSchema();
  const rows = await query<{ id: number; device_name: string; expires_at: Date; approved_by: number | null }>(
    `SELECT id, device_name, expires_at, approved_by FROM racingcoach."LightingDeviceRegistrations"
     WHERE secret_hash = $1 AND claimed_at IS NULL`,
    [hash(pairingSecret)]
  );
  const pairing = rows[0];
  if (!pairing || pairing.expires_at.getTime() < Date.now()) return { status: 'expired' };
  if (pairing.approved_by === null) return { status: 'pending', expiresAt: pairing.expires_at.getTime() };
  // Claimed once: a second claim with the same secret finds nothing
  const claimed = await query(
    `UPDATE racingcoach."LightingDeviceRegistrations" SET claimed_at = now() WHERE id = $1 AND claimed_at IS NULL RETURNING id`,
    [pairing.id]
  );
  if (!claimed.length) return { status: 'expired' };
  const deviceToken = token('rcld');
  const device = await query<{ id: number }>(
    `INSERT INTO racingcoach."LightingDevices" (user_id, name, refresh_token_hash) VALUES ($1, $2, $3) RETURNING id`,
    [pairing.approved_by, pairing.device_name, hash(deviceToken)]
  );
  // The oldest devices past MAX_DEVICES are revoked
  await query(
    `UPDATE racingcoach."LightingDevices" SET revoked_at = now(), access_token_hash = NULL
     WHERE user_id = $1 AND revoked_at IS NULL AND id NOT IN (
       SELECT id FROM racingcoach."LightingDevices" WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT $2)`,
    [pairing.approved_by, MAX_DEVICES]
  );
  return { status: 'paired', deviceId: device[0].id, deviceToken };
}

// A new access token for a device that isn't revoked and whose account may still use Lighting Control
export async function issueAccessToken(deviceToken: string): Promise<{ accessToken: string; expiresAt: number } | null> {
  await ensureLightingSchema();
  const rows = await query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM racingcoach."LightingDevices" WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [hash(deviceToken)]
  );
  const device = rows[0];
  if (!device || !canUseLighting(await getUserById(device.user_id))) return null;
  const accessToken = token('rcla');
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  await query(
    `UPDATE racingcoach."LightingDevices" SET access_token_hash = $2, access_expires_at = $3, last_seen_at = now() WHERE id = $1`,
    [device.id, hash(accessToken), expiresAt]
  );
  return { accessToken, expiresAt: expiresAt.getTime() };
}

export type LightingDevice = { deviceId: number; userId: number };

// Who's calling: the device and its account, from the access token in Authorization: Bearer; null otherwise
const seenAt = new Map<number, number>();
export async function authenticateLightingDevice(request: Request): Promise<LightingDevice | null> {
  if (!lightingEnabled()) return null;
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (rcla_[A-Za-z0-9_-]{20,100})$/);
  if (!match) return null;
  await ensureLightingSchema();
  const rows = await query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM racingcoach."LightingDevices"
     WHERE access_token_hash = $1 AND access_expires_at > now() AND revoked_at IS NULL`,
    [hash(match[1])]
  );
  const device = rows[0];
  if (!device || !canUseLighting(await getUserById(device.user_id))) return null;
  const now = Date.now();
  if (now - (seenAt.get(device.id) ?? 0) > SEEN_INTERVAL_MS) {
    seenAt.set(device.id, now);
    await query(`UPDATE racingcoach."LightingDevices" SET last_seen_at = now() WHERE id = $1`, [device.id]).catch(() => undefined);
  }
  return { deviceId: device.id, userId: device.user_id };
}

export async function setDeviceVersion(deviceId: number, version: string | null): Promise<void> {
  await query(`UPDATE racingcoach."LightingDevices" SET agent_version = $2 WHERE id = $1`, [deviceId, version?.slice(0, 40) ?? null]);
}

export type LightingDeviceRow = {
  id: number;
  name: string;
  agentVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export async function listLightingDevices(userId: number): Promise<LightingDeviceRow[]> {
  await ensureLightingSchema();
  const rows = await query<{ id: number; name: string; agent_version: string | null; created_at: Date; last_seen_at: Date | null }>(
    `SELECT id, name, agent_version, created_at, last_seen_at FROM racingcoach."LightingDevices"
     WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    agentVersion: r.agent_version,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
  }));
}

// Ends a device's tokens at once; only the account's own devices
export async function revokeLightingDevice(deviceId: number, userId: number): Promise<boolean> {
  await ensureLightingSchema();
  const rows = await query(
    `UPDATE racingcoach."LightingDevices" SET revoked_at = now(), access_token_hash = NULL
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [deviceId, userId]
  );
  return rows.length > 0;
}
