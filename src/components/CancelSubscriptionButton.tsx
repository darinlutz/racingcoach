'use client';

import { useRef, useState } from 'react';

// Cancels the monthly subscription in Stripe after a Yes/No confirmation
export default function CancelSubscriptionButton() {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action="/api/cancel-subscription" method="POST" className="mt-3">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full px-6 py-3 rounded-lg font-semibold text-primary bg-card border border-primary/40 hover:bg-primary/10 transition-colors"
      >
        Cancel
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setConfirming(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancelSubscriptionTitle"
            className="w-full max-w-sm rounded-xl bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="cancelSubscriptionTitle" className="text-foreground font-semibold mb-6">
              Are you sure you want to cancel your monthly subscription?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => formRef.current?.submit()}
                className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
