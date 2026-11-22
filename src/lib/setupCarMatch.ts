import { IRACING_CARS } from './carPictures.ts';

// Which Car Data car a setup is for, for the Setups page's Car type and Car filter (SetupCarFilter.tsx): the car whose
// name is one of the names iRacing gives the setup's car path (IRACING_CARS), or the setup's own car name; accents,
// case and punctuation aside, never a similar name. Pure, no I/O.

export const carNameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\[legacy\]\s*/, '')
    .replace(/[^a-z0-9]+/g, '');

const pathKey = (carPath: string) => carPath.trim().toLowerCase().split(/[\\/\s]+/).filter(Boolean).join(' ');
const NAMES_BY_PATH = new Map(IRACING_CARS.map(([carPath, , ...names]) => [pathKey(carPath), names.map(carNameKey)]));

// Every name a setup's car goes by, as keys
export function setupCarKeys(setup: { car: string | null; carKey: string | null }): Set<string> {
  const keys = new Set<string>(setup.carKey ? (NAMES_BY_PATH.get(pathKey(setup.carKey)) ?? []) : []);
  if (setup.car?.trim()) keys.add(carNameKey(setup.car));
  keys.delete('');
  return keys;
}

// Whether a setup is for the Car Data car named carName
export const setupIsForCar = (setup: { car: string | null; carKey: string | null }, carName: string) => setupCarKeys(setup).has(carNameKey(carName));
