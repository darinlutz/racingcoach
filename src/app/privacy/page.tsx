import type { Metadata } from 'next';
import LegalDocument from '@/components/LegalDocument';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { privacyPolicy } from '@/lib/legal';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Privacy Policy | RacingCoach.app' };

// The Privacy Policy, linked from the footer and the Legal page; open to visitors
export default async function PrivacyPage() {
  const t = getDictionary(await getLanguage(await getCurrentUser())).legal;
  return <LegalDocument doc={privacyPolicy} t={t} />;
}
