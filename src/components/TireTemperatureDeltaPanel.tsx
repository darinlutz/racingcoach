'use client';

import ComparativeTireGauge from '@/components/ComparativeTireGauge';
import { useLanguage } from '@/components/LanguageProvider';
import TireTreadComparison from '@/components/TireTreadComparison';
import { useUnits } from '@/components/UnitsProvider';
import {
  deltaColor,
  formatDelta,
  formatTireTemp,
  shownDelta,
  type TireComparison,
  type TireEdge,
  type TireLapChannel,
} from '@/lib/tireTempComparison';

export type TireDisplayMode = 'average' | 'imo' | 'delta';

const LEFT_ORDER: TireEdge[] = ['outer', 'middle', 'inner'];
const RIGHT_ORDER: TireEdge[] = ['inner', 'middle', 'outer'];

// One tire: its gauge, the difference in large type, each lap's lowest, average and highest in the scope, and across
// the tread. A difference that can't be shown says N/A, with why under it; the laps' own readings still show.
// Neither direction is called better or worse: only hotter, cooler or equal.
export default function TireTemperatureDeltaPanel({
  comparison,
  display,
  highlighted,
  onHover,
  onSelect,
}: {
  comparison: TireComparison;
  display: TireDisplayMode;
  highlighted: boolean;
  onHover: (hovering: boolean) => void;
  onSelect: () => void;
}) {
  const { t, locale, fmt } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const { corner, target, compare, deltas, reason, targetChannel, compareChannel, targetSessionTime, compareSessionTime } = comparison;
  const color = deltas.avg === null ? undefined : deltaColor(deltas.avg);
  const tireColor = `var(--tire-${corner.toLowerCase()})`;
  // As the two laps' averages read on screen
  const shown = deltas.avg === null || target.avg === null || compare.avg === null ? null : shownDelta(compare.avg, target.avg, units);
  const word = shown === null ? '' : shown === 0 ? labels.equal : shown > 0 ? labels.hotter : labels.cooler;

  const temp = (value: number | null) => (value === null ? labels.na : formatTireTemp(value, units, locale));
  const rows = [
    { key: 'target', label: labels.tgt, reading: target, className: 'text-lap-target' },
    { key: 'compare', label: labels.cmp, reading: compare, className: 'text-lap-compare' },
  ];
  const stats = ['min', 'avg', 'max'] as const;
  const diff = (stat: (typeof stats)[number]) => {
    const [a, b] = [target[stat], compare[stat]];
    return deltas[stat] === null || a === null || b === null ? labels.na : formatDelta(shownDelta(b, a, units), locale);
  };
  // What each lap's reading is, and when it was taken where that's known
  const channelText = (channel: TireLapChannel, sessionTime: number | null) => {
    if (!channel.layer) return labels.na;
    const layer = channel.layer === 'surface' ? labels.surface : labels.carcass;
    if (!channel.continuous) return fmt(labels.channelSnapshot, { layer });
    return sessionTime === null
      ? layer
      : fmt(labels.channelAt, { layer, time: sessionTime.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  };

  return (
    <section
      id={`gauge-${corner.toLowerCase()}`}
      data-gauge={corner}
      data-highlighted={highlighted}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onSelect}
      className="rc-panel relative cursor-pointer overflow-hidden p-3 transition-shadow duration-200"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: tireColor,
        boxShadow: highlighted ? `0 0 0 1px var(--foreground), 0 0 24px -6px ${color ?? 'var(--foreground)'}` : undefined,
      }}
    >
      <header className="mb-2 flex items-baseline gap-2">
        <span className="rc-num text-xs font-bold" style={{ color: tireColor }}>{corner}</span>
        <h5 className="text-sm font-semibold uppercase tracking-[0.14em] text-foreground">{t.charts.tireCorners[corner]}</h5>
      </header>

      <div className="grid grid-cols-[auto_1fr] items-center gap-3">
        <ComparativeTireGauge target={target.avg} compare={compare.avg} />
        <div className="flex min-w-0 flex-col items-end">
          <span className="rc-label">{labels.deltaLabel}</span>
          <span data-delta className="rc-num text-4xl font-bold leading-none tracking-tight" style={{ color }}>
            {shown === null ? labels.na : formatDelta(shown, locale)}
          </span>
          <span className="mt-1 min-h-4 text-xs uppercase tracking-[0.14em]" style={{ color }}>{word}</span>
          <table className="rc-num mt-2 text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th />
                {stats.map((stat) => (
                  <th key={stat} className="px-1.5 font-normal uppercase">{labels[stat]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label, reading, className }) => (
                <tr key={key} className={className}>
                  <td className="pr-1 text-[9px] tracking-widest">{label}</td>
                  {stats.map((stat) => (
                    <td key={stat} className="px-1.5 text-right">{temp(reading[stat])}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="pr-1 text-[9px] tracking-widest text-muted-foreground">Δ</td>
                {stats.map((stat) => {
                  const delta = deltas[stat];
                  return (
                    <td key={stat} className="px-1.5 text-right font-bold" style={delta === null ? undefined : { color: deltaColor(delta) }}>
                      {diff(stat)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {display !== 'average' && (
        <div className="mt-3 border-t border-border pt-2.5">
          <TireTreadComparison
            comparison={comparison}
            variant={display === 'delta' ? 'delta' : 'imo'}
            order={corner[0] === 'L' ? LEFT_ORDER : RIGHT_ORDER}
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-[10px] text-muted-foreground">
        <span><span className="text-lap-target">{labels.tgt}</span> {channelText(targetChannel, targetSessionTime)}</span>
        <span><span className="text-lap-compare">{labels.cmp}</span> {channelText(compareChannel, compareSessionTime)}</span>
      </div>
      {reason && <p data-reason={reason} className="mt-1.5 text-xs text-muted-foreground">{labels.reasons[reason]}</p>}
    </section>
  );
}
