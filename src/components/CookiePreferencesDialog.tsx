'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { OFFERED_CATEGORIES, type ConsentCategory, type ConsentChoices } from '@/lib/cookieConsent';
import { COOKIE_INVENTORY } from '@/lib/cookieInventory';

type CookiePreferencesDialogProps = {
  granted: ConsentChoices;
  saving: boolean;
  error: string;
  onClose: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onSave: (choices: ConsentChoices) => void;
};

// Cookie Settings, the preference center (CookieConsentProvider): each category the site uses, what it's for and
// what it uses (src/lib/cookieInventory.ts), with a switch for each optional one, set to the current choice (off
// when there's none). A native modal <dialog>: the page behind it can't be reached until it closes, Escape or the
// close button closes it without changing anything, and the provider puts focus back where it was.
export default function CookiePreferencesDialog({ granted, saving, error, onClose, onAcceptAll, onRejectAll, onSave }: CookiePreferencesDialogProps) {
  const { t } = useLanguage();
  const c = t.cookieConsent;
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [choices, setChoices] = useState<ConsentChoices>(() =>
    Object.fromEntries(OFFERED_CATEGORIES.map((category) => [category, granted[category] === true]))
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // The title first, so screen readers announce what opened; Tab then goes through the switches and buttons
    titleRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const categories: ConsentCategory[] = ['necessary', ...OFFERED_CATEGORIES];

  return (
    <dialog
      ref={ref}
      aria-labelledby="cookie-preferences-title"
      aria-describedby="cookie-preferences-intro"
      data-testid="cookie-preferences"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(100%-2rem,40rem)] max-h-[min(100%-2rem,52rem)] rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/70"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <h2 id="cookie-preferences-title" ref={titleRef} tabIndex={-1} className="text-lg font-bold outline-none">
          {c.preferencesTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={c.close}
          className="-m-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p id="cookie-preferences-intro" className="text-sm text-foreground/90">
          {c.preferencesIntro}{' '}
          <Link href="/cookies" onClick={onClose} className="font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-2 hover:no-underline">
            {c.cookiesLink}
          </Link>
        </p>

        <ul className="space-y-3">
          {categories.map((category) => {
            const { name, description } = c.categories[category];
            const items = COOKIE_INVENTORY.filter((item) => item.category === category);
            const switchId = `cookie-category-${category}`;
            return (
              <li key={category} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  {category === 'necessary' ? (
                    <>
                      <h3 className="font-semibold">{name}</h3>
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">{c.alwaysActive}</span>
                    </>
                  ) : (
                    <>
                      <label htmlFor={switchId} className="font-semibold cursor-pointer">{name}</label>
                      <input
                        id={switchId}
                        type="checkbox"
                        role="switch"
                        checked={choices[category] === true}
                        aria-checked={choices[category] === true}
                        aria-describedby={`${switchId}-description`}
                        onChange={(e) => setChoices((current) => ({ ...current, [category]: e.target.checked }))}
                        className="peer h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-secondary transition-colors relative
                          before:absolute before:left-0.5 before:top-1/2 before:h-[18px] before:w-[18px] before:-translate-y-1/2 before:rounded-full before:bg-foreground/80 before:transition-transform
                          checked:border-primary checked:bg-primary checked:before:translate-x-5 checked:before:bg-white
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                      />
                    </>
                  )}
                </div>
                <p id={`${switchId}-description`} className="mt-1 text-sm text-foreground/90">{description}</p>
                {items.length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-foreground/80 hover:text-foreground">{c.technologies}</summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {items.map((item) => (
                        <li key={item.name}>
                          <code className="text-xs">{item.name}</code>{' '}
                          <span className="text-foreground/80">({c.kinds[item.kind]}, {item.provider})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="border-l-2 border-primary pl-2 text-sm font-semibold text-foreground">{error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-2 border-t border-border px-5 py-4 sm:grid-cols-3">
        <Button variant="racingOutline" onClick={onRejectAll} disabled={saving} data-track="cookie-preferences-reject-all">
          {c.rejectAll}
        </Button>
        <Button variant="racingOutline" onClick={onAcceptAll} disabled={saving} data-track="cookie-preferences-accept-all">
          {c.acceptAll}
        </Button>
        <Button variant="racingOutline" onClick={() => onSave(choices)} disabled={saving} data-track="cookie-preferences-save">
          {saving ? c.saving : c.savePreferences}
        </Button>
      </div>
    </dialog>
  );
}
