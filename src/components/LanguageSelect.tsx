'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { isLanguage, LANGUAGE_NAMES, LANGUAGES } from '@/lib/i18n/languages';

// How long "Saved" shows after a change
const SAVED_MS = 3000;

// The Preferred Language box (sign-up form, and User Preferences on the Account page). A change is saved
// right away (the signed-in user's Preferred Language, and a cookie for visitors), then the page reloads
// from the server so every piece of text switches to the new language.
export default function LanguageSelect({ id, className }: { id: string; className: string }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (value: string) => {
    if (!isLanguage(value) || value === language) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLanguage: value }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch {
      setError(t.preferences.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-2">
        {t.preferences.preferredLanguage}
      </label>
      <div className="flex items-center gap-3">
        <select
          id={id}
          value={language}
          onChange={(e) => void change(e.target.value)}
          disabled={saving || refreshing}
          className={className}
        >
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
