'use client';

import { useId } from 'react';

// A car's fuel gauge: a dial from E to F with a needle at the share of the tank left (pct, 0-1; no needle when the
// collector doesn't send it, before 1.95.0), red near empty. dark draws it for the TV's dark graphics, else in the
// site's color tokens. The laps and time left are written beside it by whoever shows it.

const SWEEP = 240;
const START = -120;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function FuelGauge({
  pct,
  label,
  dark = false,
  low = false,
  className,
}: {
  pct: number | null;
  label: string;
  dark?: boolean;
  // fewer laps left than the driver will need: the dial's warning light comes on
  low?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const share = pct == null ? null : Math.min(Math.max(pct, 0), 1);
  const needle = START + SWEEP * (share ?? 0);
  const face = dark ? '#0b0f15' : 'var(--secondary)';
  const ink = dark ? '#e2e8f0' : 'currentColor';
  const warning = low || (share != null && share < 0.12);
  return (
    <svg viewBox="0 0 100 86" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <linearGradient id={`${id}-scale`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="25%" stopColor="#f59e0b" />
          <stop offset="55%" stopColor="#84cc16" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <radialGradient id={`${id}-face`} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor={dark ? '#1c2533' : 'var(--card)'} />
          <stop offset="100%" stopColor={face} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-face)`} stroke={dark ? '#334155' : 'currentColor'} strokeOpacity={dark ? 1 : 0.15} strokeWidth="2" />
      <path d={arc(50, 50, 37, START, START + SWEEP)} fill="none" stroke={dark ? '#1e293b' : 'currentColor'} strokeOpacity={dark ? 1 : 0.12} strokeWidth="8" strokeLinecap="round" />
      <path d={arc(50, 50, 37, START, START + SWEEP)} fill="none" stroke={`url(#${id}-scale)`} strokeWidth="5" strokeLinecap="round" opacity={0.95} />
      {Array.from({ length: 9 }, (_, i) => {
        const deg = START + (SWEEP * i) / 8;
        const [x1, y1] = polar(50, 50, 29, deg);
        const [x2, y2] = polar(50, 50, i % 4 === 0 ? 23 : 26, deg);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ink} strokeOpacity="0.8" strokeWidth={i % 4 === 0 ? 2.2 : 1.2} strokeLinecap="round" />;
      })}
      <text x={polar(50, 50, 19, START + 6)[0]} y={polar(50, 50, 19, START + 6)[1] + 3} fontSize="10" fontWeight="800" fill="#ef4444" textAnchor="middle">
        E
      </text>
      <text x={polar(50, 50, 19, START + SWEEP - 6)[0]} y={polar(50, 50, 19, START + SWEEP - 6)[1] + 3} fontSize="10" fontWeight="800" fill={ink} textAnchor="middle">
        F
      </text>
      {/* the pump, lit amber when low */}
      <g transform="translate(43 60)" fill={warning ? '#f59e0b' : ink} opacity={warning ? 1 : 0.55}>
        {warning && <animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite" />}
        <rect x="0" y="0" width="9" height="13" rx="1.5" />
        <rect x="1.8" y="2" width="5.4" height="4" rx="0.8" fill={dark ? '#0b0f15' : 'white'} />
        <path d="M9 3 h2.5 a1.5 1.5 0 0 1 1.5 1.5 v6 a1.2 1.2 0 0 0 2.4 0 v-7 l-2 -2" fill="none" stroke={warning ? '#f59e0b' : ink} strokeWidth="1.3" strokeLinecap="round" />
      </g>
      {share != null && (
        <g style={{ transform: `rotate(${needle}deg)`, transformOrigin: '50px 50px', transition: 'transform 900ms cubic-bezier(.3,1.4,.5,1)' }}>
          <path d="M50 14 L52.6 50 L47.4 50 Z" fill="#ff3b30" />
          <path d="M50 14 L50 50" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.6" />
        </g>
      )}
      <circle cx="50" cy="50" r="6" fill={dark ? '#e2e8f0' : 'currentColor'} />
      <circle cx="50" cy="50" r="2.5" fill="#ff3b30" />
    </svg>
  );
}
