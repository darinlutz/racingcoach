'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import {
  DELTA_FULL_SCALE,
  deltaColor,
  formatCelsiusDelta,
  formatDelta,
  formatTireSpread,
  formatTireTemp,
  shownDelta,
  type TireComparison,
  type TireEdge,
} from '@/lib/tireTempComparison';

// The bars' range (°C)
const RANGE: [number, number] = [60, 125];

// Each edge of the tread on both laps with its difference, then the difference in how far apart the inner and outer
// edges were. variant 'imo' shows each lap's temperature as a bar, 'delta' a bar each way from zero. order is left
// to right as seen on the car. Nothing here says what a spread means: temperatures alone can't tell camber from pressure
export default function TireTreadComparison({
  comparison,
  variant,
  order,
}: {
  comparison: TireComparison;
  variant: 'imo' | 'delta';
  order: TireEdge[];
}) {
  const { t, locale } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const { target, compare, deltas, targetSpread, compareSpread } = comparison;
  const pct = (value: number) => Math.max(2, Math.min(100, ((value - RANGE[0]) / (RANGE[1] - RANGE[0])) * 100));
  const temp = (value: number | null) => (value === null ? labels.na : formatTireTemp(value, units, locale));
  const edgeLabel: Record<TireEdge, string> = { inner: labels.inner, middle: labels.middle, outer: labels.outer };
  const bar = (value: number | null, color: string) => (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-sm bg-secondary">
        {value !== null && <div className="h-full rounded-sm transition-all duration-300" style={{ width: `${pct(value)}%`, background: color }} />}
      </div>
      <span className="rc-num w-12 text-right text-[11px]" style={{ color }}>{temp(value)}</span>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {order.map((edge) => {
        const [targetValue, compareValue] = [target.segments[edge], compare.segments[edge]];
        const delta = deltas[edge];
        const half = delta === null ? 0 : Math.min(50, (Math.abs(delta) / (DELTA_FULL_SCALE * 1.5)) * 50);
        return (
          <div key={edge} data-edge={edge} className="grid grid-cols-[3.4rem_1fr_3.6rem] items-center gap-2">
            <span className="rc-label">{edgeLabel[edge]}</span>
            {variant === 'imo' ? (
              <div className="space-y-0.5">
                {bar(targetValue, 'var(--lap-target)')}
                {bar(compareValue, 'var(--lap-compare)')}
              </div>
            ) : (
              <div className="relative h-4 rounded-sm bg-secondary">
                <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground" />
                {delta !== null && (
                  <div
                    className="absolute inset-y-0.5 rounded-sm transition-all duration-300"
                    style={{ background: deltaColor(delta), left: delta >= 0 ? '50%' : `${50 - half}%`, width: `${half}%` }}
                  />
                )}
                <span className="rc-num absolute inset-y-0 left-1 flex items-center text-[9px] text-lap-target">{temp(targetValue)}</span>
                <span className="rc-num absolute inset-y-0 right-1 flex items-center text-[9px] text-lap-compare">{temp(compareValue)}</span>
              </div>
            )}
            <span className="rc-num text-right text-sm font-bold" style={delta === null ? undefined : { color: deltaColor(delta) }}>
              {delta === null || targetValue === null || compareValue === null
                ? labels.na
                : formatDelta(shownDelta(compareValue, targetValue, units), locale)}
            </span>
          </div>
        );
      })}
      <div data-edge="spread" className="grid grid-cols-[3.4rem_1fr_3.6rem] items-center gap-2 border-t border-border pt-1.5">
        <span className="rc-label">{labels.spread}</span>
        <div className="rc-num flex justify-between text-[11px]">
          <span className="text-lap-target">{targetSpread === null ? labels.na : formatTireSpread(targetSpread, units, locale)}</span>
          <span className="text-lap-compare">{compareSpread === null ? labels.na : formatTireSpread(compareSpread, units, locale)}</span>
        </div>
        <span className="rc-num text-right text-sm font-bold" style={deltas.spread === null ? undefined : { color: deltaColor(deltas.spread) }}>
          {deltas.spread === null ? labels.na : formatCelsiusDelta(deltas.spread, units, locale)}
        </span>
      </div>
    </div>
  );
}
