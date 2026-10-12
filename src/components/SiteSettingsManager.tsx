'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Admin page's Site Settings section: the Show Pricing switch, saved for everyone
// (PUT /api/admin/settings) as soon as it's flipped.
export default function SiteSettingsManager({ showPricing: initialShowPricing }: { showPricing: boolean }) {
  const { t } = useLanguage();
  const a = t.admin;
  const router = useRouter();
  const [showPricing, setShowPricing] = useState(initialShowPricing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !showPricing;
    setShowPricing(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showPricing: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShowPricing(!next);
        setError(data.error ?? t.api.failedSaveSetting);
        return;
      }
      // The navigation bar is rendered by the layout on the server
      router.refresh();
    } catch {
      setShowPricing(!next);
      setError(t.api.failedSaveSetting);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-4">{a.settingsTitle}</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p id="show-pricing-label" className="text-foreground font-medium">{a.showPricing}</p>
          <p className="text-sm text-muted-foreground">{a.showPricingHint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showPricing}
          aria-labelledby="show-pricing-label"
          data-track="show-pricing"
          onClick={toggle}
          disabled={saving}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
            showPricing ? 'bg-primary border-primary' : 'bg-card border-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              showPricing ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {error && (
        <p role="status" className="mt-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
