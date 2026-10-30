'use client';

import { useId, type ReactNode } from 'react';

import type { TireCorner } from '@/lib/lapData';

const CORNERS: TireCorner[] = ['LF', 'RF', 'LR', 'RR'];
const WHEELS: Record<TireCorner, { x: number; y: number; w: number; h: number }> = {
  LF: { x: 6, y: 78, w: 26, h: 62 },
  RF: { x: 168, y: 78, w: 26, h: 62 },
  LR: { x: 3, y: 316, w: 31, h: 68 },
  RR: { x: 166, y: 316, w: 31, h: 68 },
};
export const wheelCenter = (corner: TireCorner) => {
  const { x, y, w, h } = WHEELS[corner];
  return { x: x + w / 2, y: y + h / 2 };
};

const BODY =
  'M100 16 C132 16 150 22 158 38 L165 70 C170 92 172 112 170 132 L166 162 C160 178 156 192 156 212 L158 300 C160 328 170 344 172 368 L172 404 C172 418 160 424 100 424 C40 424 28 418 28 404 L28 368 C30 344 40 328 42 300 L44 212 C44 192 40 178 34 162 L30 132 C28 112 30 92 35 70 L42 38 C50 22 68 16 100 16 Z';

export type WheelVisual = { fill?: string; label?: string; highlighted?: boolean; selected?: boolean };

// A generic GT3-class car from above, in the Tire Temperature Comparison's car colors, with each wheel colored and
// labelled by the dashboard using it. A picture only: it isn't any particular car.
export default function DashboardCarView({
  wheels = {},
  onWheelHover,
  onWheelClick,
  showSuspension = false,
  children,
  className,
  title,
}: {
  wheels?: Partial<Record<TireCorner, WheelVisual>>;
  onWheelHover?: (corner: TireCorner | null) => void;
  onWheelClick?: (corner: TireCorner) => void;
  showSuspension?: boolean;
  children?: ReactNode;
  className?: string;
  title: string;
}) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 200 440" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${ids}-body`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--car-body)" />
          <stop offset="0.5" stopColor="var(--car-body-hi)" />
          <stop offset="1" stopColor="var(--car-body)" />
        </linearGradient>
      </defs>
      <line x1="10" x2="190" y1="109" y2="109" stroke="var(--border)" strokeDasharray="2 3" />
      <line x1="10" x2="190" y1="350" y2="350" stroke="var(--border)" strokeDasharray="2 3" />
      <path d="M40 22 Q100 2 160 22 L164 30 Q100 12 36 30 Z" fill="var(--car-body-hi)" />
      <path d={BODY} fill={`url(#${ids}-body)`} stroke="var(--border)" strokeWidth={1.2} />
      <path d="M96 18 L104 18 L104 422 L96 422 Z" fill="var(--lap-compare)" opacity={0.16} />
      <g stroke="var(--border)" fill="none" strokeWidth={0.8}>
        <path d="M70 60 L90 60 L88 96 L72 96 Z" fill="var(--car-glass)" />
        <path d="M110 60 L130 60 L128 96 L112 96 Z" fill="var(--car-glass)" />
        {[66, 72, 78, 84, 90].map((y) => (
          <g key={y}>
            <line x1="73" x2="88" y1={y} y2={y} />
            <line x1="112" x2="127" y1={y} y2={y} />
          </g>
        ))}
        <path d="M44 270 L54 262 L54 300 L44 300 Z" fill="var(--car-glass)" />
        <path d="M156 270 L146 262 L146 300 L156 300 Z" fill="var(--car-glass)" />
      </g>
      <path d="M66 170 Q100 150 134 170 L138 260 Q100 272 62 260 Z" fill="var(--car-glass)" stroke="var(--border)" />
      <path d="M70 262 Q100 270 130 262 L128 330 Q100 336 72 330 Z" fill="var(--car-body-hi)" stroke="var(--border)" />
      <path d="M52 176 L38 172 L36 182 L52 186 Z" fill="var(--car-body-hi)" stroke="var(--border)" />
      <path d="M148 176 L162 172 L164 182 L148 186 Z" fill="var(--car-body-hi)" stroke="var(--border)" />
      <rect x="20" y="398" width="160" height="14" rx="2" fill="var(--car-body-hi)" stroke="var(--border)" />
      <rect x="16" y="394" width="6" height="22" fill="var(--car-body)" />
      <rect x="178" y="394" width="6" height="22" fill="var(--car-body)" />

      {showSuspension && (
        <g stroke="var(--muted-foreground)" strokeWidth={1.2} fill="var(--background)">
          {CORNERS.map((corner) => {
            const { x, y } = wheelCenter(corner);
            const inner = corner.startsWith('L') ? 58 : 142;
            return (
              <g key={corner}>
                <line x1={x} y1={y - 12} x2={inner} y2={y - 22} />
                <line x1={x} y1={y + 12} x2={inner} y2={y + 20} />
                <line x1={x} y1={y} x2={inner} y2={y} strokeDasharray="2 2" />
                <circle cx={inner} cy={y - 22} r={2.6} />
                <circle cx={inner} cy={y + 20} r={2.6} />
                <circle cx={inner} cy={y} r={3.2} />
              </g>
            );
          })}
        </g>
      )}

      {CORNERS.map((corner) => {
        const { x, y, w, h } = WHEELS[corner];
        const wheel = wheels[corner] ?? {};
        return (
          <g
            key={corner}
            onPointerEnter={() => onWheelHover?.(corner)}
            onPointerLeave={() => onWheelHover?.(null)}
            onClick={() => onWheelClick?.(corner)}
            className={onWheelClick ? 'cursor-pointer' : undefined}
          >
            {(wheel.selected || wheel.highlighted) && (
              <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={6} fill="none" stroke={wheel.selected ? 'var(--foreground)' : 'var(--muted-foreground)'} strokeWidth={wheel.selected ? 1.5 : 1} strokeDasharray={wheel.selected ? undefined : '3 2'} />
            )}
            <rect x={x} y={y} width={w} height={h} rx={5} fill="var(--car-body)" stroke="var(--border)" />
            <rect x={x + 3} y={y + 4} width={w - 6} height={h - 8} rx={3} fill={wheel.fill ?? 'var(--car-body-hi)'} />
            {wheel.label && (
              <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--foreground)" className="tele-num">
                {wheel.label}
              </text>
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
