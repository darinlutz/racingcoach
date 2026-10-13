import type { Metadata } from 'next';
import { GraduationCap } from 'lucide-react';
import LearningGuide from '@/components/LearningGuide';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getGuide } from '@/lib/learningGuide';

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLanguage()).learning;
  return { title: t.metaTitle, description: t.metaDescription };
}

// The Learning page: the guide "The Art of Driving a Race Car" (src/lib/learningGuide.ts) in the user's language, open to everyone
export default async function LearningPage() {
  const language = await getLanguage();
  const t = getDictionary(language).learning;
  const GUIDE = getGuide(language);

  return (
    <section className="py-10 sm:py-14">
      <div className="site-container space-y-10">
        <header className="relative overflow-hidden rounded-lg border border-border bg-card px-6 py-9 sm:px-10 sm:py-12">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
          <div className="relative max-w-3xl">
            <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[2px] text-muted-foreground">
              <span className="h-[2px] w-6 bg-primary" aria-hidden="true" />
              {t.eyebrow}
            </div>
            <h1 className="mt-4 font-display text-5xl sm:text-6xl font-bold uppercase leading-[0.98] text-foreground">
              {GUIDE.title}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">{GUIDE.subtitle}</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {GUIDE.topics.map((topic) => (
                <li key={topic} className="rounded-full border border-border bg-secondary px-3 py-1 text-sm font-semibold text-foreground/90">
                  {topic}
                </li>
              ))}
            </ul>
            <p className="mt-6 flex gap-2.5 text-sm text-muted-foreground">
              <GraduationCap className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {GUIDE.note}
            </p>
          </div>
        </header>

        <LearningGuide chapters={GUIDE.chapters} figures={GUIDE.figures} />
      </div>
    </section>
  );
}
