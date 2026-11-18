'use client';

import { ScanLine } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import { asymmetries, changeDirection, formatAlignment, topicOf, type AlignmentComparison, type AlignmentItem } from '@/lib/alignmentGeometry';

// ALIGNMENT CHANGES: every alignment value that differs, by axle and wheel (compareAlignment's order), with its
// baseline, comparison, delta and what the change does; then what's unchanged, left/right asymmetry and anything that
// couldn't be read. Says what changed, never which setup is better
export default function AlignmentComparisonSummary({ comparison }: { comparison: AlignmentComparison }) {
  const { t, fmt, plural } = useLanguage();
  const a = t.setups.alignment;
  const label = (item: Pick<AlignmentItem, 'scope' | 'param'>) =>
    `${item.scope === 'front' || item.scope === 'rear' ? a.axles[item.scope] : a.corners[item.scope]} · ${a.params[item.param]}`;
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const same = comparison.items.filter((i) => i.status === 'same');
  const asym = asymmetries(comparison);
  const explain = (item: AlignmentItem) => {
    const direction = changeDirection(item);
    const amount = item.delta ? formatAlignment({ ...item.delta, value: Math.abs(item.delta.value) }) : '';
    return fmt(a.direction[direction], { amount });
  };
  return (
    <section aria-labelledby="alignment-changes" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="alignment-changes" className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
          <ScanLine className="size-4 text-muted-foreground" aria-hidden />
          {a.summaryTitle}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
            {plural(changed.length, a.summaryCount, { count: changed.length })}
          </span>
        </h4>
        <span className="text-xs text-muted-foreground">{a.summaryRelative}</span>
      </div>
      {changed.length === 0 ? (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{a.summaryNone}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{t.setups.common.parameter}</th>
                <th className="px-3 py-2 text-right font-semibold text-align-baseline">{a.baseline}</th>
                <th className="px-3 py-2 text-right font-semibold text-align-comparison">{a.comparison}</th>
                <th className="px-3 py-2 text-right font-semibold">{a.delta}</th>
                <th className="px-3 py-2 font-semibold">{a.explanation}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((item) => (
                <tr key={item.id} className="border-t border-border align-top" title={item.path}>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{label(item)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-baseline" title={item.baselineRaw ?? undefined}>
                    {formatAlignment(item.baseline)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-comparison" title={item.comparisonRaw ?? undefined}>
                    {formatAlignment(item.comparison)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums text-foreground">{formatAlignment(item.delta, true)}</td>
                  <td className="min-w-64 px-3 py-2 text-xs text-muted-foreground">
                    <span className="text-foreground">{explain(item)}</span> {a.topics[topicOf(item)]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {same.length > 0 && <p className="text-xs text-muted-foreground">{fmt(a.unchangedList, { list: same.map(label).join(', ') })}</p>}
      {asym.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">{a.asymmetryTitle}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {asym.map((x) => {
              const value = (v: number | null) => (v == null ? '—' : formatAlignment({ value: v, unit: x.unit, decimals: x.decimals }, true));
              return (
                <li key={`${x.axle}.${x.param}`}>
                  {fmt(a.asymmetry, { axle: a.axles[x.axle], param: a.params[x.param].toLowerCase(), baseline: value(x.baseline), comparison: value(x.comparison) })}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {comparison.unsupported.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">{a.unsupportedTitle}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {comparison.unsupported.map((i) => (
              <li key={i.path} className="font-mono">
                {fmt(a.unsupportedItem, { path: i.path, baseline: i.baselineRaw ?? '—', comparison: i.comparisonRaw ?? '—' })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
