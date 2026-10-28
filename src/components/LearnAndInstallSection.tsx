import Link from 'next/link';
import { ArrowRight, BookOpen, Check, Download, Wrench } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// Landing page's lessons and installation steps; the hero's How it works button scrolls here.
// installHref is the Installing page for signed-in users, else Create an Account.
export default function LearnAndInstallSection({ t, installHref }: { t: Dictionary['home']; installHref: string }) {
  return (
    <section className="method" id="how-it-works">
      <div className="site-container learn-grid">
        <div className="feature-card">
          <h3><BookOpen />{t.learnHeading}</h3>
          <p className="muted-copy">{t.learnCopy}</p>
          <ul className="check-list">
            {t.learnTopics.map((topic) => <li key={topic}><Check />{topic}</li>)}
          </ul>
        </div>
        <div className="feature-card">
          <h3><Wrench />{t.installHeading}</h3>
          <div className="steps">
            {t.installSteps.map((step, i) => (
              <div key={step.title}><span className="step-number">{String(i + 1).padStart(2, '0')}</span><h3>{step.title}</h3><p>{step.copy}</p></div>
            ))}
          </div>
          <Link href={installHref} className={buttonVariants({ variant: 'racing', className: 'justify-self-start' })}>
            <Download />{t.getApp} <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}
