'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import {
  BRAKE_COLOR,
  DELTA_RANGE_S,
  PLAYBACK_DELAY_MS,
  THROTTLE_COLOR,
  valuesAt,
  type Shown,
  type TimedSample,
} from '@/components/LiveInputs';
import { steeringLabel } from '@/components/SteeringTrace';
import { BASE_ARC_R, GearDisplay, WheelGraphic } from '@/components/SteeringWheel';
import { useUnits } from '@/components/UnitsProvider';
import type { InputSample } from '@/lib/liveRacing';
import { SPEED_UNIT, speedFromMetersPerSecond } from '@/lib/units';

// TV Broadcast Mode's Driver Inputs: the Live Racing page's panel (LiveInputs) sized for a TV across the room: the
// followed driver's delta to their best lap and a throttle and brake trace, then their throttle and brake bars,
// steering wheel, gear and speed, in one strip under the map. Each picture of the race carries the last few seconds of inputs; they're kept here (KEEP_MS) and played
// back PLAYBACK_DELAY_MS behind, as on the Live Racing page, but redrawn at most FPS times a second for low-powered TVs.

const FPS = 20;
const KEEP_MS = 12_000;
const TRACE_MS = 8000;
// A new clock offset this close to the last is network timing noise, and the samples keep the old one
const OFFSET_TOLERANCE_MS = 400;

// Keeps the followed driver's inputs on this page's clock, adding each picture's newer samples
function useInputSamples(driverId: number, inputs: InputSample[] | null, inputsAgeMs: number, receivedAt: number): TimedSample[] {
  const kept = useRef<{ driverId: number; offset: number; samples: TimedSample[] } | null>(null);
  const [samples, setSamples] = useState<TimedSample[]>([]);
  useEffect(() => {
    if (!inputs || inputs.length === 0) return;
    const last = inputs[inputs.length - 1];
    const offset = receivedAt - inputsAgeMs - last[0] * 1000;
    let k = kept.current;
    const newest = k?.samples[k.samples.length - 1]?.sample[0] ?? -Infinity;
    // Another driver, or SessionTime started again (a new session): start over
    if (!k || k.driverId !== driverId || last[0] < newest) {
      k = kept.current = { driverId, offset, samples: [] };
    } else if (Math.abs(k.offset - offset) >= OFFSET_TOLERANCE_MS) {
      k.offset = offset;
    }
    const base = k.offset;
    const added = inputs.filter((s) => s[0] > newest).map((sample) => ({ at: base + sample[0] * 1000, sample }));
    k.samples = [...k.samples, ...added].filter((s) => s.at > receivedAt - KEEP_MS);
    setSamples(k.samples);
  }, [driverId, inputs, inputsAgeMs, receivedAt]);
  return samples;
}

function Pedal({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pct = value == null ? 0 : Math.round(value * 100);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[110px] w-10 overflow-hidden rounded-md border border-[#2b3440] bg-[#161b23]">
        <div className="absolute bottom-0 left-0 right-0" style={{ height: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[20px] font-bold tabular-nums">{value == null ? '—' : `${pct}%`}</span>
      <span className="text-[16px] text-[#8b95a3]">{label}</span>
    </div>
  );
}

export default function TvInputs({
  driverId,
  color,
  inputs,
  inputsAgeMs,
  receivedAt,
}: {
  driverId: number;
  color: string;
  inputs: InputSample[] | null;
  inputsAgeMs: number;
  // When this page received the picture the inputs came with (performance.now())
  receivedAt: number;
}) {
  const { t } = useLanguage();
  const units = useUnits();
  const samples = useInputSamples(driverId, inputs, inputsAgeMs, receivedAt);
  const samplesRef = useRef(samples);
  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let id = 0;
    let last = 0;
    const tick = (now: number) => {
      id = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS - 1) return;
      last = now;
      const all = samplesRef.current;
      const at = now - PLAYBACK_DELAY_MS;
      const values = valuesAt(all, at);
      const trace = all
        .filter((s) => s.at <= at && s.at >= at - TRACE_MS)
        .map((s) => ({ x: 1 - (at - s.at) / TRACE_MS, throttle: s.sample[1] ?? 0, brake: s.sample[2] ?? 0 }));
      setShown(values ? { ...values, trace } : null);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  if (!shown) {
    return <p className="text-[22px] leading-snug text-[#a7b0bd]">{t.liveRacing.inputsWaiting}</p>;
  }
  const degrees = ((shown.steering ?? 0) * 180) / Math.PI;
  const delta = shown.delta;
  const slower = (delta ?? 0) > 0;
  const share = delta == null ? 0 : Math.min(Math.abs(delta) / DELTA_RANGE_S, 1) * 50;
  const line = (key: 'throttle' | 'brake') =>
    shown.trace.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 100).toFixed(1)},${((1 - p[key]) * 40).toFixed(1)}`).join(' ');

  return (
    <div className="flex h-full items-center gap-6">
      <div className="flex w-[330px] shrink-0 flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[18px] uppercase tracking-wide text-[#8b95a3]">{t.liveRacing.deltaToBest}</span>
          <span className={`text-[34px] font-bold leading-none tabular-nums ${delta == null ? '' : slower ? 'text-[#ff5a5a]' : 'text-[#2fd36b]'}`}>
            {delta == null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(3)}`}
          </span>
        </div>
        <div className="relative h-4 overflow-hidden rounded bg-[#161b23]">
          <div
            className={`absolute bottom-0 top-0 ${slower ? 'bg-[#ef4444]' : 'bg-[#22c55e]'}`}
            style={slower ? { left: '50%', width: `${share}%` } : { right: '50%', width: `${share}%` }}
          />
          <div className="absolute bottom-0 top-0 left-1/2 w-px bg-white" />
        </div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-1 h-[86px] w-full rounded bg-[#161b23]" aria-hidden>
          <path d={line('throttle')} fill="none" stroke={THROTTLE_COLOR} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          <path d={line('brake')} fill="none" stroke={BRAKE_COLOR} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="flex flex-1 items-center justify-around gap-3">
        <Pedal label={t.liveRacing.throttle} value={shown.throttle} color={THROTTLE_COLOR} />
        <WheelGraphic
          angle={degrees}
          arcs={[{ key: 'live', color, r: BASE_ARC_R, angle: degrees }]}
          readout={steeringLabel(degrees, t.charts)}
          ariaLabel={`${t.liveRacing.steering} ${steeringLabel(degrees, t.charts)}`}
          size={150}
        />
        <Pedal label={t.liveRacing.brake} value={shown.brake} color={BRAKE_COLOR} />
        <GearDisplay gear={shown.gear ?? NaN} label={t.liveRacing.gear} color={color} />
        <div className="text-center">
          <span className="block text-[40px] font-bold leading-none tabular-nums">
            {shown.speed == null ? '—' : Math.round(speedFromMetersPerSecond(shown.speed, units))}
          </span>
          <span className="text-[16px] text-[#8b95a3]">{SPEED_UNIT[units]}</span>
        </div>
      </div>
    </div>
  );
}
