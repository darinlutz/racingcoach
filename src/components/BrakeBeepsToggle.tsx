'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';

// How long "Saved" shows after a change
const SAVED_MS = 3000;

// The "Play beeps before braking" Yes / No radio buttons in User Preferences on the Account page. Saved to the
// user's account (racingcoach."Users".brake_beeps), which the telemetry collector reads with its upload key and
// takes up at the next track it loads; a failed save puts the old choice back.
export default function BrakeBeepsToggle({ brakeBeeps: initial }: { brakeBeeps: boolean }) {
  const { t } = useLanguage();
  const units = useUnits();
  const [brakeBeeps, setBrakeBeeps] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (value: boolean) => {
    if (value === brakeBeeps || saving) return;
    const previous = brakeBeeps;
    setBrakeBeeps(value);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brakeBeeps: value }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
    } catch {
      setBrakeBeeps(previous);
      setError(t.preferences.brakeBeepsFailed);
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: true, label: t.preferences.yes },
    { value: false, label: t.preferences.no },
  ];

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-foreground mb-2">{t.preferences.brakeBeeps}</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {options.map((option) => (
          <label key={option.label} className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground">
            <input
              type="radio"
              name="brakeBeeps"
              value={option.value ? 'yes' : 'no'}
              checked={brakeBeeps === option.value}
              onChange={() => void change(option.value)}
              disabled={saving}
              data-track={`brake-beeps-${option.value ? 'yes' : 'no'}`}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
            />
            <span className="font-semibold">{option.label}</span>
          </label>
        ))}
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t.preferences.brakeBeepsHint[units]}</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </fieldset>
  );
}
