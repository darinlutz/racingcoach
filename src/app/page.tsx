import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, GitCompareArrows, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import CoachingWorkbench from '@/components/CoachingWorkbench';
import { getCurrentUser } from '@/lib/session';
import './landing.css';

export const metadata: Metadata = {
  title: 'RacingCoach.app — Find Your Next Tenth',
  description: 'Your AI-powered sim racing coach. Compare laps, find your focus, and turn racing telemetry into a faster, more consistent drive.',
  openGraph: {
    title: 'RacingCoach.app — Find Your Next Tenth',
    description: 'Data-driven lap comparison, debrief coaching, iRacing trends, and racecar analysis. Every lap is an opportunity.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

const capabilities = [
  { icon: Sparkles, title: 'AI-powered coaching', sub: 'A clear plan, not just numbers' },
  { icon: Radio, title: 'iRacing integration', sub: 'Your progress, connected' },
  { icon: GitCompareArrows, title: 'Corner-by-corner insights', sub: 'Find where the time is hiding' },
  { icon: ShieldCheck, title: 'Grounded in real data', sub: 'Evidence behind every insight' },
];

const steps = [
  ['01', 'Bring your laps', 'Your iRacing history and session telemetry put your performance in context.'],
  ['02', 'Find your focus', 'Compare braking, corner speed, and consistency to pinpoint what matters.'],
  ['03', 'Make the next lap count', 'Take a focused practice plan to the track. Build pace one corner at a time.'],
];

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <>
      <section className="hero">
        <Image
          className="hero-photo"
          src="/assets/pitlane-hero.jpg"
          alt="A driver and crew chief in red race suits review telemetry beside a Porsche GT3 in the pit garage"
          width={1920}
          height={1024}
          sizes="100vw"
          preload
        />
        <div className="site-container hero-content">
          <div className="eyebrow">Built for the pursuit of pace</div>
          <h1>YOUR NEXT TENTH.<br /><span>IS IN THE DATA.</span></h1>
          <p className="hero-copy">Meet your AI race engineer. Turn every lap into a clear plan to drive faster, race smarter, and stay consistent.</p>
          <div className="hero-actions">
            <a href="#toolkit" className={buttonVariants({ variant: 'racing' })}>Explore your toolkit <ArrowRight /></a>
            <a href="#how-it-works" className={buttonVariants({ variant: 'racingOutline' })}>How it works <ArrowDown /></a>
          </div>
          <div className="hero-footnote"><Check />Your telemetry. Your potential. Your edge.</div>
        </div>
        <div className="hero-coordinate">PRECISION AT EVERY CORNER</div>
      </section>

      <section className="capabilities" aria-label="Product capabilities">
        <div className="site-container capability-row">
          {capabilities.map((item) => (
            <div className="capability" key={item.title}>
              <item.icon />
              <div><strong>{item.title}</strong><span>{item.sub}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="toolkit site-container" id="toolkit">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Less guesswork. More racecraft.</div>
            <h2>YOUR COMPLETE COACHING TOOLKIT.</h2>
          </div>
          <p>From the first braking point to your season-long progress. See the bigger picture, then focus on the details.</p>
        </div>
        <CoachingWorkbench />
      </section>

      <section className="method" id="how-it-works">
        <div className="site-container method-layout">
          <div>
            <div className="eyebrow">From data to the next tenth</div>
            <h2>ANALYZE. ADAPT.<br />GO AGAIN.</h2>
          </div>
          <div className="steps">
            {steps.map(([n, title, copy]) => (
              <div key={n}><span className="step-number">{n}</span><h3>{title}</h3><p>{copy}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-container bottom-cta">
        <div>
          <h2>EVERY LAP HAS <span>MORE TO GIVE.</span></h2>
          <p>Find the details that make the difference.</p>
        </div>
        <Link href={user ? '/racing' : '/signup'} className={buttonVariants({ variant: 'racing' })}>
          {user ? 'Open your race engineer' : 'Meet your race engineer'} <ArrowRight />
        </Link>
      </section>
    </>
  );
}
