import { redirect } from 'next/navigation';
import ExpertLapsManager from '@/components/ExpertLapsManager';
import { listExpertLaps } from '@/lib/expertLaps';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';

// The nav bar's Expert Laps page: the Coach page's Expert Laps (src/lib/expertLaps.ts), read only, with a Set
// Target button that copies one into the user's own Target Lap. Signed-in users only.
export default async function ExpertLapsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/expert-laps'));
  const dictionary = getDictionary(await getLanguage(user));
  const expertLaps = await listExpertLaps();

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {dictionary.nav.expertLaps}
        </h1>
        <ExpertLapsManager expertLaps={expertLaps} readOnly />
      </div>
    </section>
  );
}
