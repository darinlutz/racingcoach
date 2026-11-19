import { redirect } from 'next/navigation';
import SetupsWorkspace from '@/components/SetupsWorkspace';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { canUseInCarCoach, isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { SETUPS_TABS, type SetupsTab } from '@/lib/setupsTabs';
import { getEnableAiFeatures, getShowPricing } from '@/lib/siteSettings';

// Setups (the nav bar's Setups link; docs/setups.md): the signed-in driver's iRacing setups in tabs. ?tab= picks the
// tab it opens on. The Setup Engineer tab is left out while the Admin page's Enable AI Features is off; Bronze members
// see it with why it's for Silver and Gold
export default async function SetupsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { tab } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', typeof tab === 'string' ? `/setups?tab=${encodeURIComponent(tab)}` : '/setups'));
  const t = getDictionary(await getLanguage(user)).setups;
  const tabs: SetupsTab[] = (await getEnableAiFeatures()) ? [...SETUPS_TABS] : SETUPS_TABS.filter((name) => name !== 'engineer');
  const initialTab = tabs.find((name) => name === tab) ?? 'overview';

  return (
    <div className="w-full">
      <section className="border-b border-border bg-gradient-to-b from-background to-background py-10">
        <div className="site-container">
          <h1 className="bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-3xl font-bold text-transparent">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">{t.intro}</p>
        </div>
      </section>
      <section className="bg-card py-10">
        <div className="site-container">
          <SetupsWorkspace tabs={tabs} initialTab={initialTab} canUseEngineer={canUseInCarCoach(user)} showPricing={await getShowPricing()} canDebugDrawings={isAdmin(user.role)} />
        </div>
      </section>
    </div>
  );
}
