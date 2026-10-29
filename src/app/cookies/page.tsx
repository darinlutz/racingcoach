import type { Metadata } from 'next';
import LegalDocument from '@/components/LegalDocument';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { cookiePolicy } from '@/lib/legal';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Cookie Policy | RacingCoach.app' };

// The Cookie Policy, linked from the footer, the cookie banner, Cookie Settings and the Legal page; open to visitors
export default async function CookiePolicyPage() {
  const t = getDictionary(await getLanguage(await getCurrentUser())).legal;
  return <LegalDocument doc={cookiePolicy} t={t} />;
}
