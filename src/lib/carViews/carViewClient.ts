import type { ResolvedCarAsset } from './assetRules.ts';

// The browser's copy of each car's engineering drawings (docs/car-views.md): one request per car path per page load,
// however many drawings show it, kept until the page is left (the response also lets the browser keep it five
// minutes). Only the car being looked at is ever loaded. A failed request is tried again when the car is next asked
// for, after 30 s.

export type CarAssetEntry = { state: 'loading' | 'ready' | 'error'; asset: ResolvedCarAsset | null; at: number };

const LOADING: CarAssetEntry = { state: 'loading', asset: null, at: 0 };
export const NO_CAR: CarAssetEntry = { state: 'ready', asset: null, at: 0 };
const RETRY_MS = 30_000;

const entries = new Map<string, CarAssetEntry>();
const listeners = new Set<() => void>();

export function subscribeCarAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const carAssetSnapshot = (carKey: string | null): CarAssetEntry => (carKey ? (entries.get(carKey) ?? LOADING) : NO_CAR);

function set(carKey: string, entry: CarAssetEntry) {
  entries.set(carKey, entry);
  for (const listener of listeners) listener();
}

export function loadCarAsset(carKey: string | null): void {
  if (!carKey) return;
  const current = entries.get(carKey);
  if (current && (current.state !== 'error' || Date.now() - current.at < RETRY_MS)) return;
  set(carKey, { ...LOADING, at: Date.now() });
  void fetch(`/api/car-views?carKey=${encodeURIComponent(carKey)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { asset: ResolvedCarAsset | null };
      set(carKey, { state: 'ready', asset: data.asset ?? null, at: Date.now() });
    })
    .catch((error) => {
      console.warn('Car drawing load failed:', error);
      set(carKey, { state: 'error', asset: null, at: Date.now() });
    });
}
