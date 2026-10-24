'use client';

import { ArrowDownWideNarrow, ChevronLeft, ChevronRight, ListOrdered } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';

export type FocusAreaTab = { name: string; diff: number };

// Lap Compare's focus areas across the top, each with the time the Compare lap lost (red, +) or
// gained (green, -) there, tinted by how much. Picking one shows its telemetry below; only one at a
// time. The button on the left switches between most time lost first and track order (areas come in
// track order); the arrows scroll the strip when the areas don't all fit.
export default function FocusAreaTabs({
  areas,
  selected,
  onSelect,
  panelId,
}: {
  areas: FocusAreaTab[];
  selected: string;
  onSelect: (name: string) => void;
  panelId: string;
}) {
  const { t: dictionary, locale } = useLanguage();
  const t = dictionary.lapCompare;
  const stripRef = useRef<HTMLDivElement>(null);
  const [byTimeLost, setByTimeLost] = useState(true);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const shown = byTimeLost ? [...areas].sort((a, b) => b.diff - a.diff) : areas;
  const largest = Math.max(...areas.map((a) => Math.abs(a.diff)), 0.001);

  const updateScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    setCanScroll({ left: strip.scrollLeft > 1, right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1 });
  };

  useEffect(() => {
    updateScroll();
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [areas, byTimeLost]);

  // Keep the picked area in view, e.g. after re-sorting or picking with the keyboard. Only the strip
  // scrolls (scrollIntoView would scroll the page to it too)
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior: 'smooth' });
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: left + tab.offsetWidth - strip.clientWidth, behavior: 'smooth' });
  }, [selected, byTimeLost]);

  const scrollBy = (direction: 1 | -1) => {
    const strip = stripRef.current;
    strip?.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Left/Right, Home and End move between the tabs, as a tab list does
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = shown.findIndex((a) => a.name === selected);
    const next =
      event.key === 'ArrowRight' ? Math.min(index + 1, shown.length - 1)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? shown.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(shown[next].name);
    stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  const seconds = (diff: number) =>
    `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}s`;

  const arrowClass =
    'shrink-0 flex items-center justify-center w-9 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors';

  return (
    <div className="flex items-stretch h-14 bg-card border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setByTimeLost((v) => !v)}
        title={byTimeLost ? t.sortByTimeLost : t.sortByTrackOrder}
        aria-label={byTimeLost ? t.sortByTimeLost : t.sortByTrackOrder}
        className="shrink-0 flex items-center justify-center w-12 bg-secondary border-r border-border text-foreground hover:bg-background transition-colors"
      >
        {byTimeLost ? <ArrowDownWideNarrow size={22} /> : <ListOrdered size={22} />}
      </button>
      {canScroll.left && (
        <button type="button" onClick={() => scrollBy(-1)} aria-label={t.scrollAreasLeft} className={arrowClass}>
          <ChevronLeft size={20} />
        </button>
      )}
      <div
        ref={stripRef}
        role="tablist"
        aria-label={t.areaTabs}
        onScroll={updateScroll}
        onKeyDown={onKeyDown}
        className="flex flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shown.map((area) => {
          const isSelected = area.name === selected;
          // Tint by share of the biggest difference: red where the Compare lap lost time, green where it gained
          const strength = 0.06 + 0.3 * (Math.abs(area.diff) / largest);
          const tint = area.diff > 0 ? `rgba(255, 64, 64, ${strength})` : area.diff < 0 ? `rgba(34, 197, 94, ${strength})` : undefined;
          return (
            <button
              key={area.name}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelId}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(area.name)}
              style={isSelected ? undefined : { backgroundColor: tint }}
              className={`shrink-0 flex items-center gap-3 px-4 border-r border-border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${
                isSelected ? 'bg-sky-600 text-white' : 'text-foreground hover:brightness-125'
              }`}
            >
              <span className="font-display text-2xl font-bold leading-none whitespace-nowrap">{area.name}</span>
              <span
                className={`font-display text-base font-semibold tabular-nums whitespace-nowrap ${
                  isSelected ? 'text-white/85' : area.diff > 0 ? 'text-red-400' : area.diff < 0 ? 'text-green-400' : 'text-muted-foreground'
                }`}
              >
                {seconds(area.diff)}
              </span>
            </button>
          );
        })}
      </div>
      {canScroll.right && (
        <button type="button" onClick={() => scrollBy(1)} aria-label={t.scrollAreasRight} className={arrowClass}>
          <ChevronRight size={20} />
        </button>
      )}
    </div>
  );
}
