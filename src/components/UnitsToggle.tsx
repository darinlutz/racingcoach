'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { Units } from '@/lib/units';

// How long "Saved" shows after a change
const SAVED_MS = 3000;

// The Standard / Metric radio buttons in User Preferences on the Account page. The choice is saved to the
// user's account (racingcoach."Users".units) and a cookie, then the page reloads its data in the new units;
// a failed save puts the old choice back.
export default function UnitsToggle() {
  const { t } = useLanguage();
  const router = useRouter();
  const current = useUnits();
  const [units, setUnits] = useState<Units>(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (value: Units) => {
    if (value === units || saving) return;
    const previous = units;
    setUnits(value);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: value }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
      // So the root layout's UnitsProvider has the new units too
      router.refresh();
    } catch {
      setUnits(previous);
      setError(t.preferences.unitsFailed);
    } finally {
      setSaving(false);
    }
  };

  const options: { value: Units; label: string; hint: string }[] = [
    { value: 'standard', label: t.preferences.standard, hint: t.preferences.standardHint },
    { value: 'metric', label: t.preferences.metric, hint: t.preferences.metricHint },
  ];

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-foreground mb-2">{t.preferences.units}</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground">
            <input
              type="radio"
              name="preferredUnits"
              value={option.value}
              checked={units === option.value}
              onChange={() => void change(option.value)}
              disabled={saving}
              data-track={`units-${option.value}`}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
            />
            <span className="font-semibold">{option.label}</span>
            <span className="text-muted-foreground">({option.hint})</span>
          </label>
        ))}
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </fieldset>
  );
}
