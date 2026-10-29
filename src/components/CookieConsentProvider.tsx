'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import CookieConsentBanner from '@/components/CookieConsentBanner';
import CookiePreferencesDialog from '@/components/CookiePreferencesDialog';
import { useLanguage } from '@/components/LanguageProvider';
import {
  allChoices,
  grantsAny,
  normalizeChoices,
  OFFERED_CATEGORIES,
  type ConsentChoices,
  type ConsentMethod,
  type ConsentVia,
  type OptionalCategory,
} from '@/lib/cookieConsent';
import { storageKeysOf } from '@/lib/cookieInventory';

// The visitor's cookie consent on the page (src/lib/cookieConsent.ts). The root layout reads the consent cookie on
// the server (getConsentState in src/lib/cookieConsentServer.ts) and passes what may run, so the first render, on the
// server and while hydrating, already leaves out everything not consented to: optional technologies are rendered
// inside <ConsentGate>, which renders nothing until their category is granted, and never decide for themselves.
// Shows the banner while a choice is needed and the preference center (Cookie Settings) when opened. A choice is
// saved by POST /api/consent; anything taken back stops at once, before the server answers, and its browser storage
// is removed. A grant only takes effect once the server has recorded it.

export type ConsentInitialState = {
  needsChoice: boolean;
  reconsent: boolean;
  granted: ConsentChoices;
};

type CookieConsentContextValue = {
  granted: ConsentChoices;
  // Opens Cookie Settings; focus goes back to `from` (or whatever had it) when it closes
  openPreferences: (from?: HTMLElement | null) => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function useCookieConsent(): CookieConsentContextValue {
  const value = useContext(CookieConsentContext);
  if (!value) throw new Error('useCookieConsent must be used inside CookieConsentProvider');
  return value;
}

// Removes the browser storage of the categories no longer granted (their cookies are deleted by /api/consent)
function clearStorage(categories: OptionalCategory[]) {
  for (const category of categories) {
    for (const [kind, storage] of [
      ['localStorage', () => window.localStorage],
      ['sessionStorage', () => window.sessionStorage],
    ] as const) {
      for (const key of storageKeysOf(category, kind)) {
        try {
          storage().removeItem(key);
        } catch {
          // Storage can be blocked; there's nothing in it then
        }
      }
    }
  }
}

export default function CookieConsentProvider({ initial, children }: { initial: ConsentInitialState; children: ReactNode }) {
  const { t, language } = useLanguage();
  const [granted, setGranted] = useState<ConsentChoices>(initial.granted);
  const [bannerOpen, setBannerOpen] = useState(initial.needsChoice);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Read out by screen readers when a choice is saved
  const [status, setStatus] = useState('');
  const opener = useRef<HTMLElement | null>(null);

  const openPreferences = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setError('');
    setPreferencesOpen(true);
  }, []);

  const closePreferences = useCallback(() => {
    setPreferencesOpen(false);
    setError('');
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) window.setTimeout(() => back.focus(), 0);
  }, []);

  const choose = useCallback(
    async (via: ConsentVia, method: ConsentMethod, picked?: ConsentChoices) => {
      const next = via === 'acceptAll' ? allChoices(true) : via === 'rejectAll' ? allChoices(false) : normalizeChoices(picked);
      // Taken back at once: whatever is turned off stops now, whether or not the server answers
      const withdrawn = OFFERED_CATEGORIES.filter((category) => next[category] !== true);
      setGranted((current) =>
        Object.fromEntries(OFFERED_CATEGORIES.map((category) => [category, current[category] === true && next[category] === true]))
      );
      clearStorage(withdrawn);

      setSaving(true);
      setError('');
      setStatus('');
      try {
        const response = await fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ via, method, choices: next, language }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { choices: ConsentChoices };
        setGranted(normalizeChoices(body.choices));
        setBannerOpen(false);
        if (preferencesOpen) closePreferences();
        setStatus(t.cookieConsent.saved);
      } catch {
        if (grantsAny(next)) {
          // Nothing optional starts without a recorded choice
          setError(t.cookieConsent.saveFailed);
        } else {
          // A refusal holds on this page even if it couldn't be saved; the banner asks again on the next visit
          setBannerOpen(false);
          if (preferencesOpen) closePreferences();
        }
      } finally {
        setSaving(false);
      }
    },
    [language, preferencesOpen, closePreferences, t.cookieConsent.saved, t.cookieConsent.saveFailed]
  );

  const value = useMemo(() => ({ granted, openPreferences }), [granted, openPreferences]);

  return (
    <CookieConsentContext.Provider value={value}>
      {/* Early in the page, so keyboard and screen reader users reach it first; it's drawn at the bottom */}
      {bannerOpen && (
        <CookieConsentBanner
          reconsent={initial.reconsent}
          saving={saving}
          error={preferencesOpen ? '' : error}
          onAcceptAll={() => choose('acceptAll', 'banner')}
          onRejectAll={() => choose('rejectAll', 'banner')}
          onCustomize={(from) => openPreferences(from)}
        />
      )}
      {preferencesOpen && (
        <CookiePreferencesDialog
          granted={granted}
          saving={saving}
          error={error}
          onClose={closePreferences}
          onAcceptAll={() => choose('acceptAll', 'preferenceCenter')}
          onRejectAll={() => choose('rejectAll', 'preferenceCenter')}
          onSave={(choices) => choose('save', 'preferenceCenter', choices)}
        />
      )}
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {children}
    </CookieConsentContext.Provider>
  );
}
