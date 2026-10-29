'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Cookie } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';

type CookieConsentBannerProps = {
  reconsent: boolean;
  saving: boolean;
  error: string;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onCustomize: (from: HTMLElement) => void;
};

// The cookie banner (CookieConsentProvider), across the bottom of every page until a choice is made. Accept All,
// Reject All and Customize look the same and sit side by side: none is preselected or played down. It doesn't block
// the site, and nothing but those buttons counts as a choice (not scrolling, browsing on or closing the page).
// While it's showing, the page scrolls far enough that nothing it covers is hidden for good, and keyboard focus
// scrolls clear of it (scroll-padding), so a focused link is never behind it.
export default function CookieConsentBanner({ reconsent, saving, error, onAcceptAll, onRejectAll, onCustomize }: CookieConsentBannerProps) {
  const { t } = useLanguage();
  const c = t.cookieConsent;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const banner = ref.current;
    if (!banner) return;
    const html = document.documentElement;
    const fit = () => {
      const height = `${banner.offsetHeight}px`;
      html.style.scrollPaddingBottom = height;
      document.body.style.paddingBottom = height;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      html.style.scrollPaddingBottom = '';
      document.body.style.paddingBottom = '';
    };
  }, []);

  // {privacy} and {cookies} as links to the documents
  const links = c.links.split(/(\{privacy\}|\{cookies\})/).map((part, i) =>
    part === '{privacy}' ? (
      <Link key={i} href="/privacy" className="font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-2 hover:no-underline">{c.privacyLink}</Link>
    ) : part === '{cookies}' ? (
      <Link key={i} href="/cookies" className="font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-2 hover:no-underline">{c.cookiesLink}</Link>
    ) : (
      part
    )
  );

  return (
    <section
      ref={ref}
      aria-label={c.bannerLabel}
      aria-describedby="cookie-banner-body"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.35)] lg:pl-(--nav-width)"
    >
      <div className="site-container py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex-1 min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Cookie className="w-4 h-4 text-primary shrink-0" aria-hidden />
            {reconsent ? c.reconsentTitle : c.title}
          </h2>
          <p id="cookie-banner-body" className="mt-1 text-sm text-foreground/90">
            {reconsent && <>{c.reconsentBody} </>}
            {c.body} {links}
          </p>
          {error && <p role="alert" className="mt-2 border-l-2 border-primary pl-2 text-sm font-semibold text-foreground">{error}</p>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:shrink-0">
          <Button variant="racingOutline" onClick={onRejectAll} disabled={saving} data-track="cookie-reject-all">
            {c.rejectAll}
          </Button>
          <Button variant="racingOutline" onClick={onAcceptAll} disabled={saving} data-track="cookie-accept-all">
            {c.acceptAll}
          </Button>
          <Button
            variant="racingOutline"
            onClick={(e) => onCustomize(e.currentTarget)}
            disabled={saving}
            aria-haspopup="dialog"
            data-track="cookie-customize"
          >
            {c.customize}
          </Button>
        </div>
      </div>
    </section>
  );
}
