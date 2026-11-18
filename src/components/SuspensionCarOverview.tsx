'use client';

import type { KeyboardEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import SuspensionSpring from '@/components/SuspensionSpring';
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
  type Corner,
  type SuspensionDrawingProps,
} from '@/lib/suspensionGeometry';

// Where each corner's wheel sits in the axonometric drawing (schematic, not the car's geometry)
const AT: Record<Corner, [number, number]> = { LF: [305, 369], RF: [502, 265], LR: [511, 473], RR: [710, 371] };
const ARB_AT = { front: [384, 281], rear: [592, 386] } as const;

// The Suspension tab's 3D overview (from the Lovable design): an elevated three-quarter axonometric view of the
// chassis, each corner's upright, wishbones, spring and damper, and the anti-roll bars, both setups at once or one at a
// time. A corner is raised or lowered by its ride height (exaggerated; the only thing drawn to a scale), and its parts
// fade when the component filter picks another system. Click or press Enter on a wheel to select its corner
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
  return (
    <svg className="align-svg susp-overview h-auto w-full" viewBox="120 130 740 465" role="img" aria-label={s.overview.aria}>
      <path d="M140 380 L459 210 L855 414 L535 581 Z" className="align-reference" />
      <path d="M224 331 L476 201 L808 371 L555 502 Z" className="align-reference" />
      <text x="143" y="418">
        {s.overview.ground.toUpperCase()}
      </text>
      <text x="609" y="536">
        {s.overview.chassis.toUpperCase()}
      </text>
      {/* Floor pan and frame rails */}
      <path d="M230 299 L417 197 L747 350 L550 461 Z M287 273 L491 377 M354 234 L559 339 M490 300 L685 401" className="align-structure" />
      <path d="M286 299 L430 224 L716 355 L566 436 Z M325 309 L488 387 M443 249 L650 350 M347 290 L451 343 M451 343 L583 372" className="align-structure" />

      {/* Anti-roll bars: the bar across each axle and its blade, turned by its setting (schematic) */}
      <g className={dim('arb')}>
        {kinds.map((kind) => (
          <g key={kind} opacity=".85">
            <path
              d="M312 320 L331 300 L414 258 L461 271 L492 291 M520 429 L541 409 L624 368 L673 378 L703 397"
              strokeWidth="3"
              className={toneOf(findItem(comparison, 'front', 'arb'), kind)}
            />
            {AXLES.map((axle) => {
              const item = findItem(comparison, axle, 'arb');
              const v = item?.[kind];
              const [x, y] = ARB_AT[axle];
              return (
                <g key={axle} transform={`translate(${x} ${y})`} className={toneOf(item, kind)}>
                  <path d="M-21 0 L21 0" strokeWidth="2" />
                  <g className="align-rotate" style={{ transform: `rotate(${v ? arbBladeAngle(v.value) : 0}deg)` }}>
                    <path d="M-18 -8 H18 V8 H-18 Z" strokeWidth="1" />
                  </g>
                </g>
              );
            })}
          </g>
        ))}
      </g>

      {CORNERS.map((corner) => {
        const [x, y] = AT[corner];
        const spring = findItem(comparison, corner, 'springRate');
        const height = findItem(comparison, corner, 'rideHeight');
        return (
          <g
            key={corner}
            transform={`translate(${x} ${y})`}
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
            <ellipse className="align-ring" cy="-15" rx="62" ry="93" />
            {/* The tire and wheel, seen at three-quarters */}
            <g transform="rotate(-27)">
              <ellipse rx="29" ry="46" className="align-chassis" />
              <ellipse rx="19" ry="32" className="align-structure" />
              <ellipse rx="8" ry="14" className="align-structure" />
              {Array.from({ length: 8 }, (_, i) => (
                <path key={i} transform={`rotate(${i * 45})`} d="M0 -14 V-31" className="align-structure" />
              ))}
              <path d="M-28 -27 Q-6 -47 15 -37 M-30 -12 Q-8 -29 24 -22 M-29 8 Q-8 -12 27 -4 M-18 35 Q0 15 27 18" className="align-structure" opacity=".5" />
            </g>
            {kinds.map((kind) => {
              const v = height?.[kind] ?? null;
              const { offset } = heightOffset(v, reference, exaggeration);
              return (
                <g key={kind} className="susp-lift" style={{ transform: `translateY(${-offset}px)` }} opacity={kind === 'baseline' && mode === 'overlay' ? 0.85 : 1}>
                  {/* Wishbones and the damper strut */}
                  <g className={`${toneOf(height, kind)} ${dim('dampers')}`}>
                    <path d="M0 -5 L27 -70 M0 -5 L72 -20 M0 -5 L46 -57 M0 -21 L41 -84 L82 -44 Z" strokeWidth="1.3" />
                    <path d="M23 -67 L47 -46" strokeWidth="3" />
                  </g>
                  <g className={dim('springRate')} transform="translate(25 -89) rotate(-27) scale(.48)">
                    {valueOf(comparison, corner, 'springRate', kind) && <SuspensionSpring tone={toneOf(spring, kind)} length={104} />}
                  </g>
                  <g className={`${toneOf(findItem(comparison, corner, 'bumpGap'), kind)} ${dim('bumpGap')}`}>
                    <path d="M36 -61 L42 -57 L45 -62 L41 -66 Z" strokeWidth="3" />
                  </g>
                  {(component === 'all' || component === 'rideHeight') && v && (
                    <g className={toneOf(height, kind)}>
                      <path d="M-47 20 V-70 M-51 20 H-43 M-51 -70 H-43" strokeWidth=".6" strokeDasharray={kind === 'comparison' ? '3 3' : undefined} />
                      <text x="-54" y={kind === 'baseline' ? -49 : -34} textAnchor="end" className="align-value">
                        {formatSuspension(v)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            <text x="-10" y="64" className="align-wheel-label">
              {corner}
            </text>
          </g>
        );
      })}

      {/* The body, as a ghost over the chassis */}
      <g className="susp-ghost-body">
        <path d="M228 269 L275 219 Q336 182 415 171 L455 186 L528 239 L652 299 L737 315 L787 350 L779 380 L716 414 L569 463 L547 452 L517 423 L366 351 L324 360 L286 344 L241 313 Z" />
        <path d="M320 243 L389 206 L457 206 L548 272 L435 330 Z M359 252 L420 221 L477 239 L510 273 L435 313 Z M436 330 L548 272 L611 303 L498 361 Z M504 368 L621 307 L681 337 L565 398 Z M286 273 L350 238 M612 337 L706 382 M591 427 L739 352 M253 285 L287 308" />
        <path d="M676 297 L806 362 L801 372 L671 307 Z M700 310 V339 M768 346 V372" />
      </g>
      <path d="M154 478 L190 459 M154 478 L154 443 M154 478 L189 496" className="align-structure" />
      <text x="193" y="459">
        X
      </text>
      <text x="149" y="437">
        Z
      </text>
      <text x="193" y="501">
        Y
      </text>
      <text x="500" y="567" textAnchor="middle">
        {s.overview.footer.toUpperCase()}
      </text>
    </svg>
  );
}
