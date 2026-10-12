'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { Theme } from '@/lib/theme';

// How long "Saved" shows after a change
const SAVED_MS = 3000;

// The Dark Mode / Light Mode switch in User Preferences on the Account page. The new theme shows at once
// (the <html data-theme> globals.css switches on), then is saved to the user's account
// (racingcoach."Users".theme) and a cookie; a failed save puts the old theme back.
export default function ThemeToggle({ theme: initialTheme }: { theme: Theme }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Shows the picked theme at once, without waiting for the save
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (value: Theme) => {
    if (value === theme || saving) return;
    const previous = theme;
    setTheme(value);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: value }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
      // So the root layout the router keeps has the new theme too
      router.refresh();
    } catch {
      setTheme(previous);
      setError(t.preferences.themeFailed);
    } finally {
      setSaving(false);
    }
  };

  const options: { value: Theme; label: string }[] = [
    { value: 'dark', label: t.preferences.darkMode },
    { value: 'light', label: t.preferences.lightMode },
  ];

  return (
    <div>
      <p id="themeLabel" className="block text-sm font-medium text-foreground mb-2">
        {t.preferences.theme}
      </p>
      <div className="flex items-center gap-3">
        <div role="radiogroup" aria-labelledby="themeLabel" className="inline-flex rounded-lg border border-border bg-card p-1">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              data-track={`theme-${option.value}`}
              onClick={() => void change(option.value)}
              disabled={saving}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors disabled:cursor-not-allowed ${
                theme === option.value ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
