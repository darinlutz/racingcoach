'use client';

import { useEffect, useState } from 'react';
import CountrySelect from '@/components/CountrySelect';
import { useLanguage } from '@/components/LanguageProvider';

// How long "Saved" shows after a change
const SAVED_MS = 3000;

// The Account page's User Preferences Country box, under Preferred Language. A change is saved right away
// (PUT /api/preferences); a failed save puts the old one back.
export default function CountryPreference({ country: initial, className }: { country: string | null; className: string }) {
  const { t } = useLanguage();
  const [country, setCountry] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (next: string | null) => {
    const previous = country;
    setCountry(next);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: next }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
    } catch {
      setCountry(previous);
      setError(t.preferences.countryFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5">
      <label htmlFor="country" className="block text-sm font-medium text-foreground mb-2">
        {t.preferences.country}
      </label>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <CountrySelect id="country" value={country} onChange={(next) => void change(next)} disabled={saving} className={className} />
        </div>
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t.preferences.countryHint}</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
