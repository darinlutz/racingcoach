import type { Metadata } from 'next';
import { headers } from 'next/headers';
import LanguageProvider from '@/components/LanguageProvider';
import TvApp from '@/components/TvApp';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getEnableAiFeatures } from '@/lib/siteSettings';
import { getTvSession } from '@/lib/tvAuth';

export const metadata: Metadata = { title: 'RacingCoach.app TV' };

// TV Broadcast Mode (docs/tv-broadcast.md): Live Racing for a TV's web browser (Amazon Silk on Fire TV), worked with
// the remote. An unpaired TV shows a pairing code to type on the TV Link page (src/app/tv/link/) of a signed-in
// browser (src/lib/tvAuth.ts); a paired one shows the race its account may watch, live, with the Race Announcers.
// Covers the site's navigation and footer, as the TV shows nothing else. In the account's Preferred Language once
// paired, the browser's before.
export default async function TvPage() {
  const session = await getTvSession();
  const [language, enableAiFeatures] = await Promise.all([
    session ? session.user.preferredLanguage : getLanguage(null),
    getEnableAiFeatures(),
  ]);
  // Where to type the code: the site's own address, without https://
  const siteUrl = process.env.SITE_URL?.trim().replace(/\/+$/, '') || `https://${(await headers()).get('host') ?? 'racingcoach.app'}`;
  const linkAddress = `${siteUrl.replace(/^https?:\/\//, '')}/tv/link`;

  return (
    <LanguageProvider language={language} dictionary={getDictionary(language)}>
      <TvApp
        paired={session ? { userName: session.user.userName } : null}
        announcers={enableAiFeatures}
        linkAddress={linkAddress}
      />
    </LanguageProvider>
  );
}
