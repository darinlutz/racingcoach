'use client';

import { type FocusEvent, Fragment, type MouseEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import CalibrationHelpButton from '@/components/CalibrationHelpButton';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { CarInput, UserCar } from '@/lib/carData';
import { CAR_PICTURE_HEIGHT, CAR_PICTURE_WIDTH, carPictureUrl } from '@/lib/carPictures';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import { RACING_DISCIPLINES, type RacingDiscipline } from '@/lib/racingDisciplines';
import { ROTATION_CALIBRATIONS } from '@/lib/rotationModelConfig';
import { lbFtFromTorque, SPEED_UNIT, speedFromMetersPerSecond, TORQUE_UNIT, torqueFromLbFt, type Units } from '@/lib/units';

type NumberField = Exclude<keyof CarInput, 'name' | 'racingDiscipline' | 'notes'>;

// Form values are kept as typed text and converted when the car is saved
type CarDraft = { id: number | null; name: string; racingDiscipline: RacingDiscipline | ''; notes: string } & Record<
  NumberField,
  string
>;

// Every numeric field in form order: unit, whether it is a whole number, and a placeholder (labels: dictionary cars.fields)
const NUMBER_FIELDS: { field: NumberField; unit: string; integer: boolean; placeholder: string }[] = [
  { field: 'powerBhp', unit: 'bhp', integer: true, placeholder: '520' },
  { field: 'torqueLbFt', unit: 'lb-ft', integer: true, placeholder: '450' },
  { field: 'rpmLimit', unit: 'rpm', integer: true, placeholder: '8000' },
  { field: 'displacementLiters', unit: 'L', integer: false, placeholder: '4.0' },
  { field: 'dryWeightLbs', unit: 'lbs', integer: true, placeholder: '2900' },
  { field: 'wetWeightLbs', unit: 'lbs', integer: true, placeholder: '3250' },
  { field: 'lengthIn', unit: 'in', integer: false, placeholder: '182.0' },
  { field: 'widthIn', unit: 'in', integer: false, placeholder: '80.5' },
  { field: 'wheelbaseIn', unit: 'in', integer: false, placeholder: '105.0' },
];

const asText = (value: number | null) => (value === null ? '' : String(value));

// Torque is stored in lb-ft and shown in the user's units: lb-ft, or whole Nm for Metric (a whole Nm is smaller than
// a lb-ft, so a value that isn't edited saves back unchanged)
const torqueText = (lbFt: number | null, units: Units) => (lbFt === null ? null : Math.round(torqueFromLbFt(lbFt, units)));
const fieldUnit = (field: NumberField, unit: string, units: Units) => (field === 'torqueLbFt' ? TORQUE_UNIT[units] : unit);
const fieldPlaceholder = (field: NumberField, placeholder: string, units: Units) =>
  field === 'torqueLbFt' ? String(torqueText(Number(placeholder), units)) : placeholder;

function toDraft(car: UserCar | null, units: Units): CarDraft {
  const draft = {
    id: car?.id ?? null,
    name: car?.name ?? '',
    racingDiscipline: car?.racingDiscipline ?? '',
    notes: car?.notes ?? '',
  } as CarDraft;
  for (const { field } of NUMBER_FIELDS) {
    draft[field] = !car ? '' : field === 'torqueLbFt' ? asText(torqueText(car.torqueLbFt, units)) : asText(car[field]);
  }
  return draft;
}

// '' -> null; otherwise a positive number, or an error naming the field
function parseNumber(text: string, label: string, integer: boolean, t: Dictionary['cars']): number | null {
  const trimmed = text.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(fmt(integer ? t.mustBePositiveWhole : t.mustBePositive, { label }));
  }
  return value;
}

function toInput(draft: CarDraft, t: Dictionary['cars'], units: Units): CarInput {
  const input = { name: draft.name, racingDiscipline: draft.racingDiscipline || null, notes: draft.notes } as CarInput;
  for (const { field, integer } of NUMBER_FIELDS) input[field] = parseNumber(draft[field], t.fields[field], integer, t);
  // Back to whole lb-ft, as Car Data stores it
  if (input.torqueLbFt !== null) input.torqueLbFt = Math.max(1, Math.round(lbFtFromTorque(input.torqueLbFt, units)));
  return input;
}

const stat = (value: number | null, locale: string, unit = '') => (value === null ? '—' : `${value.toLocaleString(locale)}${unit}`);

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const primaryButton =
  'px-4 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function CarDataManagement() {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.cars;
  const [cars, setCars] = useState<UserCar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<CarDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  // The car whose name is hovered (or focused), and where its picture goes. Fixed to the window, as the table's
  // scroll box would clip it; scrolling hides it
  const [picture, setPicture] = useState<{ car: UserCar; url: string; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!picture) return;
    const hide = () => setPicture(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [picture]);

  // Under the name, or above it when there's no room below; kept inside the window
  const showPicture = (car: UserCar) => (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const url = carPictureUrl(car.name);
    if (!url) return;
    const box = event.currentTarget.getBoundingClientRect();
    const below = box.bottom + 8 + CAR_PICTURE_HEIGHT <= window.innerHeight;
    setPicture({
      car,
      url,
      left: Math.max(8, Math.min(box.left, window.innerWidth - CAR_PICTURE_WIDTH - 8)),
      top: below ? box.bottom + 8 : Math.max(8, box.top - 8 - CAR_PICTURE_HEIGHT),
    });
  };
  const hidePicture = () => setPicture(null);

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
      .catch(() => setMessage(t.failedLoad))
      .finally(() => setLoaded(true));
  }, [t]);

  if (signedOut) {
    return (
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t.logIn}
        </Link>
        {t.signedOut}
      </div>
    );
  }

  const updateDraft = (changes: Partial<CarDraft>) => setDraft((d) => (d ? { ...d, ...changes } : d));

  const startEditing = (car: UserCar | null) => {
    setMessage('');
    setDraft(toDraft(car, units));
  };

  const saveCar = async () => {
    if (!draft) return;
    setMessage('');
    let car: CarInput;
    try {
      car = toInput(draft, t, units);
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
      if (!response.ok) throw new Error(data.error || t.failedSave);
      setCars(data.cars);
      setExpanded(draft.id ?? data.id);
      setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.failedSave);
    } finally {
      setSaving(false);
    }
  };

  const removeCar = async (car: UserCar) => {
    if (!window.confirm(fmt(t.deleteConfirm, { car: car.name }))) return;
    setMessage('');
    try {
      const response = await fetch('/api/car-data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: car.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.failedDelete);
      setCars((prev) => prev.filter((c) => c.id !== car.id));
      if (draft?.id === car.id) setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.failedDelete);
    }
  };

  const speed = (metersPerSecond: number) => Math.round(speedFromMetersPerSecond(metersPerSecond, units)).toLocaleString(locale);

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {/* Cars the Rotation Model has a calibration for (rotation-model/calibrations.json) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-bold text-foreground">{t.calibratedCars}</h3>
          <CalibrationHelpButton />
        </div>
        {ROTATION_CALIBRATIONS.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noCalibratedCars}</p>
        ) : (
          <div className="overflow-x-auto bg-card border border-border rounded-lg">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary text-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t.car}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t.calibrationVersion}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">
                    {fmt(t.validSpeeds, { unit: SPEED_UNIT[units] })}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t.calibrationSource}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground">
                {ROTATION_CALIBRATIONS.map((calibration) => (
                  <tr key={calibration.calibrationId}>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                      {calibration.carNames.join(', ') || calibration.carId}
                    </th>
                    <td className="px-4 py-3 tabular-nums">{calibration.calibrationVersion}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {calibration.validSpeedRangeMps
                        ? `${speed(calibration.validSpeedRangeMps[0])}–${speed(calibration.validSpeedRangeMps[1])}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{calibration.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{message}</div>
      )}

      {/* Car editor */}
      {draft ? (
        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <h3 className="text-lg font-bold text-foreground">{draft.id === null ? t.addCar : fmt(t.editCar, { car: draft.name || t.car })}</h3>

          <div>
            <label htmlFor="car-name" className="block text-sm font-medium text-foreground mb-1">
              {t.carName}
            </label>
            <input
              id="car-name"
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder={t.carNamePlaceholder}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="car-discipline" className="block text-sm font-medium text-foreground mb-1">
              {t.racingDiscipline} <span className="font-normal text-muted-foreground">{dictionary.common.optional}</span>
            </label>
            <select
              id="car-discipline"
              value={draft.racingDiscipline}
              onChange={(e) => updateDraft({ racingDiscipline: e.target.value as RacingDiscipline | '' })}
              className={inputClass}
            >
              <option value="">{t.noDiscipline}</option>
              {RACING_DISCIPLINES.map((discipline) => (
                <option key={discipline} value={discipline}>
                  {t.disciplines[discipline]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {NUMBER_FIELDS.map(({ field, unit, integer, placeholder }) => (
              <div key={field}>
                <label htmlFor={`car-${field}`} className="block text-sm font-medium text-foreground mb-1">
                  {fmt(t.fieldLabel, { label: t.fields[field], unit: fieldUnit(field, unit, units) })}{' '}
                  <span className="font-normal text-muted-foreground">{dictionary.common.optional}</span>
                </label>
                <input
                  id={`car-${field}`}
                  type="text"
                  inputMode={integer ? 'numeric' : 'decimal'}
                  value={draft[field]}
                  onChange={(e) => updateDraft({ [field]: e.target.value })}
                  placeholder={fmt(t.example, { value: fieldPlaceholder(field, placeholder, units) })}
                  className={`${inputClass} tabular-nums`}
                />
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="car-notes" className="block text-sm font-medium text-foreground mb-1">
              {t.notes} <span className="font-normal text-muted-foreground">{dictionary.common.optional}</span>
            </label>
            <textarea
              id="car-notes"
              rows={5}
              value={draft.notes}
              onChange={(e) => updateDraft({ notes: e.target.value })}
              placeholder={t.notesPlaceholder}
              className={inputClass}
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => void saveCar()} disabled={saving || !draft.name.trim()} className={primaryButton}>
              {saving ? dictionary.common.saving : t.saveCar}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className={secondaryButton}>
              {dictionary.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => startEditing(null)} className={primaryButton}>
          {t.addCarButton}
        </button>
      )}

      {/* Car list */}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : cars.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="overflow-x-auto bg-card border border-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary text-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t.car}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t.racingDiscipline}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t.powerBhp}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {fmt(t.torqueLbFt, { unit: TORQUE_UNIT[units] })}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t.rpmLimit}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t.displacement}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t.wetWeight}
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {cars.map((car) => (
                <Fragment key={car.id}>
                  <tr className={draft?.id === car.id ? 'bg-accent' : undefined}>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === car.id ? null : car.id)}
                        onMouseEnter={showPicture(car)}
                        onMouseLeave={hidePicture}
                        onFocus={showPicture(car)}
                        onBlur={hidePicture}
                        aria-expanded={expanded === car.id}
                        className="text-left hover:text-primary"
                      >
                        <span className="inline-block w-4 text-muted-foreground">{expanded === car.id ? '▾' : '▸'}</span>
                        {car.name}
                      </button>
                    </th>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {car.racingDiscipline ? t.disciplines[car.racingDiscipline] : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.powerBhp, locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(torqueText(car.torqueLbFt, units), locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.rpmLimit, locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.displacementLiters, locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{stat(car.wetWeightLbs, locale)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(car)}
                          className="px-3 py-1 text-sm bg-card border border-border rounded text-foreground hover:border-primary hover:text-primary transition-colors"
                        >
                          {dictionary.common.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeCar(car)}
                          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        >
                          {dictionary.common.delete}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Dimensions, weights and notes for this car */}
                  {expanded === car.id && (
                    <tr>
                      <td colSpan={8} className="px-4 pb-4 bg-secondary">
                        <table className="mt-3 w-full text-xs text-left bg-card border border-border rounded">
                          <thead className="bg-secondary text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium text-right">{t.fields.lengthIn}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.fields.widthIn}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.fields.wheelbaseIn}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.fields.dryWeightLbs}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.fields.wetWeightLbs}</th>
                            </tr>
                          </thead>
                          <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <tr>
                              <td className="px-3 py-1.5 text-right">{stat(car.lengthIn, locale, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.widthIn, locale, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.wheelbaseIn, locale, ' in')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.dryWeightLbs, locale, ' lbs')}</td>
                              <td className="px-3 py-1.5 text-right">{stat(car.wetWeightLbs, locale, ' lbs')}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-3 text-sm text-muted-foreground whitespace-pre-line">
                          {car.notes ?? t.noNotes}
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

      {picture && (
        <div className="fixed z-50 pointer-events-none" style={{ left: picture.left, top: picture.top }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picture.url}
            alt={picture.car.name}
            width={CAR_PICTURE_WIDTH}
            height={CAR_PICTURE_HEIGHT}
            className="rounded-lg border border-border bg-card shadow-xl object-cover"
            style={{ width: CAR_PICTURE_WIDTH, height: CAR_PICTURE_HEIGHT }}
          />
        </div>
      )}
    </div>
  );
}
