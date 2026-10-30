import { Tv } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
// The leaderboard's country flags (`fi fi-<code>`, src/lib/countryFlags.ts)
import 'flag-icons/css/flag-icons.min.css';
import LiveRacing from '@/components/LiveRacing';
import LiveRacingWatchers from '@/components/LiveRacingWatchers';
import { readEngineBedConfig } from '@/lib/engineAudioAssets';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The nav bar's Live Racing page: the drivers running the telemetry collector right now whom the user may watch
// (src/lib/liveRacing.ts), as dots going round each track's map, and who may watch the user. Signed-in users only.
// Watch on a TV leads to the TV Link page, which pairs a TV for TV Broadcast Mode (src/app/tv/).
export default async function LiveRacingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/live-racing'));
  const [language, enableAiFeatures, engine] = await Promise.all([getLanguage(user), getEnableAiFeatures(), readEngineBedConfig(user.id)]);
  const dictionary = getDictionary(language);

  return (
    // The full width, with a small margin, like the My Sessions page, so the map and both side columns fit
    <section className="py-10 px-3 sm:px-4">
      <div className="w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {dictionary.nav.liveRacing}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {dictionary.liveRacing.intro}{' '}
            <Link href="/tv/link" className="inline-flex items-center gap-1 text-primary hover:underline">
              <Tv size={16} aria-hidden />
              {dictionary.tv.watchOnTv}
            </Link>
          </p>
        </div>
        <LiveRacing announcers={enableAiFeatures} engine={engine} />
        <LiveRacingWatchers />
      </div>
    </section>
  );
}
