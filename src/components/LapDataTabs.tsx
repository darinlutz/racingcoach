'use client';

import { type KeyboardEvent, type PointerEvent } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { useUnits } from '@/components/UnitsProvider';
import { BASE_LAP_COLOR, clamp, COMPARE_LAP_COLOR, nearestIndex, positionLabel, xTicks, type Axis } from '@/lib/lapCharts';
import type { AreaTrace, TireCorner, TireTemps } from '@/lib/lapData';
import {
  MASS_RATE_UNIT,
  MASS_UNIT,
  massFromKg,
  PRESSURE_UNIT,
  pressureFromKpa,
  RIDE_HEIGHT_UNIT,
  rideHeightFromMeters,
  TEMPERATURE_UNIT,
  temperatureFromCelsius,
} from '@/lib/units';

export type Tab = 'temp' | 'pressure' | 'rideHeights' | 'gear' | 'engine' | 'slip';
const TABS: Tab[] = ['slip', 'temp', 'pressure', 'rideHeights', 'gear', 'engine'];

type Edge = keyof TireTemps;
const EDGES: Edge[] = ['outer', 'middle', 'inner'];

// Outer blue, middle teal, inner red, as tire temperature charts usually are; the Compare lap's lines are
// lighter versions of the same colors, dotted
const EDGE_COLORS: Record<Edge, { base: string; compare: string }> = {
  outer: { base: '#2f80ed', compare: '#8fbaf5' },
  middle: { base: '#14a3a3', compare: '#7fd6d6' },
  inner: { base: '#e5484d', compare: '#f59a9d' },
};
// Charts with one line per lap use the laps' own colors (Compare still dotted)
const LAP_COLORS = { base: BASE_LAP_COLOR, compare: COMPARE_LAP_COLOR };
const DOTTED = '0 4'; // zero-length dashes with round caps draw dots

// The Slip & Balance tab's tire slip angles need the car's geometry, which neither iRacing nor the lap files
// give, so they're estimated for a typical GT3 car: steering wheel angle / front wheel angle, and the distances
// (m) from the center of gravity to the front and rear axles (2.7 m wheelbase, a little more weight on the rear)
const STEERING_RATIO = 11;
const CG_TO_FRONT_AXLE = 1.49;
const CG_TO_REAR_AXLE = 1.21;
const DEGREES_PER_RADIAN = 180 / Math.PI;

// Each sample's front and rear tire slip angles (degrees, NaN where the lap can't tell), from the steering, the
// yaw rate and the sideslip (a bicycle model, as the Rotation Model works them out): the angle between where
// each axle's wheels point and the direction that axle travels. Signed like the steering: positive in a left turn.
function tireSlipAngles({ steerings, speeds, handling: { yawRates, sideslips } }: AreaTrace) {
  const front: number[] = [];
  const rear: number[] = [];
  sideslips.forEach((beta, i) => {
    const forward = speeds[i] * Math.cos(beta);
    const left = speeds[i] * Math.sin(beta);
    const r = yawRates[i];
    front.push((steerings[i] / STEERING_RATIO - Math.atan2(left + CG_TO_FRONT_AXLE * r, forward)) * DEGREES_PER_RADIAN);
    rear.push(-Math.atan2(left - CG_TO_REAR_AXLE * r, forward) * DEGREES_PER_RADIAN);
  });
  return { front, rear };
}

// Front minus rear tire slip angle in the direction the car turns (degrees): positive is understeer (the front
// slipping more), negative oversteer
function carBalance(trace: AreaTrace) {
  const { front, rear } = tireSlipAngles(trace);
  return front.map((f, i) => Math.sign(trace.handling.yawRates[i]) * (f - rear[i]));
}

// Upper left, upper right, lower left, lower right
const CORNER_ORDER: TireCorner[] = ['LF', 'RF', 'LR', 'RR'];
const GRID_GAP = 16;
const HEIGHT = 200;
// Narrower than the full-width charts' CHART_MARGIN, as two charts share a row
const MARGIN = { top: 10, right: 16, bottom: 28, left: 44 };

// One line on a chart for each lap: its label ('' for none), colors, and values at each sample in the lap
// file's own units (null when the lap has none)
type Series = {
  key: string;
  label: string;
  colors: { base: string; compare: string };
  values: (trace: AreaTrace) => number[] | null;
};

// One chart: its title, lines, the unit it's shown in and how to get there from the lap file's, the smallest
// range its vertical axis shows and the decimals its numbers get, in the user's units
type Chart = {
  key: string;
  title: string;
  series: Series[];
  unit: string;
  convert: (value: number) => number;
  minSpan: number;
  digits: number;
  diffLabel: string;
};

function LineKey({ color, dotted = false }: { color: string; dotted?: boolean }) {
  return dotted ? (
    <span className="inline-block w-3 align-middle border-t-2 border-dotted" style={{ borderColor: color }} />
  ) : (
    <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: color }} />
  );
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? NaN : finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

// The values, or null when there are none
const present = (values: number[] | undefined) => (values?.some(Number.isFinite) ? values : null);

// Round ticks (in the user's units) across lo..hi, at least minSpan apart in all: steps of 1/2/5 x 10^n, about 4 of them
function yTicks(lo: number, hi: number, minSpan: number) {
  const raw = Math.max(hi - lo, minSpan) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let i = Math.floor(lo / step); i * step <= hi + step - 1e-9; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

// One chart through the focus area: the Base lap in solid lines and the Compare lap in lighter dotted ones,
// sharing the crosshair with the charts above. Over it, in large type, how much higher (+) or lower (-) the
// Compare lap's values were than the Base lap's, at the crosshair, or on average through the area when there's
// no crosshair; under that each lap's own values.
function LapDataChart({
  id,
  chart: { title, series, unit, convert, minSpan, digits, diffLabel },
  base,
  compare,
  axis,
  width,
  hoverPct,
  onHover,
}: {
  id: string;
  chart: Chart;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
}) {
  const { t: dictionary, locale } = useLanguage();
  const t = dictionary.charts;
  const laps = [
    { key: 'base' as const, lap: base },
    { key: 'compare' as const, lap: compare },
  ];

  const [d0, d1] = axis.domain;
  const span = d1 - d0;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const all = laps.flatMap(({ lap }) => series.flatMap((s) => (s.values(lap.trace) ?? []).filter(Number.isFinite).map(convert)));
  const ticks = all.length > 0 ? yTicks(Math.min(...all), Math.max(...all), minSpan) : [];
  const [lo, hi] = ticks.length > 1 ? [ticks[0], ticks[ticks.length - 1]] : [0, 1];
  const x = (pct: number) => MARGIN.left + ((pct - d0) / span) * innerW;
  const y = (value: number) => MARGIN.top + (1 - (value - lo) / (hi - lo)) * innerH;
  // Gaps where the lap file has no value break the line
  const path = (pcts: number[], values: number[]) => {
    let pen = 'M';
    return values
      .map((value, i) => {
        if (!Number.isFinite(value)) {
          pen = 'M';
          return '';
        }
        const segment = `${pen}${x(pcts[i]).toFixed(1)},${y(convert(value)).toFixed(1)}`;
        pen = 'L';
        return segment;
      })
      .join('');
  };

  // Each lap's values in the user's units: at the crosshair, or the area's average
  const readings = laps.map(({ lap }) =>
    series.map((s) => {
      const values = s.values(lap.trace);
      if (!values) return NaN;
      const value = hoverPct === null ? average(values) : values[nearestIndex(lap.trace.pcts, hoverPct)];
      return Number.isFinite(value) ? convert(value) : NaN;
    })
  );
  const format = (value: number, signed = false) =>
    Number.isFinite(value)
      ? `${signed && value >= 0 ? '+' : ''}${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`
      : '—';
  // Rounded as shown, so the difference matches the two values under it
  const round = (value: number) => Math.round(value * 10 ** digits) / 10 ** digits;
  const diffs = series.map((_, i) => round(readings[1][i]) - round(readings[0][i]));

  const hoverX = hoverPct === null ? null : x(clamp(hoverPct, d0, d1));
  const positionFromPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return null;
    return clamp(d0 + ((event.clientX - box.left - MARGIN.left) / innerW) * span, d0, d1);
  };
  // Arrow keys move the crosshair a hundredth of the area at a time
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (span / 100);
    onHover(clamp((hoverPct ?? d0) + step, d0, d1));
  };

  const readingText = (i: number) => series.map((s, j) => `${s.label} ${format(readings[i][j])}`.trim()).join(', ');

  return (
    <figure className="relative min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-1">
        <span className="text-sm font-semibold text-foreground">
          {title} <span className="font-normal text-muted-foreground">{unit}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {hoverPct === null ? t.tireAreaAverage : positionLabel(hoverPct, axis)}
        </span>
      </div>

      {all.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t.lapDataNone}</p>
      ) : (
        <>
          {/* The difference, Compare minus Base, stands out; each lap's values are under it */}
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-label={diffLabel}>
            {series.map((s, i) => (
              <span key={s.key} className="text-2xl font-bold tabular-nums" style={{ color: s.colors.base }}>
                {format(diffs[i], true)}
              </span>
            ))}
          </p>
          <p className="mb-1 text-[11px] text-muted-foreground">{diffLabel}</p>
          <div className="mb-2 space-y-0.5 text-xs">
            {laps.map(({ key, lap }, i) => (
              <p key={key} className="flex flex-wrap items-center gap-x-2.5">
                <span className="font-semibold text-foreground">{lap.title}</span>
                {series.map((s, j) => (
                  <span key={s.key} className="flex items-center gap-1 tabular-nums" style={{ color: s.colors[key] }}>
                    <LineKey color={s.colors[key]} dotted={key === 'compare'} />
                    {s.label} {format(readings[i][j])}
                  </span>
                ))}
              </p>
            ))}
          </div>

          <svg
            width={width}
            height={HEIGHT}
            tabIndex={0}
            role="img"
            aria-label={`${title}. ${laps.map(({ lap }, i) => `${lap.title}: ${readingText(i)}`).join('. ')}`}
            onKeyDown={onKeyDown}
            onFocus={() => onHover(hoverPct ?? d0)}
            onBlur={() => onHover(null)}
            className="block text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
          >
            <defs>
              <clipPath id={`${id}-plot`}>
                <rect x={MARGIN.left} y={0} width={innerW} height={HEIGHT} />
              </clipPath>
            </defs>

            {/* Recessive hairline grid and axes */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
                <text x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="tabular-nums">
                  {tick.toLocaleString(locale)}
                </text>
              </g>
            ))}
            {xTicks(axis).map((tick) => (
              <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="tabular-nums">
                {positionLabel(tick, axis)}
              </text>
            ))}

            {/* Base lap underneath, Compare lap's dots on top so they stay visible where the lines meet */}
            <g clipPath={`url(#${id}-plot)`} fill="none" strokeLinejoin="round" strokeLinecap="round">
              {laps.map(({ key, lap }) => (
                <g key={key} strokeDasharray={key === 'compare' ? DOTTED : undefined} strokeWidth={key === 'compare' ? 2.5 : 2}>
                  {series.map((s) => {
                    const values = s.values(lap.trace);
                    return values ? <path key={s.key} d={path(lap.trace.pcts, values)} stroke={s.colors[key]} /> : null;
                  })}
                </g>
              ))}
            </g>

            {hoverX !== null && (
              <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="currentColor" strokeWidth={1} />
            )}

            {/* The hit target is the whole plot, not the 2px lines */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={(event) => onHover(positionFromPointer(event))}
              onPointerLeave={() => onHover(null)}
            />
          </svg>
        </>
      )}
    </figure>
  );
}

// Under Lap Compare's charts for a focus area: Balance, Tire Temp, Tire Pressure, Ride Heights, Gear and Engine &
// Fuel tabs. The three tire and ride height tabs each have a chart per corner (left front and right front above, left rear and
// right rear below) of both laps' tire temperatures (outer, middle, inner), tire pressures or ride
// heights; Gear has the gear and RPM; Engine & Fuel has water and oil temperatures above, fuel use and fuel left below;
// Balance has the steering angle, yaw rate, rear wheel slip, front and rear tire slip angles and the
// car's balance. Two charts a row, or one on narrow screens. width is the container's. The tab is kept by Lap
// Compare, so it stays the same when another focus area is picked.
export default function LapDataTabs({
  id,
  base,
  compare,
  axis,
  width,
  hoverPct,
  onHover,
  tab,
  onTabChange: setTab,
}: {
  id: string;
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  width: number;
  hoverPct: number | null;
  onHover: (pct: number | null) => void;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const { t: dictionary, fmt } = useLanguage();
  const t = dictionary.charts;
  const units = useUnits();
  // The panel's padding (p-4) on both sides, then two columns when there's room
  const innerWidth = width - 32;
  const twoColumns = innerWidth >= 640;
  const chartWidth = twoColumns ? (innerWidth - GRID_GAP) / 2 : innerWidth;

  const edgeLabel: Record<Edge, string> = { outer: t.tireOuter, middle: t.tireMiddle, inner: t.tireInner };
  const toTemperature = (celsius: number) => temperatureFromCelsius(celsius, units);
  const toMass = (kg: number) => massFromKg(kg, units);
  // One line per lap
  const lapLine = (values: (trace: AreaTrace) => number[] | null): Series[] => [
    { key: 'value', label: '', colors: LAP_COLORS, values },
  ];
  const engineChart = (
    key: string,
    title: string,
    unit: string,
    convert: (value: number) => number,
    minSpan: number,
    digits: number,
    values: (trace: AreaTrace) => number[] | null
  ): Chart => ({ key, title, series: lapLine(values), unit, convert, minSpan, digits, diffLabel: t.lapDataDiffLabel });

  // Slip & Balance charts, in units that are the same for Standard and Metric
  const slipChart = (
    key: string,
    title: string,
    unit: string,
    convert: (value: number) => number,
    minSpan: number,
    digits: number,
    values: (trace: AreaTrace) => number[] | null
  ): Chart => engineChart(key, title, unit, convert, minSpan, digits, values);
  const asIs = (value: number) => value;
  const toDegrees = (radians: number) => radians * DEGREES_PER_RADIAN;

  // What each filled-in tab charts, whether a lap has any of it, and its texts
  const tabs = {
    temp: {
      has: (trace: AreaTrace) => Boolean(trace.tireTemps),
      charts: CORNER_ORDER.map((corner): Chart => ({
        key: corner,
        title: t.tireCorners[corner],
        series: EDGES.map((edge) => ({
          key: edge,
          label: edgeLabel[edge],
          colors: EDGE_COLORS[edge],
          values: (trace) => trace.tireTemps?.[corner][edge] ?? null,
        })),
        unit: TEMPERATURE_UNIT[units],
        convert: toTemperature,
        minSpan: 1,
        digits: 1,
        diffLabel: t.tireDiffLabel,
      })),
      none: t.tireNoTemps,
      lapNone: t.tireLapNoTemps,
      caption: t.tireTempCaption,
    },
    pressure: {
      has: (trace: AreaTrace) => Boolean(trace.tirePressures),
      charts: CORNER_ORDER.map((corner): Chart => ({
        key: corner,
        title: t.tireCorners[corner],
        series: lapLine((trace) => trace.tirePressures?.[corner] ?? null),
        unit: PRESSURE_UNIT[units],
        convert: (kpa) => pressureFromKpa(kpa, units),
        minSpan: units === 'metric' ? 2 : 0.4,
        digits: 1,
        diffLabel: t.lapDataDiffLabel,
      })),
      none: t.tireNoPressures,
      lapNone: t.tireLapNoPressures,
      caption: t.tirePressureCaption,
    },
    rideHeights: {
      has: (trace: AreaTrace) => Boolean(trace.rideHeights),
      charts: CORNER_ORDER.map((corner): Chart => ({
        key: corner,
        title: t.tireCorners[corner],
        series: lapLine((trace) => trace.rideHeights?.[corner] ?? null),
        unit: RIDE_HEIGHT_UNIT[units],
        convert: (meters) => rideHeightFromMeters(meters, units),
        minSpan: units === 'metric' ? 5 : 0.2,
        digits: units === 'metric' ? 1 : 2,
        diffLabel: t.lapDataDiffLabel,
      })),
      none: t.rideHeightNone,
      lapNone: t.rideHeightLapNone,
      caption: t.rideHeightCaption,
    },
    gear: {
      has: ({ engine }: AreaTrace) => Boolean(present(engine.gears)),
      charts: [
        engineChart('gear', t.gearCharts.gear, '', asIs, 2, 0, (trace) => present(trace.engine.gears)),
        engineChart('rpm', t.engineCharts.rpm, 'rpm', asIs, 500, 0, (trace) => present(trace.engine.rpms)),
      ],
      none: t.gearNone,
      lapNone: t.gearLapNone,
      caption: t.gearCaption,
    },
    engine: {
      has: ({ engine: { waterTemps, oilTemps, fuelKgs, fuelKgPerHour } }: AreaTrace) =>
        [waterTemps, oilTemps, fuelKgs, fuelKgPerHour].some((values) => present(values)),
      charts: [
        engineChart('water', t.engineCharts.waterTemp, TEMPERATURE_UNIT[units], toTemperature, 1, 1, (trace) =>
          present(trace.engine.waterTemps)
        ),
        engineChart('oil', t.engineCharts.oilTemp, TEMPERATURE_UNIT[units], toTemperature, 1, 1, (trace) =>
          present(trace.engine.oilTemps)
        ),
        engineChart('fuelUse', t.engineCharts.fuelUsage, MASS_RATE_UNIT[units], toMass, 5, 1, (trace) =>
          present(trace.engine.fuelKgPerHour)
        ),
        engineChart('fuel', t.engineCharts.fuelLevel, MASS_UNIT[units], toMass, 0.5, 2, (trace) => present(trace.engine.fuelKgs)),
      ],
      none: t.engineNone,
      lapNone: t.engineLapNone,
      caption: t.engineCaption,
    },
    slip: {
      has: ({ handling }: AreaTrace) => Boolean(present(handling.yawRates) || present(handling.sideslips)),
      charts: [
        slipChart('steering', t.slipCharts.steering, '°', toDegrees, 20, 1, (trace) => trace.steerings),
        slipChart('yawRate', t.slipCharts.yawRate, '°/s', toDegrees, 10, 1, (trace) => present(trace.handling.yawRates)),
        slipChart('rearWheels', t.slipCharts.rearWheels, '%', (ratio) => ratio * 100, 2, 1, (trace) =>
          present(trace.handling.rearWheelSlips)
        ),
        slipChart('frontTires', t.slipCharts.frontTires, '°', asIs, 2, 2, (trace) => present(tireSlipAngles(trace).front)),
        slipChart('rearTires', t.slipCharts.rearTires, '°', asIs, 2, 2, (trace) => present(tireSlipAngles(trace).rear)),
        slipChart('balance', t.slipCharts.balance, '°', asIs, 2, 2, (trace) => present(carBalance(trace))),
      ],
      none: t.slipNone,
      lapNone: t.slipLapNone,
      caption: t.slipCaption,
    },
  };
  const panel = tabs[tab];
  const missing = [base, compare].filter((lap) => !panel.has(lap.trace));

  return (
    <div className="rounded-lg border border-border bg-secondary/40">
      <div role="tablist" aria-label={t.tireDataLabel} className="flex flex-wrap gap-2 px-4 pt-3 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === key ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'
            }`}
          >
            {t.tireTabs[key]}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="p-4">
        {missing.length === 2 ? (
          <p className="text-sm text-muted-foreground">{panel.none}</p>
        ) : (
          <>
            {missing.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {fmt(panel.lapNone, { lap: missing.map((lap) => lap.title).join(', ') })}
              </p>
            )}
            <div className={`grid gap-4 ${twoColumns ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {panel.charts.map((chart) => (
                <LapDataChart
                  key={`${tab}-${chart.key}`}
                  id={`${id}-${tab}-${chart.key}`}
                  chart={chart}
                  base={base}
                  compare={compare}
                  axis={axis}
                  width={chartWidth}
                  hoverPct={hoverPct}
                  onHover={onHover}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{panel.caption}</p>
          </>
        )}
      </div>
    </div>
  );
}
