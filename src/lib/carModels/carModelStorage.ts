import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { deleteVideoObject, readObjectStream, uploadObjectBytes, videoStorageConfigured } from '../objectStorage';
import { isLiveServer } from '../serverEnvironment';

// Where the 3D car models' GLB files live (docs/car-models.md): the existing RacingCoach R2 bucket the Broadcast Video
// Library, Engine Sounds and privacy exports already use (objectStorage.ts, BROADCAST_VIDEO_S3_*), under car-models/.
// Its credentials stay on the server: browsers only ever get the file through /api/car-models/[id]/file, after its
// access check, so the bucket needs no CORS rule for them and no URL to it reaches a page.
//
// For local development without R2, CAR_MODEL_DEV_STORAGE_DIR (a folder on this computer) stands in; never on the live
// server. Tests set their own store with setCarModelStoreForTests.

export type CarModelStore = {
  put(key: string, bytes: Buffer): Promise<void>;
  stream(key: string): Promise<{ body: ReadableStream; size: number | null }>;
  remove(key: string): Promise<void>;
};

const CONTENT_TYPE = 'model/gltf-binary';

const r2Store: CarModelStore = {
  put: (key, bytes) => uploadObjectBytes(key, bytes, CONTENT_TYPE),
  stream: (key) => readObjectStream(key),
  remove: (key) => deleteVideoObject(key),
};

function diskStore(dir: string): CarModelStore {
  const file = (key: string) => {
    const resolved = path.resolve(dir, key);
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) throw new Error('Bad car model key');
    return resolved;
  };
  return {
    async put(key, bytes) {
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), bytes);
    },
    async stream(key) {
      const bytes = await fs.readFile(file(key));
      return { body: Readable.toWeb(Readable.from(bytes)) as ReadableStream, size: bytes.length };
    },
    async remove(key) {
      await fs.rm(file(key), { force: true });
    },
  };
}

export function memoryCarModelStore(): CarModelStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
    },
    async stream(key) {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } });
      return { body: Readable.toWeb(Readable.from(bytes)) as ReadableStream, size: bytes.length };
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

let testStore: CarModelStore | null = null;
export const setCarModelStoreForTests = (store: CarModelStore | null) => {
  testStore = store;
};

const devDir = () => {
  const dir = process.env.CAR_MODEL_DEV_STORAGE_DIR?.trim();
  return dir && !isLiveServer() ? dir : null;
};

export function carModelStore(): CarModelStore | null {
  if (testStore) return testStore;
  if (videoStorageConfigured()) return r2Store;
  const dir = devDir();
  return dir ? diskStore(dir) : null;
}

export const carModelStorageConfigured = () => carModelStore() !== null;

// Content-addressed by car: the same file uploaded twice for a car is one object (and refused as a duplicate), and
// an object never changes once written
export const carModelKey = (carId: number, sha256: string) => `car-models/${carId}/${sha256}.glb`;
export { CONTENT_TYPE as CAR_MODEL_CONTENT_TYPE };
