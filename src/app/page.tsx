import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, GitCompareArrows, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import AiRaceTeamSection from '@/components/AiRaceTeamSection';
import { buttonVariants } from '@/components/Button';
import CoachingWorkbench from '@/components/CoachingWorkbench';
import CompatibleSimsSection from '@/components/CompatibleSimsSection';
import HomeScreenshot from '@/components/HomeScreenshot';
import HomeShowcase from '@/components/HomeShowcase';
import LanguagesSection from '@/components/LanguagesSection';
import LearnAndInstallSection from '@/components/LearnAndInstallSection';
import PersonalCoachSection from '@/components/PersonalCoachSection';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';
import 'flag-icons/css/flag-icons.min.css';
import './landing.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLanguage()).meta;
  return {
    title: t.homeTitle,
    description: t.homeDescription,
    openGraph: {
      title: t.homeTitle,
      description: t.homeOgDescription,
      type: 'website',
    },
    twitter: { card: 'summary_large_image' },
  };
}

// Icons for the capabilities row, in the order of the dictionary's home.capabilities
const capabilityIcons = [Sparkles, Radio, GitCompareArrows, ShieldCheck];

export default async function Home() {
  const [user, enableAiFeatures] = await Promise.all([getCurrentUser(), getEnableAiFeatures()]);
  const t = getDictionary(await getLanguage(user)).home;

  return (
    <>
      <section className="hero">
        <Image
          className="hero-photo"
          src="/assets/pitlane-hero.jpg"
          alt={t.heroAlt}
          width={1920}
          height={1024}
          sizes="100vw"
          preload
        />
        <div className="site-container hero-content">
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.heroLine1}<br /><span>{t.heroLine2}</span></h1>
          {/* The Admin page's Enable AI Features setting picks AI or personal race engineer, like the logo */}
          <p className="hero-copy">{enableAiFeatures ? t.heroCopy : t.heroCopyNoAi}</p>
          <div className="hero-actions">
            <a href="#overlay" className={buttonVariants({ variant: 'racing' })}>{t.exploreToolkit} <ArrowRight /></a>
            <a href="#how-it-works" className={buttonVariants({ variant: 'racingOutline' })}>{t.howItWorks} <ArrowDown /></a>
          </div>
          <div className="hero-footnote"><Check />{t.footnote}</div>
        </div>
        <div className="hero-coordinate">{t.coordinate}</div>
      </section>

      <section className="capabilities" aria-label={t.capabilitiesLabel}>
        {/* The first, AI-powered coaching, is left out while the Admin page's Enable AI Features is off */}
        <div
          className="site-container capability-row"
          style={{ '--capability-count': enableAiFeatures ? 4 : 3 } as React.CSSProperties}
        >
          {t.capabilities.map((item, i) => {
            if (i === 0 && !enableAiFeatures) return null;
            const Icon = capabilityIcons[i];
            return (
              <div className="capability" key={item.title}>
                <Icon />
                <div><strong>{item.title}</strong><span>{item.sub}</span></div>
              </div>
            );
          })}
        </div>
      </section>

      <CompatibleSimsSection t={t} />

      {/* In the car: the collector's Target Telemetry overlay and Brake Practice game.
          Screenshots are public/assets/home/<name>.webp, see HomeScreenshot */}
      <section className="site-container feature-section showcase-stack" id="overlay">
        <HomeShowcase
          eyebrow={t.overlayEyebrow}
          title={t.overlayTitle}
          copy={t.overlayCopy}
          points={t.overlayPoints}
          shot={{ name: 'target-telemetry', title: t.overlayTitle, alt: t.overlayShotAlt, pending: t.screenshotPending }}
        />
        <HomeShowcase
          id="brake-practice"
          reverse
          eyebrow={t.brakeEyebrow}
          title={t.brakeTitle}
          copy={t.brakeCopy}
          points={t.brakePoints}
          shot={{ name: 'brake-practice', title: t.brakeEyebrow, alt: t.brakeShotAlt, pending: t.screenshotPending }}
        />
      </section>

      {/* The AI race team and the personal AI coach are left out while the Admin page's Enable AI Features is off */}
      {enableAiFeatures && <AiRaceTeamSection t={t} />}
      {enableAiFeatures && <PersonalCoachSection />}

      <section className="site-container feature-section" id="analysis">
        <div className="section-heading">
          <div>
            <div className="eyebrow">{t.analysisEyebrow}</div>
            <h2>{t.analysisTitle}</h2>
          </div>
          <p>{t.analysisCopy}</p>
        </div>
        <div className="gallery-feature">
          <HomeScreenshot name="tire-temps" title={t.tireTitle} alt={t.tireShotAlt} pending={t.screenshotPending} sizes="(max-width: 800px) 100vw, 65vw" />
          <div className="gallery-caption">
            <h3>{t.tireTitle}</h3>
            <p className="muted-copy">{t.tireCopy}</p>
          </div>
        </div>
        <div className="gallery-grid">
          <div>
            <HomeScreenshot name="driving-line-map" title={t.mapTitle} alt={t.mapShotAlt} pending={t.screenshotPending} aspect="4 / 3" sizes="(max-width: 800px) 100vw, 50vw" />
            <h3>{t.mapTitle}</h3>
            <p className="muted-copy">{t.mapCopy}</p>
          </div>
          <div>
            <HomeScreenshot name="track-3d" title={t.map3dTitle} alt={t.map3dShotAlt} pending={t.screenshotPending} aspect="4 / 3" sizes="(max-width: 800px) 100vw, 50vw" />
            <h3>{t.map3dTitle}</h3>
            <p className="muted-copy">{t.map3dCopy}</p>
          </div>
        </div>
      </section>

      <section className="site-container feature-section" id="live">
        <div className="section-heading">
          <div>
            <div className="eyebrow">{t.liveEyebrow}</div>
            <h2>{t.liveTitle}</h2>
          </div>
          <p>{enableAiFeatures ? t.liveCopy : t.liveCopyNoAi}</p>
        </div>
        <div className="gallery-grid">
          <div>
            <HomeScreenshot name="live-racing" title={t.liveWebTitle} alt={t.liveWebShotAlt} pending={t.screenshotPending} sizes="(max-width: 800px) 100vw, 50vw" />
            <h3>{t.liveWebTitle}</h3>
            <p className="muted-copy">{t.liveWebCopy}</p>
          </div>
          <div>
            <HomeScreenshot name="tv-broadcast" title={t.tvTitle} alt={t.tvShotAlt} pending={t.screenshotPending} sizes="(max-width: 800px) 100vw, 50vw" />
            <h3>{t.tvTitle}</h3>
            <p className="muted-copy">{enableAiFeatures ? t.tvCopy : t.tvCopyNoAi}</p>
          </div>
        </div>
      </section>

      <LanguagesSection t={t} enableAiFeatures={enableAiFeatures} />

      <section className="toolkit site-container feature-section" id="toolkit">
        <div className="section-heading">
          <div>
            <div className="eyebrow">{t.toolkitEyebrow}</div>
            <h2>{t.toolkitTitle}</h2>
          </div>
          <p>{t.toolkitCopy}</p>
        </div>
        <CoachingWorkbench />
      </section>

      <LearnAndInstallSection t={t} installHref={user ? '/installing' : '/signup'} />

      <section className="site-container bottom-cta">
        <div>
          <h2>{t.ctaLine1}<span>{t.ctaLine2}</span></h2>
          <p>{t.ctaCopy}</p>
        </div>
        <Link href={user ? '/racing' : '/signup'} className={buttonVariants({ variant: 'racing' })}>
          {user ? t.openEngineer : t.meetEngineer} <ArrowRight />
        </Link>
      </section>
    </>
  );
}
