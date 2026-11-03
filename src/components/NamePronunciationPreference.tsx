'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// How long "Saved" shows after saving
const SAVED_MS = 3000;

// The Account page's User Preferences Name Pronunciation box, above Preferred Language: how the Race Announcers say the
// user's name (src/lib/raceAnnouncer.ts). Empty, they say the name as written, which the placeholder shows. Saved with
// its Save button (PUT /api/preferences).
export default function NamePronunciationPreference({
  namePronunciation: initial,
  userName,
  maxLength,
  className,
}: {
  namePronunciation: string;
  userName: string;
  maxLength: number;
  className: string;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namePronunciation: value }),
      });
      if (!response.ok) throw new Error();
      const { namePronunciation } = await response.json();
      setValue(namePronunciation);
      setSavedValue(namePronunciation);
      setSaved(true);
    } catch {
      setError(t.preferences.namePronunciationFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mb-5">
      <label htmlFor="namePronunciation" className="block text-sm font-medium text-foreground mb-2">
        {t.preferences.namePronunciation}
      </label>
      <div className="flex items-center gap-3">
        <input
          id="namePronunciation"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={userName}
          maxLength={maxLength}
          autoComplete="off"
          disabled={saving}
          className={`min-w-0 flex-1 ${className}`}
        />
        <button
          type="submit"
          disabled={saving || value.trim() === savedValue}
          className="shrink-0 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? t.common.saving : t.common.save}
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {saved ? <span className="font-medium text-positive">{t.common.saved}</span> : t.preferences.namePronunciationHint}
      </p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </form>
  );
}
