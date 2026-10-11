'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import {
  CANCELLATION_REASONS,
  MAX_CANCELLATION_NOTES,
  type CancellationConfirmation,
} from '@/lib/cancellationReasons';

// Asks the subscriber why they're leaving, then cancels the subscription in Stripe and shows
// Stripe's confirmation
export default function CancelSubscriptionButton() {
  const { t: dictionary, locale } = useLanguage();
  const t = dictionary.cancelSubscription;
  const formatDate = (iso: string | null, withTime = false) =>
    iso ? new Date(iso).toLocaleString(locale, withTime ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' }) : '—';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CancellationConfirmation | null>(null);

  const close = () => {
    if (submitting) return;
    setOpen(false);
    // Once canceled, reload the account page so it shows the new status
    if (confirmation) router.refresh();
  };

  const cancelSubscription = async () => {
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.failed);
      setConfirmation(data.confirmation);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-6 py-3 rounded-lg font-semibold text-primary bg-card border border-primary/40 hover:bg-primary/10 transition-colors"
      >
        {t.button}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancelSubscriptionTitle"
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            {confirmation ? (
              <>
                <h2 id="cancelSubscriptionTitle" className="text-lg font-bold text-foreground mb-2">
                  {t.canceledTitle}
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t.canceledIntro}
                </p>
                <dl className="divide-y divide-border rounded-lg border border-border text-sm mb-6">
                  <div className="flex justify-between gap-4 px-4 py-2">
                    <dt className="text-muted-foreground">{t.confirmationNumber}</dt>
                    <dd className="font-mono text-foreground text-right break-all">{confirmation.confirmationNumber}</dd>
                  </div>
                  <div className="flex justify-between gap-4 px-4 py-2">
                    <dt className="text-muted-foreground">{t.canceledOn}</dt>
                    <dd className="text-foreground text-right">{formatDate(confirmation.canceledAt, true)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 px-4 py-2">
                    <dt className="text-muted-foreground">{t.subscriptionEndDate}</dt>
                    <dd className="text-foreground text-right">{formatDate(confirmation.subscriptionEndDate)}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  autoFocus
                  onClick={close}
                  className="w-full px-4 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong"
                >
                  {dictionary.common.done}
                </button>
              </>
            ) : (
              <>
                <h2 id="cancelSubscriptionTitle" className="text-lg font-bold text-foreground mb-1">
                  {t.askTitle}
                </h2>
                <p className="text-sm text-muted-foreground mb-4">{t.askIntro}</p>

                <fieldset className="space-y-2 mb-4">
                  <legend className="sr-only">{t.reasonLegend}</legend>
                  {CANCELLATION_REASONS.map(({ label, stripeFeedback }) => (
                    <label
                      key={label}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        reason === label ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="cancellationReason"
                        value={label}
                        checked={reason === label}
                        onChange={() => setReason(label)}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground">{t.reasons[stripeFeedback] ?? label}</span>
                    </label>
                  ))}
                </fieldset>

                <label htmlFor="cancellationNotes" className="block text-sm font-medium text-foreground mb-1">
                  {t.comments} <span className="font-normal text-muted-foreground">{dictionary.common.optional}</span>
                </label>
                <textarea
                  id="cancellationNotes"
                  rows={4}
                  maxLength={MAX_CANCELLATION_NOTES}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t.commentsPlaceholder}
                  className="w-full px-3 py-2 mb-4 bg-card border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />

                {error && (
                  <p className="mb-4 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3">
                  <button
                    type="button"
                    autoFocus
                    onClick={close}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    {t.remain}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelSubscription()}
                    disabled={!reason || submitting}
                    className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? t.canceling : t.button}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
