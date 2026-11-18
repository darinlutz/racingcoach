'use client';

import { useLanguage } from '@/components/LanguageProvider';
import {
  AXLES,
  changeDirection,
  formatSuspension,
  heightAsymmetry,
  heightDifference,
  percentChange,
  topicOf,
  type SuspensionComparison,
  type SuspensionItem,
  type SuspensionValue,
} from '@/lib/suspensionGeometry';

// The Suspension tab's list of changes (from the Lovable design's "Suspension changes & engineering analysis"): every
// value that differs, with what the change is and what that part of the suspension influences in general (never which
// setup is better), then the derived height differences, what couldn't be read, and the Setup Engineer button
export default function SuspensionChangesSummary({ comparison, actions }: { comparison: SuspensionComparison; actions?: React.ReactNode }) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups.suspension;
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const name = (i: SuspensionItem) => `${i.scope === 'front' || i.scope === 'rear' ? s.axles[i.scope] : s.corners[i.scope]} · ${s.params[i.param]}`;
  const amount = (i: SuspensionItem) => {
    if (!i.delta) return '';
    if (i.delta.pair) return formatSuspension({ ...i.delta, pair: i.delta.pair }, true);
    return formatSuspension({ ...i.delta, value: Math.abs(i.delta.value) });
  };

  // The derived rows: rear minus front, and right minus left on each axle, when either setup has them and they differ
  const derived: { key: string; label: string; a: SuspensionValue | null; b: SuspensionValue | null; topic: string }[] = [];
  const differs = (a: SuspensionValue | null, b: SuspensionValue | null) => (a || b) && (a?.value ?? NaN) !== (b?.value ?? NaN);
  const hd = [heightDifference(comparison, 'baseline'), heightDifference(comparison, 'comparison')] as const;
  if (differs(...hd)) derived.push({ key: 'height', label: s.heightDifferenceRow, a: hd[0], b: hd[1], topic: s.heightDifferenceTopic });
  for (const axle of AXLES) {
    const asym = [heightAsymmetry(comparison, axle, 'baseline'), heightAsymmetry(comparison, axle, 'comparison')] as const;
    if (differs(...asym)) derived.push({ key: `asym-${axle}`, label: fmt(s.asymmetryRow, { axle: s.axles[axle] }), a: asym[0], b: asym[1], topic: s.asymmetryTopic });
  }
  const derivedDelta = (a: SuspensionValue | null, b: SuspensionValue | null) =>
    a && b && a.unit === b.unit ? formatSuspension({ value: b.value - a.value, unit: a.unit, decimals: Math.max(a.decimals, b.decimals) }, true) : '—';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          {s.summaryTitle}
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            {plural(changed.length, s.summaryCount, { count: changed.length })}
          </span>
        </h3>
        {actions}
      </div>
      {changed.length === 0 && derived.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{s.summaryNone}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-secondary text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{t.setups.common.parameter}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.baseline}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.comparison}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.delta}</th>
                <th className="px-3 py-2 font-semibold">{s.interpretation}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((i) => {
                const pct = i.param === 'springRate' ? percentChange(i) : null;
                return (
                  <tr key={i.id} className="border-t border-border align-top" title={i.path}>
                    <td className="px-3 py-2 font-semibold text-foreground">
                      {name(i)}
                      {i.reading && <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-normal text-muted-foreground">{s.readingTag}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-align-baseline">{formatSuspension(i.baseline)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-align-comparison">{formatSuspension(i.comparison)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">
                      {formatSuspension(i.delta, true)}
                      {pct != null && <span className="block text-[11px] text-muted-foreground">{`${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%`}</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <span className="font-semibold text-foreground">{fmt(s.direction[changeDirection(i)], { amount: amount(i) })}</span>{' '}
                      {i.status === 'changed' && s.topics[topicOf(i)]}
                    </td>
                  </tr>
                );
              })}
              {derived.map((d) => (
                <tr key={d.key} className="border-t border-border bg-secondary/40 align-top">
                  <td className="px-3 py-2 font-semibold text-foreground">{d.label}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-align-baseline">{formatSuspension(d.a, true)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-align-comparison">{formatSuspension(d.b, true)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{derivedDelta(d.a, d.b)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.topic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changed.some((i) => i.status === 'changed') && <p className="text-xs text-muted-foreground">{s.hedge}</p>}
      {comparison.unsupported.length > 0 && (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">{s.unsupportedTitle}</div>
          {comparison.unsupported.map((i) => (
            <div key={i.path} className="font-mono">
              {fmt(s.unsupportedItem, { path: i.path, baseline: i.baselineRaw ?? '—', comparison: i.comparisonRaw ?? '—' })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
