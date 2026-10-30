'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import GT3CarTopView, { type CarViewMode } from '@/components/GT3CarTopView';
import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import TireDeltaChart from '@/components/TireDeltaChart';
import TireDeltaSummary from '@/components/TireDeltaSummary';
import TireTemperatureDeltaPanel, { type TireDisplayMode } from '@/components/TireTemperatureDeltaPanel';
import { useUnits } from '@/components/UnitsProvider';
import { positionLabel, type Axis } from '@/lib/lapCharts';
import { TIRE_CORNERS, type TireCorner } from '@/lib/lapData';
import {
  compareTires,
  DELTA_FULL_SCALE,
  deltaColor,
  HEAT_RANGE,
  tireDeltaSeries,
  tireSeriesReason,
  type TireLapInput,
  type TireScope,
} from '@/lib/tireTempComparison';
import { TEMPERATURE_UNIT, temperatureDeltaFromCelsius, temperatureFromCelsius } from '@/lib/units';

// Narrower than this, the gauges stack instead of standing either side of the car
const THREE_COLUMN_MIN_WIDTH = 1040;
const CAR_WIDTH = 340;
const LEGEND_STOPS = [-1, -0.5, 0, 0.5, 1];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="rc-label">{label}</span>
      <div className="rc-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.key} type="button" data-active={value === option.key} aria-pressed={value === option.key} data-track={`tire-${option.key}`} onClick={() => onChange(option.key)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const lapInput = ({ samples, trace }: PedalTraceLap): TireLapInput => ({ lap: samples, area: trace });

// Lap Compare's Tire Temperature Comparison, on top of the Tire Temp tab: the difference between the Target and
// Compare laps picked for Lap Compare (Compare minus Target), tire by tire, around a top view of the car. Neither
// direction is better or worse. Sample follows the page's crosshair, where it last was when it's off the charts;
// Focus Area and Lap are means over that stretch. Only continuous readings of the same layer of the tire are
// compared (lib/tireTempComparison.ts), with N/A and why for anything else. The numbers are in the user's units.
export default function TireTempDashboard({
  id,
  base,
  compare,
  axis,
  width,
  hoverPct,
  onHover,
}: {
  id: string;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t, locale, fmt } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const [scope, setScope] = useState<TireScope>('sample');
  const [display, setDisplay] = useState<TireDisplayMode>('delta');
  const [carMode, setCarMode] = useState<CarViewMode>('delta');
  const [showBadges, setShowBadges] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [hovered, setHovered] = useState<TireCorner | null>(null);
  const [selected, setSelected] = useState<TireCorner | null>(null);
  const toggleSelected = useCallback((corner: TireCorner) => setSelected((current) => (current === corner ? null : corner)), []);

  // The Sample scope stays where the crosshair last was
  const [heldPct, setHeldPct] = useState(axis.domain[0]);
  if (hoverPct !== null && hoverPct !== heldPct) setHeldPct(hoverPct);

  const target = useMemo(() => lapInput(base), [base]);
  const other = useMemo(() => lapInput(compare), [compare]);
  const comparisons = useMemo(() => compareTires(target, other, scope, heldPct), [target, other, scope, heldPct]);

  // The traces and their shared scales only change with the laps, not with the crosshair
  const traces = useMemo(() => {
    const entries = TIRE_CORNERS.map((corner) => {
      const reason = tireSeriesReason(target, other, corner);
      return { corner, reason, series: reason ? null : tireDeltaSeries(target.area, other.area, corner) };
    });
    const temps = entries.flatMap(({ series }) => (series ? [...series.target, ...series.compare].filter(Number.isFinite) : []));
    const deltas = entries.flatMap(({ series }) => (series ? series.delta.filter(Number.isFinite).map(Math.abs) : []));
    return {
      entries,
      tempRange: (temps.length > 0
        ? [Math.floor(Math.min(...temps) / 5) * 5, Math.max(Math.ceil(Math.max(...temps) / 5) * 5, Math.floor(Math.min(...temps) / 5) * 5 + 5)]
        : [0, 1]) as [number, number],
      deltaRange: Math.max(5, Math.ceil(Math.max(0, ...deltas) / 5) * 5),
    };
  }, [target, other]);

  const threeColumns = width >= THREE_COLUMN_MIN_WIDTH;
  const columns = threeColumns ? { gridTemplateColumns: `minmax(0,1fr) ${CAR_WIDTH}px minmax(0,1fr)` } : undefined;
  const panel = (corner: TireCorner) => (
    <TireTemperatureDeltaPanel
      comparison={comparisons[corner]}
      display={display}
      highlighted={hovered === corner || selected === corner}
      onHover={(hovering) => setHovered(hovering ? corner : null)}
      onSelect={() => toggleSelected(corner)}
    />
  );
  const legendValue = (celsius: number) => Math.round(temperatureDeltaFromCelsius(celsius, units)).toLocaleString(locale);
  const heatValue = (celsius: number) => `${Math.round(temperatureFromCelsius(celsius, units)).toLocaleString(locale)}°`;
  const scopeText: Record<TireScope, ReactNode> = {
    sample: fmt(labels.scopeTextSample, { position: positionLabel(heldPct, axis) }),
    area: labels.scopeTextArea,
    lap: labels.scopeTextLap,
    session: labels.scopeTextSession,
  };

  return (
    <div id={id} data-tire-dashboard className="mb-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div>
          <h4 className="text-lg font-bold uppercase tracking-[0.14em] text-foreground">{labels.title}</h4>
          <p data-scope-text className="text-xs text-muted-foreground tabular-nums">
            {scopeText[scope]} · {TEMPERATURE_UNIT[units]}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <Segmented
            label={labels.scope}
            value={scope}
            onChange={setScope}
            options={(['sample', 'area', 'lap', 'session'] as const).map((key) => ({ key, label: labels.scopes[key] }))}
          />
          <Segmented
            label={labels.display}
            value={display}
            onChange={setDisplay}
            options={(['average', 'imo', 'delta'] as const).map((key) => ({ key, label: labels.displays[key] }))}
          />
          <Segmented
            label={labels.carView}
            value={carMode}
            onChange={setCarMode}
            options={[
              { key: 'target', label: labels.target },
              { key: 'compare', label: labels.compare },
              { key: 'delta', label: labels.delta },
            ]}
          />
        </div>
      </div>

      <div className={threeColumns ? 'grid gap-4' : 'space-y-4'} style={columns}>
        <div className="flex flex-col justify-around gap-4">
          {panel('LF')}
          {panel('LR')}
        </div>
        <div className="flex justify-center">
          <GT3CarTopView
            comparisons={comparisons}
            mode={carMode}
            showBadges={showBadges}
            hovered={hovered}
            selected={selected}
            onTireHover={setHovered}
            onTireSelect={toggleSelected}
          />
        </div>
        <div className="flex flex-col justify-around gap-4">
          {panel('RF')}
          {panel('RR')}
        </div>
      </div>

      <div className={threeColumns ? 'grid items-start gap-4' : 'space-y-4'} style={columns}>
        <TireDeltaSummary comparisons={comparisons} />
        <div className="rc-panel p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="rc-label">{carMode === 'delta' ? labels.compareMinusTarget : carMode === 'target' ? labels.target : labels.compare}</span>
            <label className="rc-label flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={showBadges} onChange={(event) => setShowBadges(event.target.checked)} className="accent-primary" />
              {labels.badges}
            </label>
          </div>
          {carMode === 'delta' ? (
            <>
              <div className="h-3 rounded-sm" style={{ background: `linear-gradient(90deg, ${LEGEND_STOPS.map((stop) => deltaColor(stop * DELTA_FULL_SCALE)).join(',')})` }} />
              <div className="rc-num mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{fmt(labels.legendCooler, { value: legendValue(DELTA_FULL_SCALE) })}</span>
                <span>0</span>
                <span>{fmt(labels.legendHotter, { value: legendValue(DELTA_FULL_SCALE) })}</span>
              </div>
            </>
          ) : (
            <>
              <div className="h-3 rounded-sm" style={{ background: 'linear-gradient(90deg, var(--heat-cold), var(--heat-mid), var(--heat-hot))' }} />
              <div className="rc-num mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{heatValue(HEAT_RANGE[0])}</span>
                <span>{heatValue((HEAT_RANGE[0] + HEAT_RANGE[1]) / 2)}</span>
                <span>{heatValue(HEAT_RANGE[1])}</span>
              </div>
            </>
          )}
          <div className="mt-3 flex justify-between text-xs text-foreground">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-lap-target" /> {labels.target}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-lap-compare" /> {labels.compare}</span>
          </div>
        </div>
        <div className="rc-panel p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="rc-label mb-1 text-foreground">{labels.readingTitle}</div>
          {labels.readingText}
        </div>
      </div>

      <section className="rc-panel">
        <button type="button" onClick={() => setChartsOpen((open) => !open)} aria-expanded={chartsOpen} className="flex w-full items-center justify-between px-3 py-2.5 text-foreground">
          <span className="text-sm font-semibold uppercase tracking-[0.18em]">{labels.tracesTitle}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${chartsOpen ? 'rotate-180' : ''}`} />
        </button>
        {chartsOpen && (
          <div className="border-t border-border p-3">
            <p className="rc-label mb-3 text-right">{labels.tracesHint}</p>
            <div className={width >= 640 ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
              {traces.entries.map(({ corner, reason, series }) => (
                <TireDeltaChart
                  key={corner}
                  corner={corner}
                  series={series}
                  reason={reason}
                  axis={axis}
                  tempRange={traces.tempRange}
                  deltaRange={traces.deltaRange}
                  cursorPct={heldPct}
                  highlighted={hovered === corner || selected === corner}
                  onHover={onHover}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
