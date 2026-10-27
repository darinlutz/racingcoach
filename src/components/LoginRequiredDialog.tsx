'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ArrowRight, Lock, X } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { withReturnTo } from '@/lib/returnTo';

type LoginRequiredDialogProps = {
  open: boolean;
  // The page they clicked, to go to once they've logged in or signed up
  returnTo: string;
  onClose: () => void;
};

// Shown by the nav bar when a signed-out visitor clicks a link to a page that needs an account
// (Coaching & Analysis, Cars & Tracks, Installing, Support, Pricing). Fades and scales like ConfirmDialog; Escape or a click outside closes it.
export default function LoginRequiredDialog({ open, returnTo, onClose }: LoginRequiredDialogProps) {
  const { t } = useLanguage();
  const logInRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    logInRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

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
        aria-labelledby="loginRequiredTitle"
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm overflow-hidden rounded-xl bg-card border border-border shadow-xl transition-transform duration-200 ease-out ${
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        }`}
      >
        <div className="h-1 bg-gradient-to-r from-primary-strong via-primary to-primary-strong" />
        <button
          type="button"
          onClick={onClose}
          aria-label={t.loginRequired.close}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h2 id="loginRequiredTitle" className="text-lg font-bold text-foreground">
            {t.loginRequired.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.loginRequired.text}</p>
          <div className="mt-6 flex flex-col gap-3">
            <Link ref={logInRef} href={withReturnTo('/login', returnTo)} onClick={onClose} className={buttonVariants({ variant: 'racing', className: 'w-full' })}>
              {t.nav.logIn} <ArrowRight />
            </Link>
            <Link href={withReturnTo('/signup', returnTo)} onClick={onClose} className={buttonVariants({ variant: 'racingOutline', className: 'w-full' })}>
              {t.loginRequired.createAccount}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
