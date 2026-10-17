'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Gauge, X } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { RATE_LIMIT_EVENT, type RateLimitEventDetail } from '@/lib/rateLimitClient';
import { withReturnTo } from '@/lib/returnTo';

// Shown over any page when one of its AI features was refused because the user's AI limit is used up (the Admin
// page's Rate Limiting, src/lib/rateLimits.ts): the server's message, and a button to the Pricing page for the
// next membership level up, or to create a free account for a visitor who isn't signed in. Features raise it with
// reportRateLimit (src/lib/rateLimitClient.ts). Fades and scales like LoginRequiredDialog; Escape or a click
// outside closes it.
export default function RateLimitDialog() {
  const { t, fmt } = useLanguage();
  const r = t.rateLimit;
  const pathname = usePathname();
  const [detail, setDetail] = useState<RateLimitEventDetail | null>(null);
  const [open, setOpen] = useState(false);
  const actionRef = useRef<HTMLAnchorElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onLimit = (event: Event) => {
      setDetail((event as CustomEvent<RateLimitEventDetail>).detail);
      setOpen(true);
    };
    window.addEventListener(RATE_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(RATE_LIMIT_EVENT, onLimit);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (actionRef.current ?? closeRef.current)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open]);

  const info = detail?.info;
  const close = () => setOpen(false);
  const title = info?.reason === 'burst' ? r.titleBurst : info?.reason === 'blocked' ? r.titleBlocked : r.title;

  return (
    <div
      aria-hidden={!open}
      onClick={close}
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 transition-[opacity,visibility] duration-200 ease-out ${
        open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rateLimitTitle"
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm overflow-hidden rounded-xl bg-card border border-border shadow-xl transition-transform duration-200 ease-out ${
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
        }`}
      >
        <div className="h-1 bg-gradient-to-r from-primary-strong via-primary to-primary-strong" />
        <button
          type="button"
          onClick={close}
          aria-label={t.loginRequired.close}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Gauge className="h-6 w-6" />
          </div>
          <h2 id="rateLimitTitle" className="text-lg font-bold text-foreground">
            {title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{detail?.message}</p>
          <div className="mt-6 flex flex-col gap-3">
            {info?.upgradeTo && (
              <Link ref={actionRef} href="/pricing" onClick={close} className={buttonVariants({ variant: 'racing', className: 'w-full' })}>
                {fmt(r.upgradeButton, { level: t.pricing.levelNames[info.upgradeTo] ?? info.upgradeTo })} <ArrowRight />
              </Link>
            )}
            {info?.signUp && (
              <>
                <Link ref={actionRef} href={withReturnTo('/signup', pathname)} onClick={close} className={buttonVariants({ variant: 'racing', className: 'w-full' })}>
                  {t.loginRequired.createAccount} <ArrowRight />
                </Link>
                <Link href={withReturnTo('/login', pathname)} onClick={close} className={buttonVariants({ variant: 'racingOutline', className: 'w-full' })}>
                  {t.nav.logIn}
                </Link>
              </>
            )}
            <button ref={closeRef} type="button" onClick={close} className={buttonVariants({ variant: 'racingOutline', className: 'w-full' })}>
              {r.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
