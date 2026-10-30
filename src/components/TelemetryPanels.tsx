'use client';

import { useMemo, type ReactNode } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, LapLegend, niceLimit, Readout, signedValue, TARGET_COLOR, type ChartSeries, type Scales } from '@/components/TelemetryChart';
import { useTelemetry, type ChannelPair } from '@/components/TelemetryCursor';
import { deltas, meanAbs, stats } from '@/lib/lapChannels';
import { roundTicks } from '@/lib/lapCharts';

// The pieces the bottom tabs' dashboards are built from. Δ is always Compare minus Target; teal is above zero and
// orange below, which only says which way, never better or worse.

export const DASH_GAP = 12; // gap-3

// A number in the user's locale, or a dash when there isn't one
export function useNumbers() {
  const { locale } = useLanguage();
  return useMemo(
    () => ({
      num: (value: number | null | undefined, digits = 1) =>
        value == null || !Number.isFinite(value) ? '–' : value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
      signed: (value: number | null | undefined, digits = 1) => (value == null || !Number.isFinite(value) ? '–' : signedValue(value, locale, digits)),
    }),
    [locale]
  );
}

// Compare minus Target rounded as they're shown, so the difference always matches the two numbers beside it
export function shownDelta(target: number | null | undefined, compare: number | null | undefined, digits: number) {
  if (target == null || compare == null || !Number.isFinite(target) || !Number.isFinite(compare)) return null;
  return Number((Number(compare.toFixed(digits)) - Number(target.toFixed(digits))).toFixed(digits));
}

// The grid points of the part of the area in view
export function useViewWindow(): [number, number] {
  const { grid, axis } = useTelemetry();
  const { pcts } = grid;
  const [d0, d1] = axis.domain;
  const step = (pcts[pcts.length - 1] - pcts[0]) / (pcts.length - 1);
  return [Math.max(0, Math.round((d0 - pcts[0]) / step)), Math.min(pcts.length - 1, Math.round((d1 - pcts[0]) / step))];
}

// Both laps' values at the crosshair, null without a crosshair or where a lap has none
export function useAtCursor() {
  const { cursorIndex } = useTelemetry();
  return (values: number[] | null | undefined) => {
    if (cursorIndex === null || !values) return null;
    return Number.isFinite(values[cursorIndex]) ? values[cursorIndex] : null;
  };
}

// Each lap's values put through convert, for a chart
export function usePair([target, compare]: ChannelPair, convert: (value: number) => number): ChannelPair {
  return useMemo(() => [target?.map(convert) ?? null, compare?.map(convert) ?? null], [target, compare, convert]);
}

export function Panel({ title, subtitle, right, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-md border border-border bg-card ${className}`}>
      {title != null && (
        <header className="flex min-h-8 flex-wrap items-center gap-x-2 border-b border-border px-3 py-1">
          <h4 className="font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h4>
          {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

const DELTA_SIZES = { sm: 'text-xs', md: 'text-sm', lg: 'text-xl', xl: 'text-3xl', xxl: 'text-5xl' };

// A signed difference, colored by its sign only
export function DeltaIndicator({ value, digits = 1, unit, size = 'md', label = true }: { value: number | null | undefined; digits?: number; unit?: string; size?: keyof typeof DELTA_SIZES; label?: boolean }) {
  const { signed } = useNumbers();
  const known = value != null && Number.isFinite(value);
  const zero = !known || Number(Math.abs(value).toFixed(digits)) === 0;
  const tone = !known ? 'text-muted-foreground' : zero ? 'text-foreground' : value > 0 ? 'text-tele-pos' : 'text-tele-neg';
  return (
    <span className={`tele-num inline-flex items-baseline gap-1 font-semibold leading-none ${DELTA_SIZES[size]} ${tone}`}>
      {label && <span className="text-[0.6em] font-bold opacity-80">Δ</span>}
      {signed(value, digits)}
      {unit && known && <span className="text-[0.55em] font-medium opacity-80">{unit}</span>}
    </span>
  );
}

// One lap's value, marked with the lap's initial and color
export function LapValue({ lap, value, digits, unit }: { lap: 'target' | 'compare'; value: number | null | undefined; digits: number; unit?: string }) {
  const { t } = useLanguage();
  const { num } = useNumbers();
  const labels = t.charts.telemetry;
  return (
    <span className="tele-num inline-flex items-baseline gap-1">
      <span className={`text-[9px] font-bold tracking-widest ${lap === 'target' ? 'text-lap-target' : 'text-lap-compare'}`}>{lap === 'target' ? labels.targetInitial : labels.compareInitial}</span>
      <span className="text-foreground">{num(value, digits)}</span>
      {unit && <span className="text-[9px] text-muted-foreground">{unit}</span>}
    </span>
  );
}

// A named difference, with each lap's value under it when given, and then the difference of those as shown
export function MetricCard({ label, target, compare, delta, digits = 1, unit, note, size = 'lg', className = '' }: { label: string; target?: number | null; compare?: number | null; delta: number | null | undefined; digits?: number; unit?: string; note?: string; size?: 'md' | 'lg' | 'xl'; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2 ${className}`}>
      <span className="tele-label">{label}</span>
      <DeltaIndicator value={shownDelta(target, compare, digits) ?? delta} digits={digits} unit={unit} size={size} />
      {(target !== undefined || compare !== undefined) && (
        <div className="flex flex-wrap gap-x-3 text-[11px]">
          {target !== undefined && <LapValue lap="target" value={target} digits={digits} />}
          {compare !== undefined && <LapValue lap="compare" value={compare} digits={digits} />}
        </div>
      )}
      {note && <span className="text-[9px] leading-tight text-muted-foreground">{note}</span>}
    </div>
  );
}

const STAT_TONES = { target: 'text-lap-target', compare: 'text-lap-compare', pos: 'text-tele-pos', neg: 'text-tele-neg', muted: 'text-muted-foreground' };
export type StatTone = keyof typeof STAT_TONES;

export const signTone = (value: number | null | undefined): StatTone | undefined =>
  value == null || !Number.isFinite(value) ? 'muted' : value > 0 ? 'pos' : value < 0 ? 'neg' : undefined;

export function StatGrid({ items, columns = 3 }: { items: { label: string; value: string; tone?: StatTone }[]; columns?: number }) {
  return (
    <div className="grid gap-x-3 gap-y-1 px-2.5 py-1.5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.round(600 / columns)}px), 1fr))` }}>
      {items.map(({ label, value, tone }) => (
        <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-border/50 py-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className={`tele-num whitespace-nowrap text-[11px] ${tone ? STAT_TONES[tone] : 'text-foreground'}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function SegmentedToggle<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex overflow-hidden rounded border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-widest transition-colors ${
            value === option.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

// A tire or part's color for a difference: teal above zero, orange below, stronger with its size
export function deltaFill(value: number | null | undefined, largestValue: number) {
  if (value == null || !Number.isFinite(value)) return 'var(--secondary)';
  const share = Math.round(Math.min(1, Math.abs(value) / (largestValue || 1)) * 85 + 10);
  return `color-mix(in oklab, ${value >= 0 ? 'var(--tele-pos)' : 'var(--tele-neg)'} ${share}%, var(--secondary))`;
}

export type ChartMarker = { pct: number; lap: 'target' | 'compare'; kind: 'up' | 'down' | 'reversal' | 'correction' };
export type ChartRegion = { from: number; to: number; color: string };
export type ChartReference = { value: number; label: string; color: string };

const lapColor = (lap: 'target' | 'compare') => (lap === 'target' ? TARGET_COLOR : COMPARE_COLOR);

function MarkerShape({ x, y, marker }: { x: number; y: number; marker: ChartMarker }) {
  const color = lapColor(marker.lap);
  if (marker.kind === 'up') return <path d={`M${x - 3.5},${y + 3} L${x + 3.5},${y + 3} L${x},${y - 3} Z`} fill={color} />;
  if (marker.kind === 'down') return <path d={`M${x - 3.5},${y - 3} L${x + 3.5},${y - 3} L${x},${y + 3} Z`} fill={color} />;
  if (marker.kind === 'correction') return <circle cx={x} cy={y} r={3} fill="none" stroke={color} strokeWidth={1.2} />;
  return <path d={`M${x},${y - 3.5} L${x + 3.5},${y} L${x},${y + 3.5} L${x - 3.5},${y} Z`} fill={color} />;
}

// One channel of both laps on a telemetry chart, with its readouts and Δ strip, already in the units it's shown in.
// A channel neither lap has says so instead of drawing nothing; one lap without it just has no line.
export function LapChannelChart({
  id,
  title,
  subtitle,
  values: [target, compare],
  unit,
  digits = 1,
  width,
  height = 180,
  embedded = false,
  zeroLine = false,
  step = false,
  minSpan = 1,
  yDomain,
  yTicks,
  formatTick,
  markers = [],
  regions = [],
  references = [],
  caption,
}: {
  id: string;
  title: string;
  subtitle?: string;
  values: ChannelPair;
  unit?: string;
  digits?: number;
  width: number;
  height?: number;
  embedded?: boolean;
  zeroLine?: boolean;
  step?: boolean;
  minSpan?: number;
  yDomain?: [number, number];
  yTicks?: number[];
  formatTick?: (value: number) => string;
  markers?: ChartMarker[];
  regions?: ChartRegion[];
  references?: ChartReference[];
  caption?: ReactNode;
}) {
  const { t, locale } = useLanguage();
  const labels = t.charts.telemetry;
  const { num, signed } = useNumbers();
  const { settings } = useTelemetry();
  const atCursor = useAtCursor();

  const delta = useMemo(() => deltas(target, compare), [target, compare]);
  const range = useMemo(() => niceLimit(Math.max(minSpan / 4, stats(delta?.map(Math.abs) ?? null)?.max ?? 0)), [delta, minSpan]);
  const extent = useMemo(() => [stats(target), stats(compare)].flatMap((s) => (s ? [s.min, s.max] : [])), [target, compare]);
  const shownValues = [...extent, ...references.map((r) => r.value), ...(zeroLine ? [0] : [])];
  const ticks = yTicks ?? (shownValues.length > 0 ? roundTicks(Math.min(...shownValues), Math.max(...shownValues), minSpan) : [0, 1]);

  if (!target && !compare) {
    return (
      <section className={`p-3 ${embedded ? '' : 'rounded-md border border-border bg-card'}`}>
        <h4 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h4>
        <p className="mt-2 text-xs text-muted-foreground">{t.charts.lapDataNone}</p>
      </section>
    );
  }

  const [yMin, yMax] = yDomain ?? [ticks[0], ticks[ticks.length - 1]];
  const series: ChartSeries[] = [
    ...(target ? [{ id: 'target', values: target, color: TARGET_COLOR, visible: settings.showTarget, step }] : []),
    ...(compare ? [{ id: 'compare', values: compare, color: COMPARE_COLOR, visible: settings.showCompare, width: 1.4, step }] : []),
  ];
  const [targetValue, compareValue] = [atCursor(target), atCursor(compare)];
  const cursorDelta = shownDelta(targetValue, compareValue, digits);
  const withUnit = (value: string) => (unit && value !== '–' ? `${value} ${unit}` : value);
  const lapText = (name: string, value: number | null) => `${name} ${withUnit(num(value, digits))}`;

  return (
    <TelemetryChart
      id={id}
      title={title}
      unit={[subtitle, unit].filter(Boolean).join(' · ') || undefined}
      width={width}
      embedded={embedded}
      height={height}
      yMin={yMin}
      yMax={yMax}
      yTicks={ticks.filter((tick) => tick >= yMin && tick <= yMax)}
      formatTick={formatTick ?? ((tick) => tick.toLocaleString(locale))}
      legend={<LapLegend />}
      series={series}
      diff={target && compare ? { a: target, b: compare } : undefined}
      delta={delta ? { values: delta, range, unit: unit ?? '' } : undefined}
      zeroLine={zeroLine ? { color: 'var(--muted-foreground)', width: 1 } : undefined}
      ariaLabel={`${title}. ${lapText(labels.target, targetValue)}. ${lapText(labels.compare, compareValue)}.`}
      caption={caption}
      background={(s: Scales) => (
        <g>
          {regions.map(({ from, to, color }, i) => (
            <rect key={i} x={s.x(from)} y={s.plotTop} width={Math.max(1, s.x(to) - s.x(from))} height={s.plotBottom - s.plotTop} fill={color} opacity={0.12} />
          ))}
        </g>
      )}
      overlay={(s: Scales) => (
        <g pointerEvents="none" clipPath={`url(#${id}-plot)`}>
          {references.map(({ value, label, color }) => (
            <g key={label}>
              <line x1={s.plotLeft} x2={s.plotRight} y1={s.y(value)} y2={s.y(value)} stroke={color} strokeDasharray="4 3" />
              <text x={s.plotRight - 4} y={s.y(value) - 3} textAnchor="end" fontSize={9} fill={color}>
                {label}
              </text>
            </g>
          ))}
          {settings.showEvents &&
            markers.filter((m) => s.inView(m.pct) && (m.lap === 'target' ? settings.showTarget : settings.showCompare)).map((m, i) => (
              <MarkerShape key={i} x={s.x(m.pct)} y={s.plotTop + (m.lap === 'target' ? 6 : 15)} marker={m} />
            ))}
        </g>
      )}
      readout={
        <>
          <Readout label={labels.target} value={withUnit(num(targetValue, digits))} tone="target" />
          <Readout label={labels.compare} value={withUnit(num(compareValue, digits))} tone="compare" />
          <Readout label="Δ" value={withUnit(signed(cursorDelta, digits))} tone={cursorDelta === null || cursorDelta === 0 ? 'plain' : cursorDelta > 0 ? 'pos' : 'neg'} />
        </>
      }
    />
  );
}

// A channel's mean size in the corner's entry, apex and exit, by the Target lap's phases
export function CornerPhaseTable({ title, rows }: { title: string; rows: { label: string; values: ChannelPair; digits?: number }[] }) {
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const dash = t.charts.dash;
  const { num } = useNumbers();
  const { grid, phases, cursorPct } = useTelemetry();
  const { pcts } = grid;
  const span = (ids: string[]) => {
    const parts = phases.filter((p) => ids.includes(p.id));
    return parts.length > 0 ? [parts[0].start, parts[parts.length - 1].end] : null;
  };
  const columns = [
    { key: 'entry', label: dash.phaseEntry, window: span(['braking', 'turnIn']) },
    { key: 'apex', label: dash.phaseApex, window: span(['apex']) },
    { key: 'exit', label: dash.phaseExit, window: span(['exit']) },
  ];
  const current = columns.find(({ window }) => window && cursorPct !== null && cursorPct >= window[0] && cursorPct < window[1])?.key;
  if (phases.length === 0) return <p className="px-2.5 py-2 text-[11px] text-muted-foreground">{labels.phasesNone}</p>;

  const indexOf = (pct: number) => {
    const step = (pcts[pcts.length - 1] - pcts[0]) / (pcts.length - 1);
    return Math.round((pct - pcts[0]) / step);
  };
  return (
    <div className="px-2.5 py-2">
      <div className="tele-label mb-1">{title}</div>
      <table className="tele-num w-full text-[11px]">
        <thead>
          <tr className="text-[9px] text-muted-foreground">
            <th className="text-left font-medium">{dash.meanSize}</th>
            {columns.map(({ key, label }) => (
              <th key={key} className={`text-right font-medium uppercase ${current === key ? 'text-foreground' : ''}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, values: [target, compare], digits = 2 }) => (
            <tr key={label} className="border-t border-border/60">
              <td className="py-0.5 text-muted-foreground">{label}</td>
              {columns.map(({ key, window }) => {
                const [from, to] = window ? [indexOf(window[0]), indexOf(window[1])] : [0, -1];
                const [a, b] = [window ? meanAbs(target, from, to) : null, window ? meanAbs(compare, from, to) : null];
                return (
                  <td key={key} className={`py-0.5 text-right ${current === key ? 'bg-secondary/60' : ''}`}>
                    <div className="flex flex-col items-end leading-tight">
                      <DeltaIndicator value={shownDelta(a, b, digits)} digits={digits} size="sm" label={false} />
                      <span className="text-[9px] text-muted-foreground">
                        <span className="text-lap-target">{num(a, digits)}</span> / <span className="text-lap-compare">{num(b, digits)}</span>
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
