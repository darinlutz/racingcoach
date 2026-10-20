'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';

// The Subscribers page's Sync from Stripe button: imports every existing subscription and its discounts from Stripe
// (POST /api/admin/subscribers/sync, src/lib/stripeBilling.ts importStripeSubscriptions), then reloads the page.
export default function StripeSyncButton() {
  const { t } = useLanguage();
  const s = t.subscribers;
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/subscribers/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? fmt(t.common.failed, { error: t.common.unknownError }));
        return;
      }
      const { result } = data;
      setMessage(
        [fmt(s.syncDone, result), result.failed ? fmt(s.syncSomeFailed, result) : null].filter(Boolean).join(' ')
      );
      router.refresh();
    } catch {
      setError(fmt(t.common.failed, { error: t.common.unknownError }));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={sync}
        disabled={running}
        title={s.syncHint}
        className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong disabled:opacity-60 transition-colors"
      >
        {running ? s.syncing : s.syncButton}
      </button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
