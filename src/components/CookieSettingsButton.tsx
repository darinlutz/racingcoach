'use client';

import { useCookieConsent } from '@/components/CookieConsentProvider';

// Opens Cookie Settings (the preference center) from the footer and the Cookie Policy, for everyone, signed in or not
export default function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  const { openPreferences } = useCookieConsent();
  return (
    <button
      type="button"
      onClick={(e) => openPreferences(e.currentTarget)}
      aria-haspopup="dialog"
      data-track="cookie-settings"
      className={className}
    >
      {label}
    </button>
  );
}
