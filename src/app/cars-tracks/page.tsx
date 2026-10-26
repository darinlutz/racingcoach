import CarsTracksTabs from '@/components/CarsTracksTabs';
import { CARS_TRACKS_TABS, type CarsTracksTab } from '@/lib/carsTracksTabs';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// Cars & Tracks: Car Data, Track Data and Racecar Analysis in one page of tabs (the nav bar's Cars & Tracks link).
// ?tab=cars|tracks|racecar picks the tab it opens on. Racecar Analysis is left out while the Admin page's Enable AI
// Features is off
export default async function CarsTracksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = getDictionary(await getLanguage()).carsTracks;
  const { tab } = await searchParams;
  const tabs = (await getEnableAiFeatures()) ? [...CARS_TRACKS_TABS] : CARS_TRACKS_TABS.filter((name) => name !== 'racecar');
  const initialTab = tabs.find((name) => name === tab) ?? ('cars' satisfies CarsTracksTab);

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.title}
          </h1>
          <p className="text-lg text-muted-foreground">{t.intro}</p>
        </div>
      </section>

      <section className="py-16 bg-card">
        <div className="site-container">
          <CarsTracksTabs tabs={tabs} initialTab={initialTab} />
        </div>
      </section>
    </div>
  );
}
