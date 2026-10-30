'use client';

import { useMemo, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { gearLabel } from '@/components/SteeringWheel';
import { DASH_GAP, DeltaIndicator, LapChannelChart, MetricCard, Panel, shownDelta, signTone, StatGrid, useAtCursor, useNumbers, useViewWindow, type ChartMarker } from '@/components/TelemetryPanels';
import { useUnits } from '@/components/UnitsProvider';
import { deltas, largest, pairShifts, shiftEvents, stats, stretchesWhere } from '@/lib/lapChannels';
import { clamp, gapLabel, positionLabel } from '@/lib/lapCharts';
import { SPEED_UNIT } from '@/lib/units';

const WIDE = 1100;
const SIDE_COLUMN = 400;
const LED_COUNT = 15;
const LED_START_SHARE = 0.82; // Of the laps' highest RPM, where the shift lights start by default
const SLIDER_RANGE = [3000, 12000];
const SAME_SHIFT_SHARE = 0.0005; // Of a lap: closer than this, neither shifted later

function GearIndicator({ lap, gear, rpm, speed, ledStart, shiftPoint }: { lap: 'target' | 'compare'; gear: number | null; rpm: number | null; speed: string; ledStart: number; shiftPoint: number }) {
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const { num } = useNumbers();
  const tone = lap === 'target' ? 'text-lap-target' : 'text-lap-compare';
  const reached = rpm !== null && rpm >= shiftPoint;
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 rounded-md border bg-[#05080d] p-3 ${lap === 'target' ? 'border-lap-target/40' : 'border-lap-compare/40'}`}>
      <div className="flex flex-wrap justify-center gap-0.5" role="img" aria-label={`RPM ${num(rpm, 0)}`}>
        {Array.from({ length: LED_COUNT }, (_, i) => {
          const at = ledStart + ((shiftPoint - ledStart) * i) / (LED_COUNT - 1);
          const lit = rpm !== null && rpm >= at;
          const color = i < LED_COUNT / 3 ? '#22c55e' : i < (2 * LED_COUNT) / 3 ? '#facc15' : '#ef4444';
          return <span key={i} className="size-2 rounded-full" style={{ backgroundColor: reached ? 'var(--lap-target)' : lit ? color : '#2b3440' }} />;
        })}
      </div>
      <div className="flex w-full flex-wrap items-end justify-between gap-x-2">
        <span className={`tele-label ${lap === 'target' ? '!text-lap-target' : '!text-lap-compare'}`}>{lap === 'target' ? labels.target : labels.compare}</span>
        <span className="tele-num text-[11px] text-[#9aa3ae]">{speed}</span>
      </div>
      <div className={`tele-num text-[72px] font-bold leading-[0.9] ${tone}`}>{gear === null ? '–' : gearLabel(gear)}</div>
      <div className="tele-num text-lg text-[#e5e7eb]">
        {num(rpm, 0)} <span className="text-[10px] text-[#9aa3ae]">rpm</span>
      </div>
    </div>
  );
}

// The Gear tab: RPM and gear through the area with each lap's shifts marked and stretches in different gears tinted,
// the same shifts compared one by one, each lap's gear at the crosshair, and how the shifts add up in what's in view.
export default function GearRpmDashboard({ id, width }: { id: string; width: number }) {
  const { t, locale, fmt } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const { num, signed } = useNumbers();
  const { axis, base, compare, grid, channels } = useTelemetry();
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const { pcts, speeds } = grid;
  const { rpms, gears } = channels;

  const highest = useMemo(() => Math.max(0, ...rpms.flatMap((lap) => {
    const s = stats(lap);
    return s ? [s.max] : [];
  })), [rpms]);
  const [typed, setTyped] = useState<{ start?: number; shift?: number }>({});
  const shiftPoint = typed.shift ?? Math.round(highest / 50) * 50;
  const ledStart = typed.start ?? Math.round((highest * LED_START_SHARE) / 50) * 50;

  const targetShifts = useMemo(() => shiftEvents(base.trace.pcts, base.trace.engine.gears, base.trace.engine.rpms), [base]);
  const compareShifts = useMemo(() => shiftEvents(compare.trace.pcts, compare.trace.engine.gears, compare.trace.engine.rpms), [compare]);
  const pairs = useMemo(() => pairShifts(targetShifts, compareShifts), [targetShifts, compareShifts]);
  const markers = useMemo<ChartMarker[]>(
    () => [
      ...targetShifts.map(({ pct, type }) => ({ pct, lap: 'target' as const, kind: type })),
      ...compareShifts.map(({ pct, type }) => ({ pct, lap: 'compare' as const, kind: type })),
    ],
    [targetShifts, compareShifts]
  );
  const [gearsA, gearsB] = gears;
  const different = useMemo(
    () => (gearsA && gearsB ? stretchesWhere(pcts, (i) => Number.isFinite(gearsA[i]) && Number.isFinite(gearsB[i]) && gearsA[i] !== gearsB[i]) : []),
    [pcts, gearsA, gearsB]
  );
  const gearRange = useMemo(() => {
    const all = gears.flatMap((lap) => {
      const s = stats(lap);
      return s ? [s.min, s.max] : [];
    });
    return all.length > 0 ? [Math.min(...all), Math.max(...all)] : [0, 1];
  }, [gears]);
  const gearTicks = Array.from({ length: gearRange[1] - gearRange[0] + 1 }, (_, i) => gearRange[0] + i);

  const [targetGear, compareGear] = [atCursor(gearsA), atCursor(gearsB)];
  const [targetRpm, compareRpm] = [atCursor(rpms[0]), atCursor(rpms[1])];
  const speedAt = (lap: 0 | 1) => {
    const value = atCursor(speeds[lap]);
    return value === null ? '' : `${num(value, 0)} ${SPEED_UNIT[units]}`;
  };
  const [rpmA, rpmB] = [stats(rpms[0], i0, i1), stats(rpms[1], i0, i1)];
  const rpmLargest = largest(useMemo(() => deltas(rpms[0], rpms[1]), [rpms]), i0, i1);
  const inView = ({ pct }: { pct: number }) => pct >= pcts[i0] && pct <= pcts[i1];
  const count = (shifts: typeof targetShifts, type: 'up' | 'down') => shifts.filter((s) => s.type === type && inView(s)).length;
  const differentInView = gearsA && gearsB ? (() => {
    let n = 0;
    for (let i = i0; i <= i1; i++) if (Number.isFinite(gearsA[i]) && Number.isFinite(gearsB[i]) && gearsA[i] !== gearsB[i]) n++;
    return n * (pcts[1] - pcts[0]);
  })() : null;
  const paired = pairs.filter((p) => p.target && p.compare);
  const largestShift = paired.reduce<number | null>((most, p) => {
    const gap = (p.compare?.pct ?? 0) - (p.target?.pct ?? 0);
    return most === null || Math.abs(gap) > Math.abs(most) ? gap : most;
  }, null);

  const wide = width >= WIDE;
  const mainWidth = wide ? width - SIDE_COLUMN - DASH_GAP : width;
  const rpmTick = (tick: number) => `${(tick / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
  const gapValue = (gap: number) => `${gap >= 0 ? '+' : '−'}${gapLabel(gap, axis)}`;

  const slider = (key: 'start' | 'shift', label: string, value: number) => (
    <label key={key} className="flex items-center gap-2">
      <span className="tele-label w-24">{label}</span>
      <input type="range" min={SLIDER_RANGE[0]} max={SLIDER_RANGE[1]} step={50} value={clamp(value, SLIDER_RANGE[0], SLIDER_RANGE[1])} onChange={(event) => setTyped({ ...typed, [key]: Number(event.target.value) })} className="min-w-0 flex-1 accent-primary" />
      <span className="tele-num w-12 text-right">{num(value, 0)}</span>
    </label>
  );

  return (
    <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) ${SIDE_COLUMN}px` } : undefined}>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <LapChannelChart
            id={`${id}-rpm`}
            title={t.charts.engineCharts.rpm}
            values={rpms}
            unit="rpm"
            digits={0}
            minSpan={500}
            width={mainWidth}
            height={280}
            markers={markers}
            formatTick={rpmTick}
            references={shiftPoint > 0 ? [{ value: shiftPoint, label: fmt(dash.shiftRef, { rpm: num(shiftPoint, 0) }), color: 'var(--muted-foreground)' }] : []}
          />
          <div className="rounded-b-md border border-t-0 border-border bg-card">
            <StatGrid
              columns={6}
              items={[
                { label: `${dash.max} ${labels.targetInitial}`, value: num(rpmA?.max, 0), tone: 'target' },
                { label: `${dash.max} ${labels.compareInitial}`, value: num(rpmB?.max, 0), tone: 'compare' },
                { label: `${dash.avg} ${labels.targetInitial}`, value: num(rpmA?.avg, 0), tone: 'target' },
                { label: `${dash.avg} ${labels.compareInitial}`, value: num(rpmB?.avg, 0), tone: 'compare' },
                { label: labels.avgDelta, value: signed(shownDelta(rpmA?.avg, rpmB?.avg, 0), 0), tone: signTone(shownDelta(rpmA?.avg, rpmB?.avg, 0)) },
                { label: labels.maxDelta, value: signed(rpmLargest?.value, 0), tone: signTone(rpmLargest?.value) },
              ]}
            />
          </div>
        </div>
        <LapChannelChart
          id={`${id}-gear`}
          title={t.charts.gearCharts.gear}
          subtitle={dash.gearSubtitle}
          values={gears}
          digits={0}
          step
          width={mainWidth}
          height={220}
          yDomain={[gearRange[0] - 0.5, gearRange[1] + 0.5]}
          yTicks={gearTicks}
          formatTick={gearLabel}
          markers={markers}
          regions={different.map((stretch) => ({ ...stretch, color: 'var(--tele-warn)' }))}
        />
        <Panel title={dash.shiftComparison} subtitle={dash.correspondingOnly}>
          {pairs.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{dash.noShifts}</p>
          ) : (
            <div className="max-h-[300px] overflow-auto">
              <table className="tele-num w-full text-[11px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[9px] text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">{dash.shift}</th>
                    <th className="px-2 text-right font-medium text-lap-target">{labels.targetInitial} {dash.position}</th>
                    <th className="px-2 text-right font-medium text-lap-compare">{labels.compareInitial} {dash.position}</th>
                    <th className="px-2 text-right font-medium">Δ</th>
                    <th className="px-2 text-right font-medium text-lap-target">{labels.targetInitial} RPM</th>
                    <th className="px-2 text-right font-medium text-lap-compare">{labels.compareInitial} RPM</th>
                    <th className="px-2 text-right font-medium">Δ RPM</th>
                    <th className="px-2 text-left font-medium">{dash.note}</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((pair) => {
                    const gap = pair.target && pair.compare ? pair.compare.pct - pair.target.pct : null;
                    const rpmGap = pair.target && pair.compare ? pair.compare.rpm - pair.target.rpm : null;
                    const flag = gap === null ? 'unpaired' : Math.abs(gap) < SAME_SHIFT_SHARE ? '' : gap > 0 ? 'later' : 'earlier';
                    return (
                      <tr key={pair.key} className="border-t border-border/60">
                        <td className="px-2 py-1">{pair.type === 'up' ? '▲' : '▼'} {pair.from}→{pair.to}</td>
                        <td className="px-2 text-right text-lap-target">{pair.target ? positionLabel(pair.target.pct, axis) : '—'}</td>
                        <td className="px-2 text-right text-lap-compare">{pair.compare ? positionLabel(pair.compare.pct, axis) : '—'}</td>
                        <td className="whitespace-nowrap px-2 text-right">{gap === null ? '–' : gapValue(gap)}</td>
                        <td className="px-2 text-right text-lap-target">{num(pair.target?.rpm, 0)}</td>
                        <td className="px-2 text-right text-lap-compare">{num(pair.compare?.rpm, 0)}</td>
                        <td className="px-2 text-right">
                          <DeltaIndicator value={rpmGap} digits={0} size="sm" label={false} />
                        </td>
                        <td className="px-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          {flag === 'unpaired' ? dash.noCorresponding : flag === 'later' ? labels.later : flag === 'earlier' ? labels.earlier : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-2 py-1.5 text-[9px] text-muted-foreground">{dash.shiftNote}</p>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-3">
        <Panel title={dash.gearAtCursor} right={<DeltaIndicator value={targetGear !== null && compareGear !== null ? compareGear - targetGear : null} digits={0} size="lg" />}>
          <div className="grid grid-cols-2 gap-2 p-2.5">
            <GearIndicator lap="target" gear={targetGear} rpm={targetRpm} speed={speedAt(0)} ledStart={ledStart} shiftPoint={shiftPoint} />
            <GearIndicator lap="compare" gear={compareGear} rpm={compareRpm} speed={speedAt(1)} ledStart={ledStart} shiftPoint={shiftPoint} />
          </div>
          <div className="px-2.5 pb-2.5">
            <MetricCard label={dash.rpmDeltaAtCursor} target={targetRpm} compare={compareRpm} delta={null} digits={0} unit="rpm" size="xl" />
          </div>
        </Panel>
        <Panel title={dash.shiftStats} subtitle={dash.inView}>
          <div className="grid grid-cols-2 gap-2 p-2.5">
            <MetricCard label={dash.upshifts} target={count(targetShifts, 'up')} compare={count(compareShifts, 'up')} delta={count(compareShifts, 'up') - count(targetShifts, 'up')} digits={0} />
            <MetricCard label={dash.downshifts} target={count(targetShifts, 'down')} compare={count(compareShifts, 'down')} delta={count(compareShifts, 'down') - count(targetShifts, 'down')} digits={0} />
            <div className="flex flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2">
              <span className="tele-label">{dash.differentGear}</span>
              <span className="tele-num text-xl text-tele-warn">{differentInView === null ? '–' : gapLabel(differentInView, axis)}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-sm border border-border bg-secondary/60 px-2.5 py-2">
              <span className="tele-label">{dash.largestShiftGap}</span>
              <span className="tele-num text-xl text-foreground">{largestShift === null ? '–' : gapValue(largestShift)}</span>
            </div>
            <MetricCard label={dash.maxRpmDelta} delta={rpmLargest?.value} digits={0} unit="rpm" className="col-span-2" />
          </div>
        </Panel>
        <Panel title={dash.shiftLights} subtitle={dash.shiftLightsSubtitle}>
          <div className="flex flex-col gap-2 p-3 text-xs">
            {slider('start', dash.ledStart, ledStart)}
            {slider('shift', dash.shiftPoint, shiftPoint)}
            <p className="text-[9px] leading-snug text-muted-foreground">{dash.shiftLightsNote}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
