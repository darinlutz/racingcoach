'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { changeDirection, formatBrake, type BrakeComparison, type BrakeItem } from '@/lib/brakesGeometry';
import { keyLabel } from '@/lib/setupYaml';

// The Brakes tab's list of changes (from the Lovable design): every value that differs, what the change is and what
// that part influences in general (never which setup is better), the LED color marked as lighting, then what couldn't
// be read and the Setup Engineer button
export default function BrakeChangesSummary({ comparison, actions }: { comparison: BrakeComparison; actions?: ReactNode }) {
  const { t, fmt, plural } = useLanguage();
  const b = t.setups.brakes;
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const name = (i: BrakeItem) => (i.param === 'other' ? keyLabel(i.key) : b.params[i.param]);
  const delta = (i: BrakeItem) => {
    if (!i.delta) return '—';
    const text = formatBrake({ ...i.delta, unit: i.param === 'bias' || i.param === 'abs' ? 'setting' : i.delta.unit }, true);
    if (i.param === 'bias') return fmt(b.pp, { value: text });
    if (i.param === 'abs') return fmt(b.positions, { value: text });
    return text;
  };
  const amount = (i: BrakeItem) => {
    if (!i.delta) return '';
    const text = formatBrake({ ...i.delta, value: Math.abs(i.delta.value), unit: i.param === 'bias' || i.param === 'abs' ? 'setting' : i.delta.unit });
    return i.param === 'bias' ? fmt(b.pp, { value: text }) : text;
  };
  const topic = (i: BrakeItem) => (i.param === 'frontMaster' || i.param === 'rearMaster' ? b.topics.masters : b.topics[i.param]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          {b.summaryTitle}
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            {plural(comparison.changedCount, b.summaryCount, { count: comparison.changedCount })}
          </span>
        </h3>
        {actions}
      </div>
      {changed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{b.summaryNone}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-secondary text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{t.setups.common.parameter}</th>
                <th className="px-3 py-2 text-right font-semibold">{b.baseline}</th>
                <th className="px-3 py-2 text-right font-semibold">{b.comparison}</th>
                <th className="px-3 py-2 text-right font-semibold">{b.delta}</th>
                <th className="px-3 py-2 font-semibold">{b.interpretation}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((i) => (
                <tr key={i.id} className={`border-t border-border align-top ${i.param === 'led' ? 'opacity-70' : ''}`} title={i.path}>
                  <td className="px-3 py-2 font-semibold text-foreground">
                    {name(i)}
                    {i.param === 'led' && <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-normal text-muted-foreground">{b.auxiliaryTag}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-align-baseline">{formatBrake(i.baseline)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-align-comparison">{formatBrake(i.comparison)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">{delta(i)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span className="font-semibold text-foreground">{fmt(b.direction[changeDirection(i)], { amount: amount(i) })}</span>{' '}
                    {i.status === 'changed' && topic(i)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changed.some((i) => i.status === 'changed' && i.param !== 'led') && <p className="text-xs text-muted-foreground">{b.hedge}</p>}
      {comparison.unsupported.length > 0 && (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">{b.unsupportedTitle}</div>
          {comparison.unsupported.map((i) => (
            <div key={i.path} className="font-mono">
              {fmt(b.unsupportedItem, { path: i.path, baseline: i.baselineRaw ?? '—', comparison: i.comparisonRaw ?? '—' })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
