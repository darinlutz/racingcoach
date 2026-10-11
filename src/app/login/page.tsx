import { redirect } from 'next/navigation';
import LoginForm from '@/components/LoginForm';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  const t = getDictionary(await getLanguage(null)).auth;

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.logInTitle}
        </h1>
        <p className="text-muted-foreground mb-8">{t.logInIntro}</p>
        <LoginForm />
      </div>
    </section>
  );
}
