'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CarInput, UserCar } from '@/lib/carData';

type NumberField = Exclude<keyof CarInput, 'name' | 'notes'>;

// Form values are kept as typed text and converted when the car is saved
type CarDraft = { id: number | null; name: string; notes: string } & Record<NumberField, string>;

// Every numeric field in form order: label, unit, whether it is a whole number, and a placeholder
const NUMBER_FIELDS: { field: NumberField; label: string; unit: string; integer: boolean; placeholder: string }[] = [
  { field: 'powerBhp', label: 'Power', unit: 'bhp', integer: true, placeholder: '520' },
  { field: 'torqueLbFt', label: 'Torque', unit: 'lb-ft', integer: true, placeholder: '450' },
  { field: 'rpmLimit', label: 'RPM Limit', unit: 'rpm', integer: true, placeholder: '8000' },
  { field: 'displacementLiters', label: 'Displacement', unit: 'L', integer: false, placeholder: '4.0' },
  { field: 'dryWeightLbs', label: 'Dry Weight', unit: 'lbs', integer: true, placeholder: '2900' },
  { field: 'wetWeightLbs', label: 'Wet Weight With Driver', unit: 'lbs', integer: true, placeholder: '3250' },
  { field: 'lengthIn', label: 'Length', unit: 'in', integer: false, placeholder: '182.0' },
  { field: 'widthIn', label: 'Width', unit: 'in', integer: false, placeholder: '80.5' },
  { field: 'wheelbaseIn', label: 'Wheelbase', unit: 'in', integer: false, placeholder: '105.0' },
];

const asText = (value: number | null) => (value === null ? '' : String(value));

function toDraft(car: UserCar | null): CarDraft {
  const draft = { id: car?.id ?? null, name: car?.name ?? '', notes: car?.notes ?? '' } as CarDraft;
  for (const { field } of NUMBER_FIELDS) draft[field] = car ? asText(car[field]) : '';
  return draft;
}

// '' -> null; otherwise a positive number, or an error naming the field
function parseNumber(text: string, label: string, integer: boolean): number | null {
  const trimmed = text.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a positive ${integer ? 'whole number' : 'number'}`);
  }
  return value;
}

function toInput(draft: CarDraft): CarInput {
  const input = { name: draft.name, notes: draft.notes } as CarInput;
  for (const { field, label, integer } of NUMBER_FIELDS) input[field] = parseNumber(draft[field], label, integer);
  return input;
}

const stat = (value: number | null, unit = '') => (value === null ? '—' : `${value.toLocaleString('en-US')}${unit}`);

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const primaryButton =
  'px-4 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function CarDataManagement() {
  const [cars, setCars] = useState<UserCar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<CarDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/car-data')
      .then((response) => {
        if (response.status === 401) {
          setSignedOut(true);
          return { cars: [] };
        }
        return response.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCars(data.cars ?? []);
      })
      .catch(() => setMessage('Failed to load cars'))
      .finally(() => setLoaded(true));
  }, []);

  if (signedOut) {
    return (
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>{' '}
        to see and manage your cars.
      </div>
    );
  }

  const updateDraft = (changes: Partial<CarDraft>) => setDraft((d) => (d ? { ...d, ...changes } : d));

  const startEditing = (car: UserCar | null) => {
    setMessage('');
    setDraft(toDraft(car));
  };

  const saveCar = async () => {
    if (!draft) return;
    setMessage('');
    let car: CarInput;
    try {
      car = toInput(draft);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/car-data', {
        method: draft.id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.id === null ? { car } : { id: draft.id, car }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save car');
      setCars(data.cars);
      setExpanded(draft.id ?? data.id);
      setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save car');
    } finally {
      setSaving(false);
    }
  };

  const removeCar = async (car: UserCar) => {
    if (!window.confirm(`Delete ${car.name}?`)) return;
    setMessage('');
    try {
      const response = await fetch('/api/car-data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: car.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to delete car');
      setCars((prev) => prev.filter((c) => c.id !== car.id));
      if (draft?.id === car.id) setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete car');
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {message && (
        <div className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{message}</div>
      )}

      {/* Car editor */}
      {draft ? (
        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <h3 className="text-lg font-bold text-foreground">{draft.id === null ? 'Add Car' : `Edit ${draft.name || 'Car'}`}</h3>

          <div>
            <label htmlFor="car-name" className="block text-sm font-medium text-foreground mb-1">
              Car Name
            </label>
            <input
              id="car-name"
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder="e.g. Porsche 911 GT3 R (992)"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {NUMBER_FIELDS.map(({ field, label, unit, integer, placeholder }) => (
              <div key={field}>
                <label htmlFor={`car-${field}`} className="block text-sm font-medium text-foreground mb-1">
                  {label} ({unit}) <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id={`car-${field}`}
                  type="text"
                  inputMode={integer ? 'numeric' : 'decimal'}
                  value={draft[field]}
                  onChange={(e) => updateDraft({ [field]: e.target.value })}
                  placeholder={`e.g. ${placeholder}`}
                  className={`${inputClass} tabular-nums`}
                />
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="car-notes" className="block text-sm font-medium text-foreground mb-1">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="car-notes"
              rows={5}
              value={draft.notes}
              onChange={(e) => updateDraft({ notes: e.target.value })}
              placeholder="Handling traits, strengths and weaknesses, tracks it suits…"
              className={inputClass}
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => void saveCar()} disabled={saving || !draft.name.trim()} className={primaryButton}>
              {saving ? 'Saving…' : 'Save Car'}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => startEditing(null)} className={primaryButton}>
          + Add Car
        </button>
      )}

      {/* Car list */}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading your cars…</p>
      ) : cars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cars added yet.</p>
      ) : (
        <div className="overflow-x-auto bg-card border border-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary text-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Car
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Power (bhp)
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Torque (lb-ft)
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  RPM Limit
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Disp. (L)
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Wet Weight (lbs)
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {cars.map((car) => (
                <Fragment key={car.id}>
                  <tr className={draft?.id === car.id ? 'bg-accent' : undefined}>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === car.id ? null : car.id)}
                        aria-expanded={expanded === car.id}
                        className="text-left hover:text-primary"
                      >
                        <span className="inline-block w-4 text-muted-foreground">{expanded === car.id ? '▾' : '▸'}</span>
                        {car.name}
                      </button>
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.powerBhp)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.torqueLbFt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.rpmLimit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.displacementLiters)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.wetWeightLbs)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(car)}
                          className="px-3 py-1 text-sm bg-card border border-border rounded text-foreground hover:border-primary hover:text-primary transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeCar(car)}
                          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Dimensions, weights and notes for this car */}
                  {expanded === car.id && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-4 bg-secondary">
                        <table className="mt-3 w-full text-xs text-left bg-card border border-border rounded">
                          <thead className="bg-secondary text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium text-right">Length</th>
                              <th className="px-3 py-2 font-medium text-right">Width</th>
                              <th className="px-3 py-2 font-medium text-right">Wheelbase</th>
                              <th className="px-3 py-2 font-medium text-right">Dry Weight</th>
                              <th className="px-3 py-2 font-medium text-right">Wet Weight With Driver</th>
                            </tr>
                          </thead>
                          <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <tr>
                              <td className="px-3 py-1.5 text-right">{stat(car.lengthIn, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.widthIn, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.wheelbaseIn, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.dryWeightLbs, ' lbs')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.wetWeightLbs, ' lbs')}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-3 text-sm text-muted-foreground whitespace-pre-line">
                          {car.notes ?? 'No notes yet. Press Edit to add some.'}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
