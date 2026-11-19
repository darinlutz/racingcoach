import { query, transaction } from '../db';
import { ensureUserSchema } from '../users';
import { parseViewAnchors, type CarViewArt } from './anchors.ts';
import { checkAction, type AssetAction, type AssetStatus, type Draft, type DraftViews, type ResolvedCarAsset } from './assetRules.ts';
import { sanitizeSvg } from './svgSanitize.ts';
import { CAR_VIEWS, type CarView } from './views.ts';

// The engineering car drawings in the database (docs/car-views.md; tables in carViewSchema.ts, rules in assetRules.ts).
// Drivers' pages read only a car's active version, by an exact iRacing car path; the Admin page reads and changes
// every version. Every drawing read is put through the sanitizer again before it leaves, so a row changed by hand
// can't put anything on a page the sanitizer wouldn't.

export type AssetSummary = {
  id: number;
  carId: number;
  carName: string;
  version: number;
  status: AssetStatus;
  active: boolean;
  carKeys: string[];
  views: CarView[];
  sources: string;
  license: string;
  notes: string;
  createdAt: string;
  reviewedAt: string | null;
  activatedAt: string | null;
  history: { action: string; from: string | null; to: string | null; at: string }[];
};

type Row = {
  id: number;
  car_id: number;
  car_name: string;
  version: number;
  status: AssetStatus;
  active: boolean;
  car_keys: string[];
  views: Record<string, unknown>;
  sources: string;
  license: string;
  notes: string;
  created_at: Date;
  reviewed_at: Date | null;
  activated_at: Date | null;
};

export class CarViewActionError extends Error {
  constructor(readonly code: 'notFound' | 'wrongStatus' | 'needsProvenance' | 'notActive' | 'alreadyActive' | 'carKeyTaken' | 'notDeletable', readonly detail?: string) {
    super(code);
  }
}

// A stored view, sanitized again; null when it no longer passes (logged, and the generic car shows instead)
function readView(view: CarView, value: unknown, assetId: number): CarViewArt | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { viewBox?: { x: number; y: number; width: number; height: number }; inner?: unknown; anchors?: unknown; hasWheels?: unknown };
  if (!v.viewBox || typeof v.inner !== 'string') return null;
  const { x, y, width, height } = v.viewBox;
  const again = sanitizeSvg(`<svg viewBox="${Number(x)} ${Number(y)} ${Number(width)} ${Number(height)}">${v.inner}</svg>`);
  if (!again.ok) {
    console.error(`Car drawing ${assetId} ${view} failed the sanitizer on reading:`, JSON.stringify(again.problems.slice(0, 3)));
    return null;
  }
  return { viewBox: again.svg.viewBox, inner: again.svg.inner, anchors: parseViewAnchors(view, v.anchors).anchors, hasWheels: v.hasWheels !== false };
}

function readViews(row: Pick<Row, 'id' | 'views'>): DraftViews {
  const views: DraftViews = {};
  for (const view of CAR_VIEWS) {
    const art = readView(view, row.views?.[view], row.id);
    if (art) views[view] = art;
  }
  return views;
}

const COLUMNS = `a.id, a.car_id, c.car_name, a.version, a.status, a.active, a.car_keys, a.views, a.sources, a.license, a.notes,
  a.created_at, a.reviewed_at, a.activated_at`;

const toResolved = (row: Row): ResolvedCarAsset => ({
  id: row.id,
  version: row.version,
  carId: row.car_id,
  carName: row.car_name,
  status: row.status,
  active: row.active,
  views: readViews(row),
  notes: row.notes,
});

// The active drawings by car path, kept a minute in this server's memory, emptied by every Admin change
const resolved = new Map<string, { at: number; value: ResolvedCarAsset | null }>();
const RESOLVED_TTL_MS = 60_000;

export async function readActiveCarAsset(carKey: string): Promise<ResolvedCarAsset | null> {
  const key = carKey.trim().toLowerCase();
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < RESOLVED_TTL_MS) return hit.value;
  await ensureUserSchema();
  const [row] = await query<Row>(
    `SELECT ${COLUMNS} FROM racingcoach."CarEngineeringAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id
     WHERE a.active AND $1 = ANY(a.car_keys) ORDER BY a.activated_at DESC NULLS LAST LIMIT 1`,
    [key]
  );
  const value = row ? toResolved(row) : null;
  if (resolved.size > 500) resolved.clear();
  resolved.set(key, { at: Date.now(), value });
  return value;
}

// Any version with its drawings, for the Admin page's preview
export async function readCarAsset(id: number): Promise<ResolvedCarAsset | null> {
  await ensureUserSchema();
  const [row] = await query<Row>(`SELECT ${COLUMNS} FROM racingcoach."CarEngineeringAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id WHERE a.id = $1`, [id]);
  return row ? toResolved(row) : null;
}

export async function listCarAssets(): Promise<AssetSummary[]> {
  await ensureUserSchema();
  const rows = await query<Row & { history: AssetSummary['history'] | null }>(
    `SELECT ${COLUMNS},
       (SELECT json_agg(json_build_object('action', e.action, 'from', e.from_status, 'to', e.to_status, 'at', e.created_at) ORDER BY e.created_at)
          FROM racingcoach."CarEngineeringAssetEvents" e WHERE e.asset_id = a.id) AS history
     FROM racingcoach."CarEngineeringAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id
     ORDER BY lower(c.car_name), a.version DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    carId: row.car_id,
    carName: row.car_name,
    version: row.version,
    status: row.status,
    active: row.active,
    carKeys: row.car_keys,
    views: CAR_VIEWS.filter((v) => row.views && typeof row.views === 'object' && v in row.views),
    sources: row.sources,
    license: row.license,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    activatedAt: row.activated_at?.toISOString() ?? null,
    history: row.history ?? [],
  }));
}

// A new version of a car's drawings, as a draft numbered after its latest
export async function createCarAssetDraft(draft: Draft, userId: number): Promise<{ id: number; version: number }> {
  await ensureUserSchema();
  const created = await transaction(async (client) => {
    const car = await client.query('SELECT id FROM racingcoach."Cars" WHERE id = $1 FOR UPDATE', [draft.carId]);
    if (!car.rowCount) throw new CarViewActionError('notFound');
    const { rows } = await client.query<{ id: number; version: number }>(
      `INSERT INTO racingcoach."CarEngineeringAssets" (car_id, version, car_keys, views, sources, license, notes, created_by)
       VALUES ($1, (SELECT COALESCE(max(version), 0) + 1 FROM racingcoach."CarEngineeringAssets" WHERE car_id = $1), $2, $3, $4, $5, $6, $7)
       RETURNING id, version`,
      [draft.carId, draft.carKeys, JSON.stringify(draft.views), draft.sources, draft.license, draft.notes, userId]
    );
    await client.query(`INSERT INTO racingcoach."CarEngineeringAssetEvents" (asset_id, action, to_status, user_id) VALUES ($1, 'create', 'draft', $2)`, [rows[0].id, userId]);
    return rows[0];
  });
  resolved.clear();
  return created;
}

export async function applyCarAssetAction(id: number, action: AssetAction, userId: number): Promise<void> {
  await ensureUserSchema();
  await transaction(async (client) => {
    const { rows } = await client.query<{ car_id: number; status: AssetStatus; active: boolean; sources: string; license: string; car_keys: string[] }>(
      'SELECT car_id, status, active, sources, license, car_keys FROM racingcoach."CarEngineeringAssets" WHERE id = $1 FOR UPDATE',
      [id]
    );
    const version = rows[0];
    if (!version) throw new CarViewActionError('notFound');
    const check = checkAction(version, action);
    if (!check.ok) throw new CarViewActionError(check.code);
    if (action === 'activate') {
      // A car path is one car's: another car's active drawings mustn't already claim it
      const taken = await client.query<{ car_name: string }>(
        `SELECT c.car_name FROM racingcoach."CarEngineeringAssets" a JOIN racingcoach."Cars" c ON c.id = a.car_id
         WHERE a.active AND a.car_id <> $1 AND a.car_keys && $2::text[] LIMIT 1`,
        [version.car_id, version.car_keys]
      );
      if (taken.rowCount) throw new CarViewActionError('carKeyTaken', taken.rows[0].car_name);
      await client.query('UPDATE racingcoach."CarEngineeringAssets" SET active = false WHERE car_id = $1 AND active', [version.car_id]);
      await client.query('UPDATE racingcoach."CarEngineeringAssets" SET active = true, activated_at = now(), activated_by = $2 WHERE id = $1', [id, userId]);
    } else if (action === 'deactivate') {
      await client.query('UPDATE racingcoach."CarEngineeringAssets" SET active = false WHERE id = $1', [id]);
    } else {
      await client.query('UPDATE racingcoach."CarEngineeringAssets" SET status = $2, reviewed_at = CASE WHEN $3 THEN now() ELSE reviewed_at END, reviewed_by = CASE WHEN $3 THEN $4 ELSE reviewed_by END WHERE id = $1', [
        id,
        check.status,
        action !== 'submit',
        userId,
      ]);
    }
    await client.query(`INSERT INTO racingcoach."CarEngineeringAssetEvents" (asset_id, action, from_status, to_status, user_id) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      action,
      version.status,
      check.status,
      userId,
    ]);
  });
  resolved.clear();
}

// Only a draft or a rejected version that isn't active can be deleted: an approved one stays, to roll back to
export async function deleteCarAsset(id: number): Promise<void> {
  await ensureUserSchema();
  const rows = await query(`DELETE FROM racingcoach."CarEngineeringAssets" WHERE id = $1 AND NOT active AND status IN ('draft', 'rejected') RETURNING id`, [id]);
  if (!rows.length) throw new CarViewActionError('notDeletable');
  resolved.clear();
}
