'use client';

import { useId } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { PedalTraceLap } from '@/components/PedalTraces';
import { steeringLabel } from '@/components/SteeringTrace';
import { fmt } from '@/lib/i18n/languages';
import { BASE_LAP_COLOR, clamp, COMPARE_LAP_COLOR, nearestIndex, positionLabel, type Axis } from '@/lib/lapCharts';

const SIZE = 220;
const MARK_COLOR = '#f97316';
// Radii of the angle scale around the wheel and each lap's arc outside it
const SCALE_R = 80;
export const BASE_ARC_R = 89;
const COMPARE_ARC_R = 97;

const degrees = (radians: number) => (radians * 180) / Math.PI;

// iRacing's Gear: -1 reverse, 0 neutral, NaN where the lap file has no gear
export const gearLabel = (gear: number) => (!Number.isFinite(gear) ? '–' : gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear));

// A dash display of one lap's gear: the number large in the lap's color, the lap's name under it, and on
// the Compare lap how many gears higher (+) or lower (−) than the Base lap it is, when they differ. Also Live Racing's.
export function GearDisplay({ gear, label, color, diff }: { gear: number; label: string; color: string; diff?: number }) {
  return (
    <div
      className="relative w-[5.2rem] rounded-xl border border-[#2b3440] bg-gradient-to-b from-[#1f232a] to-[#05080d] px-2.5 pt-2.5 pb-1.5 text-center shadow-md"
      style={{ boxShadow: `inset 0 0 14px ${color}33` }}
    >
      <div
        className="text-[2.6rem] font-extrabold leading-none tabular-nums"
        style={{ color, textShadow: `0 0 11px ${color}99` }}
      >
        {gearLabel(gear)}
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[#9aa3ae]">{label}</div>
      {diff !== undefined && diff !== 0 && (
        <span className="absolute -top-2 -right-2 rounded-full bg-[#05080d] border border-[#2b3440] px-1.5 text-[10px] font-bold tabular-nums text-[#facc15]">
          {diff > 0 ? `+${diff}` : `−${-diff}`}
        </span>
      )}
    </div>
  );
}

// A point at angle θ (degrees clockwise from 12 o'clock) on a circle of radius r
const point = (r: number, theta: number) => {
  const rad = (theta * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)] as const;
};

// Arc from θ0 to θ1 (degrees clockwise from 12 o'clock), going clockwise when θ1 > θ0
function arc(r: number, theta0: number, theta1: number) {
  const [x0, y0] = point(r, theta0);
  const [x1, y1] = point(r, theta1);
  const large = Math.abs(theta1 - theta0) > 180 ? 1 : 0;
  const sweep = theta1 > theta0 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

// The wheel itself, turned by angle (degrees, + left, so counterclockwise), on a fixed angle scale with an arc per
// entry in arcs from straight ahead (the top) to its own angle (radius r: BASE_ARC_R inside, 97 outside), and readout
// on its screen, size pixels square, or with fill as wide as its box. Lap Compare's wheel, and Live Racing's.
export function WheelGraphic({
  angle,
  arcs,
  readout,
  ariaLabel,
  size = SIZE,
  fill = false,
}: {
  angle: number;
  arcs: { key: string; color: string; r: number; angle: number }[];
  readout: string;
  ariaLabel: string;
  size?: number;
  fill?: boolean;
}) {
  const ids = useId().replace(/:/g, '');
  return (
    <svg
      width={fill ? undefined : size}
      height={fill ? undefined : size}
      viewBox="-105 -105 210 210"
      role="img"
      aria-label={ariaLabel}
      className={`block text-muted-foreground ${fill ? 'w-full h-auto' : ''}`}
    >
      <defs>
        <linearGradient id={`${ids}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a505a" />
          <stop offset="0.5" stopColor="#262a31" />
          <stop offset="1" stopColor="#15181c" />
        </linearGradient>
        <linearGradient id={`${ids}-spoke`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4049" />
          <stop offset="1" stopColor="#1b1e23" />
        </linearGradient>
        <radialGradient id={`${ids}-plate`} cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#3b414b" />
          <stop offset="0.6" stopColor="#1f232a" />
          <stop offset="1" stopColor="#121418" />
        </radialGradient>
        <pattern id={`${ids}-carbon`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="transparent" />
          <rect width="2" height="2" fill="#ffffff" fillOpacity="0.035" />
          <rect x="2" y="2" width="2" height="2" fill="#ffffff" fillOpacity="0.035" />
        </pattern>
      </defs>

      {/* The fixed angle scale: a tick every 30°, straight ahead stronger */}
      <circle r={SCALE_R} fill="none" stroke="var(--border)" strokeWidth={3} />
      {Array.from({ length: 12 }, (_, i) => i * 30).map((theta) => {
        const [x0, y0] = point(SCALE_R - 4, theta);
        const [x1, y1] = point(SCALE_R + 4, theta);
        return (
          <line
            key={theta}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke="currentColor"
            strokeOpacity={theta === 0 ? 0.9 : 0.45}
            strokeWidth={theta === 0 ? 2 : 1.2}
          />
        );
      })}

      {/* Each lap's angle from straight ahead; past a full turn the arc stops just short of closing */}
      {arcs.map(({ key, color, r, angle }) => {
        const theta = clamp(-angle, -359, 359);
        if (Math.abs(theta) < 0.5) return null;
        const [ex, ey] = point(r, theta);
        return (
          <g key={key}>
            <path d={arc(r, 0, theta)} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
            <circle cx={ex} cy={ey} r={3.5} fill={color} stroke="var(--card)" strokeWidth={1} />
          </g>
        );
      })}

      <g transform={`rotate(${(-angle).toFixed(2)})`}>
        {/* Spokes, under the rim and center plate */}
        <rect x={-60} y={-7} width={30} height={15} rx={4} fill={`url(#${ids}-spoke)`} />
        <rect x={30} y={-7} width={30} height={15} rx={4} fill={`url(#${ids}-spoke)`} />
        <rect x={-7} y={22} width={14} height={38} rx={4} fill={`url(#${ids}-spoke)`} />

        {/* Rim, with thicker stitched leather grips at 9 and 3 o'clock */}
        <circle r={64} fill="none" stroke={`url(#${ids}-rim)`} strokeWidth={11} />
        <circle r={68.5} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />
        {[
          [235, 305],
          [55, 125],
        ].map(([from, to]) => (
          <g key={from}>
            <path d={arc(64, from, to)} fill="none" stroke="#101215" strokeWidth={15} strokeLinecap="round" />
            <path d={arc(64, from, to)} fill="none" stroke="#5b616b" strokeWidth={0.8} strokeDasharray="2 2" />
          </g>
        ))}

        {/* Orange mark at the top of the rim: straight ahead */}
        <rect x={-3.5} y={-71} width={7} height={14} rx={1.5} fill={MARK_COLOR} />

        {/* Center plate: shift lights, screen, buttons and rotaries */}
        <rect x={-35} y={-28} width={70} height={54} rx={13} fill={`url(#${ids}-plate)`} stroke="#4a515c" strokeWidth={1} />
        <rect x={-35} y={-28} width={70} height={54} rx={13} fill={`url(#${ids}-carbon)`} />
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} cx={-16 + i * 4} cy={-23.5} r={1.4} fill={i < 3 ? '#22c55e' : i < 6 ? '#facc15' : '#ef4444'} />
        ))}
        <rect x={-20} y={-20} width={40} height={17} rx={2.5} fill="#05080d" stroke="#2b3440" strokeWidth={0.8} />
        <text y={-8} textAnchor="middle" fontSize={10} fontWeight={700} fill="#38bdf8" className="tabular-nums">
          {readout}
        </text>
        {[
          [-27, -2, '#dc2626'],
          [-27, 9, '#2563eb'],
          [27, -2, '#facc15'],
          [27, 9, '#16a34a'],
        ].map(([cx, cy, fill]) => (
          <g key={`${cx},${cy}`}>
            <circle cx={cx} cy={cy} r={3.6} fill="#0c0e11" />
            <circle cx={cx} cy={cy} r={2.7} fill={fill as string} />
            <circle cx={(cx as number) - 0.8} cy={(cy as number) - 0.9} r={0.9} fill="#ffffff" fillOpacity={0.45} />
          </g>
        ))}
        {[-12, 12].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={14} r={6} fill="#2e333b" stroke="#6b727d" strokeWidth={1} />
            <line x1={cx} y1={14} x2={cx} y2={9.5} stroke={MARK_COLOR} strokeWidth={1.2} strokeLinecap="round" />
          </g>
        ))}
        <circle cy={4} r={2.4} fill={MARK_COLOR} />
      </g>
    </svg>
  );
}

// A wheel turned by the Base lap's steering angle at the crosshair (the start of the area without one),
// with an arc for each lap from straight ahead (the top) to its own angle: Base inside, Compare outside,
// then the caption, and to its right each lap's gear there side by side under "Gear" (GearDisplay).
// iRacing's angle is positive to the left, so a positive angle turns the wheel counterclockwise.
export default function SteeringWheel({
  base,
  compare,
  axis,
  hoverPct,
}: {
  base: PedalTraceLap;
  compare: PedalTraceLap;
  axis: Axis;
  hoverPct: number | null;
}) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.charts;
  const pct = clamp(hoverPct ?? axis.domain[0], axis.domain[0], axis.domain[1]);
  const laps = [
    { key: 'base', label: dictionary.lapCompare.base, lap: base, color: BASE_LAP_COLOR, r: BASE_ARC_R },
    { key: 'compare', label: dictionary.lapCompare.compare, lap: compare, color: COMPARE_LAP_COLOR, r: COMPARE_ARC_R },
  ].map((l) => {
    const i = nearestIndex(l.lap.trace.pcts, pct);
    return { ...l, angle: degrees(l.lap.trace.steerings[i] ?? 0), gear: l.lap.trace.engine.gears[i] ?? NaN };
  });
  const wheelAngle = laps[0].angle;
  // No gear displays when neither lap has gear data (Garage 61 exports and older collector laps)
  const hasGears = laps.some(({ lap }) => lap.trace.engine.gears.some(Number.isFinite));
  const gearDiff =
    Number.isFinite(laps[0].gear) && Number.isFinite(laps[1].gear) ? laps[1].gear - laps[0].gear : undefined;

  const angles = laps
    .map(({ label, angle, gear }) => `${label} ${steeringLabel(angle, t)}${hasGears ? `, ${t.gearCharts.gear} ${gearLabel(gear)}` : ''}`)
    .join(', ');

  return (
    <figure className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <WheelGraphic
        angle={wheelAngle}
        arcs={laps}
        readout={steeringLabel(wheelAngle, t)}
        ariaLabel={fmt(t.wheelAria, { position: positionLabel(pct, axis), angles })}
      />

      {/* A small basis keeps it beside the wheel in half a row; it wraps under only when even that doesn't fit */}
      <figcaption className="space-y-1 text-xs text-muted-foreground basis-32 grow max-w-56">
        <p className="tabular-nums">{positionLabel(pct, axis)}</p>
        {laps.map(({ key, label, color, angle }) => (
          <p key={key} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="font-semibold text-foreground tabular-nums">{steeringLabel(angle, t)}</span>
            <span>{label}</span>
          </p>
        ))}
        <p>{t.wheelHint}</p>
      </figcaption>

      {/* Right of the caption (under it when there's no room): Gear, and each lap's gear side by side */}
      {hasGears && (
        <div aria-hidden="true">
          <p className="mb-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.gearCharts.gear}
          </p>
          <div className="flex gap-3">
            {laps.map(({ key, label, color, gear }) => (
              <GearDisplay key={key} gear={gear} label={label} color={color} diff={key === 'compare' ? gearDiff : undefined} />
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
