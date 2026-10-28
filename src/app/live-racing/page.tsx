import { redirect } from 'next/navigation';
import LiveRacing from '@/components/LiveRacing';
import LiveRacingWatchers from '@/components/LiveRacingWatchers';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';

// The nav bar's Live Racing page: the drivers running the telemetry collector right now whom the user may watch
// (src/lib/liveRacing.ts), as dots going round each track's map, and who may watch the user. Signed-in users only.
export default async function LiveRacingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/live-racing'));
  const dictionary = getDictionary(await getLanguage(user));

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {dictionary.nav.liveRacing}
          </h1>
          <p className="mt-2 text-muted-foreground">{dictionary.liveRacing.intro}</p>
        </div>
        <LiveRacing />
        <LiveRacingWatchers />
      </div>
    </section>
  );
}
