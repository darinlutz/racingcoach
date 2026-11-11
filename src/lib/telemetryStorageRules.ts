// Lap telemetry in object storage: the rules, with no I/O and no imports but node:crypto, so tests run them directly.
// Design, rollout and rollback are in docs/telemetry-storage.md.
//
// Each lap's gzip-compressed CSV is one object, named by the server from stable IDs, never from anything a client
// sends as a file name:
//   telemetry/{simulator}/u{userId}/{clientLapId}/{sha256 of the compressed bytes}.csv.gz
// The checksum in the name makes every object immutable: a lap re-uploaded with track positions gets a new key, the
// row moves to it in one UPDATE and the old object is queued for deletion, so a row never points at an object that's
// being overwritten, and a cache of objects by key can never be stale.
import { createHash } from 'node:crypto';

// Where a lap's CSV lives ("CollectorLaps".storage_provider): inline in csv_gzip, or in the S3-compatible store
export const STORAGE_PROVIDERS = { postgres: 'postgres', r2: 'r2' } as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[keyof typeof STORAGE_PROVIDERS];

// "CollectorLaps".storage_status: inline (csv_gzip), stored (object written and its size checked), missing (a read
// found no object, e.g. after a database restore brought back a row whose object was already deleted)
export const STORAGE_STATUS = { inline: 'inline', stored: 'stored', missing: 'missing' } as const;
export type StorageStatus = (typeof STORAGE_STATUS)[keyof typeof STORAGE_STATUS];

export const LAP_CONTENT_TYPE = 'text/csv';
export const LAP_COMPRESSION = 'gzip';
export const TELEMETRY_PREFIX = 'telemetry/';

// TELEMETRY_STORAGE_MODE: where new laps are written. Reads always follow each row's storage_provider, so both kinds
// work side by side whatever the mode. Anything but "r2" is postgres, the safe default (Phase A).
export type TelemetryStorageMode = 'postgres' | 'r2';
export function parseStorageMode(value: string | undefined): TelemetryStorageMode {
  return value?.trim().toLowerCase() === 'r2' ? 'r2' : 'postgres';
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const SIMULATOR_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// The object key for a lap. Throws on anything that isn't a stable ID, so no input can climb out of the user's prefix.
export function lapObjectKey(parts: { simulator: string; userId: number; clientLapId: string; sha256: string }): string {
  const simulator = parts.simulator.toLowerCase();
  const clientLapId = parts.clientLapId.toLowerCase();
  if (!SIMULATOR_ID.test(simulator)) throw new Error('Invalid simulator id for an object key');
  if (!Number.isSafeInteger(parts.userId) || parts.userId <= 0) throw new Error('Invalid user id for an object key');
  if (!UUID.test(clientLapId)) throw new Error('Invalid lap id for an object key');
  if (!SHA256.test(parts.sha256)) throw new Error('Invalid checksum for an object key');
  return `${TELEMETRY_PREFIX}${simulator}/u${parts.userId}/${clientLapId}/${parts.sha256}.csv.gz`;
}

// Expert Laps (src/lib/expertLaps.ts) are in the same bucket under their own prefix, by their bytes alone, as they
// belong to no user: expert-laps/{sha256 of the compressed bytes}.csv.gz. Outside telemetry/, so the reconciliation's
// listing never takes one for an orphan
export const EXPERT_LAP_PREFIX = 'expert-laps/';
export function expertLapObjectKey(sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('Invalid checksum for an object key');
  return `${EXPERT_LAP_PREFIX}${sha256}.csv.gz`;
}
export const isExpertLapObjectKey = (key: string) => /^expert-laps\/[0-9a-f]{64}\.csv\.gz$/.test(key);

// Each user's Target Lap (src/lib/targetLap.ts), also outside telemetry/: target-laps/u{userId}/{sha256}.csv.gz
export const TARGET_LAP_PREFIX = 'target-laps/';
export function targetLapObjectKey(userId: number, sha256: string): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id for an object key');
  if (!SHA256.test(sha256)) throw new Error('Invalid checksum for an object key');
  return `${TARGET_LAP_PREFIX}u${userId}/${sha256}.csv.gz`;
}
export const isTargetLapObjectKey = (key: string) => /^target-laps\/u\d+\/[0-9a-f]{64}\.csv\.gz$/.test(key);

// The prefix holding every one of a user's laps, for a reconciliation or an account's safety-net sweep
export function userObjectPrefix(simulator: string, userId: number): string {
  if (!SIMULATOR_ID.test(simulator) || !Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid prefix parts');
  return `${TELEMETRY_PREFIX}${simulator}/u${userId}/`;
}

// The parts of a lap key, or null for anything that isn't one (reconciliation skips those)
export function parseLapObjectKey(key: string): { simulator: string; userId: number; clientLapId: string; sha256: string } | null {
  const match = /^telemetry\/([a-z0-9][a-z0-9_-]{0,39})\/u(\d+)\/([0-9a-f-]{36})\/([0-9a-f]{64})\.csv\.gz$/.exec(key);
  if (!match || !UUID.test(match[3])) return null;
  return { simulator: match[1], userId: Number(match[2]), clientLapId: match[3], sha256: match[4] };
}

// Retry delay for attempt n (1-based): exponential with full jitter, capped
export function backoffMs(attempt: number, baseMs = 200, capMs = 5000, random: () => number = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

// When a failed cleanup deletion is tried again: minutes, doubling, at most a day
export function cleanupRetryDelayMs(attempts: number): number {
  return Math.min(24 * 60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, Math.min(attempts, 20)));
}

// How long an upload's pending cleanup entry waits before the sweeper may delete its object: long enough that an
// upload still in flight (object written, row not yet committed) is never caught
export const PENDING_UPLOAD_GRACE_MS = 60 * 60 * 1000;

// Cloudflare R2 list prices (USD), for the Admin page's estimate only; check them at cloudflare.com/r2/pricing
export const R2_PRICES = {
  storagePerGbMonth: 0.015,
  classAPerMillion: 4.5,
  classBPerMillion: 0.36,
  freeStorageGb: 10,
  freeClassAPerMonth: 1_000_000,
  freeClassBPerMonth: 10_000_000,
};

export function estimateMonthlyR2Cost(storedBytes: number, classAPerMonth = 0, classBPerMonth = 0): number {
  const gb = storedBytes / 1024 ** 3;
  const storage = Math.max(0, gb - R2_PRICES.freeStorageGb) * R2_PRICES.storagePerGbMonth;
  const classA = (Math.max(0, classAPerMonth - R2_PRICES.freeClassAPerMonth) / 1e6) * R2_PRICES.classAPerMillion;
  const classB = (Math.max(0, classBPerMonth - R2_PRICES.freeClassBPerMonth) / 1e6) * R2_PRICES.classBPerMillion;
  return Math.round((storage + classA + classB) * 100) / 100;
}
