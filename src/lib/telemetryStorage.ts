import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createS3Client, type S3Config } from './s3Client';
import { LAP_COMPRESSION, LAP_CONTENT_TYPE, parseStorageMode, sha256Hex, STORAGE_PROVIDERS, type TelemetryStorageMode } from './telemetryStorageRules';

// The lap telemetry store (docs/telemetry-storage.md): a private S3-compatible bucket (Cloudflare R2) of its own, with
// its own least-privilege token, separate from the Broadcast Video Library's. Only the web server talks to it: no
// browser or collector ever gets its credentials or a URL to it, so every read goes through the site's own
// authorization (LapViewer in collectorLaps.ts) first.
//
// Configured by TELEMETRY_S3_ENDPOINT, TELEMETRY_S3_BUCKET, TELEMETRY_S3_ACCESS_KEY_ID, TELEMETRY_S3_SECRET_ACCESS_KEY,
// TELEMETRY_S3_REGION (default auto). TELEMETRY_STORAGE_MODE=r2 writes new laps there; without it laps stay in
// Postgres. Tuning: TELEMETRY_STORAGE_TIMEOUT_MS (each request, default 15000), TELEMETRY_STORAGE_MAX_ATTEMPTS (the
// SDK's retries with backoff, default 4), TELEMETRY_STORAGE_CONCURRENCY (requests at once per server, default 8),
// TELEMETRY_CACHE_MB (objects kept in memory, default 100; 0 turns the cache off).

// What any telemetry store does. The S3 one is the only real one; tests use memoryTelemetryStore.
export interface TelemetryObjectStore {
  readonly provider: string;
  readonly bucket: string;
  putObject(key: string, body: Buffer, options: { contentType: string; metadata: Record<string, string> }): Promise<void>;
  // null when there's no such object; throws ObjectTooLargeError past maxBytes without reading the rest
  getObject(key: string, maxBytes: number): Promise<Buffer | null>;
  headObject(key: string): Promise<{ size: number; metadata: Record<string, string> } | null>;
  // Deleting an object that isn't there succeeds
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string, continuationToken?: string): Promise<{ objects: { key: string; size: number }[]; next?: string }>;
}

export class TelemetryStorageNotConfiguredError extends Error {
  constructor() {
    super('Telemetry object storage is not configured (TELEMETRY_S3_*)');
  }
}
export class ObjectTooLargeError extends Error {}
export class ChecksumMismatchError extends Error {}

const envInt = (name: string, fallback: number, min: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
};

export const telemetryStorageMode = (): TelemetryStorageMode => parseStorageMode(process.env.TELEMETRY_STORAGE_MODE);

function telemetryS3Config(): S3Config | null {
  const endpoint = process.env.TELEMETRY_S3_ENDPOINT?.trim();
  const bucket = process.env.TELEMETRY_S3_BUCKET?.trim();
  const accessKeyId = process.env.TELEMETRY_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.TELEMETRY_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.TELEMETRY_S3_REGION?.trim() || 'auto' };
}

const statusOf = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const isNotFound = (error: unknown) =>
  statusOf(error) === 404 || ['NoSuchKey', 'NotFound'].includes((error as { name?: string }).name ?? '');

class S3TelemetryStore implements TelemetryObjectStore {
  readonly provider = STORAGE_PROVIDERS.r2;
  private readonly client: S3Client;
  private readonly timeoutMs: number;

  constructor(readonly bucket: string, config: S3Config) {
    this.timeoutMs = envInt('TELEMETRY_STORAGE_TIMEOUT_MS', 15_000, 1000);
    this.client = createS3Client(config, {
      maxAttempts: envInt('TELEMETRY_STORAGE_MAX_ATTEMPTS', 4, 1),
      connectionTimeoutMs: Math.min(5000, this.timeoutMs),
      requestTimeoutMs: this.timeoutMs,
    });
  }

  // The whole call, retries included, is bounded too
  private signal = () => AbortSignal.timeout(this.timeoutMs * 3);

  async putObject(key: string, body: Buffer, options: { contentType: string; metadata: Record<string, string> }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: options.contentType,
        // The store refuses the body if it arrived different from what was sent. No Content-Encoding: with gzip there,
        // Cloudflare may decompress the object on the way out, and the size and checksum checks would fail
        ContentMD5: createHash('md5').update(body).digest('base64'),
        Metadata: options.metadata,
      }),
      { abortSignal: this.signal() }
    );
  }

  async getObject(key: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: this.signal() });
      if ((response.ContentLength ?? 0) > maxBytes) {
        (response.Body as Readable | undefined)?.destroy?.();
        throw new ObjectTooLargeError(`Object is larger than ${maxBytes} bytes`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.Body as Readable) {
        size += (chunk as Buffer).length;
        if (size > maxBytes) {
          (response.Body as Readable).destroy();
          throw new ObjectTooLargeError(`Object is larger than ${maxBytes} bytes`);
        }
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async headObject(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: this.signal() });
      return { size: head.ContentLength ?? 0, metadata: head.Metadata ?? {} };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: this.signal() });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async listObjects(prefix: string, continuationToken?: string) {
    const page = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken, MaxKeys: 1000 }),
      { abortSignal: this.signal() }
    );
    return {
      objects: (page.Contents ?? []).flatMap((item) => (item.Key ? [{ key: item.Key, size: item.Size ?? 0 }] : [])),
      next: page.IsTruncated ? page.NextContinuationToken : undefined,
    };
  }
}

// An in-memory store for tests, with failures that can be switched on per operation
export function memoryTelemetryStore(bucket = 'test-telemetry') {
  const objects = new Map<string, { body: Buffer; contentType: string; metadata: Record<string, string> }>();
  const failures: Partial<Record<'put' | 'get' | 'head' | 'delete' | 'list', number>> = {};
  const calls = { put: 0, get: 0, head: 0, delete: 0, list: 0 };
  const maybeFail = (op: keyof typeof calls) => {
    calls[op]++;
    if ((failures[op] ?? 0) > 0) {
      failures[op]!--;
      throw Object.assign(new Error(`Injected ${op} failure`), { $metadata: { httpStatusCode: 503 } });
    }
  };
  const store: TelemetryObjectStore & {
    objects: typeof objects;
    calls: typeof calls;
    failNext(op: keyof typeof calls, times?: number): void;
  } = {
    provider: STORAGE_PROVIDERS.r2,
    bucket,
    objects,
    calls,
    failNext(op, times = 1) {
      failures[op] = (failures[op] ?? 0) + times;
    },
    async putObject(key, body, options) {
      maybeFail('put');
      objects.set(key, { body: Buffer.from(body), contentType: options.contentType, metadata: { ...options.metadata } });
    },
    async getObject(key, maxBytes) {
      maybeFail('get');
      const object = objects.get(key);
      if (!object) return null;
      if (object.body.length > maxBytes) throw new ObjectTooLargeError(`Object is larger than ${maxBytes} bytes`);
      return Buffer.from(object.body);
    },
    async headObject(key) {
      maybeFail('head');
      const object = objects.get(key);
      return object ? { size: object.body.length, metadata: { ...object.metadata } } : null;
    },
    async deleteObject(key) {
      maybeFail('delete');
      objects.delete(key);
    },
    async listObjects(prefix) {
      maybeFail('list');
      return { objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length })) };
    },
  };
  return store;
}

const globalForStore = globalThis as typeof globalThis & {
  telemetryStore?: TelemetryObjectStore | null;
  telemetryStoreOverride?: TelemetryObjectStore | null;
};

// The configured store, or null when TELEMETRY_S3_* isn't set
export function telemetryStore(): TelemetryObjectStore | null {
  if (globalForStore.telemetryStoreOverride !== undefined) return globalForStore.telemetryStoreOverride;
  if (globalForStore.telemetryStore === undefined) {
    const config = telemetryS3Config();
    globalForStore.telemetryStore = config ? new S3TelemetryStore(config.bucket, config) : null;
  }
  return globalForStore.telemetryStore;
}

export const telemetryStorageConfigured = () => telemetryStore() !== null;

// Tests: use this store (null: as if unconfigured; undefined: back to the environment's)
export function setTelemetryStoreForTests(store: TelemetryObjectStore | null | undefined): void {
  globalForStore.telemetryStoreOverride = store;
  cache.clear();
  cacheBytes = 0;
}

function requireStore(bucket?: string): TelemetryObjectStore {
  const store = telemetryStore();
  if (!store) throw new TelemetryStorageNotConfiguredError();
  if (bucket !== undefined && bucket !== store.bucket) {
    throw new Error(`Lap object is in bucket ${bucket}, but the configured telemetry bucket is ${store.bucket}`);
  }
  return store;
}

// Bounded concurrency: at most N storage requests at once from this server, the rest wait their turn
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  const max = envInt('TELEMETRY_STORAGE_CONCURRENCY', 8, 1);
  if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// Objects never change once written (the checksum is in the key), so the cache can't be stale. The In-Car AI Coach
// re-reads up to 30 of a session's laps after every lap, which this keeps from going back to the store each time.
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
function cacheGet(id: string): Buffer | undefined {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
  }
  return hit;
}
function cachePut(id: string, bytes: Buffer): void {
  const limit = envInt('TELEMETRY_CACHE_MB', 100, 0) * 1024 * 1024;
  if (bytes.length > limit / 4) return;
  if (cache.has(id)) return;
  cache.set(id, bytes);
  cacheBytes += bytes.length;
  for (const [oldest, value] of cache) {
    if (cacheBytes <= limit) break;
    cache.delete(oldest);
    cacheBytes -= value.length;
  }
}

// Counters for the Admin page, kept in memory and written to "TelemetryStorageCounters" now and then by
// telemetryStorageMetrics.ts (drainStorageMetrics), so a read never waits on a write
export type StorageMetric =
  | 'put_ok'
  | 'put_fail'
  | 'get_ok'
  | 'get_fail'
  | 'get_missing'
  | 'checksum_fail'
  | 'cache_hit'
  | 'delete_ok'
  | 'delete_fail';
const pendingMetrics = new Map<StorageMetric, { count: number; bytes: number }>();
export function recordStorageMetric(metric: StorageMetric, bytes = 0): void {
  const entry = pendingMetrics.get(metric) ?? { count: 0, bytes: 0 };
  entry.count++;
  entry.bytes += bytes;
  pendingMetrics.set(metric, entry);
}
export function drainStorageMetrics(): { metric: StorageMetric; count: number; bytes: number }[] {
  const drained = [...pendingMetrics].map(([metric, value]) => ({ metric, ...value }));
  pendingMetrics.clear();
  return drained;
}

// A gzip-compressed lap CSV is at most this big (MAX_UPLOAD_BYTES in collectorLaps.ts); reads refuse anything larger
export const MAX_LAP_OBJECT_BYTES = 10 * 1024 * 1024;

export type StoredLapObject = { provider: string; bucket: string; key: string; storedBytes: number; sha256: string };

// Writes a lap's compressed CSV and checks the store has it at the right size. Throws on any failure; the caller's
// pending cleanup entry takes care of whatever may have been written.
export async function putLapObject(
  key: string,
  gzip: Buffer,
  details: { sha256?: string; csvBytes: number; userId: number; clientLapId: string; simulator: string }
): Promise<StoredLapObject> {
  const store = requireStore();
  const sha256 = details.sha256 ?? sha256Hex(gzip);
  try {
    await limited(() =>
      store.putObject(key, gzip, {
        contentType: LAP_CONTENT_TYPE,
        metadata: {
          sha256,
          'csv-bytes': String(details.csvBytes),
          'user-id': String(details.userId),
          'client-lap-id': details.clientLapId,
          simulator: details.simulator,
          compression: LAP_COMPRESSION,
        },
      })
    );
    const head = await limited(() => store.headObject(key));
    if (!head || head.size !== gzip.length) {
      throw new Error(`Stored object ${head ? `is ${head.size} bytes, expected ${gzip.length}` : 'is missing after upload'}`);
    }
    recordStorageMetric('put_ok', gzip.length);
    cachePut(`${store.bucket}/${key}`, gzip);
    return { provider: store.provider, bucket: store.bucket, key, storedBytes: gzip.length, sha256 };
  } catch (error) {
    recordStorageMetric('put_fail');
    throw error;
  }
}

// A lap's compressed CSV, or null when the object isn't there. With expectedSha256 (the row's checksum_sha256), bytes
// that don't match throw ChecksumMismatchError rather than reaching the analysis.
export async function getLapObject(bucket: string, key: string, expectedSha256?: string | null): Promise<Buffer | null> {
  const store = requireStore(bucket);
  const id = `${bucket}/${key}`;
  const hit = cacheGet(id);
  if (hit) {
    recordStorageMetric('cache_hit', hit.length);
    return hit;
  }
  let bytes: Buffer | null;
  try {
    bytes = await limited(() => store.getObject(key, MAX_LAP_OBJECT_BYTES));
  } catch (error) {
    recordStorageMetric('get_fail');
    throw error;
  }
  if (!bytes) {
    recordStorageMetric('get_missing');
    return null;
  }
  if (expectedSha256 && sha256Hex(bytes) !== expectedSha256) {
    recordStorageMetric('checksum_fail');
    throw new ChecksumMismatchError(`Checksum mismatch for ${key}`);
  }
  recordStorageMetric('get_ok', bytes.length);
  cachePut(id, bytes);
  return bytes;
}

export async function lapObjectExists(bucket: string, key: string): Promise<{ size: number; sha256: string | null } | null> {
  const store = requireStore(bucket);
  const head = await limited(() => store.headObject(key));
  return head ? { size: head.size, sha256: head.metadata.sha256 ?? null } : null;
}

export async function deleteLapObject(bucket: string, key: string): Promise<void> {
  const store = requireStore(bucket);
  try {
    await limited(() => store.deleteObject(key));
    recordStorageMetric('delete_ok');
  } catch (error) {
    recordStorageMetric('delete_fail');
    throw error;
  }
  cache.delete(`${bucket}/${key}`);
}

// Every object under a prefix, a page at a time: only for the periodic reconciliation, never a routine page
export async function* listLapObjects(prefix: string): AsyncGenerator<{ key: string; size: number }> {
  const store = requireStore();
  let token: string | undefined;
  do {
    const page = await limited(() => store.listObjects(prefix, token));
    yield* page.objects;
    token = page.next;
  } while (token);
}

// Runs fn over items with at most `concurrency` at once, keeping their order
export async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
