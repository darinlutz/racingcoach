'use client';

import { useId, useMemo, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { useTelemetry } from '@/components/TelemetryCursor';
import { steeringLabel } from '@/components/SteeringTrace';
import { gearLabel } from '@/components/SteeringWheel';
import { DASH_GAP, DeltaIndicator, LapChannelChart, MetricCard, Panel, SegmentedToggle, useAtCursor, useNumbers, useViewWindow, type ChartMarker } from '@/components/TelemetryPanels';
import { useUnits } from '@/components/UnitsProvider';
import { deltas, largest, stats, steeringReversals } from '@/lib/lapChannels';
import { SPEED_UNIT } from '@/lib/units';

const WIDE = 1100;
const SIDE_COLUMN = 360;
const MAX_WHEEL_ANGLE = 540; // The picture stops turning here; the numbers don't
const CORRECTION_LIMIT = 25; // A reversal smaller than this (degrees) counts as a correction
const LED_COUNT = 15;
const LED_START_SHARE = 0.82; // Of the laps' highest RPM, where the shift lights start

const TARGET = 'var(--lap-target)';
const COMPARE = 'var(--lap-compare)';
const WARN = 'var(--tele-warn)';
const GREEN = '#22c55e';
const ENCODERS = [TARGET, COMPARE, WARN, GREEN];

type WheelDisplay = { gearTarget: string; gearCompare: string; speed: string; rpm: string; steer: string };

// A GT3 wheel, in the hardware's own dark colors in both themes, turned by angle (degrees, right positive)
function GT3SteeringWheel({ angle, lap, indicators, display, ledShare, size }: { angle: number; lap?: 'target' | 'compare'; indicators?: { angle: number; color: string; key: string }[]; display: WheelDisplay; ledShare: number; size: number }) {
  const { t } = useLanguage();
  const ids = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rotation = Math.max(-MAX_WHEEL_ANGLE, Math.min(MAX_WHEEL_ANGLE, angle));
  const ring = lap === 'target' ? TARGET : lap === 'compare' ? COMPARE : '#4a515c';
  const at = (degrees: number, r: number) => ({ x: 200 + r * Math.sin((degrees * Math.PI) / 180), y: 170 - r * Math.cos((degrees * Math.PI) / 180) });
  return (
    <svg viewBox="0 0 400 340" width={size} height={size * 0.85} role="img" aria-label={`${t.charts.slipCharts.steering} ${display.steer}`} className="max-w-full">
      <defs>
        <pattern id={`${ids}-carbon`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#15181c" />
          <rect width="3" height="3" fill="#1f232a" />
          <rect x="3" y="3" width="3" height="3" fill="#1f232a" />
        </pattern>
        <radialGradient id={`${ids}-hub`}>
          <stop offset="0" stopColor="#6b727d" />
          <stop offset="1" stopColor="#2e333b" />
        </radialGradient>
        <linearGradient id={`${ids}-grip`} x1="0" x2="1">
          <stop offset="0" stopColor="#101215" />
          <stop offset="0.5" stopColor="#1f232a" />
          <stop offset="1" stopColor="#101215" />
        </linearGradient>
      </defs>
      {indicators && (
        <g>
          <circle cx="200" cy="170" r="160" fill="none" stroke="var(--border)" strokeDasharray="2 4" />
          {indicators.map(({ angle: indicator, color, key }) => {
            const clamped = Math.max(-MAX_WHEEL_ANGLE, Math.min(MAX_WHEEL_ANGLE, indicator));
            const [a, b] = [at(clamped, 150), at(clamped, 168)];
            return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={5} strokeLinecap="round" />;
          })}
        </g>
      )}
      <g transform={`rotate(${rotation.toFixed(2)} 200 170)`}>
        <path d="M70 60 Q30 70 26 170 Q30 270 80 290 L104 270 Q78 240 76 170 Q78 100 100 76 Z" fill={`url(#${ids}-grip)`} stroke="#2b3440" />
        <path d="M330 60 Q370 70 374 170 Q370 270 320 290 L296 270 Q322 240 324 170 Q322 100 300 76 Z" fill={`url(#${ids}-grip)`} stroke="#2b3440" />
        <path d="M96 56 L304 56 Q326 60 326 90 L322 230 Q318 270 280 282 L240 296 L160 296 L120 282 Q82 270 78 230 L74 90 Q74 60 96 56 Z" fill={`url(#${ids}-carbon)`} stroke={ring} strokeWidth="2" />
        <path d="M150 296 L250 296 L240 316 L160 316 Z" fill={`url(#${ids}-carbon)`} stroke="#2b3440" />
        {Array.from({ length: LED_COUNT }, (_, i) => {
          const lit = ledShare * LED_COUNT > i;
          const color = i < 5 ? GREEN : i < 10 ? '#facc15' : '#ef4444';
          return <circle key={i} cx={130 + i * 10} cy="74" r="3.2" fill={lit ? color : '#2b3440'} />;
        })}
        <rect x="140" y="84" width="120" height="64" rx="4" fill="#05080d" stroke="#2e333b" />
        <text x="160" y="124" fontSize="30" fontWeight="700" textAnchor="middle" fill={TARGET} className="tele-num">{display.gearTarget}</text>
        <text x="240" y="124" fontSize="30" fontWeight="700" textAnchor="middle" fill={COMPARE} className="tele-num">{display.gearCompare}</text>
        <text x="200" y="100" fontSize="8" textAnchor="middle" fill="#9aa3ae" className="tele-num">{display.speed}</text>
        <text x="200" y="118" fontSize="9" textAnchor="middle" fill="#e5e7eb" className="tele-num">{display.rpm}</text>
        <text x="200" y="141" fontSize="9" textAnchor="middle" fill="#facc15" className="tele-num">{display.steer}</text>
        {[[110, 120], [290, 120], [118, 220], [282, 220]].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="14" fill="#2e333b" stroke={ENCODERS[i]} strokeWidth="2.5" />
            <circle cx={x} cy={y} r="5" fill="#6b727d" />
          </g>
        ))}
        {[[100, 165, 0], [300, 165, 1], [140, 255, 2], [260, 255, 3], [150, 168, 0], [250, 168, 1]].map(([x, y, color], i) => (
          <g key={i}>
            <rect x={x - 11} y={y - 8} width="22" height="16" rx="4" fill="#1f232a" stroke={ENCODERS[color]} strokeWidth="1.4" />
            <rect x={x - 6} y={y - 2} width="12" height="4" rx="2" fill={ENCODERS[color]} opacity="0.8" />
          </g>
        ))}
        <circle cx="200" cy="215" r="34" fill={`url(#${ids}-hub)`} stroke="#2e333b" strokeWidth="2" />
        <circle cx="200" cy="215" r="17" fill="#15181c" />
        <text x="200" y="219" fontSize="11" fontWeight="700" textAnchor="middle" fill={COMPARE}>RC</text>
        <rect x="196" y="50" width="8" height="10" fill={WARN} />
      </g>
    </svg>
  );
}

// The Steering tab: both laps' wheel at the crosshair side by side or as one with both angles marked, their angles
// and difference, the steering chart with where each lap turns the wheel back, and how often it does in what's in view.
export default function SteeringAnalysisDashboard({ id, width }: { id: string; width: number }) {
  const { t } = useLanguage();
  const dash = t.charts.dash;
  const labels = t.charts.telemetry;
  const units = useUnits();
  const { num } = useNumbers();
  const { grid, channels } = useTelemetry();
  const [view, setView] = useState<'pair' | 'overlay'>('pair');
  const [i0, i1] = useViewWindow();
  const atCursor = useAtCursor();
  const { pcts, steerings, speeds } = grid;

  const wide = width >= WIDE;
  const mainWidth = wide ? width - SIDE_COLUMN - DASH_GAP : width;
  const wheelSize = Math.min(400, (mainWidth - 60) / (view === 'pair' ? 2 : 1));

  const [target, compare] = [atCursor(steerings[0]), atCursor(steerings[1])];
  const rpm = atCursor(channels.rpms[0]);
  const speed = atCursor(speeds[1]);
  const highestRpm = useMemo(() => Math.max(0, ...channels.rpms.flatMap((lap) => {
    const s = stats(lap);
    return s ? [s.max] : [];
  })), [channels.rpms]);
  const ledShare = rpm !== null && highestRpm > 0 ? Math.max(0, Math.min(1, (rpm - highestRpm * LED_START_SHARE) / (highestRpm * (1 - LED_START_SHARE)))) : 0;

  const gear = (value: number | null) => (value === null ? '–' : gearLabel(value));
  const display = (steer: number | null): WheelDisplay => ({
    gearTarget: gear(atCursor(channels.gears[0])),
    gearCompare: gear(atCursor(channels.gears[1])),
    speed: speed === null ? '' : `${num(speed, 0)} ${SPEED_UNIT[units]}`,
    rpm: rpm === null ? '' : num(rpm, 0),
    steer: steer === null ? '' : steeringLabel(-steer, t.charts),
  });

  const reversals = useMemo(() => [steeringReversals(pcts, steerings[0]), steeringReversals(pcts, steerings[1])], [pcts, steerings]);
  const markers = useMemo<ChartMarker[]>(() => {
    const onLap = (lap: 'target' | 'compare', list: typeof reversals[number]): ChartMarker[] =>
      list.map(({ pct, amplitude }) => ({ pct, lap, kind: amplitude < CORRECTION_LIMIT ? 'correction' : 'reversal' }));
    return [...onLap('target', reversals[0]), ...onLap('compare', reversals[1])];
  }, [reversals]);
  const inView = ({ pct }: { pct: number }) => pct >= pcts[i0] && pct <= pcts[i1];
  const count = (lap: 0 | 1) => reversals[lap].filter(inView).length;
  const corrections = (lap: 0 | 1) => reversals[lap].filter((r) => inView(r) && r.amplitude < CORRECTION_LIMIT).length;
  const steerDelta = useMemo(() => deltas(steerings[0], steerings[1]), [steerings]);
  const peak = largest(steerDelta, i0, i1);
  const delta = target !== null && compare !== null ? Math.round(compare) - Math.round(target) : null;
  const direction = delta === null || delta === 0 ? '' : delta > 0 ? labels.right : labels.left;

  return (
    <div className={wide ? 'grid gap-3' : 'flex flex-col gap-3'} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) ${SIDE_COLUMN}px` } : undefined}>
      <div className="flex min-w-0 flex-col gap-3">
        <Panel
          title={dash.steeringWheel}
          subtitle={dash.wheelNotRoadWheel}
          right={
            <SegmentedToggle
              label={dash.steeringWheel}
              value={view}
              onChange={setView}
              options={[
                { value: 'pair', label: dash.sideBySide },
                { value: 'overlay', label: labels.overlay },
              ]}
            />
          }
        >
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {view === 'pair' ? (
                <>
                  <div className="flex flex-col items-center">
                    <span className="tele-label !text-lap-target">{labels.target}</span>
                    <GT3SteeringWheel angle={target ?? 0} lap="target" display={display(target)} ledShare={ledShare} size={wheelSize} />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="tele-label !text-lap-compare">{labels.compare}</span>
                    <GT3SteeringWheel angle={compare ?? 0} lap="compare" display={display(compare)} ledShare={ledShare} size={wheelSize} />
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="tele-label">{dash.wheelAtCompare}</span>
                  <GT3SteeringWheel
                    angle={compare ?? 0}
                    lap="compare"
                    indicators={[
                      { key: 'target', angle: target ?? 0, color: TARGET },
                      { key: 'compare', angle: compare ?? 0, color: COMPARE },
                    ]}
                    display={display(compare)}
                    ledShare={ledShare}
                    size={wheelSize}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-sm border border-lap-target/40 bg-secondary/60 p-2">
                <div className="tele-label !text-lap-target">{labels.target}</div>
                <div className="tele-num text-2xl text-lap-target">{target === null ? '–' : steeringLabel(-target, t.charts)}</div>
              </div>
              <div className="rounded-sm border border-lap-compare/40 bg-secondary/60 p-2">
                <div className="tele-label !text-lap-compare">{labels.compare}</div>
                <div className="tele-num text-2xl text-lap-compare">{compare === null ? '–' : steeringLabel(-compare, t.charts)}</div>
              </div>
              <div className="rounded-sm border border-border bg-secondary/60 p-2">
                <div className="tele-label">{t.charts.pedalDelta}</div>
                <div className="flex items-baseline gap-2">
                  <DeltaIndicator value={delta} digits={0} unit="°" size="xl" label={false} />
                  <span className="text-sm text-muted-foreground">{direction}</span>
                </div>
              </div>
            </div>
          </div>
        </Panel>
        <LapChannelChart
          id={`${id}-angle`}
          title={t.charts.slipCharts.steering}
          subtitle={dash.steeringMarkers}
          values={steerings}
          unit="°"
          digits={0}
          zeroLine
          minSpan={20}
          width={mainWidth}
          height={320}
          markers={markers}
          formatTick={(tick) => steeringLabel(-tick, t.charts)}
        />
      </div>
      <Panel title={dash.steeringStats} subtitle={dash.inView} className="self-start">
        <div className="grid grid-cols-2 gap-2 p-2.5">
          <MetricCard label={dash.peakSteeringDelta} delta={peak?.value} unit="°" size="xl" className="col-span-2" />
          <MetricCard label={dash.reversals} target={count(0)} compare={count(1)} delta={count(1) - count(0)} digits={0} />
          <MetricCard label={dash.corrections} target={corrections(0)} compare={corrections(1)} delta={corrections(1) - corrections(0)} digits={0} />
        </div>
        <p className="px-2.5 pb-2.5 text-[9px] leading-snug text-muted-foreground">{dash.steeringNote}</p>
      </Panel>
    </div>
  );
}
