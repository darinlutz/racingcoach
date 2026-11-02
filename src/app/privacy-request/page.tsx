import Link from 'next/link';
import PublicPrivacyRequestForm from '@/components/PublicPrivacyRequestForm';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// A privacy request from someone without an account, a former user, or someone who can't sign in
// (src/app/api/privacy/requests/route.ts). Signed-in users are pointed to Privacy & Data Rights instead.
export default async function PrivacyRequestPage() {
  const user = await getCurrentUser();
  const t = getDictionary(await getLanguage(user)).privacyRights;
  return (
    <section className="py-12 px-4 flex justify-center">
      <div className="w-full max-w-xl bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.public.title}
        </h1>
        <p className="text-muted-foreground mb-6">{t.public.intro}</p>
        {user && (
          <p className="mb-6 p-3 rounded-lg bg-card border border-border text-sm">
            {t.public.signedIn}{' '}
            <Link href="/account/privacy" className="text-primary hover:underline">{t.link}</Link>
          </p>
        )}
        <PublicPrivacyRequestForm />
      </div>
    </section>
  );
}
