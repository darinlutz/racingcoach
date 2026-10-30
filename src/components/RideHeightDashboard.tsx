'use client';

import { useCallback, useMemo, useState } from 'react';

import DashboardCarView, { wheelCenter } from '@/components/DashboardCarView';
import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry, type ChannelPair } from '@/components/TelemetryCursor';
import { DeltaIndicator, deltaFill, LapChannelChart, MetricCard, Panel, shownDelta, signTone, StatGrid, useAtCursor, useNumbers, usePair, useViewWindow, type ChartRegion } from '@/components/TelemetryPanels';
import { useUnits } from '@/components/UnitsProvider';
import { deltas, largest, stats, stretchesWhere } from '@/lib/lapChannels';
import { gapLabel } from '@/lib/lapCharts';
import { TIRE_CORNERS, type TireCorner } from '@/lib/lapData';
import { RIDE_HEIGHT_UNIT, rideHeightFromMeters } from '@/lib/units';

const WIDE = 1100;
const CAR_COLUMN = 400;
const SIDE_COLUMN = 360;
const INDICATOR_WIDTH = 92;
const DEFAULT_THRESHOLD_MM = 36;
const THRESHOLD_RANGE_MM: [number, number] = [20, 60];
const COLOR_RANGE_MM = 6; // A difference at the car's strongest color
const METERS_PER_MM = 0.001;
const SCHEMATIC_PX_PER_MM = 0.55;

// One corner's height at the crosshair for both laps, on a scale across the laps
function HeightIndicator({ target, compare, range, threshold, unit, digits }: { target: number | null; compare: number | null; range: [number, number]; threshold: number; unit: string; digits: number }) {
  const { t } = useLanguage();
  const { num } = useNumbers();
  const share = (value: number | null) => (value === null ? 0 : Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0] || 1))) * 100);
  const delta = shownDelta(target, compare, digits);
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-l border-border px-2 py-2" style={{ width: INDICATOR_WIDTH }}>
      <span className="tele-label">{t.charts.dash.height}</span>
      <div className="relative flex h-[150px] w-full justify-center gap-2">
        {[
          { value: target, color: 'bg-lap-target' },
          { value: compare, color: 'bg-lap-compare' },
        ].map(({ value, color }) => (
          <div key={color} className="relative h-full w-5 overflow-hidden rounded-sm border border-border bg-secondary">
            <div className={`absolute inset-x-0 bottom-0 opacity-85 ${color}`} style={{ height: `${share(value)}%` }} />
          </div>
        ))}
        <div className="absolute inset-x-0 h-px bg-tele-warn" style={{ bottom: `${share(threshold)}%` }} />
      </div>
      <div className="tele-num flex w-full justify-between text-[10px]">
        <span className="text-lap-target">{num(target, digits)}</span>
        <span className="text-lap-compare">{num(compare, digits)}</span>
      </div>
      <DeltaIndicator value={delta} digits={digits} size="lg" label={false} />
      <span className="text-[9px] text-muted-foreground">{unit}</span>
    </div>
  );
}

// A drawing of the car's stance from the side (rake) and behind (left minus right) for both laps, from the corners'
// heights in millimeters. A schematic, its heights exaggerated.
function ChassisAttitude({ front, rear, left, right, toUnits, unit, digits }: { front: (number | null)[]; rear: (number | null)[]; left: (number | null)[]; right: (number | null)[]; toUnits: (mm: number) => number; unit: string; digits: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const { num } = useNumbers();
  const ground = 96;
  const y = (mm: number) => ground - 8 - mm * SCHEMATIC_PX_PER_MM;
  const colors = ['var(--lap-target)', 'var(--lap-compare)'];
  const toneClass = ['text-lap-target', 'text-lap-compare'];
  const shown = (mm: number | null) => num(mm === null ? null : toUnits(mm), digits);
  const difference = (a: (number | null)[], b: (number | null)[], i: number) => (a[i] !== null && b[i] !== null ? (a[i] as number) - (b[i] as number) : null);
  const rake = [difference(rear, front, 0), difference(rear, front, 1)];
  const leftRight = [difference(left, right, 0), difference(left, right, 1)];
  const change = (values: (number | null)[]) => (values[0] !== null && values[1] !== null ? toUnits(values[1] - values[0]) : null);
  return (
    <div className="grid w-full grid-cols-[1.6fr_1fr] gap-2">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="tele-label">{dash.sideProfile}</span>
          <DeltaIndicator value={change(rake)} digits={digits} unit={unit} size="sm" />
        </div>
        <svg viewBox="0 0 300 104" className="w-full" role="img" aria-label={dash.sideProfile}>
          <line x1="0" x2="300" y1={ground} y2={ground} stroke="var(--muted-foreground)" />
          <circle cx="70" cy={ground - 14} r="14" fill="var(--car-body)" stroke="var(--border)" />
          <circle cx="232" cy={ground - 15} r="15" fill="var(--car-body)" stroke="var(--border)" />
          {[0, 1].map((i) => {
            const [f, r] = [front[i], rear[i]];
            if (f === null || r === null) return null;
            const slope = (y(r) - y(f)) / (232 - 70);
            const at = (x: number) => y(f) + (x - 70) * slope;
            return (
              <g key={i}>
                <path d={`M14,${at(14)} L286,${at(286)} L282,${at(282) - 18} L230,${at(230) - 26} L170,${at(170) - 44} L120,${at(120) - 44} L60,${at(60) - 22} L20,${at(20) - 12} Z`} fill={colors[i]} fillOpacity="0.07" stroke={colors[i]} strokeWidth="1.2" />
                <line x1="14" x2="286" y1={at(14)} y2={at(286)} stroke={colors[i]} strokeWidth="2" />
              </g>
            );
          })}
          <text x="4" y="10" fontSize="8" fill="var(--muted-foreground)">{dash.front}</text>
          <text x="296" y="10" fontSize="8" textAnchor="end" fill="var(--muted-foreground)">{dash.rear}</text>
        </svg>
        <div className="tele-num flex flex-wrap justify-between gap-x-2 text-[10px]">
          {[
            { key: 'front', label: dash.front, values: front },
            { key: 'rake', label: dash.rake, values: rake },
            { key: 'rear', label: dash.rear, values: rear },
          ].map(({ key, label, values }) => (
            <span key={key}>
              {label} <span className={toneClass[0]}>{shown(values[0])}</span>/<span className={toneClass[1]}>{shown(values[1])}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="tele-label">{dash.rearView}</span>
          <DeltaIndicator value={change(leftRight)} digits={digits} unit={unit} size="sm" />
        </div>
        <svg viewBox="0 0 160 104" className="w-full" role="img" aria-label={dash.rearView}>
          <line x1="0" x2="160" y1={ground} y2={ground} stroke="var(--muted-foreground)" />
          <rect x="8" y={ground - 30} width="22" height="30" rx="4" fill="var(--car-body)" stroke="var(--border)" />
          <rect x="130" y={ground - 30} width="22" height="30" rx="4" fill="var(--car-body)" stroke="var(--border)" />
          {[0, 1].map((i) => {
            const [l, r] = [left[i], right[i]];
            if (l === null || r === null) return null;
            const [yl, yr] = [y(l), y(r)];
            return (
              <g key={i}>
                <path d={`M20,${yl} L140,${yr} L130,${yr - 30} L100,${(yr + yl) / 2 - 46} L60,${(yr + yl) / 2 - 46} L30,${yl - 30} Z`} fill={colors[i]} fillOpacity="0.07" stroke={colors[i]} strokeWidth="1.2" />
                <line x1="20" x2="140" y1={yl} y2={yr} stroke={colors[i]} strokeWidth="2" />
              </g>
            );
          })}
        </svg>
        <div className="tele-num text-center text-[10px]">
          <span className={toneClass[0]}>{shown(leftRight[0])}</span>/<span className={toneClass[1]}>{shown(leftRight[1])}</span> {unit}
        </div>
      </div>
      <p className="col-span-2 text-[9px] text-muted-foreground">{dash.schematicNote}</p>
    </div>
  );
}

// The Ride Heights tab: each corner's trace and height at the crosshair around the car, the car's stance, what the
// differences add up to, and stretches under a height the driver sets (which only suggest it might have bottomed out).
export default function RideHeightDashboard({ id, width }: { id: string; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const unit = RIDE_HEIGHT_UNIT[units];
  const digits = units === 'metric' ? 1 : 2;
  const { num, signed } = useNumbers();
  const { axis, grid, channels } = useTelemetry();
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const [thresholdMm, setThresholdMm] = useState(DEFAULT_THRESHOLD_MM);
  const [showRisk, setShowRisk] = useState(true);
  const { pcts } = grid;
  const heights = channels.rideHeights;

  const convert = useCallback((meters: number) => rideHeightFromMeters(meters, units), [units]);
  const threshold = convert(thresholdMm * METERS_PER_MM);
  const pairs: Record<TireCorner, ChannelPair> = {
    LF: usePair(heights.LF, convert),
    RF: usePair(heights.RF, convert),
    LR: usePair(heights.LR, convert),
    RR: usePair(heights.RR, convert),
  };

  // Everything the laps read, so the indicators keep their scale as the crosshair moves
  const range = useMemo<[number, number]>(() => {
    const all = TIRE_CORNERS.flatMap((corner) => pairs[corner].flatMap((lap) => {
      const s = stats(lap);
      return s ? [s.min, s.max] : [];
    }));
    return all.length > 0 ? [Math.min(...all, threshold), Math.max(...all, threshold)] : [0, 1];
    // The pairs change with heights and convert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heights, convert, threshold]);

  const belowRegions = useCallback(
    (corner: TireCorner): ChartRegion[] => {
      if (!showRisk) return [];
      const [a, b] = pairs[corner];
      const below = (values: number[] | null, color: string) => (values ? stretchesWhere(pcts, (i) => values[i] < threshold).map((s) => ({ ...s, color })) : []);
      return [...below(a, 'var(--lap-target)'), ...below(b, 'var(--lap-compare)')];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heights, convert, threshold, showRisk, pcts]
  );

  const cornerChart = (corner: TireCorner, chartWidth: number) => {
    const [a, b] = pairs[corner];
    const [sa, sb] = [stats(a, i0, i1), stats(b, i0, i1)];
    const most = largest(deltas(a, b), i0, i1);
    const chart = chartWidth - INDICATOR_WIDTH - 2;
    return (
      <div key={corner} className="flex min-w-0 rounded-md border border-border bg-card">
        <div className="min-w-0 flex-1">
          <LapChannelChart
            id={`${id}-${corner}`}
            title={t.charts.tireCorners[corner]}
            values={pairs[corner]}
            unit={unit}
            digits={digits}
            minSpan={units === 'metric' ? 5 : 0.2}
            width={chart}
            height={200}
            embedded
            regions={belowRegions(corner)}
            references={[{ value: threshold, label: dash.threshold, color: 'var(--tele-warn)' }]}
          />
          <StatGrid
            columns={4}
            items={[
              { label: `${dash.avg} ${labels.targetInitial}`, value: num(sa?.avg, digits), tone: 'target' },
              { label: `${dash.avg} ${labels.compareInitial}`, value: num(sb?.avg, digits), tone: 'compare' },
              { label: `${dash.avg} Δ`, value: signed(shownDelta(sa?.avg, sb?.avg, digits), digits), tone: signTone(shownDelta(sa?.avg, sb?.avg, digits)) },
              { label: `${dash.min} ${labels.targetInitial}`, value: num(sa?.min, digits), tone: 'target' },
              { label: `${dash.min} ${labels.compareInitial}`, value: num(sb?.min, digits), tone: 'compare' },
              { label: `${dash.min} Δ`, value: signed(shownDelta(sa?.min, sb?.min, digits), digits), tone: signTone(shownDelta(sa?.min, sb?.min, digits)) },
              { label: labels.maxDelta, value: signed(most?.value, digits), tone: signTone(most?.value) },
            ]}
          />
        </div>
        <HeightIndicator target={atCursor(a)} compare={atCursor(b)} range={range} threshold={threshold} unit={unit} digits={digits} />
      </div>
    );
  };

  // Heights at the crosshair in millimeters for the drawing, averaged across each side
  const mmAt = (corner: TireCorner, lap: 0 | 1) => {
    const value = atCursor(heights[corner][lap]);
    return value === null ? null : value / METERS_PER_MM;
  };
  const averageMm = (a: TireCorner, b: TireCorner) =>
    ([0, 1] as const).map((lap) => {
      const [x, y] = [mmAt(a, lap), mmAt(b, lap)];
      return x !== null && y !== null ? (x + y) / 2 : null;
    });
  const wheelDelta = (corner: TireCorner) => {
    const [a, b] = [atCursor(pairs[corner][0]), atCursor(pairs[corner][1])];
    return a !== null && b !== null ? b - a : null;
  };

  const meanOf = (lap: 0 | 1, corners: TireCorner[]) => {
    const values = corners.map((corner) => stats(pairs[corner][lap], i0, i1)?.avg ?? null);
    return values.every((value) => value !== null) ? (values as number[]).reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const diff = (corners: TireCorner[]) => {
    const [a, b] = [meanOf(0, corners), meanOf(1, corners)];
    return a !== null && b !== null ? b - a : null;
  };
  const [frontDelta, rearDelta, leftDelta, rightDelta] = [diff(['LF', 'RF']), diff(['LR', 'RR']), diff(['LF', 'LR']), diff(['RF', 'RR'])];

  // The lowest reading in view, and whose it was
  let lowest: { value: number; who: string } | null = null;
  let biggest: number | null = null;
  for (const corner of TIRE_CORNERS) {
    const [a, b] = pairs[corner];
    const [sa, sb] = [stats(a, i0, i1), stats(b, i0, i1)];
    if (sa && (!lowest || sa.min < lowest.value)) lowest = { value: sa.min, who: `${labels.targetInitial} ${corner}` };
    if (sb && (!lowest || sb.min < lowest.value)) lowest = { value: sb.min, who: `${labels.compareInitial} ${corner}` };
    const most = largest(deltas(a, b), i0, i1);
    if (most && (biggest === null || Math.abs(most.value) > Math.abs(biggest))) biggest = most.value;
  }

  // How far through what's in view any corner was under the threshold, per lap
  const distanceBelow = (lap: 0 | 1) => {
    let count = 0;
    let any = false;
    for (let i = i0; i <= i1; i++) {
      const values = TIRE_CORNERS.map((corner) => pairs[corner][lap]?.[i]);
      if (values.some((value) => value !== undefined)) any = true;
      if (values.some((value) => value !== undefined && value < threshold)) count++;
    }
    return any ? (count * (pcts[1] - pcts[0])) : null;
  };
  const [belowTarget, belowCompare] = [distanceBelow(0), distanceBelow(1)];

  const wide = width >= WIDE;
  const sideWidth = wide ? (width - CAR_COLUMN - 24) / 2 : width;
  const front = averageMm('LF', 'RF');
  const rear = averageMm('LR', 'RR');
  const left = averageMm('LF', 'LR');
  const right = averageMm('RF', 'RR');
  const mmToUnits = (mm: number) => convert(mm * METERS_PER_MM);

  const car = (
    <Panel title={dash.chassis} subtitle={dash.heightDeltaAtCursor}>
      <div className="flex flex-col items-center gap-2 p-3">
        <DashboardCarView
          title={dash.chassis}
          className="h-[340px] max-w-full"
          showSuspension
          wheels={Object.fromEntries(TIRE_CORNERS.map((corner) => [corner, { fill: deltaFill(wheelDelta(corner), convert(COLOR_RANGE_MM * METERS_PER_MM)), highlighted: true }]))}
        >
          {TIRE_CORNERS.map((corner) => {
            const { x, y } = wheelCenter(corner);
            const delta = wheelDelta(corner);
            return (
              <text key={corner} x={x} y={corner.endsWith('F') ? y - 38 : y + 46} textAnchor="middle" fontSize={10} fontWeight={700} className="tele-num" fill={delta === null ? 'var(--muted-foreground)' : delta >= 0 ? 'var(--tele-pos)' : 'var(--tele-neg)'}>
                {signed(shownDelta(atCursor(pairs[corner][0]), atCursor(pairs[corner][1]), digits), digits)}
              </text>
            );
          })}
        </DashboardCarView>
        <div className="w-full border-t border-border pt-2">
          <ChassisAttitude front={front} rear={rear} left={left} right={right} toUnits={mmToUnits} unit={unit} digits={digits} />
        </div>
      </div>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-3">
      {wide ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `minmax(0, 1fr) ${CAR_COLUMN}px minmax(0, 1fr)` }}>
          <div className="flex min-w-0 flex-col gap-3">
            {cornerChart('LF', sideWidth)}
            {cornerChart('LR', sideWidth)}
          </div>
          {car}
          <div className="flex min-w-0 flex-col gap-3">
            {cornerChart('RF', sideWidth)}
            {cornerChart('RR', sideWidth)}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {car}
          {TIRE_CORNERS.map((corner) => cornerChart(corner, sideWidth))}
        </div>
      )}

      <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) ${SIDE_COLUMN}px` } : undefined}>
        <Panel title={dash.heightSummary} subtitle={`${dash.inView} · ${t.charts.pedalDelta}`}>
          <div className="grid grid-cols-2 gap-2 p-2.5 md:grid-cols-4 xl:grid-cols-7">
            <MetricCard label={dash.frontAxleDelta} delta={frontDelta} digits={digits} unit={unit} />
            <MetricCard label={dash.rearAxleDelta} delta={rearDelta} digits={digits} unit={unit} />
            <MetricCard label={dash.rakeDelta} delta={frontDelta !== null && rearDelta !== null ? rearDelta - frontDelta : null} digits={digits} unit={unit} note={dash.rakeNote} />
            <MetricCard label={dash.leftRightDelta} delta={leftDelta !== null && rightDelta !== null ? leftDelta - rightDelta : null} digits={digits} unit={unit} note={dash.leftRightNote} />
            <MetricCard label={dash.largestDelta} delta={biggest} digits={digits} unit={unit} />
            <div className="flex flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2">
              <span className="tele-label">{dash.lowestRecorded}</span>
              <span className="tele-num text-xl text-foreground">
                {num(lowest?.value, digits)} <span className="text-xs text-muted-foreground">{unit}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">{lowest?.who}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2">
              <span className="tele-label">{dash.distanceBelow}</span>
              <span className="tele-num text-[11px]">
                <span className="text-lap-target">{labels.targetInitial} {belowTarget === null ? '–' : gapLabel(belowTarget, axis)}</span>
              </span>
              <span className="tele-num text-[11px]">
                <span className="text-lap-compare">{labels.compareInitial} {belowCompare === null ? '–' : gapLabel(belowCompare, axis)}</span>
              </span>
            </div>
          </div>
        </Panel>
        <Panel title={dash.bottomingRisk} subtitle={dash.configurable}>
          <div className="flex flex-col gap-2 p-3 text-xs">
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" checked={showRisk} onChange={(event) => setShowRisk(event.target.checked)} className="accent-primary" /> {dash.highlightBelow}
            </label>
            <div className="flex items-center gap-2">
              <span className="tele-label">{dash.threshold}</span>
              <input aria-label={dash.threshold} type="range" min={THRESHOLD_RANGE_MM[0]} max={THRESHOLD_RANGE_MM[1]} step={0.5} value={thresholdMm} onChange={(event) => setThresholdMm(Number(event.target.value))} className="min-w-0 flex-1 accent-primary" />
              <span className="tele-num w-16 text-right text-tele-warn">
                {num(threshold, digits)} {unit}
              </span>
            </div>
            <p className="text-[9px] leading-snug text-muted-foreground">{dash.bottomingNote}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
