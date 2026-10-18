'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ArrowRight, Lock, X } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';

// Shown when a Bronze member uses a feature that's for Silver and Gold only (Racecar Analysis, see createRagRoute's
// notForBronze in src/lib/ragRoute.ts), with a button to the Pricing page when Show Pricing is on. Fades and scales
// like RateLimitDialog; Escape or a click outside closes it.
export default function MembershipRequiredDialog({
  open,
  showPricing,
  onClose,
}: {
  open: boolean;
  showPricing: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const m = t.membershipRequired;
  const actionRef = useRef<HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest onClose, so a new function from each render of the page doesn't rerun the effect below
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (actionRef.current ?? closeRef.current)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open]);

  return (
    <div
      aria-hidden={!open}
      onClick={onClose}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 transition-[opacity,visibility] duration-200 ease-out ${
        open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="membershipRequiredTitle"
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm overflow-hidden rounded-xl bg-card border border-border shadow-xl transition-transform duration-200 ease-out ${
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        }`}
      >
        <div className="h-1 bg-gradient-to-r from-primary-strong via-primary to-primary-strong" />
        <button
          type="button"
          onClick={onClose}
          aria-label={m.close}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h2 id="membershipRequiredTitle" className="text-lg font-bold text-foreground">
            {m.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{m.text}</p>
          {showPricing && <p className="mt-1 text-sm text-muted-foreground">{m.upgrade}</p>}
          <div className="mt-6 flex flex-col gap-3">
            {showPricing && (
              <Link ref={actionRef} href="/pricing" onClick={onClose} className={buttonVariants({ variant: 'racing', className: 'w-full' })}>
                {m.viewPlans} <ArrowRight />
              </Link>
            )}
            <button ref={closeRef} type="button" onClick={onClose} className={buttonVariants({ variant: showPricing ? 'racingOutline' : 'racing', className: 'w-full' })}>
              {m.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
