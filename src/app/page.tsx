import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, GitCompareArrows, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import CoachingWorkbench from '@/components/CoachingWorkbench';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
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
  const user = await getCurrentUser();
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
          <p className="hero-copy">{t.heroCopy}</p>
          <div className="hero-actions">
            <a href="#toolkit" className={buttonVariants({ variant: 'racing' })}>{t.exploreToolkit} <ArrowRight /></a>
            <a href="#how-it-works" className={buttonVariants({ variant: 'racingOutline' })}>{t.howItWorks} <ArrowDown /></a>
          </div>
          <div className="hero-footnote"><Check />{t.footnote}</div>
        </div>
        <div className="hero-coordinate">{t.coordinate}</div>
      </section>

      <section className="capabilities" aria-label={t.capabilitiesLabel}>
        <div className="site-container capability-row">
          {t.capabilities.map((item, i) => {
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

      <section className="toolkit site-container" id="toolkit">
        <div className="section-heading">
          <div>
            <div className="eyebrow">{t.toolkitEyebrow}</div>
            <h2>{t.toolkitTitle}</h2>
          </div>
          <p>{t.toolkitCopy}</p>
        </div>
        <CoachingWorkbench />
      </section>

      <section className="method" id="how-it-works">
        <div className="site-container method-layout">
          <div>
            <div className="eyebrow">{t.methodEyebrow}</div>
            <h2>{t.methodLine1}<br />{t.methodLine2}</h2>
          </div>
          <div className="steps">
            {t.steps.map((step, i) => (
              <div key={step.title}><span className="step-number">{String(i + 1).padStart(2, '0')}</span><h3>{step.title}</h3><p>{step.copy}</p></div>
            ))}
          </div>
        </div>
      </section>

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
