'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { TireCorner } from '@/lib/lapData';
import { TIRE_CORNERS } from '@/lib/lapData';
import {
  deltaColor,
  formatCelsiusDelta,
  formatTireTemp,
  summarizeTires,
  type TireComparison,
  type TireExtreme,
} from '@/lib/tireTempComparison';

// The biggest differences across the car, Compare minus Target, from the tires that can be compared; how many that
// is out of four when it isn't all of them. — means no tire qualifies (nothing ran hotter, say)
export default function TireDeltaSummary({ comparisons }: { comparisons: Record<TireCorner, TireComparison> }) {
  const { t, locale, fmt } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const summary = summarizeTires(comparisons);
  const list = TIRE_CORNERS.map((corner) => comparisons[corner]);

  const extreme = (label: string, value: TireExtreme | null) => ({ key: label, label, delta: value?.delta ?? null, corner: value?.corner });
  const rows = [
    extreme(labels.largestPositive, summary.largestPositive),
    extreme(labels.largestNegative, summary.largestNegative),
    extreme(labels.largestAbsolute, summary.largestAbsolute),
    { key: labels.frontAxle, label: labels.frontAxle, delta: summary.frontAxle, corner: undefined },
    { key: labels.rearAxle, label: labels.rearAxle, delta: summary.rearAxle, corner: undefined },
    extreme(labels.largestSpread, summary.largestSpread),
  ];

  // The hottest tire of each lap, by its average in this scope
  const hottest = (key: 'target' | 'compare') =>
    list.reduce<{ corner: TireCorner; avg: number } | null>((best, comparison) => {
      const avg = comparison[key].avg;
      return avg !== null && (!best || avg > best.avg) ? { corner: comparison.corner, avg } : best;
    }, null);
  const hottestLaps = [
    { key: 'target', lap: labels.target, value: hottest('target'), className: 'text-lap-target' },
    { key: 'compare', lap: labels.compare, value: hottest('compare'), className: 'text-lap-compare' },
  ];

  return (
    <div className="rc-panel p-3" data-summary>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">{labels.summaryTitle}</h5>
        <span className="rc-label">{labels.compareMinusTarget}</span>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm bg-border">
        {rows.map(({ key, label, delta, corner }) => (
          <div key={key} className="bg-card px-2.5 py-2">
            <div className="rc-label flex items-center justify-between gap-1">
              {label}
              {corner && (
                <span className="rc-num font-bold" style={{ color: `var(--tire-${corner.toLowerCase()})` }} title={t.charts.tireCorners[corner]}>
                  {corner}
                </span>
              )}
            </div>
            <div className="rc-num text-xl font-bold" style={delta === null ? undefined : { color: deltaColor(delta) }}>
              {delta === null ? '—' : formatCelsiusDelta(delta, units, locale)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {hottestLaps.map(({ key, lap, value, className }) => (
          <div key={key} className="rounded-sm border border-border px-2.5 py-1.5">
            <div className="rc-label">{fmt(labels.hottest, { lap })}</div>
            <div className="flex items-baseline justify-between">
              <span className="rc-num text-sm font-bold" style={value ? { color: `var(--tire-${value.corner.toLowerCase()})` } : undefined}>
                {value?.corner ?? '—'}
              </span>
              <span className={`rc-num text-base font-bold ${className}`}>{value ? formatTireTemp(value.avg, units, locale) : labels.na}</span>
            </div>
          </div>
        ))}
      </div>
      {summary.comparable < TIRE_CORNERS.length && (
        <p className="mt-2 text-xs text-muted-foreground">{fmt(labels.comparableCount, { n: summary.comparable })}</p>
      )}
    </div>
  );
}
