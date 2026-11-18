'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { formatAlignment, type AlignmentComparison, type AlignmentItem, type Axle, type Corner } from '@/lib/alignmentGeometry';

// One corner's (or axle's) alignment values in a compact table: Baseline, Comparison and Delta, in the values' own
// units and decimals. Clicking a corner's panel selects that wheel in the diagrams
export default function AlignmentDataPanel({
  comparison,
  scope,
  selected = false,
  onSelect,
}: {
  comparison: AlignmentComparison;
  scope: Corner | Axle;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t, fmt } = useLanguage();
  const a = t.setups.alignment;
  const corner = scope !== 'front' && scope !== 'rear';
  const items = comparison.items.filter((i) => i.scope === scope);
  const title = corner ? a.corners[scope] : a.axles[scope];
  const front = corner && scope.endsWith('F');
  const axleToe = corner && !items.some((i) => i.param === 'toe') && comparison.items.some((i) => i.param === 'totalToe' && i.scope === (front ? 'front' : 'rear'));
  const body = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</span>
        {corner && <span className="font-mono text-[10px] text-muted-foreground">{a.cornerShort[scope]}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{a.noCornerData}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide">
              <th className="sr-only">{t.setups.common.parameter}</th>
              <th className="py-0.5 text-right font-semibold text-align-baseline" title={a.baseline}>
                {a.baseline.slice(0, 1)}
              </th>
              <th className="py-0.5 text-right font-semibold text-align-comparison" title={a.comparison}>
                {a.comparison.slice(0, 1)}
              </th>
              <th className="py-0.5 text-right font-semibold text-muted-foreground" title={a.delta}>
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Row key={item.id} item={item} label={a.params[item.param]} />
            ))}
          </tbody>
        </table>
      )}
      {axleToe && <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{fmt(a.fromAxle, { axle: a.axles[front ? 'front' : 'rear'].toLowerCase() })}</p>}
    </>
  );
  const frame = `block w-full rounded-md border bg-card/95 p-2.5 text-left transition-colors ${selected ? 'border-align-baseline' : 'border-border'}`;
  if (!onSelect) return <div className={frame}>{body}</div>;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`${frame} hover:border-align-baseline/60 focus-visible:outline-2 focus-visible:outline-align-baseline`}>
      {body}
    </button>
  );
}

function Row({ item, label }: { item: AlignmentItem; label: string }) {
  const changed = item.status !== 'same';
  return (
    <tr className="border-t border-border/60" title={item.path}>
      <td className="py-0.5 pr-1 text-muted-foreground">{label}</td>
      <td className={`py-0.5 text-right font-mono tabular-nums ${changed ? 'text-align-baseline' : 'text-align-neutral'}`} title={item.baselineRaw ?? undefined}>
        {formatAlignment(item.baseline)}
      </td>
      <td className={`py-0.5 text-right font-mono tabular-nums ${changed ? 'text-align-comparison' : 'text-align-neutral'}`} title={item.comparisonRaw ?? undefined}>
        {formatAlignment(item.comparison)}
      </td>
      <td className={`py-0.5 pl-1 text-right font-mono tabular-nums ${changed ? 'font-semibold text-foreground' : 'text-align-neutral'}`}>{formatAlignment(item.delta, true)}</td>
    </tr>
  );
}
