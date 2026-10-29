import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Cookie, FileText, Lock, ShieldCheck } from 'lucide-react';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Legal | RacingCoach.app' };

// The Legal page: links to the Privacy Policy (/privacy), Terms of Service (/terms) and Cookie Policy (/cookies)
export default async function LegalPage() {
  const t = getDictionary(await getLanguage(await getCurrentUser())).legal;
  const docs = [
    { href: '/privacy', title: t.privacyTitle, description: t.privacyDescription, Icon: Lock },
    { href: '/terms', title: t.termsTitle, description: t.termsDescription, Icon: FileText },
    { href: '/cookies', title: t.cookiesTitle, description: t.cookiesDescription, Icon: Cookie },
  ];

  return (
    <section className="py-10 px-4">
      <div className="site-container max-w-3xl space-y-6">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <ShieldCheck className="w-8 h-8 text-primary" />
            <span className="bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
              {t.pageTitle}
            </span>
          </h1>
          <p className="text-muted-foreground">{t.intro}</p>
        </div>
        <ul className="rounded-xl border border-border bg-card divide-y divide-border">
          {docs.map(({ href, title, description, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex items-center gap-4 px-5 py-4 hover:bg-background/50 transition-colors">
                <Icon className="w-5 h-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{title}</div>
                  <div className="text-xs text-muted-foreground">racingcoach.app{href}</div>
                  <div className="text-sm text-muted-foreground">{description}</div>
                </div>
                <ChevronRight className="w-5 h-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
