import { IRACING_CARS } from '../carPictures.ts';

// iRacing's car path for a lap that only has the car's name (a dropped Garage 61 file, or the Target Lap, whose file
// name is all it keeps). Only an exact match against IRACING_CARS's curated list of each car path's names (the official
// name and the screen names seen in laps), accents, case and punctuation aside: never "contains" or a similar name, so
// "Lamborghini Huracán GT3" never finds the GT3 EVO's model. A name two car paths share answers null, as it can't tell
// them apart; so does a name not in the list. Pure.

const key = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\[legacy\]\s*/, '')
    .replace(/[^a-z0-9]+/g, '');

const BY_NAME = (() => {
  const paths = new Map<string, Set<string>>();
  for (const [carPath, , ...names] of IRACING_CARS) {
    for (const name of names) {
      const k = key(name);
      if (!k) continue;
      if (!paths.has(k)) paths.set(k, new Set());
      paths.get(k)!.add(carPath.trim().toLowerCase());
    }
  }
  return new Map([...paths].filter(([, set]) => set.size === 1).map(([k, set]) => [k, [...set][0]]));
})();

export function carPathForName(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_NAME.get(key(name)) ?? null;
}
