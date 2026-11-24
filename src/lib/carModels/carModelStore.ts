import { createHash } from 'node:crypto';
import { query, transaction } from '../db';
import { ensureUserSchema } from '../users';
import { carModelKey, carModelStore } from './carModelStorage.ts';
import { liteKeysOf } from './carModelLite.ts';
import type { Sharing } from '../carViews/assetRules.ts';
import { activateSharedVersion, SHARED_CARS_SQL, sharedCarsExist, type SharedCar } from '../carViews/sharingDb.ts';
import type { GlbInfo } from './glb.ts';
import { canonicalBounds, DEFAULT_NORMALIZATION, type Bounds, type Normalization } from './matrix.ts';
import {
  checkModelAction,
  editableStatus,
  estimateWheelAnchors,
  isCameraView,
  modelFileUrl,
  parseNormalization,
  parseWheelAnchors,
  type CameraView,
  type ModelAction,
  type ModelSettings,
  type ModelStatus,
  type ResolvedCarModel,
  type WheelAnchors,
} from './modelRules.ts';

// The 3D car models in the database (docs/car-models.md; tables in carViews/carViewSchema.ts, rules in modelRules.ts),
// files in object storage (carModelStorage.ts). Drivers' pages read only a car's active version, by an exact iRacing
// car path; the Admin page reads and changes every version.

export type ModelSummary = {
  id: number;
  carId: number;
  carName: string;
  version: number;
  status: ModelStatus;
  active: boolean;
  // The other cars that use this version's model
  sharedCars: SharedCar[];
  carKeys: string[];
  fileName: string;
  bytes: number;
  sha256: string;
  stats: GlbInfo['stats'];
  warnings: GlbInfo['warnings'];
  rawBounds: Bounds;
  normalization: Normalization;
  wheelAnchors: WheelAnchors;
  defaultView: CameraView;
  source: string;
  license: string;
  attribution: string;
  notes: string;
  createdAt: string;
  history: { action: string; from: string | null; to: string | null; at: string }[];
};

// racingDiscipline: the Car Type (RACING_DISCIPLINES), which the Admin page's list of cars groups them by
export type ModelCar = { id: number; name: string; racingDiscipline: string | null; lengthIn: number | null; widthIn: number | null; wheelbaseIn: number | null };

type Row = {
  id: number;
  car_id: number;
  car_name: string;
  version: number;
  status: ModelStatus;
  active: boolean;
  shared_car_ids: number[];
  car_keys: string[];
  storage_key: string;
  file_name: string;
  bytes: number;
  sha256: string;
  raw_bounds: Bounds;
  stats: GlbInfo['stats'];
  warnings: GlbInfo['warnings'];
  normalization: unknown;
  wheel_anchors: unknown;
  default_view: string;
  source: string;
  license: string;
  attribution: string;
  notes: string;
  created_at: Date;
};

export class CarModelError extends Error {
  constructor(
    readonly code:
      | 'notFound'
      | 'wrongStatus'
      | 'needsProvenance'
      | 'needsAttribution'
      | 'notActive'
      | 'alreadyActive'
      | 'carKeyTaken'
      | 'unknownCar'
      | 'notEditable'
      | 'duplicate'
      | 'storageMissing',
    readonly detail?: string
  ) {
    super(code);
  }
}

const COLUMNS = `a.id, a.car_id, c.car_name, a.version, a.status, a.active, a.shared_car_ids, a.car_keys, a.storage_key, a.file_name, a.bytes, a.sha256,
  a.raw_bounds, a.stats, a.warnings, a.normalization, a.wheel_anchors, a.default_view, a.source, a.license, a.attribution, a.notes, a.created_at`;

// A stored row read back defensively: settings changed by hand that no longer parse fall back to the defaults
function settingsOf(row: Row) {
  const normalization = parseNormalization(row.normalization) ?? DEFAULT_NORMALIZATION;
  const wheelAnchors = parseWheelAnchors(row.wheel_anchors) ?? estimateWheelAnchors(canonicalBounds(normalization, row.raw_bounds), null);
  return { normalization, wheelAnchors, defaultView: isCameraView(row.default_view) ? row.default_view : ('frontThreeQuarter' as CameraView) };
}

const toResolved = (row: Row): ResolvedCarModel => ({
  id: row.id,
  version: row.version,
  carId: row.car_id,
  carName: row.car_name,
  status: row.status,
  active: row.active,
  url: modelFileUrl(row.id, row.sha256),
  bytes: row.bytes,
  rawBounds: row.raw_bounds,
  ...settingsOf(row),
  attribution: row.attribution,
  license: row.license,
});

// The active model by car path, kept a minute in this server's memory, emptied by every Admin change
const resolved = new Map<string, { at: number; value: ResolvedCarModel | null }>();
const RESOLVED_TTL_MS = 60_000;

export async function readActiveCarModel(carKey: string): Promise<ResolvedCarModel | null> {
  const key = carKey.trim().toLowerCase();
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < RESOLVED_TTL_MS) return hit.value;
  await ensureUserSchema();
  const [row] = await query<Row>(
    `SELECT ${COLUMNS} FROM racingcoach."CarModelAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id
     WHERE a.active AND $1 = ANY(a.car_keys) ORDER BY a.activated_at DESC NULLS LAST LIMIT 1`,
    [key]
  );
  const value = row ? toResolved(row) : null;
  if (resolved.size > 500) resolved.clear();
  resolved.set(key, { at: Date.now(), value });
  return value;
}

// Any version, for the Admin page's preview
export async function readCarModel(id: number): Promise<ResolvedCarModel | null> {
  await ensureUserSchema();
  const [row] = await query<Row>(`SELECT ${COLUMNS} FROM racingcoach."CarModelAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id WHERE a.id = $1`, [id]);
  return row ? toResolved(row) : null;
}

// What the file route needs: where the file is, and whether drivers may have it
export async function readCarModelFile(id: number): Promise<{ storageKey: string; sha256: string; bytes: number; servable: boolean } | null> {
  await ensureUserSchema();
  const [row] = await query<{ storage_key: string; sha256: string; bytes: number; active: boolean; status: ModelStatus }>(
    'SELECT storage_key, sha256, bytes, active, status FROM racingcoach."CarModelAssets" WHERE id = $1',
    [id]
  );
  return row ? { storageKey: row.storage_key, sha256: row.sha256, bytes: row.bytes, servable: row.active && row.status === 'approved' } : null;
}

export async function listModelCars(): Promise<ModelCar[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; car_name: string; racing_discipline: string | null; length_in: number | null; width_in: number | null; wheelbase_in: number | null }>(
    'SELECT id, car_name, racing_discipline, length_in, width_in, wheelbase_in FROM racingcoach."Cars" ORDER BY lower(car_name)'
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.car_name,
    racingDiscipline: r.racing_discipline,
    lengthIn: r.length_in,
    widthIn: r.width_in,
    wheelbaseIn: r.wheelbase_in,
  }));
}

export async function listCarModels(): Promise<ModelSummary[]> {
  await ensureUserSchema();
  const rows = await query<Row & { history: ModelSummary['history'] | null; shared_cars: SharedCar[] }>(
    `SELECT ${COLUMNS}, ${SHARED_CARS_SQL},
       (SELECT json_agg(json_build_object('action', e.action, 'from', e.from_status, 'to', e.to_status, 'at', e.created_at) ORDER BY e.created_at)
          FROM racingcoach."CarModelAssetEvents" e WHERE e.asset_id = a.id) AS history
     FROM racingcoach."CarModelAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id
     ORDER BY lower(c.car_name), a.version DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    carId: row.car_id,
    carName: row.car_name,
    version: row.version,
    status: row.status,
    active: row.active,
    sharedCars: row.shared_cars ?? [],
    carKeys: row.car_keys,
    fileName: row.file_name,
    bytes: row.bytes,
    sha256: row.sha256,
    stats: row.stats,
    warnings: row.warnings ?? [],
    rawBounds: row.raw_bounds,
    ...settingsOf(row),
    source: row.source,
    license: row.license,
    attribution: row.attribution,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    history: row.history ?? [],
  }));
}

export type NewCarModel = {
  carId: number;
  sharedCarIds: number[];
  carKeys: string[];
  fileName: string;
  bytes: Buffer;
  info: GlbInfo;
  source: string;
  license: string;
  attribution: string;
  notes: string;
};

// A new version of a car's model: the file stored first (content-addressed, so a retry writes the same object), then
// its row numbered after the car's latest. If the row can't be written the object is removed again, unless another
// row already holds it
export async function createCarModel(input: NewCarModel, userId: number): Promise<{ id: number; version: number }> {
  await ensureUserSchema();
  const store = carModelStore();
  if (!store) throw new CarModelError('storageMissing');
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const key = carModelKey(input.carId, sha256);
  const [car] = await query<{ id: number; wheelbase_in: number | null }>('SELECT id, wheelbase_in FROM racingcoach."Cars" WHERE id = $1', [input.carId]);
  if (!car) throw new CarModelError('notFound');
  const [existing] = await query<{ version: number }>('SELECT version FROM racingcoach."CarModelAssets" WHERE storage_key = $1', [key]);
  if (existing) throw new CarModelError('duplicate', String(existing.version));

  const normalization = DEFAULT_NORMALIZATION;
  const wheelAnchors = estimateWheelAnchors(canonicalBounds(normalization, input.info.bounds), car.wheelbase_in ? car.wheelbase_in * 0.0254 : null);
  await store.put(key, input.bytes);
  try {
    const created = await transaction(async (client) => {
      const locked = await client.query('SELECT id FROM racingcoach."Cars" WHERE id = $1 FOR UPDATE', [input.carId]);
      if (!locked.rowCount) throw new CarModelError('notFound');
      if (!(await sharedCarsExist(client, input.sharedCarIds ?? []))) throw new CarModelError('unknownCar');
      const { rows } = await client.query<{ id: number; version: number }>(
        `INSERT INTO racingcoach."CarModelAssets"
           (car_id, version, shared_car_ids, car_keys, storage_key, file_name, bytes, sha256, raw_bounds, stats, warnings, normalization, wheel_anchors,
            source, license, attribution, notes, created_by)
         VALUES ($1, (SELECT COALESCE(max(version), 0) + 1 FROM racingcoach."CarModelAssets" WHERE car_id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17)
         RETURNING id, version`,
        [
          input.carId,
          input.sharedCarIds ?? [],
          input.carKeys,
          key,
          input.fileName,
          input.bytes.length,
          sha256,
          JSON.stringify(input.info.bounds),
          JSON.stringify(input.info.stats),
          JSON.stringify(input.info.warnings),
          JSON.stringify(normalization),
          JSON.stringify(wheelAnchors),
          input.source,
          input.license,
          input.attribution,
          input.notes,
          userId,
        ]
      );
      await client.query(`INSERT INTO racingcoach."CarModelAssetEvents" (asset_id, action, to_status, user_id) VALUES ($1, 'upload', 'uploaded', $2)`, [rows[0].id, userId]);
      return rows[0];
    });
    resolved.clear();
    return created;
  } catch (error) {
    const held = await query('SELECT 1 FROM racingcoach."CarModelAssets" WHERE storage_key = $1', [key]).catch(() => [1]);
    if (!held.length) await store.remove(key).catch((e) => console.error(`Car model object ${key} couldn't be removed after a failed save:`, e));
    throw error;
  }
}

// An Admin's settings: normalization, wheel anchors, default camera, provenance and car paths. Only while the version
// can be edited (uploaded or rejected; a rejected one goes back to uploaded)
export async function updateCarModel(id: number, settings: ModelSettings, userId: number): Promise<void> {
  await ensureUserSchema();
  await transaction(async (client) => {
    const { rows } = await client.query<{ status: ModelStatus }>('SELECT status FROM racingcoach."CarModelAssets" WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new CarModelError('notFound');
    if (!editableStatus(rows[0].status)) throw new CarModelError('notEditable');
    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (settings.carKeys) set('car_keys', settings.carKeys);
    if (settings.normalization) set('normalization', JSON.stringify(settings.normalization));
    if (settings.wheelAnchors) set('wheel_anchors', JSON.stringify(settings.wheelAnchors));
    if (settings.defaultView) set('default_view', settings.defaultView);
    for (const field of ['source', 'license', 'attribution', 'notes'] as const) if (settings[field] !== undefined) set(field, settings[field]);
    if (!sets.length) return;
    await client.query(`UPDATE racingcoach."CarModelAssets" SET ${sets.join(', ')}, status = 'uploaded', updated_at = now() WHERE id = $1`, values);
    await client.query(`INSERT INTO racingcoach."CarModelAssetEvents" (asset_id, action, from_status, to_status, user_id) VALUES ($1, 'edit', $2, 'uploaded', $3)`, [
      id,
      rows[0].status,
      userId,
    ]);
  });
  resolved.clear();
}

export async function applyCarModelAction(id: number, action: ModelAction, userId: number): Promise<void> {
  await ensureUserSchema();
  await transaction(async (client) => {
    const { rows } = await client.query<{
      car_id: number;
      status: ModelStatus;
      active: boolean;
      source: string;
      license: string;
      attribution: string;
      car_keys: string[];
      shared_car_ids: number[];
    }>(
      'SELECT car_id, status, active, source, license, attribution, car_keys, shared_car_ids FROM racingcoach."CarModelAssets" WHERE id = $1 FOR UPDATE',
      [id]
    );
    const version = rows[0];
    if (!version) throw new CarModelError('notFound');
    const check = checkModelAction(version, action);
    if (!check.ok) throw new CarModelError(check.code);
    if (action === 'activate') {
      // Replaces the active models of its car and of the cars it's shared with; refused while one of its car paths is
      // another car's active model's (carViews/sharingDb.ts)
      const taken = await activateSharedVersion(
        client,
        'CarModelAssets',
        { id, carId: version.car_id, sharedCarIds: version.shared_car_ids ?? [], carKeys: version.car_keys },
        userId
      );
      if (taken) throw new CarModelError('carKeyTaken', taken);
    } else if (action === 'deactivate') {
      await client.query('UPDATE racingcoach."CarModelAssets" SET active = false WHERE id = $1', [id]);
    } else {
      await client.query(
        'UPDATE racingcoach."CarModelAssets" SET status = $2, reviewed_at = CASE WHEN $3 THEN now() ELSE reviewed_at END, reviewed_by = CASE WHEN $3 THEN $4 ELSE reviewed_by END WHERE id = $1',
        [id, check.status, action !== 'submit', userId]
      );
    }
    await client.query(`INSERT INTO racingcoach."CarModelAssetEvents" (asset_id, action, from_status, to_status, user_id) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      action,
      version.status,
      check.status,
      userId,
    ]);
  });
  resolved.clear();
}

// Which cars use a version: the other cars it's shared with and its car paths, at any status, as that doesn't change
// the model that was reviewed. An active version's change replaces the active model of a car it's now shared with, and
// is refused while one of its car paths is another car's active model's
export async function updateCarModelSharing(id: number, sharing: Sharing, userId: number): Promise<void> {
  await ensureUserSchema();
  await transaction(async (client) => {
    const { rows } = await client.query<{ car_id: number; status: ModelStatus; active: boolean }>(
      'SELECT car_id, status, active FROM racingcoach."CarModelAssets" WHERE id = $1 FOR UPDATE',
      [id]
    );
    const version = rows[0];
    if (!version) throw new CarModelError('notFound');
    const sharedCarIds = sharing.sharedCarIds.filter((c) => c !== version.car_id);
    if (!(await sharedCarsExist(client, sharedCarIds))) throw new CarModelError('unknownCar');
    await client.query('UPDATE racingcoach."CarModelAssets" SET shared_car_ids = $2, car_keys = $3, updated_at = now() WHERE id = $1', [id, sharedCarIds, sharing.carKeys]);
    if (version.active) {
      const taken = await activateSharedVersion(client, 'CarModelAssets', { id, carId: version.car_id, sharedCarIds, carKeys: sharing.carKeys }, userId, true);
      if (taken) throw new CarModelError('carKeyTaken', taken);
    }
    await client.query(`INSERT INTO racingcoach."CarModelAssetEvents" (asset_id, action, from_status, to_status, user_id) VALUES ($1, 'share', $2, $2, $3)`, [
      id,
      version.status,
      userId,
    ]);
  });
  resolved.clear();
}

// Any version can be deleted, with its file and its lite copy, and its events with it (ON DELETE CASCADE). Deleting the
// active version leaves the car with none, so drivers see the generic car until another approved version is activated;
// a deleted approved version can no longer be rolled back to
export async function deleteCarModel(id: number): Promise<void> {
  await ensureUserSchema();
  const rows = await query<{ storage_key: string }>(`DELETE FROM racingcoach."CarModelAssets" WHERE id = $1 RETURNING storage_key`, [id]);
  if (!rows.length) throw new CarModelError('notFound');
  resolved.clear();
  const store = carModelStore();
  if (!store) return;
  for (const key of [rows[0].storage_key, ...liteKeysOf(rows[0].storage_key)]) {
    await store.remove(key).catch((e) => console.error(`Car model object ${key} couldn't be removed:`, e));
  }
}
