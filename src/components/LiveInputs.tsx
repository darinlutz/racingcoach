'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import type { InputSample } from '@/lib/liveRacing';
import { SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

// Live Racing's Driver Inputs panel: one driver's delta to their best lap, throttle, brake, steering wheel, gear and
// speed, and a trace of the throttle and brake over the last few seconds. The collector records the inputs 20 times a
// second and sends them twice a second, and the page fetches them once a second, so they're played back PLAYBACK_DELAY_MS
// behind, smoothly, rather than jumping once a second.

// A sample: its time on this page's clock (performance.now()) and its values
export type TimedSample = { at: number; sample: InputSample };

const PLAYBACK_DELAY_MS = 1600;
const TRACE_MS = 8000;
// The delta bar's full width, each way, in seconds
const DELTA_RANGE_S = 1;
const THROTTLE_COLOR = '#22C55E';
const BRAKE_COLOR = '#EF4444';

type Shown = {
  throttle: number | null;
  brake: number | null;
  steering: number | null;
  gear: number | null;
  speed: number | null;
  delta: number | null;
  // The trace's samples: x (0-1, oldest left) and throttle and brake (0-1)
  trace: { x: number; throttle: number; brake: number }[];
};

const lerp = (a: number | null, b: number | null, t: number) => (a == null || b == null ? (b ?? a) : a + (b - a) * t);

// The values at this time, between the samples either side of it
function valuesAt(samples: TimedSample[], at: number): Omit<Shown, 'trace'> | null {
  if (samples.length === 0) return null;
  let i = samples.findIndex((s) => s.at > at);
  if (i === -1) i = samples.length;
  const before = samples[Math.max(0, i - 1)];
  const after = samples[Math.min(samples.length - 1, i)];
  const span = after.at - before.at;
  const t = span > 0 ? Math.min(Math.max((at - before.at) / span, 0), 1) : 0;
  const [, throttle, brake, steering, gear, speed, delta] = before.sample;
  const [, throttle2, brake2, steering2, gear2, speed2, delta2] = after.sample;
  return {
    throttle: lerp(throttle, throttle2, t),
    brake: lerp(brake, brake2, t),
    steering: lerp(steering, steering2, t),
    gear: t < 0.5 ? (gear ?? gear2) : (gear2 ?? gear),
    speed: lerp(speed, speed2, t),
    delta: lerp(delta, delta2, t),
  };
}

function SteeringWheel({ radians }: { radians: number }) {
  // + is to the left, counterclockwise
  const degrees = (-radians * 180) / Math.PI;
  return (
    <svg viewBox="-50 -50 100 100" className="size-24" aria-hidden>
      <g transform={`rotate(${degrees})`}>
        <circle r={40} fill="none" className="stroke-foreground" strokeWidth={8} />
        <path d="M -40 0 L -12 6 L 12 6 L 40 0" fill="none" className="stroke-foreground" strokeWidth={7} strokeLinejoin="round" />
        <path d="M 0 8 L 0 40" className="stroke-foreground" strokeWidth={7} />
        <circle r={12} className="fill-foreground" />
        <rect x={-3} y={-46} width={6} height={12} rx={2} fill="#F59E0B" />
      </g>
    </svg>
  );
}

function PedalBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pct = value == null ? 0 : Math.round(value * 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-28 w-8 rounded bg-muted overflow-hidden border border-border">
        <div className="absolute bottom-0 left-0 right-0" style={{ height: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums">{value == null ? '—' : `${pct}%`}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function DeltaBar({ delta, label }: { delta: number | null; label: string }) {
  const share = delta == null ? 0 : Math.min(Math.abs(delta) / DELTA_RANGE_S, 1) * 50;
  const slower = (delta ?? 0) > 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-2xl font-bold tabular-nums ${delta == null ? 'text-foreground' : slower ? 'text-red-400' : 'text-green-500'}`}>
          {delta == null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(3)}`}
        </span>
      </div>
      <div className="relative mt-1 h-4 rounded bg-muted overflow-hidden border border-border">
        {/* faster grows to the left of the middle in green, slower to the right in red */}
        <div
          className={`absolute top-0 bottom-0 ${slower ? 'bg-red-500' : 'bg-green-500'}`}
          style={slower ? { left: '50%', width: `${share}%` } : { right: '50%', width: `${share}%` }}
        />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-foreground" />
      </div>
    </div>
  );
}

export default function LiveInputs({ driver, samples }: { driver: string; samples: TimedSample[] }) {
  const { t, fmt } = useLanguage();
  const units = useUnits();
  const samplesRef = useRef(samples);
  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let id = 0;
    const tick = (now: number) => {
      const all = samplesRef.current;
      const at = now - PLAYBACK_DELAY_MS;
      const values = valuesAt(all, at);
      const trace = all
        .filter((s) => s.at <= at && s.at >= at - TRACE_MS)
        .map((s) => ({ x: 1 - (at - s.at) / TRACE_MS, throttle: s.sample[1] ?? 0, brake: s.sample[2] ?? 0 }));
      setShown(values ? { ...values, trace } : null);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const line = (key: 'throttle' | 'brake') =>
    shown?.trace.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 100).toFixed(2)},${((1 - p[key]) * 40).toFixed(2)}`).join(' ') ?? '';

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t.liveRacing.inputsTitle}</h3>
        <span className="text-xs text-muted-foreground truncate">{fmt(t.liveRacing.inputsOf, { name: driver })}</span>
      </div>
      {!shown ? (
        <p className="text-sm text-muted-foreground">{t.liveRacing.inputsWaiting}</p>
      ) : (
        <>
          <DeltaBar delta={shown.delta} label={t.liveRacing.deltaToBest} />
          <div className="flex flex-wrap items-end justify-around gap-4">
            <PedalBar label={t.liveRacing.throttle} value={shown.throttle} color={THROTTLE_COLOR} />
            <PedalBar label={t.liveRacing.brake} value={shown.brake} color={BRAKE_COLOR} />
            <div className="flex flex-col items-center gap-1">
              <SteeringWheel radians={shown.steering ?? 0} />
              <span className="text-xs font-semibold text-foreground tabular-nums">
                {shown.steering == null ? '—' : `${Math.round((shown.steering * 180) / Math.PI)}°`}
              </span>
              <span className="text-xs text-muted-foreground">{t.liveRacing.steering}</span>
            </div>
            <div className="flex flex-col items-center gap-1 min-w-16">
              <span className="text-5xl font-bold text-foreground tabular-nums leading-none">
                {shown.gear == null ? '—' : shown.gear === -1 ? 'R' : shown.gear === 0 ? 'N' : shown.gear}
              </span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {shown.speed == null ? '—' : `${Math.round(speedFromMetersPerSecond(shown.speed, units))} ${SPEED_UNIT[units]}`}
              </span>
              <span className="text-xs text-muted-foreground">{t.liveRacing.gear}</span>
            </div>
          </div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-20 rounded bg-muted/50 border border-border" aria-hidden>
            {[0.25, 0.5, 0.75].map((y) => (
              <line key={y} x1={0} x2={100} y1={y * 40} y2={y * 40} className="stroke-border" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={line('throttle')} fill="none" stroke={THROTTLE_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <path d={line('brake')} fill="none" stroke={BRAKE_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </>
      )}
    </div>
  );
}
