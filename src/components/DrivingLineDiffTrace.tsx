'use client';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, Readout, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { useUnits } from '@/components/UnitsProvider';
import { positionLabel } from '@/lib/lapCharts';
import { DISTANCE_UNIT } from '@/lib/units';

const HEIGHT = 170;
// The vertical axis runs from -limit to +limit (feet or meters), the smallest of these that fits the Compare lap
const LIMITS = [1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500];
// The Compare lap within this much (feet or meters, as shown) of the Target line counts as on it
const SAME_LINE = 0.5;

// How far left or right of the Target lap's line the Compare lap was through one focus area: the Target lap is the
// flat blue line at zero, the Compare lap the red line, left of the Target line up and right of it down, filled above
// and below it (measured across the Target line's direction of travel, at the same lap position, by lineOffsets).
export default function DrivingLineDiffTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const unit = DISTANCE_UNIT[useUnits()];
  const t = dictionary.charts;
  const labels = t.telemetry;
  const { axis, grid, settings, cursorIndex } = useTelemetry();
  const offsets = grid.lineOffsets;
  if (!offsets) return <section className="tele-label rounded-md border border-border bg-card p-4">{labels.noLineData}</section>;

  const largest = Math.max(...offsets.map(Math.abs), 0);
  const limit = LIMITS.find((l) => l >= largest) ?? Math.ceil(largest / 100) * 100;

  // 1.5 -> "1.5 ft L", -1.5 -> "1.5 ft R", 0 -> "0 ft"
  const sideLabel = (value: number) => {
    const shown = Number(Math.abs(value).toFixed(1));
    if (shown === 0) return `0 ${unit}`;
    const n = shown.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return fmt(value > 0 ? t.lineLeft : t.lineRight, { n, unit });
  };
  const tickLabel = (value: number) => (value === 0 ? '0' : `${Math.abs(value).toLocaleString(locale)}${value > 0 ? t.sideLeft : t.sideRight}`);

  // Text version of the chart: the Compare lap's largest distance from the Target line, and where it was
  const widest = offsets.reduce((best, value, i) => (Math.abs(value) > Math.abs(offsets[best]) ? i : best), 0);
  const summary =
    Math.abs(offsets[widest]) < SAME_LINE
      ? fmt(t.lineDiffSame, { n: SAME_LINE.toLocaleString(locale), unit })
      : fmt(offsets[widest] > 0 ? t.lineDiffLeft : t.lineDiffRight, {
          n: Math.abs(offsets[widest]).toLocaleString(locale, { maximumFractionDigits: 1 }),
          unit,
          where: positionLabel(grid.pcts[widest], axis),
        });

  // The largest each way and the average, of what's in view
  const [d0, d1] = axis.domain;
  const inView = offsets.filter((_, i) => grid.pcts[i] >= d0 && grid.pcts[i] <= d1);
  const average = inView.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, inView.length);

  return (
    <TelemetryChart
      id={id}
      title={t.lineDiffTitle}
      unit={unit}
      width={width}
      height={HEIGHT}
      yMin={-limit}
      yMax={limit}
      yTicks={[-limit, -limit / 2, 0, limit / 2, limit]}
      formatTick={tickLabel}
      axisSideLabels={{ top: labels.compareLeftUp, bottom: labels.compareRightDown }}
      zeroLine={{ color: TARGET_COLOR, width: 1.6 }}
      diverging={settings.showCompare ? { values: offsets, line: false } : undefined}
      series={[{ id: 'compare', values: offsets, color: COMPARE_COLOR, visible: settings.showCompare, width: 1.6 }]}
      ariaLabel={fmt(t.lineDiffAria, { summary })}
      caption={`${summary}. ${t.lineDiffCaption}`}
      legend={
        <span className="ml-2 flex items-center gap-3">
          <span className="tele-label flex items-center gap-1">
            <i className="inline-block h-0.5 w-4 bg-lap-target" /> {labels.targetLine}
          </span>
          <span className="tele-label flex items-center gap-1">
            <i className="inline-block h-0.5 w-4 bg-lap-compare" /> {labels.compare}
          </span>
        </span>
      }
      readout={
        <>
          <Readout label={labels.atCursor} value={cursorIndex === null ? '–' : sideLabel(offsets[cursorIndex])} tone="compare" />
          <Readout label={labels.maxLeft} value={sideLabel(Math.max(0, ...inView))} />
          <Readout label={labels.maxRight} value={sideLabel(Math.min(0, ...inView))} />
          <Readout label={labels.avgAbs} value={`${average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`} />
        </>
      }
    />
  );
}
