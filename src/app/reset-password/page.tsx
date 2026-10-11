import Link from 'next/link';
import ResetPasswordForm from '@/components/ResetPasswordForm';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getPasswordResetUser } from '@/lib/passwordReset';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await searchParams;
  const resetToken = typeof token === 'string' ? token : '';
  const user = resetToken ? await getPasswordResetUser(resetToken) : null;
  const t = getDictionary(await getLanguage()); // the visitor's language; the reset link's user may not be signed in

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.auth.resetTitle}
        </h1>

        {user ? (
          <>
            <p className="text-muted-foreground mb-8">{t.auth.resetIntro}</p>
            <div className="mb-6">
              <span className="block text-sm font-medium text-foreground mb-2">{t.common.emailAddress}</span>
              <p className="px-4 py-3 bg-secondary border border-border rounded-lg text-foreground">
                {user.emailAddress}
              </p>
            </div>
            <ResetPasswordForm token={resetToken} />
          </>
        ) : (
          <>
            <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm mb-6">
              {t.auth.resetInvalid}
            </p>
            <Link href="/signup" className="text-primary hover:underline font-medium">
              {t.auth.backToSignUp}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
