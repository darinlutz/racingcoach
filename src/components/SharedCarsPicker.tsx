'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { carPathForName } from '@/lib/carModels/carPathByName';

// The other Car Data cars a version of a car's drawings or 3D model is shared with (CarViewAssetManager.tsx and
// CarModelAssetManager.tsx; assetRules.ts' sharedCarIds): a filtered list of checkboxes. Drivers' pages find a version
// only by its car paths, so ticking a car whose iRacing car path is known from its name (carPathByName.ts, exact names
// only) adds that path to the car paths text too; unticking leaves the paths alone, for the Admin to edit.
export const addCarPath = (carKeys: string, path: string | null): string => {
  if (!path) return carKeys;
  const keys = carKeys
    .split(/[,\n]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.some((k) => k.toLowerCase() === path) ? carKeys : [...keys, path].join(', ');
};

export default function SharedCarsPicker({
  id,
  cars,
  ownCarId,
  value,
  onChange,
}: {
  id: string;
  cars: { id: number; name: string }[];
  // The version's own car, which isn't offered
  ownCarId: number | null;
  value: number[];
  // The new selection, and the car path of a car just ticked when its name gives one
  onChange: (ids: number[], addedPath: string | null) => void;
}) {
  const { t } = useLanguage();
  const s = t.setups.carViews.admin.sharing;
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const offered = cars.filter((c) => c.id !== ownCarId && (!needle || c.name.toLowerCase().includes(needle) || value.includes(c.id)));
  const toggle = (car: { id: number; name: string }, on: boolean) =>
    onChange(on ? [...value, car.id] : value.filter((v) => v !== car.id), on ? carPathForName(car.name) : null);
  return (
    <div className="space-y-1">
      <input
        id={id}
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={s.filter}
        aria-label={s.filter}
        autoComplete="off"
        className="w-full px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:border-primary"
      />
      <ul className="max-h-40 overflow-y-auto rounded border border-border bg-card px-2 py-1 text-xs text-foreground">
        {offered.map((car) => (
          <li key={car.id}>
            <label className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={value.includes(car.id)} onChange={(e) => toggle(car, e.target.checked)} />
              <span className="truncate">{car.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{s.help}</p>
    </div>
  );
}
