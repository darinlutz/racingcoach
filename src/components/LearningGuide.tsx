'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Flag, Target, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import LearningFigure from '@/components/LearningFigures';
import { fmt } from '@/lib/i18n/languages';
import type { FigureLabels, GuideChapter, GuideSection } from '@/lib/learningGuide';

const chapterNumber = (i: number) => String(i + 1).padStart(2, '0');

function Callout({ section }: { section: GuideSection }) {
  if (section.kind === 'principle') {
    return (
      <blockquote className="md:col-span-2 relative rounded-lg border border-primary/40 bg-accent px-6 py-6 sm:px-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[2px] text-primary">
          <Flag className="h-4 w-4" /> {section.heading}
        </div>
        <p className="mt-3 font-display text-2xl sm:text-[28px] leading-tight font-semibold text-foreground">{section.body}</p>
      </blockquote>
    );
  }
  const drill = section.kind === 'drill';
  const Icon = drill ? Target : TriangleAlert;
  return (
    <div className={`md:col-span-2 rounded-lg border-l-4 p-4 sm:p-5 ${drill ? 'border-l-primary bg-secondary' : 'border-l-amber-400 bg-secondary'}`}>
      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[2px] ${drill ? 'text-primary' : 'text-amber-400'}`}>
        <Icon className="h-4 w-4" /> {section.heading}
      </div>
      <p className="mt-2 leading-relaxed text-foreground">{section.body}</p>
    </div>
  );
}

// The guide's chapters as collapsible cards, with a table of contents beside them on wide screens. The page
// passes the chapters and figure labels in the user's language
export default function LearningGuide({ chapters: CHAPTERS, figures }: { chapters: GuideChapter[]; figures: FigureLabels }) {
  const { t: dict } = useLanguage();
  const t = dict.learning;
  const [open, setOpen] = useState<Set<string>>(() => new Set([CHAPTERS[0].id]));
  const allOpen = open.size === CHAPTERS.length;

  // A link to /learning#<chapter> opens that chapter
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      if (CHAPTERS.some((c) => c.id === id)) setOpen((prev) => new Set(prev).add(id));
    };
    const frame = requestAnimationFrame(openFromHash);
    window.addEventListener('hashchange', openFromHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', openFromHash);
    };
  }, [CHAPTERS]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const goTo = (id: string) => {
    setOpen((prev) => new Set(prev).add(id));
    history.replaceState(null, '', `#${id}`);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(CHAPTERS.map((c) => c.id)));

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] items-start">
      <nav aria-label={t.contents} className="lg:sticky lg:top-6 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[2px] text-muted-foreground">{t.contents}</h2>
          <span className="text-xs text-muted-foreground">{fmt(t.chapters, { n: CHAPTERS.length })}</span>
        </div>
        <ol className="mt-4 space-y-1 max-lg:grid max-lg:grid-cols-1 sm:max-lg:grid-cols-2 max-lg:gap-x-4 max-lg:space-y-0">
          {CHAPTERS.map((chapter, i) => (
            <li key={chapter.id}>
              <a
                href={`#${chapter.id}`}
                onClick={(e) => { e.preventDefault(); goTo(chapter.id); }}
                className="group flex gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors"
              >
                <span className={`font-display font-semibold ${open.has(chapter.id) ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>{chapterNumber(i)}</span>
                <span className="text-foreground/90 group-hover:text-foreground">{chapter.title}</span>
              </a>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={toggleAll}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-primary"
        >
          {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
          {allOpen ? t.collapseAll : t.expandAll}
        </button>
      </nav>

      <div className="space-y-4 min-w-0">
        {CHAPTERS.map((chapter, i) => {
          const isOpen = open.has(chapter.id);
          const panelId = `${chapter.id}-panel`;
          return (
            <article
              key={chapter.id}
              id={chapter.id}
              className={`scroll-mt-[100px] lg:scroll-mt-6 rounded-lg border bg-card transition-colors ${isOpen ? 'border-primary/50 shadow-[var(--shadow-panel)]' : 'border-border hover:border-primary/40'}`}
            >
              <h2>
                <button
                  type="button"
                  onClick={() => toggle(chapter.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  data-track={`learning-chapter-${chapter.id}`}
                  className="w-full flex items-center gap-4 sm:gap-6 p-5 sm:px-7 text-left"
                >
                  <span className="font-display text-4xl sm:text-5xl font-semibold leading-none text-primary tabular-nums">{chapterNumber(i)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-display text-xl sm:text-2xl font-semibold leading-tight text-foreground">{chapter.title}</span>
                    <span className="block mt-1 text-sm text-muted-foreground">{chapter.summary}</span>
                  </span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
                </button>
              </h2>
              <div
                id={panelId}
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
                <div className="overflow-hidden" inert={!isOpen}>
                  <div className="border-t border-border px-5 pb-7 pt-6 sm:px-7 space-y-7">
                    <div className="rounded-lg border border-border bg-background/60 p-4 sm:p-6">
                      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="font-semibold text-foreground">{chapter.figureTitle}</h3>
                        <span className="text-xs font-semibold uppercase tracking-[2px] text-primary">{fmt(t.figure, { n: i + 1 })}</span>
                      </div>
                      <LearningFigure index={i} title={chapter.figureTitle} labels={figures} />
                      <p className="mt-3 text-center text-xs italic text-muted-foreground">{t.figureNote}</p>
                    </div>
                    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                      {chapter.sections.map((section) =>
                        section.kind ? (
                          <Callout key={section.heading} section={section} />
                        ) : (
                          <section key={section.heading}>
                            <h3 className="flex items-center gap-2.5 font-semibold text-foreground">
                              <span className="h-[2px] w-4 bg-primary" aria-hidden="true" />
                              {section.heading}
                            </h3>
                            <p className="mt-2 leading-relaxed text-muted-foreground whitespace-pre-line">{section.body}</p>
                          </section>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
