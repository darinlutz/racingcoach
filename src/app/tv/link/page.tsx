import { redirect } from 'next/navigation';
import TvLink from '@/components/TvLink';
import { getDictionary } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';
import { TV_SESSION_DAYS } from '@/lib/tvAuth';

// TV Broadcast Mode's TV Link page (src/lib/tvAuth.ts): the signed-in user types the code their TV shows to pair it,
// and sees and unpairs their paired TVs. Signed-in users only; the TV's own page is /tv.
export default async function TvLinkPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/tv/link'));
  const t = getDictionary(user.preferredLanguage).tv;

  return (
    <section className="py-10 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.linkTitle}
          </h1>
          <p className="mt-2 text-muted-foreground">{t.linkIntro}</p>
        </div>
        <TvLink days={TV_SESSION_DAYS} />
      </div>
    </section>
  );
}
