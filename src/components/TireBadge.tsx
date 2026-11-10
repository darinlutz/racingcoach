'use client';

import { useId } from 'react';
import type { TireKind } from '@/lib/liveCarStatus';

// The fitted tire as a tire seen side on, in the colors Formula 1 uses for its compounds: soft red, medium yellow,
// hard white, intermediate green, wet blue; a dry tire the car names no other way is silver. The letter in the
// middle says the same for anyone who can't tell the colors apart.

export const TIRE_COLORS: Record<TireKind, string> = {
  soft: '#e10600',
  medium: '#ffd12e',
  hard: '#f4f6f8',
  dry: '#b8c2cf',
  intermediate: '#2fbf5b',
  wet: '#2f7bff',
  unknown: '#5b6573',
};

export default function TireBadge({ kind, letter, label, className }: { kind: TireKind; letter: string; label: string; className?: string }) {
  const id = useId().replace(/:/g, '');
  const color = TIRE_COLORS[kind];
  // tread blocks around the edge: grooved wets and inters, slicks smooth
  const grooves = kind === 'wet' ? 28 : kind === 'intermediate' ? 20 : 0;
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <radialGradient id={`${id}-rubber`} cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#3a3f47" />
          <stop offset="70%" stopColor="#16191e" />
          <stop offset="100%" stopColor="#050608" />
        </radialGradient>
        <radialGradient id={`${id}-rim`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4b5260" />
          <stop offset="100%" stopColor="#14171c" />
        </radialGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill={`url(#${id}-rubber)`} />
      {Array.from({ length: grooves }, (_, i) => (
        <rect key={i} x="48.5" y="3.5" width="3" height="7" rx="1" fill="#000" opacity="0.75" transform={`rotate(${(360 / grooves) * i} 50 50)`} />
      ))}
      {/* the compound's band on the sidewall */}
      <circle cx="50" cy="50" r="33" fill="none" stroke={color} strokeWidth="7" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="50" cy="50" r="26" fill={`url(#${id}-rim)`} />
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x="48" y="27" width="4" height="12" rx="2" fill="#2a2f37" transform={`rotate(${i * 72} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="13" fill="#0b0d10" stroke={color} strokeWidth="1.5" />
      <text x="50" y="55.5" textAnchor="middle" fontSize="16" fontWeight="900" fill={color} fontFamily="system-ui, sans-serif">
        {letter}
      </text>
      <circle cx="50" cy="50" r="47" fill={`url(#${id}-shine)`} />
    </svg>
  );
}
