import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import MyDashboard from '@/components/MyDashboard';
import { readDashboard } from '@/lib/dashboard';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';
import { getShowPricing } from '@/lib/siteSettings';
import { canBuyAnything } from '@/lib/users';
import './dashboard.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLanguage());
  return { title: `${t.nav.myDashboard} | RacingCoach.app` };
}

// The nav bar's My Dashboard, for signed-in users only and only ever about the session's own account: it takes no
// user ID. Reading the session makes it dynamic, so it's rendered for each visit and never cached between users.
export default async function MyDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/my-dashboard'));
  const [data, showPricing] = await Promise.all([readDashboard(user), getShowPricing()]);
  return <MyDashboard user={user} data={data} viewPlans={showPricing && canBuyAnything(user)} />;
}
