'use client';

import { useCallback, useMemo, useState } from 'react';

import DualArcGauge from '@/components/DualArcGauge';
import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry, type ChannelPair } from '@/components/TelemetryCursor';
import { DeltaIndicator, LapChannelChart, MetricCard, Panel, shownDelta, signTone, StatGrid, useAtCursor, useNumbers, usePair, useViewWindow } from '@/components/TelemetryPanels';
import { useUnits } from '@/components/UnitsProvider';
import { lapFuel, stats } from '@/lib/lapChannels';
import { MASS_RATE_UNIT, MASS_UNIT, massFromKg, TEMPERATURE_UNIT, temperatureDeltaFromCelsius, temperatureFromCelsius } from '@/lib/units';

const WIDE = 1100;
const SUMMARY_COLUMN = 330;
const DEFAULT_EXPOSURE_LIMIT_C = 110;
const EXPOSURE_RANGE_C: [number, number] = [95, 125];
const FUEL_DIGITS = 2;

// One temperature at the crosshair on a gauge across what the laps read, the lowest, average, highest and change in
// view, and its trace
function TemperaturePanel({ id, title, values, width }: { id: string; title: string; values: ChannelPair; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const unit = TEMPERATURE_UNIT[units];
  const { num, signed } = useNumbers();
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const convert = useCallback((celsius: number) => temperatureFromCelsius(celsius, units), [units]);
  const shown = usePair(values, convert);
  const [a, b] = shown;

  const range = useMemo<[number, number]>(() => {
    const all = shown.flatMap((lap) => {
      const s = stats(lap);
      return s ? [s.min, s.max] : [];
    });
    if (all.length === 0) return [0, 1];
    const [lo, hi] = [Math.floor(Math.min(...all) / 5) * 5, Math.ceil(Math.max(...all) / 5) * 5];
    return [lo, hi > lo ? hi : lo + 5];
  }, [shown]);
  const [sa, sb] = [stats(a, i0, i1), stats(b, i0, i1)];
  const change = (lap: number[] | null) => {
    if (!lap || !Number.isFinite(lap[i0]) || !Number.isFinite(lap[i1])) return null;
    return lap[i1] - lap[i0];
  };
  const [ca, cb] = [change(a), change(b)];
  const rows = [
    { key: 'target', label: labels.targetInitial, stat: sa, trend: ca, tone: 'text-lap-target' },
    { key: 'compare', label: labels.compareInitial, stat: sb, trend: cb, tone: 'text-lap-compare' },
  ];
  return (
    <Panel title={title}>
      <div className="flex flex-wrap items-center gap-3 px-3 pt-1">
        <DualArcGauge min={range[0]} max={range[1]} target={atCursor(a)} compare={atCursor(b)} unit={unit} digits={1} size={180} label={title} />
        <table className="tele-num min-w-48 flex-1 text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted-foreground">
              <th className="text-left font-medium">{dash.inView}</th>
              <th className="text-right font-medium">{dash.min}</th>
              <th className="text-right font-medium">{dash.avg}</th>
              <th className="text-right font-medium">{dash.max}</th>
              <th className="text-right font-medium">{dash.trend}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, stat, trend, tone }) => (
              <tr key={key} className={`border-t border-border/60 ${tone}`}>
                <td>{label}</td>
                <td className="text-right">{num(stat?.min, 1)}</td>
                <td className="text-right">{num(stat?.avg, 1)}</td>
                <td className="text-right">{num(stat?.max, 1)}</td>
                <td className="text-right">{signed(trend, 1)}</td>
              </tr>
            ))}
            <tr className="border-t border-border/60">
              <td className="text-muted-foreground">Δ</td>
              {(['min', 'avg', 'max'] as const).map((key) => (
                <td key={key} className="text-right">
                  <DeltaIndicator value={shownDelta(sa?.[key], sb?.[key], 1)} size="sm" label={false} />
                </td>
              ))}
              <td className="text-right">
                <DeltaIndicator value={shownDelta(ca, cb, 1)} size="sm" label={false} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <LapChannelChart id={id} title={title} subtitle={dash.trace} values={shown} unit={unit} minSpan={1} width={width - 2} height={150} embedded />
    </Panel>
  );
}

// The Engine & Fuel tab: water and oil temperature, fuel left and how fast it went, what each lap used, and how long
// the oil spent over a limit the driver sets. Only what lap files record: they have no tank size, so the tanks are
// drawn against the fuller lap, and estimates of the laps left are from this one lap's use.
export default function EngineFuelDashboard({ id, width }: { id: string; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const tempUnit = TEMPERATURE_UNIT[units];
  const massUnit = MASS_UNIT[units];
  const { num, signed } = useNumbers();
  const { base, compare, channels } = useTelemetry();
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const [limitC, setLimitC] = useState(DEFAULT_EXPOSURE_LIMIT_C);
  const { waterTemps, oilTemps, fuelKgs, fuelKgPerHour } = channels;

  const toMass = useCallback((kg: number) => massFromKg(kg, units), [units]);
  const fuel = usePair(fuelKgs, toMass);
  const fuelRate = usePair(fuelKgPerHour, toMass);
  const [fuelA, fuelB] = fuel;
  const usedInArea = useMemo<ChannelPair>(() => {
    const cumulative = (lap: number[] | null) => {
      const start = lap?.find(Number.isFinite);
      return lap && start !== undefined ? lap.map((value) => start - value) : null;
    };
    return [cumulative(fuelA), cumulative(fuelB)];
  }, [fuelA, fuelB]);

  const lapA = lapFuel(base.samples.engine.fuelKgs);
  const lapB = lapFuel(compare.samples.engine.fuelKgs);
  const mass = (kg: number | null) => (kg === null ? null : toMass(kg));
  const lapUsed = [mass(lapA.used), mass(lapB.used)];
  const lapLeft = [mass(lapA.left), mass(lapB.left)];
  const lapsLeft = [lapUsed[0] && lapLeft[0] !== null ? lapLeft[0] / lapUsed[0] : null, lapUsed[1] && lapLeft[1] !== null ? lapLeft[1] / lapUsed[1] : null];
  const inViewUsed = (lap: number[] | null) => (lap && Number.isFinite(lap[i0]) && Number.isFinite(lap[i1]) ? lap[i0] - lap[i1] : null);
  const [viewA, viewB] = [inViewUsed(fuelA), inViewUsed(fuelB)];
  const difference = (a: number | null, b: number | null) => (a !== null && b !== null ? b - a : null);

  const tankTop = Math.max(0, ...[stats(fuelA)?.max, stats(fuelB)?.max].flatMap((value) => (value === undefined ? [] : [value])));
  const tank = (lap: 'target' | 'compare', value: number | null) => (
    <div className="flex flex-col items-center gap-1">
      <span className={`tele-label ${lap === 'target' ? '!text-lap-target' : '!text-lap-compare'}`}>{lap === 'target' ? labels.target : labels.compare}</span>
      <div className="relative h-[130px] w-14 overflow-hidden rounded-md border-2 border-border bg-secondary">
        {[0.25, 0.5, 0.75].map((share) => (
          <div key={share} className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${share * 100}%` }} />
        ))}
        <div className={`absolute inset-x-0 bottom-0 ${lap === 'target' ? 'bg-lap-target/70' : 'bg-lap-compare/70'}`} style={{ height: `${tankTop > 0 && value !== null ? (value / tankTop) * 100 : 0}%` }} />
      </div>
      <span className="tele-num text-sm">
        {num(value, FUEL_DIGITS)} <span className="text-[9px] text-muted-foreground">{massUnit}</span>
      </span>
    </div>
  );

  const stat = (pair: ChannelPair) => [stats(pair[0], i0, i1), stats(pair[1], i0, i1)];
  const celsiusStat = (lap: number[] | null) => stats(lap, i0, i1);
  const [wa, wb] = [celsiusStat(waterTemps[0]), celsiusStat(waterTemps[1])];
  const [oa, ob] = [celsiusStat(oilTemps[0]), celsiusStat(oilTemps[1])];
  const tempDelta = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? null : temperatureDeltaFromCelsius(b - a, units));
  const tempValue = (value: number | undefined) => (value === undefined ? null : temperatureFromCelsius(value, units));
  const exposure = (lap: number[] | null) => {
    if (!lap) return null;
    let over = 0;
    let known = 0;
    for (let i = i0; i <= i1; i++) {
      if (!Number.isFinite(lap[i])) continue;
      known++;
      if (lap[i] > limitC) over++;
    }
    return known > 0 ? (over / known) * 100 : null;
  };
  const [ea, eb] = [exposure(oilTemps[0]), exposure(oilTemps[1])];
  const [rateA, rateB] = stat(fuelRate);

  const wide = width >= WIDE;
  const column = wide ? (width - SUMMARY_COLUMN - 24) / 2 : width;

  const summary = (
    <Panel title={dash.thermalSummary} subtitle={dash.inView} className={wide ? 'row-span-2' : ''}>
      <div className="grid grid-cols-2 gap-2 p-2.5">
        <MetricCard label={dash.waterAvgDelta} delta={tempDelta(wa?.avg, wb?.avg)} unit={tempUnit} />
        <MetricCard label={dash.oilAvgDelta} delta={tempDelta(oa?.avg, ob?.avg)} unit={tempUnit} />
        <MetricCard label={dash.maxWater} target={tempValue(wa?.max)} compare={tempValue(wb?.max)} delta={tempDelta(wa?.max, wb?.max)} unit={tempUnit} size="md" />
        <MetricCard label={dash.maxOil} target={tempValue(oa?.max)} compare={tempValue(ob?.max)} delta={tempDelta(oa?.max, ob?.max)} unit={tempUnit} size="md" />
        <MetricCard label={dash.fuelUsedLap} target={lapUsed[0]} compare={lapUsed[1]} delta={difference(lapUsed[0], lapUsed[1])} digits={FUEL_DIGITS} unit={massUnit} size="md" className="col-span-2" />
      </div>
      <div className="mx-2.5 mb-2.5 rounded-sm border border-dashed border-tele-warn/50 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <span className="tele-label">{dash.thermalExposure}</span>
          <span className="text-[9px] font-bold tracking-widest text-tele-warn">{dash.customDerived}</span>
        </div>
        <p className="text-[9px] text-muted-foreground">{dash.exposureNote}</p>
        <div className="mt-1 flex items-center gap-2">
          <input aria-label={dash.oilLimit} type="range" min={EXPOSURE_RANGE_C[0]} max={EXPOSURE_RANGE_C[1]} value={limitC} onChange={(event) => setLimitC(Number(event.target.value))} className="min-w-0 flex-1 accent-primary" />
          <span className="tele-num w-16 text-right text-xs text-tele-warn">
            {num(temperatureFromCelsius(limitC, units), 0)} {tempUnit}
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <span className="tele-num text-xs">
            <span className="text-lap-target">{num(ea, 1)}%</span> / <span className="text-lap-compare">{num(eb, 1)}%</span>
          </span>
          <DeltaIndicator value={difference(ea, eb)} unit={labels.percentPoints} size="lg" />
        </div>
      </div>
    </Panel>
  );

  return (
    <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) minmax(0, 1fr) ${SUMMARY_COLUMN}px` } : undefined}>
      <TemperaturePanel id={`${id}-water`} title={t.charts.engineCharts.waterTemp} values={waterTemps} width={column} />
      <TemperaturePanel id={`${id}-oil`} title={t.charts.engineCharts.oilTemp} values={oilTemps} width={column} />
      {summary}

      <Panel title={t.charts.engineCharts.fuelLevel}>
        <div className="flex flex-wrap items-center gap-4 px-3 py-2">
          {tank('target', atCursor(fuelA))}
          {tank('compare', atCursor(fuelB))}
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <div>
              <span className="tele-label block">{dash.fuelDeltaAtCursor}</span>
              <DeltaIndicator value={shownDelta(atCursor(fuelA), atCursor(fuelB), FUEL_DIGITS)} digits={FUEL_DIGITS} unit={massUnit} size="xl" label={false} />
            </div>
            <StatGrid
              columns={2}
              items={[
                { label: `${dash.lapEnd} ${labels.targetInitial}`, value: num(lapLeft[0], FUEL_DIGITS), tone: 'target' },
                { label: `${dash.lapEnd} ${labels.compareInitial}`, value: num(lapLeft[1], FUEL_DIGITS), tone: 'compare' },
                { label: `${dash.lapsLeft} ${labels.targetInitial}`, value: num(lapsLeft[0], 1), tone: 'target' },
                { label: `${dash.lapsLeft} ${labels.compareInitial}`, value: num(lapsLeft[1], 1), tone: 'compare' },
              ]}
            />
            <p className="text-[9px] leading-snug text-muted-foreground">{dash.tankNote}</p>
          </div>
        </div>
        <LapChannelChart id={`${id}-fuel`} title={t.charts.engineCharts.fuelLevel} subtitle={dash.trace} values={fuel} unit={massUnit} digits={FUEL_DIGITS} minSpan={0.5} width={column - 2} height={150} embedded />
      </Panel>

      <Panel title={dash.fuelConsumption} subtitle={dash.scopesLabelled}>
        <div className="grid grid-cols-2 gap-2 p-2.5">
          <MetricCard label={dash.fuelUsedView} target={viewA} compare={viewB} delta={difference(viewA, viewB)} digits={FUEL_DIGITS} unit={massUnit} />
          <MetricCard label={dash.fuelUsedLap} target={lapUsed[0]} compare={lapUsed[1]} delta={difference(lapUsed[0], lapUsed[1])} digits={FUEL_DIGITS} unit={massUnit} />
          <MetricCard label={dash.avgFuelRate} target={rateA?.avg} compare={rateB?.avg} delta={rateA && rateB ? rateB.avg - rateA.avg : null} unit={MASS_RATE_UNIT[units]} />
          <div className="flex flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2">
            <span className="tele-label">{dash.fuelLeftLapEnd}</span>
            <span className={`tele-num text-xl ${signTone(shownDelta(lapLeft[0], lapLeft[1], FUEL_DIGITS)) === 'pos' ? 'text-tele-pos' : signTone(shownDelta(lapLeft[0], lapLeft[1], FUEL_DIGITS)) === 'neg' ? 'text-tele-neg' : 'text-foreground'}`}>
              {signed(shownDelta(lapLeft[0], lapLeft[1], FUEL_DIGITS), FUEL_DIGITS)} <span className="text-xs">{massUnit}</span>
            </span>
          </div>
        </div>
        <LapChannelChart id={`${id}-used`} title={dash.cumulativeUsed} subtitle={dash.fromAreaStart} values={usedInArea} unit={massUnit} digits={FUEL_DIGITS} minSpan={0.1} width={column - 2} height={140} embedded />
        <LapChannelChart id={`${id}-rate`} title={t.charts.engineCharts.fuelUsage} values={fuelRate} unit={MASS_RATE_UNIT[units]} minSpan={5} width={column - 2} height={140} embedded />
      </Panel>
    </div>
  );
}
