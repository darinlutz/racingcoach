'use client';

import type { ReactNode } from 'react';
import { useCookieConsent } from '@/components/CookieConsentProvider';
import type { OptionalCategory } from '@/lib/cookieConsent';

// Renders an optional technology (e.g. <ActivityTracker />) only while its cookie category is granted, and unmounts
// it the moment consent is withdrawn. The only way optional technologies may be added to the site: nothing optional
// should load a script, set a cookie or send a request outside one of these.
export default function ConsentGate({ category, children }: { category: OptionalCategory; children: ReactNode }) {
  const { granted } = useCookieConsent();
  return granted[category] === true ? <>{children}</> : null;
}
