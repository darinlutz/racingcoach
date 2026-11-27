// The lighting tables (docs/lighting/README.md), run by ensureUserSchema so the privacy export, erasure and Delete
// Account always find them. Additive only. Each references "Users"(id) ON DELETE CASCADE, so Delete Account removes
// an account's lighting agents and their tokens (only hashes of tokens and codes are kept, devices.ts) and its
// installation's configuration (lightingConfig.ts: controllers, zones, scenes and rules, replaced whole on each save).

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
  // The installation's configuration, the authoritative copy (the Mac agent caches it): version goes up on every
  // save, so agents know to fetch it and a save from an older copy is refused
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingInstallations" (
    user_id INTEGER PRIMARY KEY REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    settings JSONB NOT NULL,
    start_scene TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // A controller's address is on the owner's home network: read only by the owner's Admin page and their own agents
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingControllers" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 80,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingZones" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    controller_id INTEGER NOT NULL REFERENCES racingcoach."LightingControllers"(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    max_brightness INTEGER NOT NULL DEFAULT 200,
    automatic BOOLEAN NOT NULL DEFAULT true,
    protected BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingScenes" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    all_look JSONB,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingSceneZones" (
    scene_id INTEGER NOT NULL REFERENCES racingcoach."LightingScenes"(id) ON DELETE CASCADE,
    zone_id INTEGER NOT NULL REFERENCES racingcoach."LightingZones"(id) ON DELETE CASCADE,
    look JSONB NOT NULL,
    PRIMARY KEY (scene_id, zone_id)
  )`,
  // zone_keys NULL: every enabled zone that takes part in racing events
  `CREATE TABLE IF NOT EXISTS racingcoach."LightingEventRules" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    event TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL,
    zone_keys TEXT[],
    look JSONB NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, key)
  )`,
];
