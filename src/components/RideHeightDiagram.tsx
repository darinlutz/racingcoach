'use client';

import { useLanguage } from '@/components/LanguageProvider';
import {
  findItem,
  formatSuspension,
  heightAsymmetry,
  heightDifference,
  heightOffset,
  heightReference,
  toneOf,
  visibleKinds,
  type Corner,
  type SuspensionDrawingProps,
} from '@/lib/suspensionGeometry';

// The Suspension tab's ride height elevations (from the Lovable design): the side view (the left side's front and rear
// measurement points, the nose on the left), the front view (standing in front looking rearward, so the car's left is on
// the screen's right) and the rear view (standing behind looking forward). Each setup's chassis line runs between its
// two ride heights, raised or lowered from the mean of all of them, exaggerated: the only part drawn to a scale
export default function RideHeightDiagram({
  view,
  compact = false,
  ...props
}: SuspensionDrawingProps & { view: 'side' | 'front' | 'rear'; compact?: boolean }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, mode, exaggeration } = props;
  const side = view === 'side';
  const corners: [Corner, Corner] = side ? ['LF', 'LR'] : view === 'front' ? ['RF', 'LF'] : ['LR', 'RR'];
  const xs: [number, number] = side ? [188, 534] : [160, 560];
  const reference = heightReference(comparison);
  const title = side ? s.ride.sideView : view === 'front' ? s.ride.frontView : s.ride.rearView;
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border border-border align-grid ${compact ? 'p-2' : 'p-3'}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">{title}</h4>
        <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {side ? s.ride.leftSide : s.ride.axleElevation}
        </span>
      </div>
      <svg viewBox="0 0 720 300" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.ride.aria, { view: title })}>
        <path d="M65 236 H655" className="align-structure" strokeWidth="1.6" />
        {Array.from({ length: 48 }, (_, i) => (
          <path key={i} d={`M${70 + i * 12} 236 l-7 8`} className="align-structure" opacity=".4" />
        ))}
        {side ? (
          <>
            <path
              d="M93 180 L100 149 L137 129 L250 112 L300 71 Q363 52 426 76 L485 122 L580 136 L618 169 L626 194 H575 Q571 156 534 156 Q497 156 491 194 H231 Q222 156 188 156 Q151 156 144 194 Z"
              className="align-chassis"
            />
            <path
              d="M277 113 L310 79 L364 76 V113 Z M374 77 L417 83 L459 120 L374 114 Z M258 124 L262 183 L468 183 L473 130 M110 145 L141 141 M566 137 H596 M541 126 L619 126 V133 H541 Z"
              className="align-structure"
            />
          </>
        ) : (
          <>
            <path d="M173 181 L185 122 L230 110 L273 71 H447 L490 110 L535 122 L547 181 Z" className="align-chassis" />
            <path d="M279 79 H441 L470 112 H250 Z M203 143 H253 M467 143 H517 M260 174 H460" className="align-structure" />
          </>
        )}
        {corners.map((corner, i) => (
          <g key={corner}>
            <circle cx={xs[i]} cy="202" r="34" className="align-chassis" />
            <circle cx={xs[i]} cy="202" r="23" className="align-structure" />
            <circle cx={xs[i]} cy="202" r="8" className="align-structure" />
            <line x1={xs[i]} y1="44" x2={xs[i]} y2="252" className="align-reference" />
            <text x={xs[i]} y="268" textAnchor="middle" className="align-wheel-label">
              {corner}
            </text>
          </g>
        ))}
        {visibleKinds(mode).map((kind) => {
          const items = corners.map((c) => findItem(comparison, c, 'rideHeight'));
          const values = items.map((item) => item?.[kind] ?? null);
          const ys = values.map((v) => 190 - heightOffset(v, reference, exaggeration).offset);
          const same = items.every((item) => item?.status === 'same');
          const tone = same ? 'align-unchanged' : toneOf(null, kind);
          return (
            <g key={kind} className={tone}>
              {values[0] && values[1] && values[0].unit === values[1].unit && (
                <path
                  d={`M${xs[0] - 45} ${ys[0]} L${xs[1] + 45} ${ys[1]}`}
                  strokeWidth="1.8"
                  strokeDasharray={kind === 'comparison' ? '8 4' : undefined}
                  className="susp-line"
                />
              )}
              {values.map((v, i) =>
                v ? (
                  <g key={i}>
                    <path d={`M${i ? xs[1] + 50 : xs[0] - 50} 236 V${ys[i]} m-4 0 h8 M${i ? xs[1] + 46 : xs[0] - 54} 236 h8`} strokeWidth="1" />
                    <text
                      x={i ? xs[1] + 60 : xs[0] - 60}
                      y={ys[i] + (kind === 'baseline' ? -7 : 15)}
                      textAnchor={i ? 'start' : 'end'}
                      className="align-value"
                    >
                      {formatSuspension(v)}
                    </text>
                  </g>
                ) : null
              )}
            </g>
          );
        })}
        <text x="654" y="270" textAnchor="end">
          {fmt(s.ride.ground, { factor: exaggeration }).toUpperCase()}
        </text>
      </svg>
      <Metrics {...props} view={view} />
    </div>
  );
}

function Metrics({ comparison, view }: SuspensionDrawingProps & { view: 'side' | 'front' | 'rear' }) {
  const { t } = useLanguage();
  const s = t.setups.suspension;
  const [a, b] =
    view === 'side'
      ? [heightDifference(comparison, 'baseline'), heightDifference(comparison, 'comparison')]
      : [heightAsymmetry(comparison, view, 'baseline'), heightAsymmetry(comparison, view, 'comparison')];
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
      <span className="text-muted-foreground">{view === 'side' ? s.ride.difference : s.ride.asymmetry}</span>
      {a || b ? (
        <>
          <strong className="font-mono tabular-nums text-align-baseline">{formatSuspension(a, true)}</strong>
          <strong className="font-mono tabular-nums text-align-comparison">{formatSuspension(b, true)}</strong>
        </>
      ) : (
        <span className="text-muted-foreground">{s.ride.noDifference}</span>
      )}
    </div>
  );
}
