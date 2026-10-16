'use client';

import { useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { LapOwner } from '@/lib/collectorLaps';

// The drivers picked: 'all' for All Drivers (including any who upload laps later), else their user IDs
export type DriverPick = 'all' | number[];

// Debrief Coach's Driver box: a dropdown of checkboxes, All Drivers first, then each driver with laps the user can
// see (the API decides which). At least one stays ticked: unticking the last driver is ignored. Unticking a driver
// while All Drivers is ticked leaves every other driver ticked.
export default function DriverMultiSelect({
  drivers,
  currentUserId,
  value,
  onChange,
}: {
  drivers: LapOwner[];
  currentUserId: number | null;
  value: DriverPick;
  onChange: (value: DriverPick) => void;
}) {
  const { t: dictionary, fmt, plural } = useLanguage();
  const t = dictionary.recordedLaps;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Closes on a click outside the box, or Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = (driver: LapOwner) =>
    driver.userId === currentUserId ? fmt(t.you, { name: driver.userName }) : driver.userName;
  const isPicked = (id: number) => value === 'all' || value.includes(id);

  const toggleAll = () => onChange(value === 'all' ? (currentUserId ? [currentUserId] : []) : 'all');
  const toggle = (id: number) => {
    const picked = value === 'all' ? drivers.map((d) => d.userId) : value;
    const next = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
    if (next.length > 0) onChange(next);
  };

  const summary =
    value === 'all'
      ? t.allDrivers
      : value.length === 1
        ? (() => {
            const driver = drivers.find((d) => d.userId === value[0]);
            return driver ? name(driver) : fmt(t.driversPicked, { n: 1 });
          })()
        : fmt(t.driversPicked, { n: value.length });

  return (
    <div className="flex items-center gap-2">
      <span id="recorded-laps-driver" className="text-sm text-muted-foreground">
        {t.driver}
      </span>
      <div ref={box} className="relative">
        <button
          type="button"
          aria-labelledby="recorded-laps-driver"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <span>{summary}</span>
          <span aria-hidden className="text-xs text-muted-foreground">▾</span>
        </button>
        {open && (
          <ul
            className="absolute left-0 z-20 mt-1 min-w-full max-h-72 overflow-y-auto py-1 bg-card border border-border rounded-lg shadow-lg"
          >
            <li>
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground whitespace-nowrap cursor-pointer hover:bg-secondary">
                <input type="checkbox" checked={value === 'all'} onChange={toggleAll} className="accent-primary" />
                {t.allDrivers}
              </label>
            </li>
            {drivers.map((driver) => (
              <li key={driver.userId}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground whitespace-nowrap cursor-pointer hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={isPicked(driver.userId)}
                    onChange={() => toggle(driver.userId)}
                    className="accent-primary"
                  />
                  {fmt(t.driverOption, { name: name(driver), laps: plural(driver.lapCount, t.lapCount) })}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
