'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { RACING_DISCIPLINES, type RacingDiscipline } from '@/lib/racingDisciplines';
import type { SetupSummary } from '@/lib/setupClient';
import { setupIsForCar } from '@/lib/setupCarMatch';

// The Car type and Car filter over the setup comparison's two setup pickers (SetupCompare.tsx and the engineering
// system tabs' SetupFocusComparison.tsx): seven radio buttons, Car Data's racing disciplines (Sports Car picked to
// begin with), and a Car combobox of Car Data's cars of that type the user has setups for, each with how many
// (setupCarMatch.ts). All cars leaves the pickers' setups as they are; a car limits both pickers to its setups only,
// and a setup already picked that isn't that car's is cleared from its picker.

type CarRow = { id: number; name: string; racingDiscipline: RacingDiscipline | null };

// Car Data, asked once per page
let carsPromise: Promise<CarRow[]> | null = null;
function loadCars(): Promise<CarRow[]> {
  carsPromise ??= fetch('/api/car-data')
    .then(async (res) => (res.ok ? (((await res.json()) as { cars: CarRow[] }).cars ?? []) : []))
    .catch(() => [])
    .then((cars) => {
      if (!cars.length) carsPromise = null;
      return cars;
    });
  return carsPromise;
}

export function useSetupCarFilter<S extends Pick<SetupSummary, 'id' | 'car' | 'carKey'>>(
  setups: S[],
  // Called when a car is picked, with a test of whether a setup is that car's, so the pickers can let go of setups
  // that aren't
  onCarPicked: (isForCar: (setupId: number | null | undefined) => boolean) => void
): { filtered: S[]; controls: ReactNode } {
  const { t } = useLanguage();
  const c = t.setups.compare;
  const [cars, setCars] = useState<CarRow[]>([]);
  const [type, setType] = useState<RacingDiscipline>('Sports Car');
  const [carId, setCarId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void loadCars().then((rows) => live && setCars(rows));
    return () => {
      live = false;
    };
  }, []);

  const ofType = useMemo(
    () =>
      cars
        .filter((car) => car.racingDiscipline === type)
        .map((car) => ({ ...car, setups: setups.filter((s) => setupIsForCar(s, car.name)).length }))
        // Only the cars the user has setups for
        .filter((car) => car.setups > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cars, type, setups]
  );
  const car = ofType.find((x) => x.id === carId) ?? null;
  const filtered = car ? setups.filter((s) => setupIsForCar(s, car.name)) : setups;
  const pickCar = (id: number | null) => {
    setCarId(id);
    const picked = id === null ? null : ofType.find((x) => x.id === id);
    if (!picked) return;
    const ids = new Set(setups.filter((s) => setupIsForCar(s, picked.name)).map((s) => s.id));
    onCarPicked((setupId) => typeof setupId === 'number' && ids.has(setupId));
  };

  const controls = (
    <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
      <fieldset className="min-w-0">
        <legend className="mb-1 text-base font-bold text-foreground">{c.carType}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {RACING_DISCIPLINES.map((d) => (
            <label key={d} className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <input
                type="radio"
                name="setup-car-type"
                value={d}
                checked={type === d}
                onChange={() => {
                  setType(d);
                  setCarId(null);
                }}
                className="accent-primary"
              />
              {t.cars.disciplines[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="min-w-[14rem] flex-1">
        <span className="mb-1 block text-base font-bold text-foreground">{c.car}</span>
        <select
          value={car?.id ?? ''}
          onChange={(e) => pickCar(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-medium text-foreground"
        >
          <option value="">{c.allCars}</option>
          {ofType.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.setups})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  return { filtered, controls };
}
