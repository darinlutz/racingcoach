import type { Metadata } from 'next';
import LegalDocument from '@/components/LegalDocument';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { termsOfService } from '@/lib/legal';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Terms of Service | RacingCoach.app' };

// The Terms of Service, linked from the footer and the Legal page; open to visitors
export default async function TermsPage() {
  const t = getDictionary(await getLanguage(await getCurrentUser())).legal;
  return <LegalDocument doc={termsOfService} t={t} />;
}
