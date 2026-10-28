import { redirect } from 'next/navigation';
import SignupForm from '@/components/SignupForm';
import { googleSignInEnabled } from '@/lib/googleAuth';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { safeReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';

// ?next= is the page to go back to afterwards (src/lib/returnTo.ts); ?google= is what Sign in with Google came
// back with (src/app/api/auth/google)
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; google?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  if (await getCurrentUser()) redirect(next);
  const t = getDictionary(await getLanguage(null)).auth;
  const googleResult = typeof params.google === 'string' ? params.google : '';
  const googleMessage = Object.hasOwn(t.google, googleResult) ? t.google[googleResult as keyof typeof t.google] : undefined;

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.signUpTitle}
        </h1>
        <p className="text-muted-foreground mb-8">{t.signUpIntro}</p>
        <SignupForm next={next} googleEnabled={googleSignInEnabled()} googleMessage={googleMessage} />
      </div>
    </section>
  );
}
