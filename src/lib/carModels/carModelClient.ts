'use client';

import { useEffect, useState } from 'react';
import type { ResolvedCarModel } from './modelRules';

// Which 3D model a page shows for a car (docs/car-models.md), asked of /api/car-models once per car per page and kept:
// by iRacing's car path when there is one, else (a dropped file, the Target Lap) by its exact name. Shared by Lap
// Compare's 3D view and the Setups page's viewer, so a car is resolved once; the file itself is then cached by the
// browser under its hashed address. A failure is retried after 30 s.

export type CarModelLookup = { carKey?: string | null; carName?: string | null };
export type CarModelState =
  | { status: 'loading' }
  | { status: 'none' } // no approved model: the generic car, labelled as such
  | { status: 'error' } // couldn't ask: the generic car, with a note
  | { status: 'ready'; model: ResolvedCarModel };

const RETRY_MS = 30_000;
const answers = new Map<string, { promise: Promise<ResolvedCarModel | null>; failedAt?: number }>();

const lookupKey = ({ carKey, carName }: CarModelLookup) =>
  carKey?.trim() ? `key:${carKey.trim().toLowerCase()}` : carName?.trim() ? `name:${carName.trim().toLowerCase()}` : '';

export function loadCarModel(lookup: CarModelLookup): Promise<ResolvedCarModel | null> {
  const key = lookupKey(lookup);
  if (!key) return Promise.resolve(null);
  const hit = answers.get(key);
  if (hit && !(hit.failedAt && Date.now() - hit.failedAt > RETRY_MS)) return hit.promise;
  const params = lookup.carKey?.trim() ? `carKey=${encodeURIComponent(lookup.carKey.trim())}` : `carName=${encodeURIComponent(lookup.carName!.trim())}`;
  const entry: { promise: Promise<ResolvedCarModel | null>; failedAt?: number } = {
    promise: fetch(`/api/car-models?${params}`).then(async (res) => {
      // Visitors aren't told about models: the generic car
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`car model ${res.status}`);
      const data = (await res.json()) as { model: ResolvedCarModel | null };
      return data.model;
    }),
  };
  entry.promise.catch(() => {
    entry.failedAt = Date.now();
  });
  answers.set(key, entry);
  return entry.promise;
}

// A car's model for a component: loading, none, error or ready. An Admin's preview passes `preview` to show a version
// whatever its status
export function useCarModel(lookup: CarModelLookup, preview?: ResolvedCarModel | null): CarModelState {
  const key = lookupKey(lookup);
  const [state, setState] = useState<{ key: string; value: CarModelState }>({ key: '', value: { status: 'loading' } });
  useEffect(() => {
    if (preview) return;
    let live = true;
    if (!key) return;
    loadCarModel(lookup).then(
      (model) => live && setState({ key, value: model ? { status: 'ready', model } : { status: 'none' } }),
      () => live && setState({ key, value: { status: 'error' } })
    );
    return () => {
      live = false;
    };
    // lookup is rebuilt each render; key is what it says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, preview]);
  if (preview) return { status: 'ready', model: preview };
  if (!key) return { status: 'none' };
  return state.key === key ? state.value : { status: 'loading' };
}
