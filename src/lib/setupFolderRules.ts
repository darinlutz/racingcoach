import { CAR_KEY, normalizeCarKey } from './carViews/assetRules.ts';

// The iRacing setup folders the telemetry collector reports at launch (POST /api/collector/setup-folders): the names
// of the folders in Documents\iRacing\setups, which iRacing names after each car's car path ("ferrari296gt3",
// "mx5 mx52016"). The Admin page's 3D Car Models offers them as car paths to pick. Pure, no I/O.

export const SETUP_FOLDER_LIMITS = {
  // Folders taken from one report (iRacing has a few hundred cars)
  perReport: 1000,
} as const;

// The report's folder names that can be car paths, lower case, each once; anything else is left out
export function cleanSetupFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value.slice(0, SETUP_FOLDER_LIMITS.perReport)) {
    if (typeof item !== 'string') continue;
    const key = normalizeCarKey(item);
    if (CAR_KEY.test(key)) out.add(key);
  }
  return [...out].sort();
}
