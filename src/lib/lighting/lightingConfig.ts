import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import { ensureUserSchema } from '../users';
import type { LightingConfig, Rgbw, Rule, RuleEvent, Scene, ZoneLook } from './model.ts';

// The lighting installation's configuration in Postgres, the authoritative copy (docs/lighting/README.md, Phase 10):
// lightingSchema.ts's LightingInstallations, LightingControllers, LightingZones, LightingScenes, LightingSceneZones and
// LightingEventRules, all the owner's. Read and written whole, in model.ts's LightingConfig shape, so the Admin page,
// the agent and the tests share one format and one validation (parseLightingConfig).
//
// A save carries the version it was made from: it's refused (LightingConfigConflict) when someone else saved since, and
// raises the version, which the agents' heartbeats see so they fetch it. Controller addresses (private, the home
// network's) are only ever answered to the owner's Admin page and the owner's own paired agents.

export class LightingConfigConflict extends Error {
  constructor(readonly currentVersion: number) {
    super('The lighting configuration changed since it was read');
  }
}

export async function lightingConfigVersion(userId: number): Promise<number> {
  await ensureUserSchema();
  const rows = await query<{ version: number }>('SELECT version FROM racingcoach."LightingInstallations" WHERE user_id = $1', [userId]);
  return rows[0]?.version ?? 0;
}

type ControllerRow = { id: number; key: string; name: string; host: string; port: number };
type ZoneRow = {
  id: number;
  key: string;
  name: string;
  controller_id: number;
  segment_id: number;
  enabled: boolean;
  max_brightness: number;
  automatic: boolean;
  protected: boolean;
};
type SceneRow = { id: number; key: string; name: string; all_look: Partial<ZoneLook> | null };
type RuleRow = {
  key: string;
  name: string;
  event: string;
  enabled: boolean;
  priority: number;
  zone_keys: string[] | null;
  look: Partial<ZoneLook>;
  duration_seconds: number;
};

// The owner's configuration, or null when they have none yet (the agent then uploads its own once)
export async function readLightingConfig(userId: number): Promise<LightingConfig | null> {
  await ensureUserSchema();
  const installation = await query<{ version: number; settings: LightingConfig['settings']; start_scene: string }>(
    'SELECT version, settings, start_scene FROM racingcoach."LightingInstallations" WHERE user_id = $1',
    [userId]
  );
  if (!installation[0]) return null;
  const [controllers, zones, scenes, sceneZones, rules] = await Promise.all([
    query<ControllerRow>('SELECT id, key, name, host, port FROM racingcoach."LightingControllers" WHERE user_id = $1 ORDER BY sort_order, id', [userId]),
    query<ZoneRow>(
      `SELECT id, key, name, controller_id, segment_id, enabled, max_brightness, automatic, protected
       FROM racingcoach."LightingZones" WHERE user_id = $1 ORDER BY sort_order, id`,
      [userId]
    ),
    query<SceneRow>('SELECT id, key, name, all_look FROM racingcoach."LightingScenes" WHERE user_id = $1 ORDER BY sort_order, id', [userId]),
    query<{ scene_id: number; zone_id: number; look: Partial<ZoneLook> }>(
      `SELECT sz.scene_id, sz.zone_id, sz.look FROM racingcoach."LightingSceneZones" sz
       JOIN racingcoach."LightingScenes" s ON s.id = sz.scene_id WHERE s.user_id = $1`,
      [userId]
    ),
    query<RuleRow>(
      `SELECT key, name, event, enabled, priority, zone_keys, look, duration_seconds
       FROM racingcoach."LightingEventRules" WHERE user_id = $1 ORDER BY sort_order, id`,
      [userId]
    ),
  ]);
  const controllerKey = new Map(controllers.map((c) => [c.id, c.key]));
  const zoneKey = new Map(zones.map((z) => [z.id, z.key]));
  return {
    version: installation[0].version,
    controllers: controllers.map((c) => ({ id: c.key, name: c.name, host: c.host, port: c.port })),
    zones: zones.map((z) => ({
      id: z.key,
      name: z.name,
      controllerId: controllerKey.get(z.controller_id) ?? '',
      segmentId: z.segment_id,
      enabled: z.enabled,
      maxBrightness: z.max_brightness,
      automatic: z.automatic,
      protected: z.protected,
    })),
    scenes: scenes.map(
      (s): Scene => ({
        id: s.key,
        name: s.name,
        zones: Object.fromEntries(sceneZones.filter((sz) => sz.scene_id === s.id).map((sz) => [zoneKey.get(sz.zone_id) ?? '', sz.look])),
        ...(s.all_look ? { all: s.all_look } : {}),
      })
    ),
    rules: rules.map(
      (r): Rule => ({
        id: r.key,
        name: r.name,
        event: r.event as RuleEvent,
        enabled: r.enabled,
        priority: r.priority,
        zones: r.zone_keys ?? 'automatic',
        look: r.look,
        durationSeconds: r.duration_seconds,
      })
    ),
    settings: installation[0].settings,
    startScene: installation[0].start_scene,
  };
}

const lookJson = (look: Partial<ZoneLook> | undefined) =>
  look ? JSON.stringify({ ...look, ...(look.color ? { color: look.color.slice(0, 4) as Rgbw } : {}) }) : null;

async function writeRows(client: PoolClient, userId: number, config: LightingConfig) {
  for (const table of ['LightingEventRules', 'LightingScenes', 'LightingZones', 'LightingControllers']) {
    await client.query(`DELETE FROM racingcoach."${table}" WHERE user_id = $1`, [userId]);
  }
  const controllerIds = new Map<string, number>();
  for (const [i, c] of config.controllers.entries()) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO racingcoach."LightingControllers" (user_id, key, name, host, port, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, c.id, c.name, c.host, c.port, i]
    );
    controllerIds.set(c.id, rows[0].id);
  }
  const zoneIds = new Map<string, number>();
  for (const [i, z] of config.zones.entries()) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO racingcoach."LightingZones" (user_id, key, name, controller_id, segment_id, enabled, max_brightness, automatic, protected, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [userId, z.id, z.name, controllerIds.get(z.controllerId), z.segmentId, z.enabled, z.maxBrightness, z.automatic, z.protected, i]
    );
    zoneIds.set(z.id, rows[0].id);
  }
  for (const [i, s] of config.scenes.entries()) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO racingcoach."LightingScenes" (user_id, key, name, all_look, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, s.id, s.name, lookJson(s.all), i]
    );
    for (const [zone, look] of Object.entries(s.zones)) {
      await client.query(`INSERT INTO racingcoach."LightingSceneZones" (scene_id, zone_id, look) VALUES ($1, $2, $3)`, [rows[0].id, zoneIds.get(zone), lookJson(look)]);
    }
  }
  for (const [i, r] of config.rules.entries()) {
    await client.query(
      `INSERT INTO racingcoach."LightingEventRules" (user_id, key, name, event, enabled, priority, zone_keys, look, duration_seconds, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, r.id, r.name, r.event, r.enabled, r.priority, r.zones === 'automatic' ? null : r.zones, lookJson(r.look), r.durationSeconds, i]
    );
  }
}

// Saves a configuration that parseLightingConfig accepted. expectedVersion is the version it was made from (0 for the
// first); answers the new version. The whole configuration is replaced in one transaction.
export async function saveLightingConfig(userId: number, config: LightingConfig, expectedVersion: number): Promise<number> {
  await ensureUserSchema();
  return transaction(async (client) => {
    // The installation row is the lock: two saves for one owner run one after the other
    await client.query(
      `INSERT INTO racingcoach."LightingInstallations" (user_id, version, settings, start_scene) VALUES ($1, 0, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, JSON.stringify(config.settings), config.startScene]
    );
    const { rows } = await client.query<{ version: number }>('SELECT version FROM racingcoach."LightingInstallations" WHERE user_id = $1 FOR UPDATE', [userId]);
    const current = rows[0].version;
    if (current !== expectedVersion) throw new LightingConfigConflict(current);
    await writeRows(client, userId, config);
    const version = current + 1;
    await client.query(
      `UPDATE racingcoach."LightingInstallations" SET version = $2, settings = $3, start_scene = $4, updated_at = now() WHERE user_id = $1`,
      [userId, version, JSON.stringify(config.settings), config.startScene]
    );
    return version;
  });
}
