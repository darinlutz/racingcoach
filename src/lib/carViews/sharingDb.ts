import type { PoolClient } from 'pg';

// Sharing one version of a car's engineering drawings or 3D model between several Car Data cars (assetRules.ts'
// sharedCarIds), the same for both tables: carViewStore.ts and carModels/carModelStore.ts call these inside their
// transactions. Drivers' pages find a version only by car path, so a car path still leads to one active version:
// making a version active (or changing an active one's cars) replaces the active versions of its own car and of
// every car it's shared with, and is refused while another car's active version, one it doesn't replace, already
// claims one of its car paths.

export type SharingTable = 'CarEngineeringAssets' | 'CarModelAssets';

// Whether every shared car is a Car Data car
export async function sharedCarsExist(client: PoolClient, ids: number[]): Promise<boolean> {
  if (!ids.length) return true;
  const { rows } = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM racingcoach."Cars" WHERE id = ANY($1::int[])', [ids]);
  return rows[0].count === ids.length;
}

// Makes the version active (or keeps it so, after its cars changed): the name of the car whose active version claims
// one of its car paths when that refuses it, else null once done
export async function activateSharedVersion(
  client: PoolClient,
  table: SharingTable,
  version: { id: number; carId: number; sharedCarIds: number[]; carKeys: string[] },
  userId: number,
  alreadyActive = false
): Promise<string | null> {
  const cars = [version.carId, ...version.sharedCarIds];
  const taken = await client.query<{ car_name: string }>(
    `SELECT c.car_name FROM racingcoach."${table}" a JOIN racingcoach."Cars" c ON c.id = a.car_id
     WHERE a.active AND a.id <> $1 AND NOT (a.car_id = ANY($2::int[])) AND a.car_keys && $3::text[]
     ORDER BY lower(c.car_name) LIMIT 1`,
    [version.id, cars, version.carKeys]
  );
  if (taken.rowCount) return taken.rows[0].car_name;
  await client.query(`UPDATE racingcoach."${table}" SET active = false WHERE active AND id <> $1 AND car_id = ANY($2::int[])`, [version.id, cars]);
  if (!alreadyActive) await client.query(`UPDATE racingcoach."${table}" SET active = true, activated_at = now(), activated_by = $2 WHERE id = $1`, [version.id, userId]);
  return null;
}

// Each version's shared cars by name, for the Admin pages (a deleted car is left out)
export const SHARED_CARS_SQL = `COALESCE((SELECT json_agg(json_build_object('id', sc.id, 'name', sc.car_name) ORDER BY lower(sc.car_name))
  FROM racingcoach."Cars" sc WHERE sc.id = ANY(a.shared_car_ids)), '[]'::json) AS shared_cars`;

export type SharedCar = { id: number; name: string };
