import fs from 'node:fs/promises';
import path from 'node:path';
import { IRACING_CARS } from './carPictures';
import {
  CAR_SETUP_LIMITS,
  carSetupObjectKey,
  cleanCarFolder,
  cleanSetupFileName,
  cleanSetupPath,
  importDecision,
  isProvenance,
  isSha256,
  looksLikeText,
  sameSetup,
  setupStem,
  type CarSetupFileKind,
  type CarSetupProvenance,
  type ImportDecision,
} from './carSetupLibraryRules';
import { query, transaction } from './db';
import { isLiveServer } from './serverEnvironment';
import { parseSetupHtm, type ParsedSetupHtm } from './setupHtm';
import { readStoFile } from './stoFile';
import { telemetryStore, type TelemetryObjectStore } from './telemetryStorage';
import { sha256Hex, STORAGE_PROVIDERS } from './telemetryStorageRules';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';
import { ensureUserSchema } from './users';

// The iRacing Setups library (docs/setups.md's iRacing setup collection): iRacing setup files an Admin's collector
// copied from the sim PC's setups folder (Get Car Setups, SetupLibraryScanner.cs), kept byte for byte in the private
// telemetry R2 bucket and cataloged in "CarSetups" with the .htm export's values. Admins only, everywhere: the routes
// check the role before calling anything here, and nothing here is shown to other users until the licensing and
// redistribution of iRacing's setups is decided.
//
// An import is two steps, so unchanged files are never sent again: planImport (the collector lists every setup with
// its files' SHA-256 hashes; the answer says which are new, changed or unchanged, and which car folders aren't a Car
// Data car), then storeSetup for each new or changed one (both files, checked against the hashes listed). R2 and
// Postgres share no transaction, so storeSetup writes a 'pending' cleanup entry, then the objects (checked by a HEAD),
// then the row and the entry's removal in one transaction: a failure leaves only an object the cleanup worker deletes
// once no setup references it, never a catalog entry without its files. Objects are content-addressed, so a retry or a
// second import writes nothing new.

export class CarSetupImportError extends Error {
  constructor(
    readonly code:
      | 'notConfigured'
      | 'importNotFound'
      | 'importClosed'
      | 'badRequest'
      | 'hashMismatch'
      | 'tooLarge'
      | 'notSto'
      | 'notHtm'
      | 'unresolvedCar'
      | 'storageFailed',
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Storage: the telemetry bucket, or for local development without it CAR_SETUP_DEV_STORAGE_DIR (never on the live
// server). Tests set their own with setCarSetupStoreForTests.

function diskStore(dir: string): TelemetryObjectStore {
  const root = path.resolve(dir);
  const file = (key: string) => {
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Bad setup object key');
    return resolved;
  };
  return {
    provider: 'disk',
    bucket: 'local',
    async putObject(key, body) {
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), body);
    },
    async getObject(key) {
      return fs.readFile(file(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    },
    async headObject(key) {
      const stat = await fs.stat(file(key)).catch(() => null);
      return stat ? { size: stat.size, metadata: {} } : null;
    },
    async deleteObject(key) {
      await fs.rm(file(key), { force: true });
    },
    async listObjects() {
      return { objects: [] };
    },
  };
}

let testStore: TelemetryObjectStore | null | undefined;
export const setCarSetupStoreForTests = (store: TelemetryObjectStore | null | undefined) => {
  testStore = store;
};

export function carSetupStore(): TelemetryObjectStore | null {
  if (testStore !== undefined) return testStore;
  const store = telemetryStore();
  if (store) return store;
  const dir = process.env.CAR_SETUP_DEV_STORAGE_DIR?.trim();
  return dir && !isLiveServer() ? diskStore(dir) : null;
}

const CONTENT_TYPES: Record<CarSetupFileKind, string> = { sto: 'application/octet-stream', htm: 'text/html' };

// Stores one file under its content-addressed key unless an object of that size is already there, then checks it's
// there. Answers whether it was written. A pending cleanup entry comes first, so an object whose row never commits
// is deleted later (only in R2; the cleanup worker keeps it if a setup references it by then)
async function putChecked(store: TelemetryObjectStore, key: string, bytes: Buffer, sha256: string, kind: CarSetupFileKind): Promise<boolean> {
  const existing = await store.headObject(key);
  if (existing && existing.size === bytes.length) return false;
  if (store.provider === STORAGE_PROVIDERS.r2) {
    await query(
      `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, reason, not_before)
       VALUES ($1, $2, $3, 'pending', now() + ${PENDING_GRACE_SQL})
       ON CONFLICT (storage_bucket, storage_key) DO UPDATE
         SET not_before = GREATEST(racingcoach."TelemetryObjectCleanup".not_before, now() + ${PENDING_GRACE_SQL})`,
      [store.provider, store.bucket, key]
    );
  }
  await store.putObject(key, bytes, { contentType: CONTENT_TYPES[kind], metadata: { sha256, kind: `car-setup-${kind}` } });
  const stored = await store.headObject(key);
  if (!stored || stored.size !== bytes.length) throw new Error(`the stored ${kind} object isn't there or has the wrong size`);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Car folders: iRacing names each car's setups folder after its car path (ferrari296gt3), the same paths as
// IRACING_CARS (carPictures.ts). A folder is a Car Data car only when that car path's names include exactly one Car
// Data car's name (accents, case and punctuation aside), never a similar one; otherwise it's unresolved and its
// setups aren't imported, rather than filed under the wrong car.

export type CarResolution =
  | { folder: string; resolved: true; carId: number; carName: string }
  | { folder: string; resolved: false; reason: 'unknownCarPath' | 'notInCarData' | 'ambiguous' };

const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\[legacy\]\s*/, '')
    .replace(/[^a-z0-9]+/g, '');
const pathKey = (carPath: string) => carPath.trim().toLowerCase().split(/[\\/\s]+/).filter(Boolean).join(' ');

export function carPathNames(folder: string): string[] | null {
  const entry = IRACING_CARS.find(([carPath]) => pathKey(carPath) === pathKey(folder));
  return entry ? entry.slice(2) : null;
}

export async function resolveCarFolders(folders: string[]): Promise<CarResolution[]> {
  const cars = await query<{ id: number; car_name: string }>('SELECT id, car_name FROM racingcoach."Cars"');
  return folders.map((folder): CarResolution => {
    const names = carPathNames(folder);
    if (!names) return { folder, resolved: false, reason: 'unknownCarPath' };
    const keys = new Set(names.map(nameKey));
    const matches = cars.filter((car) => keys.has(nameKey(car.car_name)));
    if (!matches.length) return { folder, resolved: false, reason: 'notInCarData' };
    if (matches.length > 1) return { folder, resolved: false, reason: 'ambiguous' };
    return { folder, resolved: true, carId: matches[0].id, carName: matches[0].car_name };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Planning an import

export type ListedSetup = {
  path: string;
  stoFileName: string;
  stoSha256: string;
  stoBytes: number;
  htmFileName: string | null;
  htmSha256: string | null;
  htmBytes: number | null;
};

export type ImportPlanInput = {
  collectorVersion: string | null;
  cars: { folder: string; setups: ListedSetup[] }[];
  // Files the collector couldn't read (locked, online-only and not downloaded, no permission), for the import's record
  unreadable: { path: string; error: string }[];
};

export type PlannedSetup = { folder: string; path: string; decision: ImportDecision | 'unresolvedCar'; setupId: number | null };

export type ImportPlan = { importId: number; cars: CarResolution[]; setups: PlannedSetup[] };

const errorText = (text: string) => text.replace(/[\u0000-\u001f]+/g, ' ').slice(0, CAR_SETUP_LIMITS.errorChars);

// Checks a listed setup's names and hashes; null when they don't add up
export function cleanListedSetup(setup: ListedSetup): ListedSetup | null {
  const setupPath = cleanSetupPath(setup.path);
  const sto = cleanSetupFileName(setup.stoFileName, 'sto');
  if (!setupPath || !sto || !isSha256(setup.stoSha256)) return null;
  if (!Number.isInteger(setup.stoBytes) || setup.stoBytes <= 0 || setup.stoBytes > CAR_SETUP_LIMITS.stoBytes) return null;
  const last = setupPath.split('/').pop()!;
  if (!sameSetup(setupStem(sto), last)) return null;
  let htm: string | null = null;
  if (setup.htmFileName != null || setup.htmSha256 != null) {
    htm = cleanSetupFileName(setup.htmFileName, 'htm');
    if (!htm || !isSha256(setup.htmSha256) || !sameSetup(setupStem(htm), last)) return null;
    if (!Number.isInteger(setup.htmBytes) || setup.htmBytes! <= 0 || setup.htmBytes! > CAR_SETUP_LIMITS.htmBytes) return null;
  }
  return {
    path: setupPath,
    stoFileName: sto,
    stoSha256: setup.stoSha256,
    stoBytes: setup.stoBytes,
    htmFileName: htm,
    htmSha256: htm ? setup.htmSha256 : null,
    htmBytes: htm ? setup.htmBytes : null,
  };
}

type ExistingRow = { id: number; car_folder: string; setup_path: string; sto_sha256: string; htm_sha256: string | null };

export async function planImport(userId: number, input: ImportPlanInput): Promise<ImportPlan> {
  await ensureUserSchema();
  if (!carSetupStore()) throw new CarSetupImportError('notConfigured', 'Setup file storage is not configured');
  const folders = [...new Map(input.cars.map((car) => [car.folder.toLowerCase(), car.folder])).values()];
  const cars = await resolveCarFolders(folders);
  const byFolder = new Map(cars.map((car) => [car.folder.toLowerCase(), car]));
  const existing = folders.length
    ? await query<ExistingRow>(
        `SELECT id, car_folder, setup_path, sto_sha256, htm_sha256 FROM racingcoach."CarSetups"
         WHERE simulator = 'iracing' AND lower(car_folder) = ANY($1::text[])`,
        [folders.map((f) => f.toLowerCase())]
      )
    : [];
  const existingBy = new Map(existing.map((row) => [`${row.car_folder.toLowerCase()}/${row.setup_path.toLowerCase()}`, row]));

  const setups: PlannedSetup[] = [];
  const seen = new Set<string>();
  let stoFiles = 0;
  let htmFiles = 0;
  for (const car of input.cars) {
    const resolution = byFolder.get(car.folder.toLowerCase())!;
    for (const setup of car.setups) {
      const id = `${car.folder.toLowerCase()}/${setup.path.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      stoFiles++;
      if (setup.htmSha256) htmFiles++;
      const row = existingBy.get(id) ?? null;
      const decision = resolution.resolved
        ? importDecision(row && { stoSha256: row.sto_sha256, htmSha256: row.htm_sha256 }, { stoSha256: setup.stoSha256, htmSha256: setup.htmSha256 })
        : 'unresolvedCar';
      setups.push({ folder: car.folder, path: setup.path, decision, setupId: row?.id ?? null });
    }
  }
  const unchanged = setups.filter((s) => s.decision === 'unchanged');
  const unresolved = cars.filter((car) => !car.resolved);
  const [{ id: importId }] = await query<{ id: number }>(
    `INSERT INTO racingcoach."CarSetupImports"
       (started_by_user_id, collector_version, car_folders, setups_found, sto_files, htm_files, unchanged_count, unresolved, errors)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      input.collectorVersion?.slice(0, 40) ?? null,
      folders,
      setups.length,
      stoFiles,
      htmFiles,
      unchanged.length,
      JSON.stringify(unresolved),
      JSON.stringify(input.unreadable.slice(0, CAR_SETUP_LIMITS.errorsPerImport).map((u) => ({ path: errorText(u.path), error: errorText(u.error) }))),
    ]
  );
  if (unchanged.length) {
    await query(`UPDATE racingcoach."CarSetups" SET last_seen_at = now(), last_import_id = $2 WHERE id = ANY($1::int[])`, [
      unchanged.map((s) => s.setupId),
      importId,
    ]);
  }
  console.log(
    `Car setup import ${importId} planned by user ${userId}: ${setups.length} setups in ${folders.length} folders, ` +
      `${setups.filter((s) => s.decision === 'new').length} new, ${setups.filter((s) => s.decision === 'changed').length} changed, ` +
      `${unchanged.length} unchanged, ${unresolved.length} unresolved folders`
  );
  return { importId, cars, setups };
}

// ---------------------------------------------------------------------------------------------------------------
// Storing one setup

export type StoredSetupResult = {
  setupId: number;
  decision: ImportDecision;
  version: number;
  htmStatus: ParsedSetupHtm['status'] | 'missing';
  written: { sto: boolean; htm: boolean };
};

type ImportRow = { id: number; started_by_user_id: number | null; status: string };

async function openImport(importId: number, userId: number): Promise<ImportRow> {
  const [row] = await query<ImportRow>('SELECT id, started_by_user_id, status FROM racingcoach."CarSetupImports" WHERE id = $1', [importId]);
  if (!row || row.started_by_user_id !== userId) throw new CarSetupImportError('importNotFound', 'No such import');
  if (row.status !== 'running') throw new CarSetupImportError('importClosed', 'The import has finished');
  return row;
}

export async function storeSetup(
  userId: number,
  importId: number,
  listed: { folder: string } & ListedSetup,
  sto: Buffer,
  htm: Buffer | null
): Promise<StoredSetupResult> {
  await ensureUserSchema();
  const store = carSetupStore();
  if (!store) throw new CarSetupImportError('notConfigured', 'Setup file storage is not configured');
  await openImport(importId, userId);
  const folder = cleanCarFolder(listed.folder);
  const setup = cleanListedSetup(listed);
  if (!folder || !setup) throw new CarSetupImportError('badRequest', 'The setup’s folder, path, file names or hashes are invalid');
  if ((htm === null) !== (setup.htmSha256 === null)) throw new CarSetupImportError('badRequest', 'The .htm file and its listing don’t match');
  if (sto.length > CAR_SETUP_LIMITS.stoBytes || (htm && htm.length > CAR_SETUP_LIMITS.htmBytes)) throw new CarSetupImportError('tooLarge', 'A file is too large');
  // The bytes received are what was listed, so the catalog's hashes are the files' own
  if (sha256Hex(sto) !== setup.stoSha256 || sto.length !== setup.stoBytes) throw new CarSetupImportError('hashMismatch', 'The .sto file doesn’t match its hash');
  if (htm && (sha256Hex(htm) !== setup.htmSha256 || htm.length !== setup.htmBytes)) throw new CarSetupImportError('hashMismatch', 'The .htm file doesn’t match its hash');
  // Its container is checked (stoFile.ts); a file that isn't a setup file at all is refused, one of a layout not seen
  // before is kept as it is
  const stoInfo = readStoFile(sto);
  if (stoInfo.status === 'failed') throw new CarSetupImportError('notSto', `Not an iRacing setup file: ${stoInfo.problem ?? 'unreadable'}`);
  if (htm && !looksLikeText(htm)) throw new CarSetupImportError('notHtm', 'The .htm file isn’t text');
  const parsed = htm ? parseSetupHtm(htm) : null;
  const [car] = await resolveCarFolders([folder]);
  if (!car.resolved) throw new CarSetupImportError('unresolvedCar', `The ${folder} folder isn’t a Car Data car (${car.reason})`);

  const stoKey = carSetupObjectKey(folder, setup.stoSha256, 'sto');
  const htmKey = htm ? carSetupObjectKey(folder, setup.htmSha256!, 'htm') : null;
  const written = { sto: false, htm: false };
  try {
    written.sto = await putChecked(store, stoKey, sto, setup.stoSha256, 'sto');
    if (htm && htmKey) written.htm = await putChecked(store, htmKey, htm, setup.htmSha256!, 'htm');
  } catch (error) {
    throw new CarSetupImportError('storageFailed', `Couldn’t store the files: ${error instanceof Error ? error.message : String(error)}`);
  }

  const htmStatus = parsed ? parsed.status : 'missing';
  const importStatus = !parsed || parsed.status === 'parsed' ? (stoInfo.status === 'partial' ? 'complete' : 'completeWithWarnings') : 'completeWithWarnings';
  const setupName = setup.path.split('/').pop()!;
  const result = await transaction(async (client) => {
    const { rows } = await client.query<{ id: number; version: number; sto_sha256: string; htm_sha256: string | null }>(
      `SELECT id, version, sto_sha256, htm_sha256 FROM racingcoach."CarSetups"
       WHERE simulator = 'iracing' AND lower(car_folder) = lower($1) AND lower(setup_path) = lower($2) FOR UPDATE`,
      [folder, setup.path]
    );
    const existing = rows[0] ?? null;
    const decision = importDecision(existing && { stoSha256: existing.sto_sha256, htmSha256: existing.htm_sha256 }, setup);
    const values = [
      folder,
      setup.path,
      setupName,
      car.carId,
      car.carName,
      store.provider,
      store.bucket,
      setup.stoFileName,
      stoKey,
      setup.stoSha256,
      sto.length,
      JSON.stringify(stoInfo),
      setup.htmFileName,
      htmKey,
      setup.htmSha256,
      htm ? htm.length : null,
      htmStatus,
      parsed ? JSON.stringify(parsed) : null,
      importStatus,
      userId,
      importId,
    ];
    let setupId: number;
    let version: number;
    if (!existing) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO racingcoach."CarSetups"
           (simulator, car_folder, setup_path, setup_name, car_id, car_name, storage_provider, storage_bucket,
            sto_file_name, sto_key, sto_sha256, sto_bytes, sto_info, htm_file_name, htm_key, htm_sha256, htm_bytes,
            htm_parse_status, htm_parsed, import_status, imported_by_user_id, last_import_id)
         VALUES ('iracing', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING id`,
        values
      );
      setupId = inserted.rows[0].id;
      version = 1;
    } else if (decision === 'changed') {
      // The same setup re-saved: the row points at the new files (the old objects are queued by the trigger)
      await client.query(
        `UPDATE racingcoach."CarSetups" SET
           car_folder = $1, setup_path = $2, setup_name = $3, car_id = $4, car_name = $5, storage_provider = $6,
           storage_bucket = $7, sto_file_name = $8, sto_key = $9, sto_sha256 = $10, sto_bytes = $11, sto_info = $12,
           htm_file_name = $13, htm_key = $14, htm_sha256 = $15, htm_bytes = $16, htm_parse_status = $17,
           htm_parsed = $18, import_status = $19, imported_by_user_id = $20, last_import_id = $21,
           version = version + 1, updated_at = now(), last_seen_at = now()
         WHERE id = $22`,
        [...values, existing.id]
      );
      setupId = existing.id;
      version = existing.version + 1;
    } else {
      await client.query('UPDATE racingcoach."CarSetups" SET last_seen_at = now(), last_import_id = $2 WHERE id = $1', [existing.id, importId]);
      setupId = existing.id;
      version = existing.version;
    }
    // The objects are this row's now
    await client.query(
      `DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1 AND storage_key = ANY($2::text[]) AND reason = 'pending'`,
      [store.bucket, [stoKey, ...(htmKey ? [htmKey] : [])]]
    );
    const column = decision === 'new' ? 'new_count' : decision === 'changed' ? 'changed_count' : 'unchanged_count';
    await client.query(`UPDATE racingcoach."CarSetupImports" SET ${column} = ${column} + 1 WHERE id = $1`, [importId]);
    return { setupId, decision, version };
  });
  console.log(
    `Car setup import ${importId}: ${folder}/${setup.path} ${result.decision} (setup ${result.setupId} v${result.version}, ` +
      `.sto ${written.sto ? 'stored' : 'already stored'}, .htm ${htm ? (written.htm ? 'stored' : 'already stored') : 'none'}, parse ${htmStatus})`
  );
  return { ...result, htmStatus, written };
}

export async function finishImport(userId: number, importId: number, failures: { path: string; error: string }[]) {
  await ensureUserSchema();
  await openImport(importId, userId);
  const errors = failures.slice(0, CAR_SETUP_LIMITS.errorsPerImport).map((f) => ({ path: errorText(f.path), error: errorText(f.error) }));
  const [row] = await query<{ new_count: number; changed_count: number; unchanged_count: number; failed_count: number; status: string }>(
    `UPDATE racingcoach."CarSetupImports"
     SET errors = errors || $2::jsonb, finished_at = now(),
         -- The files the collector couldn't read came with the plan; these are the ones that failed since
         failed_count = jsonb_array_length(errors || $2::jsonb),
         status = CASE WHEN jsonb_array_length(errors || $2::jsonb) > 0 THEN 'completeWithErrors' ELSE 'complete' END
     WHERE id = $1
     RETURNING new_count, changed_count, unchanged_count, failed_count, status`,
    [importId, JSON.stringify(errors)]
  );
  console.log(`Car setup import ${importId} finished: ${JSON.stringify(row)}`);
  return { newCount: row.new_count, changedCount: row.changed_count, unchangedCount: row.unchanged_count, failedCount: row.failed_count, status: row.status };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the library (the Setups page's iRacing Setups tab)

export type LibraryCar = { carId: number | null; carName: string; carFolder: string; setups: number; updatedAt: string };

export async function listLibraryCars(): Promise<LibraryCar[]> {
  await ensureUserSchema();
  const rows = await query<{ car_id: number | null; car_name: string | null; car_folder: string; setups: string; updated_at: Date }>(
    `SELECT s.car_id, COALESCE(c.car_name, max(s.car_name)) AS car_name, s.car_folder, count(*) AS setups, max(s.updated_at) AS updated_at
     FROM racingcoach."CarSetups" s LEFT JOIN racingcoach."Cars" c ON c.id = s.car_id
     GROUP BY s.car_id, c.car_name, s.car_folder ORDER BY 2`
  );
  return rows.map((r) => ({
    carId: r.car_id,
    carName: r.car_name ?? r.car_folder,
    carFolder: r.car_folder,
    setups: Number(r.setups),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export type LibrarySetup = {
  id: number;
  carId: number | null;
  carName: string | null;
  carFolder: string;
  setupPath: string;
  setupName: string;
  provenance: CarSetupProvenance;
  stoFileName: string;
  stoSha256: string;
  stoBytes: number;
  htmFileName: string | null;
  htmSha256: string | null;
  htmBytes: number | null;
  htmParseStatus: string;
  version: number;
  importStatus: string;
  importedAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

type SetupRow = {
  id: number;
  car_id: number | null;
  car_name: string | null;
  car_folder: string;
  setup_path: string;
  setup_name: string;
  provenance: CarSetupProvenance;
  sto_file_name: string;
  sto_sha256: string;
  sto_bytes: number;
  htm_file_name: string | null;
  htm_sha256: string | null;
  htm_bytes: number | null;
  htm_parse_status: string;
  version: number;
  import_status: string;
  imported_at: Date;
  updated_at: Date;
  last_seen_at: Date;
};

const SETUP_COLUMNS = `id, car_id, car_name, car_folder, setup_path, setup_name, provenance, sto_file_name, sto_sha256, sto_bytes,
  htm_file_name, htm_sha256, htm_bytes, htm_parse_status, version, import_status, imported_at, updated_at, last_seen_at`;

const toSetup = (r: SetupRow): LibrarySetup => ({
  id: r.id,
  carId: r.car_id,
  carName: r.car_name,
  carFolder: r.car_folder,
  setupPath: r.setup_path,
  setupName: r.setup_name,
  provenance: r.provenance,
  stoFileName: r.sto_file_name,
  stoSha256: r.sto_sha256,
  stoBytes: r.sto_bytes,
  htmFileName: r.htm_file_name,
  htmSha256: r.htm_sha256,
  htmBytes: r.htm_bytes,
  htmParseStatus: r.htm_parse_status,
  version: r.version,
  importStatus: r.import_status,
  importedAt: r.imported_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  lastSeenAt: r.last_seen_at.toISOString(),
});

export async function listCarSetups(carFolder: string): Promise<LibrarySetup[]> {
  await ensureUserSchema();
  const rows = await query<SetupRow>(
    `SELECT ${SETUP_COLUMNS} FROM racingcoach."CarSetups" WHERE lower(car_folder) = lower($1) ORDER BY lower(setup_path)`,
    [carFolder]
  );
  return rows.map(toSetup);
}

export async function readCarSetup(id: number): Promise<(LibrarySetup & { parsed: ParsedSetupHtm | null; stoNotes: string | null }) | null> {
  await ensureUserSchema();
  const [row] = await query<SetupRow & { htm_parsed: ParsedSetupHtm | null; sto_info: { notes?: string | null } | null }>(
    `SELECT ${SETUP_COLUMNS}, htm_parsed, sto_info FROM racingcoach."CarSetups" WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return { ...toSetup(row), parsed: row.htm_parsed, stoNotes: row.sto_info?.notes ?? null };
}

// A setup's original file, byte for byte, checked against the hash it was imported with
export async function readCarSetupFile(id: number, kind: CarSetupFileKind): Promise<{ bytes: Buffer; fileName: string } | null> {
  await ensureUserSchema();
  const [row] = await query<{ storage_provider: string; sto_key: string; sto_sha256: string; sto_file_name: string; htm_key: string | null; htm_sha256: string | null; htm_file_name: string | null }>(
    'SELECT storage_provider, sto_key, sto_sha256, sto_file_name, htm_key, htm_sha256, htm_file_name FROM racingcoach."CarSetups" WHERE id = $1',
    [id]
  );
  const key = kind === 'sto' ? row?.sto_key : row?.htm_key;
  const sha = kind === 'sto' ? row?.sto_sha256 : row?.htm_sha256;
  const fileName = kind === 'sto' ? row?.sto_file_name : row?.htm_file_name;
  if (!row || !key || !sha || !fileName) return null;
  const store = carSetupStore();
  if (!store || store.provider !== row.storage_provider) throw new CarSetupImportError('notConfigured', 'Setup file storage is not configured');
  const bytes = await store.getObject(key, CAR_SETUP_LIMITS[kind === 'sto' ? 'stoBytes' : 'htmBytes']);
  if (!bytes) return null;
  if (sha256Hex(bytes) !== sha) throw new Error(`Car setup ${id}'s ${kind} object doesn't match its hash`);
  return { bytes, fileName };
}

export async function setCarSetupProvenance(id: number, provenance: unknown): Promise<boolean> {
  if (!isProvenance(provenance)) return false;
  await ensureUserSchema();
  const rows = await query('UPDATE racingcoach."CarSetups" SET provenance = $2 WHERE id = $1 RETURNING id', [id, provenance]);
  return rows.length > 0;
}

export type LibraryImport = {
  id: number;
  status: string;
  carFolders: string[];
  setupsFound: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  failedCount: number;
  unresolved: CarResolution[];
  errors: { path: string; error: string }[];
  startedAt: string;
  finishedAt: string | null;
};

export async function listImports(limit = 10): Promise<LibraryImport[]> {
  await ensureUserSchema();
  const rows = await query<{
    id: number;
    status: string;
    car_folders: string[];
    setups_found: number;
    new_count: number;
    changed_count: number;
    unchanged_count: number;
    failed_count: number;
    unresolved: CarResolution[];
    errors: { path: string; error: string }[];
    started_at: Date;
    finished_at: Date | null;
  }>(`SELECT * FROM racingcoach."CarSetupImports" ORDER BY started_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    carFolders: r.car_folders,
    setupsFound: r.setups_found,
    newCount: r.new_count,
    changedCount: r.changed_count,
    unchangedCount: r.unchanged_count,
    failedCount: r.failed_count,
    unresolved: r.unresolved,
    errors: r.errors,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  }));
}
