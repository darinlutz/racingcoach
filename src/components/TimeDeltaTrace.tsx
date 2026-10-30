'use client';

import { useLanguage } from '@/components/LanguageProvider';
import TelemetryChart, { COMPARE_COLOR, linePath, Readout, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { useUnits } from '@/components/UnitsProvider';
import { roundTicks } from '@/lib/lapCharts';
import { SPEED_UNIT } from '@/lib/units';

const HEIGHT = 180;
// Shading where the Compare lap loses time (above zero) and gains it (below zero)
const LOSS_FILL = 'rgba(255, 64, 64, 0.22)';
const GAIN_FILL = 'rgba(38, 167, 100, 0.25)';

// +0.123 s / -0.045 s
function formatDelta(seconds: number, locale: string) {
  const rounded = Math.round(seconds * 1000) / 1000;
  const digits = Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${digits} s`;
}

// The Compare lap's time gained or lost against the Target lap through one focus area: at each position,
// how much longer the Compare lap has taken since the area's start than the Target lap. Above zero the
// Compare lap is behind, below zero ahead; the end value is the area's difference in the table, whatever part of
// the area is in view. Over it, each lap's speed on its own axis on the right (mph or kph): Target solid blue,
// Compare dotted red.
export default function TimeDeltaTrace({ id, width }: { id: string; width: number }) {
  const { t: dictionary, fmt, locale } = useLanguage();
  const t = dictionary.charts;
  const labels = t.telemetry;
  const speedUnit = SPEED_UNIT[useUnits()];
  const { axis, grid, cursorIndex } = useTelemetry();
  const { pcts, timeDeltas: deltas, speeds } = grid;
  const delta = (seconds: number) => formatDelta(seconds, locale);

  const ticks = roundTicks(Math.min(0, ...deltas), Math.max(0, ...deltas), 0.01);
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];

  const speedLaps = [
    { key: 'base', label: dictionary.lapCompare.base, color: TARGET_COLOR, dash: undefined, values: speeds[0] },
    { key: 'compare', label: dictionary.lapCompare.compare, color: COMPARE_COLOR, dash: '1 4', values: speeds[1] },
  ];
  const allSpeeds = speeds.flat().filter(Number.isFinite);
  const hasSpeeds = allSpeeds.length > 0;
  const sTicks = hasSpeeds ? roundTicks(Math.min(...allSpeeds), Math.max(...allSpeeds), 1) : [];
  const [sLo, sHi] = [sTicks[0] ?? 0, sTicks[sTicks.length - 1] ?? 1];

  const final = deltas[deltas.length - 1];
  const hoverDelta = cursorIndex === null ? null : deltas[cursorIndex];

  // Text version of the chart: where the gap ends, and its largest swing each way
  const most = Math.max(...deltas);
  const least = Math.min(...deltas);
  const summary = [
    fmt(t.endsArea, { delta: delta(final) }),
    most > 0.0005 && fmt(t.mostBehind, { delta: delta(most) }),
    least < -0.0005 && fmt(t.mostAhead, { delta: delta(least) }),
  ]
    .filter(Boolean)
    .join(', ');

  const [d0, d1] = axis.domain;
  const step = (pcts[pcts.length - 1] - pcts[0]) / (pcts.length - 1);
  const from = Math.max(0, Math.floor((d0 - pcts[0]) / step) - 1);
  const to = Math.min(pcts.length - 1, Math.ceil((d1 - pcts[0]) / step) + 1);

  return (
    <TelemetryChart
      id={id}
      title={t.timeTitle}
      unit={t.timeVs}
      width={width}
      height={HEIGHT}
      yMin={lo}
      yMax={hi}
      yTicks={ticks}
      formatTick={(tick) => (tick === 0 ? '0' : `${tick > 0 ? '+' : '−'}${Number(Math.abs(tick).toPrecision(3)).toLocaleString(locale)}`)}
      zeroLine={{ color: 'var(--muted-foreground)' }}
      diverging={{ values: deltas, positive: LOSS_FILL, negative: GAIN_FILL }}
      ariaLabel={fmt(t.timeAria, { summary })}
      caption={`${summary}. ${t.timeCaption}`}
      legend={
        <span className="ml-2 flex flex-wrap items-center gap-x-3">
          <span className="tele-label flex items-center gap-1">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: LOSS_FILL }} /> {t.compareBehind}
          </span>
          <span className="tele-label flex items-center gap-1">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: GAIN_FILL }} /> {t.compareAhead}
          </span>
          {hasSpeeds &&
            speedLaps.map(({ key, label, color, dash }) => (
              <span key={key} className="tele-label flex items-center gap-1">
                <svg width={14} height={4} aria-hidden="true">
                  <line x1={1} x2={13} y1={2} y2={2} stroke={color} strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
                </svg>
                {fmt(t.lapSpeed, { lap: label, unit: speedUnit })}
              </span>
            ))}
        </span>
      }
      readout={
        <>
          <Readout label={labels.atCursor} value={hoverDelta === null ? '–' : delta(hoverDelta)} tone={hoverDelta === null || hoverDelta <= 0 ? 'plain' : 'compare'} />
          <Readout label={labels.areaEnd} value={delta(final)} />
        </>
      }
      overlay={(s) => {
        const sy = (speed: number) => s.plotTop + ((sHi - speed) / (sHi - sLo || 1)) * (s.plotBottom - s.plotTop);
        return (
          <g pointerEvents="none">
            {/* The speed axis, on the right (its unit is in the legend) */}
            {sTicks.map((tick) => (
              <text key={tick} x={s.plotRight + 6} y={sy(tick)} dy="0.32em" fontSize={10} fill="var(--muted-foreground)" className="tele-num">
                {tick.toLocaleString(locale)}
              </text>
            ))}
            {speedLaps.map(({ key, color, dash, values }) => (
              <path
                key={key}
                d={linePath(pcts, values, from, to, s.x, sy)}
                fill="none"
                stroke={color}
                strokeWidth={1.6}
                strokeDasharray={dash}
                strokeLinejoin="round"
                strokeLinecap="round"
                clipPath={`url(#${id}-plot)`}
              />
            ))}
            {/* The area's result, just inside the end of the line */}
            {s.inView(pcts[pcts.length - 1]) && (
              <text
                x={s.plotRight - 4}
                y={s.y(final)}
                dy={final > 0 ? '1.1em' : '-0.5em'}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                className={`tabular-nums ${final > 0 ? 'fill-red-300' : final < 0 ? 'fill-green-300' : 'fill-current'}`}
              >
                {delta(final).replace(' s', '')}
              </text>
            )}
          </g>
        );
      }}
    />
  );
}
