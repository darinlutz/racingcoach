'use client';

import { useMemo } from 'react';

import DashboardCarView from '@/components/DashboardCarView';
import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { niceLimit } from '@/components/TelemetryChart';
import { CornerPhaseTable, DASH_GAP, DeltaIndicator, deltaFill, LapChannelChart, LapValue, MetricCard, Panel, shownDelta, signTone, StatGrid, useAtCursor, useNumbers, useViewWindow } from '@/components/TelemetryPanels';
import { deltas, largest, meanAbs, stats } from '@/lib/lapChannels';

const WIDE = 1100; // Narrower containers stack the panels
const CAR_COLUMN = 330;
const SUMMARY_COLUMN = 360;
const SLIP_COLOR_RANGE = 1.5; // Degrees of difference at the car's strongest color

// How far the balance is toward understeer or oversteer at the crosshair, on a scale that fits the laps. Understeer
// is positive in the numbers, as in the Balance Trace, and to the left here.
function CarBalanceIndicator({ target, compare, limit }: { target: number | null; compare: number | null; limit: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const position = (value: number) => `${((1 - Math.max(-1, Math.min(1, value / limit))) / 2) * 100}%`;
  const delta = shownDelta(target, compare, 2);
  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex justify-between text-[10px] font-semibold tracking-widest text-muted-foreground">
        <span>◀ {dash.understeer}</span>
        <span>{dash.neutral}</span>
        <span>{dash.oversteer} ▶</span>
      </div>
      <div className="relative h-11 rounded-sm border border-border bg-secondary">
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/60" />
        {target !== null && (
          <div className="absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent border-t-lap-target" style={{ left: position(target) }} />
        )}
        {compare !== null && (
          <div className="absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-b-[9px] border-x-transparent border-b-lap-compare" style={{ left: position(compare) }} />
        )}
      </div>
      <div className="mt-2 flex items-end justify-between text-sm">
        <LapValue lap="target" value={target} digits={2} unit="°" />
        <DeltaIndicator value={delta} digits={2} unit="°" size="xl" />
        <LapValue lap="compare" value={compare} digits={2} unit="°" />
      </div>
      <p className="mt-1.5 text-[9px] leading-snug text-muted-foreground">{dash.balanceNote}</p>
    </div>
  );
}

// The Balance tab: yaw rate, each axle's tire slip angle (the lap files have one estimate per axle, not one per tire),
// rear wheel slip, the car's balance and the differences through what's in view.
export default function VehicleDynamicsDashboard({ id, width }: { id: string; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const { num, signed } = useNumbers();
  const { channels, phases } = useTelemetry();
  const { yawRates, frontSlips, rearSlips, rearWheelSlips, balances } = channels;
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();

  const wide = width >= WIDE;
  const sideWidth = wide ? (width - CAR_COLUMN - DASH_GAP * 2) / 2 : width;
  const chartWidth = sideWidth - 2; // Inside its panel's border
  const bottomWidth = wide ? (width - SUMMARY_COLUMN - DASH_GAP * 2) / 2 - 2 : width - 2;

  const yawStats = [stats(yawRates[0], i0, i1), stats(yawRates[1], i0, i1)];
  const yawDelta = useMemo(() => deltas(yawRates[0], yawRates[1]), [yawRates]);
  const yawLargest = largest(yawDelta, i0, i1);
  const balanceLimit = useMemo(() => niceLimit(Math.max(1, ...balances.flatMap((lap) => {
    const s = stats(lap);
    return s ? [Math.abs(s.min), Math.abs(s.max)] : [];
  }))), [balances]);
  const balanceLargest = largest(useMemo(() => deltas(balances[0], balances[1]), [balances]), i0, i1);

  const sizeDelta = (pair: typeof frontSlips) => {
    const [a, b] = [atCursor(pair[0]), atCursor(pair[1])];
    return { target: a, compare: b, delta: a !== null && b !== null ? shownDelta(Math.abs(a), Math.abs(b), 2) : null };
  };
  const [front, rear] = [sizeDelta(frontSlips), sizeDelta(rearSlips)];
  const meanDelta = (pair: typeof frontSlips) => {
    const [a, b] = [meanAbs(pair[0], i0, i1), meanAbs(pair[1], i0, i1)];
    return a !== null && b !== null ? b - a : null;
  };
  const wheel = (slip: typeof front) => ({ fill: deltaFill(slip.delta, SLIP_COLOR_RANGE), label: signed(slip.delta, 1), highlighted: true });

  const slipStats = (pair: typeof frontSlips) => {
    const [a, b] = [stats(pair[0]?.map(Math.abs) ?? null, i0, i1), stats(pair[1]?.map(Math.abs) ?? null, i0, i1)];
    return (
      <StatGrid
        columns={2}
        items={[
          { label: dash.maxSize, value: `${num(a?.max, 2)} / ${num(b?.max, 2)}` },
          { label: dash.avgSize, value: `${num(a?.avg, 2)} / ${num(b?.avg, 2)}` },
          { label: `${dash.maxSize} Δ`, value: signed(shownDelta(a?.max, b?.max, 2), 2), tone: signTone(shownDelta(a?.max, b?.max, 2)) },
          { label: `${dash.avgSize} Δ`, value: signed(shownDelta(a?.avg, b?.avg, 2), 2), tone: signTone(shownDelta(a?.avg, b?.avg, 2)) },
        ]}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <LapChannelChart id={`${id}-yaw`} title={t.charts.slipCharts.yawRate} subtitle={dash.positiveRight} values={yawRates} unit="°/s" zeroLine minSpan={10} width={width} height={230} />
        <div className="rounded-b-md border border-t-0 border-border bg-card">
          <StatGrid
            columns={6}
            items={[
              { label: `${dash.peakRight} ${labels.targetInitial}`, value: num(yawStats[0]?.max, 1), tone: 'target' },
              { label: `${dash.peakRight} ${labels.compareInitial}`, value: num(yawStats[1]?.max, 1), tone: 'compare' },
              { label: `${dash.peakLeft} ${labels.targetInitial}`, value: num(yawStats[0]?.min, 1), tone: 'target' },
              { label: `${dash.peakLeft} ${labels.compareInitial}`, value: num(yawStats[1]?.min, 1), tone: 'compare' },
              { label: labels.maxDelta, value: `${signed(yawLargest?.value, 1)} °/s`, tone: signTone(yawLargest?.value) },
              { label: labels.avgDelta, value: `${num(meanAbs(yawDelta, i0, i1), 2)} °/s` },
            ]}
          />
        </div>
      </div>

      <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `1fr ${CAR_COLUMN}px 1fr` } : undefined}>
        <Panel title={dash.frontTireSlip} subtitle={dash.axleEstimate}>
          <LapChannelChart id={`${id}-front`} title={t.charts.slipCharts.frontTires} subtitle={dash.positiveRight} values={frontSlips} unit="°" digits={2} zeroLine minSpan={2} width={chartWidth} height={170} embedded />
          {slipStats(frontSlips)}
          <div className="border-t border-border">
            <CornerPhaseTable title={fmtPhaseTitle(dash.phaseTitle, t.charts.slipCharts.frontTires)} rows={[{ label: t.charts.slipCharts.frontTires, values: frontSlips }]} />
          </div>
        </Panel>

        <Panel title={dash.axleSlipAtCursor} subtitle={dash.axleSlipDelta}>
          <div className="flex flex-col items-center p-2">
            <DashboardCarView title={dash.axleSlipAtCursor} className="h-[300px]" wheels={{ LF: wheel(front), RF: wheel(front), LR: wheel(rear), RR: wheel(rear) }} />
            <table className="tele-num mt-2 w-full text-[11px]">
              <thead>
                <tr className="text-[9px] text-muted-foreground">
                  <th className="text-left font-medium">{dash.axle}</th>
                  <th className="text-right font-medium text-lap-target">{labels.targetInitial} °</th>
                  <th className="text-right font-medium text-lap-compare">{labels.compareInitial} °</th>
                  <th className="text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: 'front', label: dash.front, slip: front },
                  { key: 'rear', label: dash.rear, slip: rear },
                ].map(({ key, label, slip }) => (
                  <tr key={key} className="border-t border-border/60">
                    <td className="py-0.5 text-muted-foreground">{label}</td>
                    <td className="text-right text-lap-target">{num(slip.target, 2)}</td>
                    <td className="text-right text-lap-compare">{num(slip.compare, 2)}</td>
                    <td className="text-right">
                      <DeltaIndicator value={slip.delta} digits={2} size="sm" label={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-center text-[9px] text-muted-foreground">{dash.axleColorNote}</p>
          </div>
        </Panel>

        <Panel title={dash.rearTireSlip} subtitle={dash.axleEstimate}>
          <LapChannelChart id={`${id}-rear`} title={t.charts.slipCharts.rearTires} subtitle={dash.positiveRight} values={rearSlips} unit="°" digits={2} zeroLine minSpan={2} width={chartWidth} height={170} embedded />
          {slipStats(rearSlips)}
          <div className="border-t border-border">
            <CornerPhaseTable title={fmtPhaseTitle(dash.phaseTitle, t.charts.slipCharts.rearTires)} rows={[{ label: t.charts.slipCharts.rearTires, values: rearSlips }]} />
          </div>
        </Panel>
      </div>

      <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `1fr 1fr ${SUMMARY_COLUMN}px` } : undefined}>
        <Panel title={t.charts.slipCharts.rearWheels} subtitle={dash.rearWheelNote}>
          <LapChannelChart id={`${id}-wheels`} title={t.charts.slipCharts.rearWheels} subtitle={dash.longitudinal} values={rearWheelSlips} unit="%" zeroLine minSpan={2} width={bottomWidth} height={190} embedded />
        </Panel>

        <Panel title={t.charts.slipCharts.balance} subtitle={dash.balanceSubtitle}>
          <CarBalanceIndicator target={atCursor(balances[0])} compare={atCursor(balances[1])} limit={balanceLimit} />
          <LapChannelChart id={`${id}-balance`} title={dash.balanceTrace} subtitle={dash.positiveUndersteer} values={balances} unit="°" digits={2} zeroLine minSpan={2} width={bottomWidth} height={170} embedded />
        </Panel>

        <Panel title={dash.dynamicsSummary} subtitle={dash.inView}>
          <div className="grid grid-cols-2 gap-2 p-2.5">
            <MetricCard label={dash.maxYawDelta} delta={yawLargest?.value} unit="°/s" />
            <MetricCard label={dash.avgYawDelta} delta={meanAbs(yawDelta, i0, i1)} digits={2} unit="°/s" />
            <MetricCard label={dash.frontSlipDelta} delta={meanDelta(frontSlips)} digits={2} unit="°" />
            <MetricCard label={dash.rearSlipDelta} delta={meanDelta(rearSlips)} digits={2} unit="°" />
            <MetricCard label={dash.peakBalanceDelta} delta={balanceLargest?.value} digits={2} unit="°" className="col-span-2" />
          </div>
          {phases.length > 0 && (
            <div className="border-t border-border">
              <CornerPhaseTable title={fmtPhaseTitle(dash.phaseTitle, t.charts.slipCharts.balance)} rows={[{ label: t.charts.slipCharts.balance, values: balances }]} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

const fmtPhaseTitle = (template: string, name: string) => template.replace('{name}', name);
