'use client';

import { useId, useSyncExternalStore, type SVGProps } from 'react';
import type { FlagKind } from '@/lib/raceFlags';

// A racing flag on a pole, waving (src/lib/raceFlags.ts says which): the cloth's edges ripple and its folds catch
// the light, faster when the flag is waved. Still for visitors who ask for reduced motion.

const VIEW_W = 160;
const VIEW_H = 120;
const POLE_X = 10;
const CLOTH_X = 14;
const CLOTH_Y = 10;
const CLOTH_W = 136;
const CLOTH_H = 84;
const WAVELENGTH = 90;
const AMPLITUDE = 7;
const STEPS = 17;
const FRAMES = 6;

// The cloth's outline at a point in its wave: still at the pole, rippling more towards the free end
function clothPath(phase: number): string {
  const edge = (y0: number) =>
    Array.from({ length: STEPS }, (_, i) => {
      const x = (CLOTH_W * i) / (STEPS - 1);
      const y = y0 + AMPLITUDE * (x / CLOTH_W) * Math.sin((2 * Math.PI * x) / WAVELENGTH - phase);
      return [CLOTH_X + x, y] as const;
    });
  const top = edge(CLOTH_Y);
  // the free end droops a little
  const bottom = edge(CLOTH_Y + CLOTH_H).map(([x, y]) => [x, y - (3 * (x - CLOTH_X)) / CLOTH_W] as const).reverse();
  const point = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  return `M${top.map(point).join(' L')} L${bottom.map(point).join(' L')} Z`;
}

const STILL = clothPath(Math.PI / 3);
const FRAMES_D = Array.from({ length: FRAMES + 1 }, (_, i) => clothPath((2 * Math.PI * i) / FRAMES)).join(';');

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const SOLID: Partial<Record<FlagKind, string>> = {
  green: '#16a34a',
  yellow: '#facc15',
  caution: '#facc15',
  red: '#dc2626',
  white: '#f8fafc',
  blue: '#2563eb',
  black: '#111111',
  repair: '#111111',
  disqualify: '#111111',
  debris: '#facc15',
  none: '#94a3b8',
};

export default function RaceFlag({
  flag,
  waving = false,
  label,
  className,
}: {
  flag: FlagKind;
  waving?: boolean;
  label: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const reduced = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
  const animate = !reduced;
  const duration = waving ? '0.7s' : '1.8s';
  const clip = `${id}-clip`;
  const checks = `${id}-checks`;
  const stripes = `${id}-stripes`;
  const shade = `${id}-shade`;

  const shape = (props: SVGProps<SVGPathElement>) => (
    <path d={STILL} {...props}>
      {animate && <animate attributeName="d" values={FRAMES_D} dur={duration} repeatCount="indefinite" />}
    </path>
  );

  const left = CLOTH_X;
  const top = CLOTH_Y - AMPLITUDE - 2;
  const width = CLOTH_W + 2;
  const height = CLOTH_H + 2 * AMPLITUDE + 4;
  const cx = CLOTH_X + CLOTH_W / 2;
  const cy = CLOTH_Y + CLOTH_H / 2;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label} className={className}>
      <title>{label}</title>
      <defs>
        <clipPath id={clip}>{shape({})}</clipPath>
        <pattern id={checks} width="24" height="24" patternUnits="userSpaceOnUse" x={CLOTH_X} y={CLOTH_Y}>
          <rect width="24" height="24" fill="#f8fafc" />
          <rect width="12" height="12" fill="#111111" />
          <rect x="12" y="12" width="12" height="12" fill="#111111" />
        </pattern>
        <pattern id={stripes} width="22" height="22" patternUnits="userSpaceOnUse" x={CLOTH_X}>
          <rect width="11" height="22" fill="#dc2626" />
        </pattern>
        <linearGradient id={shade} gradientUnits="userSpaceOnUse" x1={CLOTH_X} x2={CLOTH_X + WAVELENGTH} y1="0" y2="0" spreadMethod="repeat">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#000000" stopOpacity="0.28" />
          <stop offset="0.75" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.28" />
          {animate && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="0 0"
              to={`${WAVELENGTH} 0`}
              dur={duration}
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>

      {/* the pole */}
      <rect x={POLE_X - 2} y="6" width="4" height={VIEW_H - 8} rx="2" fill="#9ca3af" />
      <circle cx={POLE_X} cy="6" r="4" fill="#d1d5db" />

      <g clipPath={`url(#${clip})`}>
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          fill={flag === 'checkered' ? `url(#${checks})` : SOLID[flag] ?? '#94a3b8'}
          opacity={flag === 'none' ? 0.35 : 1}
        />
        {flag === 'debris' && <rect x={left} y={top} width={width} height={height} fill={`url(#${stripes})`} />}
        {flag === 'blue' && (
          <polygon
            points={`${left},${top + height * 0.62} ${left + width},${top + height * 0.18} ${left + width},${top + height * 0.38} ${left},${top + height * 0.82}`}
            fill="#facc15"
          />
        )}
        {flag === 'repair' && <circle cx={cx} cy={cy} r={CLOTH_H * 0.3} fill="#f97316" />}
        {flag === 'disqualify' && (
          <g stroke="#f8fafc" strokeWidth="9" strokeLinecap="round">
            <line x1={cx - 22} y1={cy - 22} x2={cx + 22} y2={cy + 22} />
            <line x1={cx + 22} y1={cy - 22} x2={cx - 22} y2={cy + 22} />
          </g>
        )}
        <rect x={left} y={top} width={width} height={height} fill={`url(#${shade})`} />
      </g>
      {shape({
        fill: 'none',
        stroke: flag === 'white' || flag === 'checkered' || flag === 'none' ? '#64748b' : 'rgba(0,0,0,0.35)',
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
        strokeDasharray: flag === 'none' ? '6 4' : undefined,
      })}
    </svg>
  );
}
