import Link from 'next/link';
import type { ReactNode } from 'react';
import { COLLECTOR_DOWNLOAD_URL } from '@/lib/collectorDownload';
import { getDictionary, getLanguage } from '@/lib/i18n/server';

const primaryButton =
  'inline-block px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors';
const outlineButton =
  'inline-block px-5 py-2 rounded-lg text-sm font-semibold text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors';

function Step({ number, label, title, children }: { number: number; label: string; title: string; children: ReactNode }) {
  return (
    <article className="bg-card rounded-xl border border-border p-4 sm:p-6 flex gap-4 sm:gap-6">
      <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white text-lg font-bold" aria-hidden>
        {number}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label} {number}</p>
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
        </div>
        {children}
      </div>
    </article>
  );
}

// The Installing RacingCoach page (the nav bar's Installing RacingCoach link): how to get started, in three
// steps: download the collector, copy the upload key into it (from My Settings' Telemetry Collector card),
// and contact Support with questions
export default async function InstallingPage() {
  const t = getDictionary(await getLanguage()).installing;
  const text = 'text-sm sm:text-base leading-relaxed text-muted-foreground';

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.pageTitle}
          </h1>
          <p className={text}>{t.intro}</p>
        </div>

        <Step number={1} label={t.step} title={t.downloadTitle}>
          <p className={text}>{t.downloadText}</p>
          <a href={COLLECTOR_DOWNLOAD_URL} className={primaryButton}>{t.downloadButton}</a>
          <ul className={`${text} list-disc pl-5 space-y-1`}>
            {t.downloadNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </Step>

        <Step number={2} label={t.step} title={t.keyTitle}>
          <p className={text}>{t.keyText}</p>
          <ol className={`${text} list-decimal pl-5 space-y-1`}>
            {t.keySteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <Link href="/account" className={outlineButton}>{t.keyButton}</Link>
          <p className={text}>{t.keyLost}</p>
        </Step>

        <Step number={3} label={t.step} title={t.supportTitle}>
          <p className={text}>{t.supportText}</p>
          <Link href="/support" className={outlineButton}>{t.supportButton}</Link>
        </Step>
      </div>
    </section>
  );
}
