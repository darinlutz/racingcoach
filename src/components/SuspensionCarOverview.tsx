'use client';

import type { KeyboardEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import {
  arbBladeAngle,
  AXLES,
  CORNERS,
  findItem,
  formatSuspension,
  heightOffset,
  heightReference,
  toneOf,
  valueOf,
  visibleKinds,
  type Axle,
  type Corner,
  type SuspensionDrawingProps,
} from '@/lib/suspensionGeometry';

// The Suspension tab's axonometric overview (the design from the Lovable project darinlutz/page-polish): the chassis,
// each corner's wheel, wishbones, coil spring, damper and bump rubber, and an anti-roll bar across each axle, drawn
// from 3D points (meters; x back from the front axle, y across from the right side, z up from the ground) through one
// isometric projection, so every part sits in the same space. Schematic: nothing but the ride heights comes from the
// car, and those are exaggerated (heightOffset). Both setups at once or one at a time; a part fades when the component
// filter picks another system. Click or press Enter on a corner to select it.

type P3 = [number, number, number];

const WHEELBASE = 2.6;
const TRACK = 1.6;
const TIRE_R = 0.32;
const SCALE = 125; // px per meter
const ORIGIN = [450, 235] as const;
// The exaggerated ride height offsets (heightOffset's px, at most MAX_HEIGHT_OFFSET) in this drawing's px
const LIFT_PX = 1;

const project = ([x, y, z]: P3): [number, number] => [ORIGIN[0] + (x - y) * 0.866 * SCALE, ORIGIN[1] + (x + y) * 0.5 * SCALE - z * SCALE];
const pathOf = (points: P3[], close = false) =>
  points
    .map((p, i) => {
      const [sx, sy] = project(p);
      return `${i ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join('') + (close ? 'Z' : '');

// A circle in the wheel's plane (x-z) at y
function wheelPath(x: number, y: number, r: number) {
  return pathOf(Array.from({ length: 49 }, (_, i): P3 => [x + Math.cos((i / 48) * Math.PI * 2) * r, y, TIRE_R + Math.sin((i / 48) * Math.PI * 2) * r]), true);
}
// A coil spring standing from z0 to z1
function coilPath(x: number, y: number, z0: number, z1: number, r = 0.055, turns = 7) {
  const steps = turns * 16;
  return pathOf(
    Array.from({ length: steps + 1 }, (_, i): P3 => {
      const a = (i / steps) * turns * Math.PI * 2;
      return [x + Math.cos(a) * r, y + Math.sin(a) * r, z0 + ((z1 - z0) * i) / steps];
    })
  );
}

// Where each corner is: the front axle at x 0, the right side at y 0
const AT: Record<Corner, { x: number; y: number }> = {
  RF: { x: 0, y: 0 },
  LF: { x: 0, y: TRACK },
  RR: { x: WHEELBASE, y: 0 },
  LR: { x: WHEELBASE, y: TRACK },
};
// Far corners first, so nearer ones are drawn over them
const DRAW_ORDER = [...CORNERS].sort((a, b) => AT[a].x + AT[a].y - (AT[b].x + AT[b].y));
const AXLE_X: Record<Axle, number> = { front: 0, rear: WHEELBASE };

// The chassis tub's outline at a height, drawn in from its sides by `inset`
const tub = (z: number, inset = 0): P3[] => [
  [-0.75 + inset, 0.1 + inset, z],
  [3.35 - inset, 0.1 + inset, z],
  [3.35 - inset, TRACK - 0.1 - inset, z],
  [-0.75 + inset, TRACK - 0.1 - inset, z],
];

export default function SuspensionCarOverview({ comparison, mode, exaggeration, selected, onSelect, component }: SuspensionDrawingProps) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const reference = heightReference(comparison);
  const kinds = visibleKinds(mode);
  const dim = (system: string) => (component === 'all' || component === system ? '' : 'susp-dim');
  const keys = (e: KeyboardEvent<SVGGElement>, corner: Corner) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(corner);
    }
  };
  const lower = tub(0.3);
  const upper = tub(0.7, 0.05);

  return (
    <svg className="align-svg susp-overview h-auto w-full" viewBox="40 70 960 610" role="img" aria-label={s.overview.aria}>
      {/* The ground plane under the car */}
      <path
        d={pathOf([[-1.3, -0.6, 0], [3.9, -0.6, 0], [3.9, TRACK + 0.6, 0], [-1.3, TRACK + 0.6, 0]], true)}
        className="align-reference susp-ground"
      />
      {/* The planes' names, on the far edges, clear of the corners */}
      <text x={project([3.9, -0.6, 0])[0] - 6} y={project([3.9, -0.6, 0])[1] + 20} textAnchor="end" style={{ fontSize: 11 }}>
        {s.overview.ground.toUpperCase()}
      </text>

      {/* The chassis: the tub, its frame rails and the roll structure */}
      <g className="align-structure susp-chassis">
        <path d={pathOf(lower, true)} />
        <path d={pathOf(upper, true)} />
        {lower.map((p, i) => (
          <path key={i} d={pathOf([p, upper[i]])} />
        ))}
        <path d={pathOf([[0.3, 0.3, 0.7], [0.6, 0.35, 1.05], [2.0, 0.35, 1.08], [2.45, 0.3, 0.7]])} />
        <path d={pathOf([[0.3, TRACK - 0.3, 0.7], [0.6, TRACK - 0.35, 1.05], [2.0, TRACK - 0.35, 1.08], [2.45, TRACK - 0.3, 0.7]])} />
        <path d={pathOf([[0.6, 0.35, 1.05], [0.6, TRACK - 0.35, 1.05]])} />
        <path d={pathOf([[2.0, 0.35, 1.08], [2.0, TRACK - 0.35, 1.08]])} />
      </g>
      <g className="align-structure">
        <path d={pathOf([[-0.4, 0.3, 0.28], [3.0, 0.3, 0.28]])} strokeWidth="1.4" />
        <path d={pathOf([[-0.4, TRACK - 0.3, 0.28], [3.0, TRACK - 0.3, 0.28]])} strokeWidth="1.4" />
      </g>
      <text x={project([-0.75, 0.1, 0.7])[0]} y={project([-0.75, 0.1, 0.7])[1] - 12} textAnchor="middle" style={{ fontSize: 11 }}>
        {s.overview.chassis.toUpperCase()}
      </text>

      {/* Anti-roll bars: across each axle, its arms out to the corners, and its blade turned by the setting */}
      <g className={dim('arb')}>
        {AXLES.map((axle) => {
          const item = findItem(comparison, axle, 'arb');
          const x = AXLE_X[axle];
          const arm = axle === 'front' ? 0.35 : -0.35;
          const [mx, my] = project([x, TRACK / 2, 0.32]);
          return kinds.map((kind) => {
            const v = item?.[kind];
            return (
              <g key={`${axle}-${kind}`} className={toneOf(item, kind)} strokeLinecap="round" strokeLinejoin="round" opacity={kind === 'baseline' && mode === 'overlay' ? 0.8 : 1}>
                <path d={pathOf([[x + arm, 0.2, 0.3], [x, 0.3, 0.32], [x, TRACK - 0.3, 0.32], [x + arm, TRACK - 0.2, 0.3]])} strokeWidth="3" />
                <g transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
                  <g className="align-rotate" style={{ transform: `rotate(${v ? arbBladeAngle(v.value) : 0}deg)` }}>
                    <path d="M-16 -6 H16 V6 H-16 Z" strokeWidth="1.2" />
                  </g>
                </g>
              </g>
            );
          });
        })}
      </g>

      {DRAW_ORDER.map((corner) => {
        const { x, y } = AT[corner];
        const right = y === 0;
        const out = right ? -0.12 : 0.12;
        const wheelY = y + out;
        const innerY = right ? 0.28 : TRACK - 0.28;
        const strutY = right ? 0.16 : TRACK - 0.16;
        const height = findItem(comparison, corner, 'rideHeight');
        const spring = findItem(comparison, corner, 'springRate');
        const bump = findItem(comparison, corner, 'bumpGap');
        const [hubX, hubY] = project([x, wheelY, TIRE_R]);
        // Under its tire
        const [labelX, labelY] = project([x, wheelY, -0.3]);
        const front = x === 0;
        // The ride height dimension, ahead of the front wheels and behind the rear ones
        const along = front ? -0.5 : 0.5;
        const [groundX, groundY] = project([x + along, y, 0]);
        const [topX, topY] = project([x + along, y, 0.45]);
        const textAnchor = front ? 'end' : 'start';
        const textX = topX + (front ? -10 : 10);
        return (
          <g
            key={corner}
            className="align-wheel"
            role="button"
            tabIndex={0}
            aria-pressed={selected === corner}
            aria-label={fmt(s.selectCorner, { corner: s.corners[corner] })}
            onClick={() => onSelect(corner)}
            onKeyDown={(e) => keys(e, corner)}
          >
            <title>
              {fmt(s.cornerTooltip, {
                corner: s.corners[corner],
                baseline: formatSuspension(height?.baseline ?? null),
                comparison: formatSuspension(height?.comparison ?? null),
              })}
            </title>
            <ellipse className="align-ring susp-overview-ring" cx={hubX} cy={hubY - 20} rx="70" ry="95" />
            {/* The tire, the rim and the hub, in the wheel's plane */}
            <path d={wheelPath(x, wheelY, TIRE_R)} className="align-chassis" strokeWidth="1.4" />
            <path d={wheelPath(x, wheelY, TIRE_R * 0.62)} className="align-structure" opacity=".7" />
            <path d={wheelPath(x, wheelY, TIRE_R * 0.18)} className="align-structure" />

            {kinds.map((kind, i) => {
              const v = height?.[kind] ?? null;
              const { offset } = heightOffset(v, reference, exaggeration);
              // The setups side by side (a few cm apart) so both coils show
              const sx = x + (i ? 0.02 : -0.02) * (kinds.length > 1 ? 1 : 0);
              const top = 0.78;
              const gapAt = top - 0.07;
              return (
                <g
                  key={kind}
                  className="susp-lift"
                  style={{ transform: `translateY(${(-offset * LIFT_PX).toFixed(1)}px)` }}
                  opacity={kind === 'baseline' && mode === 'overlay' ? 0.85 : 1}
                  fill="none"
                  strokeLinecap="round"
                >
                  {/* Wishbones: lower and upper, from the upright to the chassis */}
                  <g className={`${toneOf(height, kind)} ${dim('dampers')}`} strokeWidth="1.6">
                    <path d={pathOf([[x - 0.22, innerY, 0.2], [x, wheelY - out * 0.3, 0.2], [x + 0.22, innerY, 0.2]])} />
                    <path d={pathOf([[x - 0.16, innerY, 0.5], [x, wheelY - out * 0.3, 0.48], [x + 0.16, innerY, 0.5]])} />
                    <path d={pathOf([[x, wheelY - out * 0.3, 0.2], [x, wheelY - out * 0.3, 0.48]])} strokeWidth="2.4" />
                  </g>
                  {valueOf(comparison, corner, 'springRate', kind) && (
                    <path d={coilPath(sx, strutY, 0.24, top)} className={`${toneOf(spring, kind)} ${dim('springRate')}`} strokeWidth="1.3" />
                  )}
                  <path d={pathOf([[sx, strutY, 0.22], [sx, strutY, top + 0.06]])} className={`${toneOf(height, kind)} ${dim('dampers')}`} strokeWidth="3" opacity=".55" />
                  {valueOf(comparison, corner, 'bumpGap', kind) &&
                    (() => {
                      const [bx, by] = project([sx, strutY, gapAt]);
                      return (
                        <rect x={bx - 5} y={by - 4} width="10" height="8" rx="2" className={`${toneOf(bump, kind)} susp-bump ${dim('bumpGap')}`} strokeWidth="1.2" />
                      );
                    })()}
                  {(component === 'all' || component === 'rideHeight') && v && (
                    <g className={toneOf(height, kind)}>
                      {i === 0 && (
                        <g strokeWidth=".8">
                          <line x1={groundX} y1={groundY} x2={topX} y2={topY} strokeDasharray="3 3" />
                          <line x1={groundX - 5} y1={groundY} x2={groundX + 5} y2={groundY} />
                          <line x1={topX - 5} y1={topY} x2={topX + 5} y2={topY} />
                        </g>
                      )}
                      <text x={textX} y={(groundY + topY) / 2 + (kind === 'baseline' ? -6 : 12)} textAnchor={textAnchor} className="align-value" style={{ fontSize: 13 }}>
                        {formatSuspension(v)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            <text x={labelX} y={labelY} textAnchor="middle" className="align-wheel-label" style={{ fontSize: 15 }}>
              {corner}
            </text>
          </g>
        );
      })}

      {/* The axes */}
      <g className="align-structure" strokeWidth="1">
        <line x1="80" y1="620" x2="80" y2="572" />
        <line x1="80" y1="620" x2="122" y2="597" />
        <line x1="80" y1="620" x2="122" y2="643" />
      </g>
      <text x="76" y="564" style={{ fontSize: 11 }}>
        Z
      </text>
      <text x="127" y="598" style={{ fontSize: 11 }}>
        X
      </text>
      <text x="127" y="652" style={{ fontSize: 11 }}>
        Y
      </text>
      <text x="520" y="664" textAnchor="middle" style={{ fontSize: 11, letterSpacing: '0.18em' }}>
        {s.overview.footer.toUpperCase()}
      </text>
    </svg>
  );
}
