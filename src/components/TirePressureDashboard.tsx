'use client';

import { useCallback, useMemo, useState } from 'react';

import DashboardCarView, { wheelCenter } from '@/components/DashboardCarView';
import DualArcGauge from '@/components/DualArcGauge';
import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { DeltaIndicator, deltaFill, LapChannelChart, MetricCard, Panel, SegmentedToggle, shownDelta, useAtCursor, useNumbers, usePair, useViewWindow } from '@/components/TelemetryPanels';
import { useUnits } from '@/components/UnitsProvider';
import { stats, type Stats } from '@/lib/lapChannels';
import { TIRE_CORNERS, type TireCorner } from '@/lib/lapData';
import { PRESSURE_UNIT, pressureFromKpa } from '@/lib/units';

const WIDE = 1100;
const CAR_COLUMN = 340;
const COLUMN_GAP = 24; // gap-x-6

// One tire: its gauge at the crosshair, the difference, and the lowest, average and highest in view
function PressureGauge({ corner, target, compare, targetStats, compareStats, range, selected, onSelect, size }: { corner: TireCorner; target: number | null; compare: number | null; targetStats: Stats | null; compareStats: Stats | null; range: [number, number]; selected: boolean; onSelect: () => void; size: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const unit = PRESSURE_UNIT[units];
  const digits = units === 'metric' ? 0 : 1;
  const { num } = useNumbers();
  const rows = [
    { key: 'target', label: labels.targetInitial, stat: targetStats, tone: 'text-lap-target' },
    { key: 'compare', label: labels.compareInitial, stat: compareStats, tone: 'text-lap-compare' },
  ];
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={`flex w-full min-w-0 flex-col rounded-md border bg-card text-left transition-colors ${selected ? 'border-foreground/70' : 'border-border'}`}>
      <span className="flex h-8 w-full items-center gap-2 border-b border-border px-3">
        <span className="font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-foreground">{t.charts.tireCorners[corner]}</span>
        <span className="tele-num text-[10px] text-muted-foreground">{corner}</span>
      </span>
      <span className="flex flex-wrap items-center gap-3 px-3 py-1">
        <DualArcGauge min={range[0]} max={range[1]} target={target} compare={compare} unit={unit} digits={digits} size={size} label={t.charts.tireCorners[corner]} />
        <span className="flex min-w-32 flex-1 flex-col gap-2">
          <span>
            <span className="tele-label block">{dash.pressureDelta}</span>
            <DeltaIndicator value={shownDelta(target, compare, digits)} digits={digits} unit={unit} size="xl" label={false} />
          </span>
          <span className="tele-num grid grid-cols-2 gap-x-3 text-xs">
            <span className="text-lap-target">{labels.target}</span>
            <span className="text-right text-lap-target">{num(target, digits)} {unit}</span>
            <span className="text-lap-compare">{labels.compare}</span>
            <span className="text-right text-lap-compare">{num(compare, digits)} {unit}</span>
          </span>
        </span>
      </span>
      <span className="px-3 pb-2">
        <table className="tele-num w-full text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted-foreground">
              <th className="text-left font-medium">{dash.inView}</th>
              <th className="text-right font-medium">{dash.min}</th>
              <th className="text-right font-medium">{dash.avg}</th>
              <th className="text-right font-medium">{dash.max}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, stat, tone }) => (
              <tr key={key} className={`border-t border-border/60 ${tone}`}>
                <td>{label}</td>
                <td className="text-right">{num(stat?.min, digits)}</td>
                <td className="text-right">{num(stat?.avg, digits)}</td>
                <td className="text-right">{num(stat?.max, digits)}</td>
              </tr>
            ))}
            <tr className="border-t border-border/60">
              <td className="text-muted-foreground">Δ</td>
              {(['min', 'avg', 'max'] as const).map((key) => (
                <td key={key} className="text-right">
                  <DeltaIndicator value={shownDelta(targetStats?.[key], compareStats?.[key], digits)} digits={digits} size="sm" label={false} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </span>
    </button>
  );
}

// The Tire Pressure tab: a gauge per tire around a map of the car, what the differences add up to across the car, and
// the trace of the tire picked. Gauges run across the laps' own pressures unless a range is typed.
export default function TirePressureDashboard({ id, width }: { id: string; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const unit = PRESSURE_UNIT[units];
  const digits = units === 'metric' ? 0 : 1;
  const { num, signed } = useNumbers();
  const { channels } = useTelemetry();
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const [mapMode, setMapMode] = useState<'target' | 'compare' | 'delta'>('delta');
  const [hovered, setHovered] = useState<TireCorner | null>(null);
  const [selected, setSelected] = useState<TireCorner>('LF');
  const [typedRange, setTypedRange] = useState<[number, number] | null>(null);

  const convert = useCallback((kpa: number) => pressureFromKpa(kpa, units), [units]);
  const pressures = channels.tirePressures;

  // Whole units around everything the laps read, so the gauges keep their scale as the crosshair moves
  const lapsRange = useMemo<[number, number]>(() => {
    const all = TIRE_CORNERS.flatMap((corner) => pressures[corner].flatMap((lap) => {
      const s = stats(lap);
      return s ? [convert(s.min), convert(s.max)] : [];
    }));
    if (all.length === 0) return [0, 1];
    const step = units === 'metric' ? 5 : 1;
    const [lo, hi] = [Math.floor(Math.min(...all) / step) * step, Math.ceil(Math.max(...all) / step) * step];
    return [lo, hi > lo ? hi : lo + step];
  }, [pressures, convert, units]);
  const range = typedRange ?? lapsRange;

  const data = Object.fromEntries(
    TIRE_CORNERS.map((corner) => {
      const [a, b] = pressures[corner];
      const scaled = (kpa: number | null) => (kpa === null ? null : convert(kpa));
      const inUnits = (s: Stats | null): Stats | null => (s ? { min: convert(s.min), max: convert(s.max), avg: convert(s.avg) } : null);
      return [corner, { target: scaled(atCursor(a)), compare: scaled(atCursor(b)), targetStats: inUnits(stats(a, i0, i1)), compareStats: inUnits(stats(b, i0, i1)) }];
    })
  ) as Record<TireCorner, { target: number | null; compare: number | null; targetStats: Stats | null; compareStats: Stats | null }>;

  // The average in view's difference per tire, null where a lap has none
  const avgDelta = (corner: TireCorner) => {
    const { targetStats, compareStats } = data[corner];
    return targetStats && compareStats ? compareStats.avg - targetStats.avg : null;
  };
  const mean = (corners: TireCorner[]) => {
    const values = corners.map(avgDelta);
    return values.every((v) => v !== null) ? (values as number[]).reduce((sum, v) => sum + v, 0) / values.length : null;
  };
  const known = TIRE_CORNERS.flatMap((corner) => {
    const value = avgDelta(corner);
    return value === null ? [] : [{ corner, value }];
  });
  const most = known.length > 0 ? known.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)) : null;
  const [left, right] = [mean(['LF', 'LR']), mean(['RF', 'RR'])];
  const summaryDigits = units === 'metric' ? 1 : 2;

  const wheels = Object.fromEntries(
    TIRE_CORNERS.map((corner) => {
      const { target, compare } = data[corner];
      const delta = target !== null && compare !== null ? compare - target : null;
      const span = range[1] - range[0] || 1;
      const shown = mapMode === 'target' ? target : compare;
      const lapColor = mapMode === 'target' ? 'var(--lap-target)' : 'var(--lap-compare)';
      const share = shown === null ? 15 : Math.round(Math.max(0, Math.min(1, (shown - range[0]) / span)) * 80 + 15);
      return [
        corner,
        {
          fill: mapMode === 'delta' ? deltaFill(delta, span / 6) : `color-mix(in oklab, ${lapColor} ${share}%, var(--secondary))`,
          label: mapMode === 'delta' ? signed(shownDelta(target, compare, digits), digits) : num(shown, digits),
          highlighted: hovered === corner,
          selected: selected === corner,
        },
      ];
    })
  );

  const wide = width >= WIDE;
  const gaugeColumn = wide ? (width - CAR_COLUMN - COLUMN_GAP * 2) / 2 : width;
  const gaugeSize = Math.min(190, Math.max(150, gaugeColumn * 0.42));
  const gauge = (corner: TireCorner) => <PressureGauge key={corner} corner={corner} {...data[corner]} range={range} selected={selected === corner} onSelect={() => setSelected(corner)} size={gaugeSize} />;
  const history = usePair(pressures[selected], convert);
  const hoveredData = hovered ? data[hovered] : null;

  const map = (
    <Panel
      title={dash.tireMap}
      subtitle={dash.atCursor}
      className={wide ? 'row-span-2' : ''}
      right={
        <SegmentedToggle
          label={dash.tireMap}
          value={mapMode}
          onChange={setMapMode}
          options={[
            { value: 'target', label: labels.target },
            { value: 'compare', label: labels.compare },
            { value: 'delta', label: 'Δ' },
          ]}
        />
      }
    >
      <div className="flex h-full flex-col items-center justify-center p-3">
        <DashboardCarView title={dash.tireMap} className="h-[480px] max-w-full" wheels={wheels} onWheelHover={setHovered} onWheelClick={setSelected}>
          {hovered && hoveredData && (
            <g pointerEvents="none" transform={`translate(${wheelCenter(hovered).x + (hovered.startsWith('L') ? 20 : -98)},${wheelCenter(hovered).y - 26})`}>
              <rect width="78" height="50" rx="2" fill="var(--card)" stroke="var(--border)" />
              <text x="5" y="11" fontSize="7" fill="var(--muted-foreground)">{t.charts.tireCorners[hovered]}</text>
              <text x="5" y="22" fontSize="8" fill="var(--lap-target)" className="tele-num">{labels.targetInitial} {num(hoveredData.target, digits)} {unit}</text>
              <text x="5" y="32" fontSize="8" fill="var(--lap-compare)" className="tele-num">{labels.compareInitial} {num(hoveredData.compare, digits)} {unit}</text>
              <text x="5" y="44" fontSize="9" fontWeight="700" fill="var(--foreground)" className="tele-num">Δ {signed(shownDelta(hoveredData.target, hoveredData.compare, digits), digits)}</text>
            </g>
          )}
        </DashboardCarView>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <span className="tele-label">{dash.gaugeRange}</span>
          <input aria-label={dash.gaugeMin} type="number" value={range[0]} onChange={(event) => setTypedRange([Number(event.target.value), Math.max(range[1], Number(event.target.value) + 1)])} className="tele-num h-6 w-16 rounded-sm border border-border bg-transparent px-1 text-foreground" />
          <span>–</span>
          <input aria-label={dash.gaugeMax} type="number" value={range[1]} onChange={(event) => setTypedRange([range[0], Math.max(Number(event.target.value), range[0] + 1)])} className="tele-num h-6 w-16 rounded-sm border border-border bg-transparent px-1 text-foreground" />
          <span>{unit}</span>
          {typedRange && (
            <button type="button" onClick={() => setTypedRange(null)} className="underline hover:text-foreground">
              {dash.useLapsRange}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-3">
      {wide ? (
        <div className="grid grid-rows-2 gap-x-6 gap-y-3" style={{ gridTemplateColumns: `minmax(0, 1fr) ${CAR_COLUMN}px minmax(0, 1fr)` }}>
          {gauge('LF')}
          {map}
          {gauge('RF')}
          {gauge('LR')}
          {gauge('RR')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {map}
          {TIRE_CORNERS.map(gauge)}
        </div>
      )}

      <Panel title={dash.pressureSummary} subtitle={`${dash.avgInView} · ${t.charts.pedalDelta}`}>
        <div className="grid grid-cols-2 gap-2 p-2.5 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label={dash.frontAxleDelta} delta={mean(['LF', 'RF'])} digits={summaryDigits} unit={unit} />
          <MetricCard label={dash.rearAxleDelta} delta={mean(['LR', 'RR'])} digits={summaryDigits} unit={unit} />
          <MetricCard label={dash.leftSideDelta} delta={left} digits={summaryDigits} unit={unit} />
          <MetricCard label={dash.rightSideDelta} delta={right} digits={summaryDigits} unit={unit} />
          <MetricCard label={most ? `${dash.largestDelta} (${most.corner})` : dash.largestDelta} delta={most?.value} digits={summaryDigits} unit={unit} />
          <MetricCard label={dash.leftRightDelta} delta={left !== null && right !== null ? left - right : null} digits={summaryDigits} unit={unit} note={dash.leftRightNote} />
        </div>
      </Panel>

      <LapChannelChart id={`${id}-history`} title={`${t.charts.tireCorners[selected]} · ${dash.pressureHistory}`} subtitle={dash.pickTire} values={history} unit={unit} digits={digits + 1} minSpan={units === 'metric' ? 2 : 0.4} width={width} height={200} />
    </div>
  );
}
