import { liteGlb, LITE_VERSION } from './glbLite.ts';
import type { CarModelStore } from './carModelStorage.ts';

// Lap Compare's lighter copy of a model's GLB (glbLite.ts), for /api/car-models/[id]/file?lite=1: made the first time
// it's asked for and kept in the same storage beside the original (an active, approved version's only, as those are
// never deleted; a draft's is made each time an Admin asks), so every later viewer gets it at once. Two requests for the
// same copy at once share one build. null when the file can't be rewritten: the route then sends the original.

export const liteKeyOf = (storageKey: string, version = LITE_VERSION) => storageKey.replace(/\.glb$/, `.lite${version}.glb`);
// Every lite copy a version may have, the current one's and older ones' (removed with the version)
export const liteKeysOf = (storageKey: string) => Array.from({ length: LITE_VERSION }, (_, i) => liteKeyOf(storageKey, i + 1));

const building = new Map<string, Promise<Uint8Array | null>>();

const isMissing = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 || (error as { code?: string }).code === 'ENOENT';

async function readAll(store: CarModelStore, key: string): Promise<Uint8Array> {
  const { body } = await store.stream(key);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function readLiteCarModel(store: CarModelStore, file: { storageKey: string; servable: boolean }): Promise<Uint8Array | null> {
  const key = liteKeyOf(file.storageKey);
  const pending = building.get(key);
  if (pending) return pending;
  const promise = (async () => {
    if (file.servable) {
      try {
        return await readAll(store, key);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const started = Date.now();
    const lite = await liteGlb(await readAll(store, file.storageKey));
    if (!lite) {
      console.warn(`Car model ${file.storageKey} has no lite copy: the file couldn't be rewritten`);
      return null;
    }
    console.log(
      `Car model lite copy made for ${file.storageKey}: ${lite.trianglesBefore} to ${lite.trianglesAfter} triangles (${lite.interiorTriangles} interior left out), ${lite.bytes.byteLength} bytes, ${Date.now() - started} ms`
    );
    if (file.servable) await store.put(key, Buffer.from(lite.bytes)).catch((e) => console.error(`Car model lite copy ${key} couldn't be stored:`, e));
    return lite.bytes;
  })();
  building.set(key, promise);
  promise.finally(() => building.delete(key)).catch(() => {});
  return promise;
}
