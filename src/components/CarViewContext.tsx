'use client';

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { ResolvedCarAsset } from '@/lib/carViews/assetRules';
import { carAssetSnapshot, loadCarAsset, NO_CAR, subscribeCarAssets, type CarAssetEntry } from '@/lib/carViews/carViewClient';

// Which car the engineering drawings show (docs/car-views.md). The Setups page's engineering tabs compare two setups
// of one car, so the car is theirs: SetupFocusComparison and SetupCompare give their baseline setup's iRacing car path
// here, and every EngineeringCarView under them draws that car. There's no car picker of its own. The Admin page's
// preview gives a version's drawings directly (`asset`) instead.

type Selection = { carKey: string | null; asset?: ResolvedCarAsset | null };
const CarViewContext = createContext<Selection>({ carKey: null });

export function CarViewProvider({ carKey, asset, children }: Selection & { children: ReactNode }) {
  return <CarViewContext.Provider value={{ carKey: carKey ? carKey.toLowerCase() : null, asset }}>{children}</CarViewContext.Provider>;
}

const PREVIEW = (asset: ResolvedCarAsset | null): CarAssetEntry => ({ state: 'ready', asset, at: 0 });
const SERVER = () => NO_CAR;

// The car's drawings: loading (the generic car shows meanwhile), ready (its active version, or null), or error
export function useCarAsset(): CarAssetEntry {
  const { carKey, asset } = useContext(CarViewContext);
  const preview = asset !== undefined;
  useEffect(() => {
    if (!preview) loadCarAsset(carKey);
  }, [carKey, preview]);
  const entry = useSyncExternalStore(subscribeCarAssets, () => carAssetSnapshot(preview ? null : carKey), SERVER);
  return preview ? PREVIEW(asset ?? null) : entry;
}

// The Admin-only SVG debug mode: every engineering drawing under it shows its anchors. SetupsWorkspace turns it on
// only for Admins, and the Admin page's preview always
const DebugContext = createContext(false);

export function CarViewDebugProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <DebugContext.Provider value={on}>{children}</DebugContext.Provider>;
}

export const useCarViewDebug = () => useContext(DebugContext);
