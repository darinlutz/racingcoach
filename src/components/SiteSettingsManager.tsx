'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

type SettingKey = 'showPricing' | 'showProDriverLesson';

// The Admin page's Site Settings section: the Show Pricing and Show Pro Driver Lesson switches, saved for
// everyone (PUT /api/admin/settings) as soon as they're flipped.
export default function SiteSettingsManager(initial: Record<SettingKey, boolean>) {
  const { t } = useLanguage();
  const a = t.admin;
  const router = useRouter();
  const [settings, setSettings] = useState<Record<SettingKey, boolean>>({
    showPricing: initial.showPricing,
    showProDriverLesson: initial.showProDriverLesson,
  });
  const [saving, setSaving] = useState<SettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: SettingKey) => {
    const next = !settings[key];
    const set = (value: boolean) => setSettings((current) => ({ ...current, [key]: value }));
    set(next);
    setSaving(key);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        set(!next);
        setError(data.error ?? t.api.failedSaveSetting);
        return;
      }
      // The navigation bar is rendered by the layout on the server
      router.refresh();
    } catch {
      set(!next);
      setError(t.api.failedSaveSetting);
    } finally {
      setSaving(null);
    }
  };

  const rows: { key: SettingKey; id: string; label: string; hint: string }[] = [
    { key: 'showPricing', id: 'show-pricing', label: a.showPricing, hint: a.showPricingHint },
    { key: 'showProDriverLesson', id: 'show-pro-driver-lesson', label: a.showProDriverLesson, hint: a.showProDriverLessonHint },
  ];

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-4">{a.settingsTitle}</h2>
      <div className="space-y-4">
        {rows.map(({ key, id, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <p id={`${id}-label`} className="text-foreground font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings[key]}
              aria-labelledby={`${id}-label`}
              data-track={id}
              onClick={() => toggle(key)}
              disabled={saving === key}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
                settings[key] ? 'bg-primary border-primary' : 'bg-card border-border'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  settings[key] ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="status" className="mt-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
