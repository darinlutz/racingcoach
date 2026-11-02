'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';
import { usePrivacyReauth } from '@/components/PrivacyReauthProvider';
import ReauthForm from '@/components/ReauthForm';
import { ERASABLE_CATEGORIES, needsReview, type ErasableCategory } from '@/lib/privacyRules';

// Privacy & Data Rights' Request Data Deletion (Article 17, keeping the account): the categories to delete, each with
// how much of it there is; reviewed ones are marked. Needs "Confirm it's you", then a confirmation
// (POST /api/account/privacy/requests { type: 'erasure', categories })
export default function RequestDataDeletion({ counts }: { counts: Record<string, number> }) {
  const { t: dictionary, plural } = useLanguage();
  const t = dictionary.privacyRights;
  const { confirmed, setConfirmed } = usePrivacyReauth();
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<ErasableCategory>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);

  const toggle = (category: ErasableCategory) => {
    const next = new Set(chosen);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    setChosen(next);
  };

  const start = () => {
    setError('');
    setMessage('');
    if (chosen.size === 0) {
      setError(t.erase.nothingChosen);
      return;
    }
    if (!confirmed) {
      setNeedsReauth(true);
      return;
    }
    setConfirming(true);
  };

  const erase = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const response = await fetch('/api/account/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'erasure', categories: [...chosen] }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.reauthRequired) {
        setConfirmed(false);
        setNeedsReauth(true);
      }
      if (!response.ok) throw new Error(data.error || t.errors.failed);
      setChosen(new Set());
      setMessage(t.erase.submitted);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <fieldset>
        <legend className="text-sm font-medium text-foreground">{t.erase.choose}</legend>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {ERASABLE_CATEGORIES.map((category) => (
            <li key={category}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-2 hover:border-primary/60">
                <input
                  type="checkbox"
                  checked={chosen.has(category)}
                  onChange={() => toggle(category)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.categories[category]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {plural(counts[category] ?? 0, t.view.items)}
                    {needsReview(category) && ` · ${t.reviewedBadge}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {chosen.has('laps') && <p className="mt-2 text-sm text-muted-foreground">{t.erase.laps}</p>}
      <p className="mt-3 text-sm text-muted-foreground">{t.erase.notErasable}</p>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        data-track="privacy-erase"
        className="mt-4 px-4 py-2 rounded-lg font-semibold text-red-500 bg-card border border-red-500/40 hover:bg-red-500/10 hover:border-red-500 transition-colors disabled:opacity-50"
      >
        {t.erase.submit}
      </button>
      {needsReauth && !confirmed && <ReauthForm />}
      {message && <p className="mt-3 text-sm text-green-400" role="status">{message}</p>}
      {error && <p role="alert" className="mt-3 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>}
      <ConfirmDialog
        open={confirming}
        title={t.erase.confirmTitle}
        confirmLabel={t.erase.confirm}
        cancelLabel={dictionary.common.cancel}
        onConfirm={() => void erase()}
        onCancel={() => setConfirming(false)}
      >
        <p>{t.erase.confirmBody}</p>
        <ul className="mt-2 list-disc pl-5">
          {[...chosen].map((category) => (
            <li key={category}>{t.categories[category]}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
