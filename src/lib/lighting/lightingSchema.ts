// The lighting tables (docs/lighting/README.md), run by ensureUserSchema so the privacy export, erasure and Delete
// Account always find them. Additive only. Each references "Users"(id) ON DELETE CASCADE, so Delete Account removes
// an account's lighting agents and their tokens, and only hashes of tokens and codes are kept (devices.ts).

export const LIGHTING_SCHEMA = [
  // A paired lighting agent: its name, its device token's hash and its current access token's hash
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingDevices" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    access_token_hash TEXT UNIQUE,
    access_expires_at TIMESTAMPTZ,
    agent_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS lighting_devices_user_idx ON racingcoach."LightingDevices" (user_id)`,
  // A pairing code an agent asked for: no account until the owner approves it, deleted an hour after it expires
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingDeviceRegistrations" (
    id SERIAL PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    approved_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    approved_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ
  )`,
];
