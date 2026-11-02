'use client';

import { useCookieConsent } from '@/components/CookieConsentProvider';
import { useLanguage } from '@/components/LanguageProvider';

// Privacy & Data Rights' Manage Cookie Preferences: this browser's analytics choice and the button that opens Cookie
// Settings (the same preference center as the footer's), where it's changed or withdrawn
export default function CookieConsentStatus() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights.cookies;
  const { granted, openPreferences } = useCookieConsent();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-foreground" role="status">{granted.analytics ? t.analyticsOn : t.analyticsOff}</p>
      <button
        type="button"
        onClick={(e) => openPreferences(e.currentTarget)}
        aria-haspopup="dialog"
        data-track="privacy-cookie-settings"
        className="px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors"
      >
        {t.open}
      </button>
    </div>
  );
}
