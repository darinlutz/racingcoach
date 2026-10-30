'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { useUnits } from '@/components/UnitsProvider';
import { gapLabel } from '@/lib/lapCharts';
import { SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

const SAME_LINE = 0.1; // Within this much (feet or meters) of the Target line, the Compare lap is on it

// What the laps measure differently through the focus area, in plain sentences with no AI involved: the first
// braking zone, the apex and the throttle from the laps' events, and the steering, speed and line at the crosshair
// while there is one. Observed differences only; it doesn't say which is better.
export default function EngineeringInsightsPanel({ areaName }: { areaName: string }) {
  const { t, fmt, locale } = useLanguage();
  const labels = t.charts.telemetry;
  const insights = labels.insights;
  const units = useUnits();
  const speedUnit = SPEED_UNIT[units];
  const { axis, grid, events, cursorIndex } = useTelemetry();
  const { target, compare } = events;
  const rows: { key: string; label: string; text: string }[] = [];

  // A gap between where the laps did something: later, earlier or the same place
  const gapRow = (key: string, label: string, from: number | null, to: number | null, later: string, earlier: string) => {
    if (from === null || to === null) return;
    // Nothing to tell apart once rounded as gapLabel shows it: whole feet or meters, or a tenth of a % of the lap
    const none = Math.round(Math.abs(to - from) * (axis.length ?? 1000)) === 0;
    rows.push({ key, label, text: none ? insights.samePlace : fmt(to >= from ? later : earlier, { gap: gapLabel(to - from, axis) }) });
  };

  gapRow('braking', insights.braking, target.brakePoint, compare.brakePoint, insights.brakesLater, insights.brakesEarlier);
  if (target.peakBrake && compare.peakBrake) {
    const [targetPeak, comparePeak] = [target.peakBrake.value * 100, compare.peakBrake.value * 100];
    rows.push({
      key: 'peakBrake',
      label: insights.peakBrake,
      text: fmt(comparePeak >= targetPeak ? insights.peakMore : insights.peakLess, {
        n: Math.abs(comparePeak - targetPeak).toFixed(0),
        compare: comparePeak.toFixed(0),
        target: targetPeak.toFixed(0),
      }),
    });
  }
  gapRow('release', insights.release, target.brakeRelease, compare.brakeRelease, insights.releaseLater, insights.releaseEarlier);

  if (cursorIndex !== null) {
    const steerGap = grid.steerings[1][cursorIndex] - grid.steerings[0][cursorIndex];
    if (Number.isFinite(steerGap)) {
      rows.push({ key: 'steering', label: insights.steering, text: fmt(steerGap >= 0 ? insights.steerRight : insights.steerLeft, { n: Math.abs(steerGap).toFixed(0) }) });
    }
    const speedGap = grid.speeds[1][cursorIndex] - grid.speeds[0][cursorIndex];
    if (Number.isFinite(speedGap)) {
      const n = Math.abs(speedGap).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      rows.push({ key: 'speed', label: insights.speed, text: fmt(speedGap >= 0 ? insights.speedFaster : insights.speedSlower, { n, unit: speedUnit }) });
    }
  }

  if (target.apex && compare.apex) {
    const speed = (metersPerSecond: number) => `${Math.round(speedFromMetersPerSecond(metersPerSecond, units)).toLocaleString(locale)} ${speedUnit}`;
    rows.push({ key: 'apex', label: insights.apex, text: fmt(insights.apexSpeeds, { target: speed(target.apex.speed), compare: speed(compare.apex.speed) }) });
  }
  gapRow('throttle', insights.throttle, target.throttlePickup, compare.throttlePickup, insights.pickupLater, insights.pickupEarlier);
  gapRow('fullThrottle', insights.fullThrottle, target.fullThrottle, compare.fullThrottle, insights.fullLater, insights.fullEarlier);

  if (cursorIndex !== null && grid.lineOffsets) {
    const offset = grid.lineOffsets[cursorIndex];
    const gap = `${Math.abs(offset).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${axis.unit}`;
    rows.push({
      key: 'line',
      label: insights.line,
      text: Math.abs(offset) < SAME_LINE ? insights.lineOn : fmt(offset > 0 ? insights.lineLeft : insights.lineRight, { gap }),
    });
  }

  return (
    <aside className="flex flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h4 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground">{fmt(labels.analysis, { area: areaName })}</h4>
        <span className="tele-label">{labels.measured}</span>
      </div>
      <dl className="divide-y divide-border">
        {rows.map(({ key, label, text }) => (
          <div key={key} className="px-3 py-2">
            <dt className="tele-label">{label}</dt>
            <dd className="mt-0.5 text-[13px] leading-snug text-foreground">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">{insights.note}</p>
    </aside>
  );
}
