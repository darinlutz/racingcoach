'use client';

import { EngineeringCarLayer, type PlacedCar } from '@/components/EngineeringCarView';
import { useLanguage } from '@/components/LanguageProvider';
import type { CarFit } from '@/lib/carViews/anchors';
import { visibleCorners, type CarView } from '@/lib/carViews/views';
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
// two ride heights, raised or lowered from the mean of all of them, exaggerated: the only part drawn to a scale. The
// car is the compared setups' own drawing of that view (EngineeringCarView.tsx, docs/car-views.md), its tires drawn
// as each view sees them: round from the side, their tread width end on from the front and rear
export default function RideHeightDiagram({
  view,
  compact = false,
  ...props
}: SuspensionDrawingProps & { view: 'side' | 'front' | 'rear'; compact?: boolean }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const c = t.setups.carViews;
  const { exaggeration } = props;
  const side = view === 'side';
  const carView: CarView = side ? 'left-side' : view;
  // The corners in screen order (views.ts): from the front the car's left is on the right
  const corners = visibleCorners(carView) as [Corner, Corner];
  // Where the wheels were drawn before the car's own drawing, in case a drawing lacks a wheel's anchor
  const xs: [number, number] = side ? [188, 534] : [160, 560];
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
        {/* Layer 1: the ground */}
        <path d={`M65 ${GROUND} H655`} className="align-structure" strokeWidth="1.6" />
        {Array.from({ length: 48 }, (_, i) => (
          <path key={i} d={`M${70 + i * 12} ${GROUND} l-7 8`} className="align-structure" opacity=".4" />
        ))}
        {/* Layer 2: the compared setups' car standing on it (EngineeringCarView.tsx), its tires as this view sees them;
            layers 3 and 4: the ride heights at its wheels, placed by its anchors */}
        <EngineeringCarLayer view={carView} fit={FIT}>
          {(car) => (
            <RideHeightOverlay
              car={car}
              corners={corners}
              fallbackXs={xs}
              {...props}
              approximateText={c.approximate}
              approximateTitle={c.approximateTitle}
            />
          )}
        </EngineeringCarLayer>
        <text x="654" y="270" textAnchor="end">
          {fmt(s.ride.ground, { factor: exaggeration }).toUpperCase()}
        </text>
      </svg>
      <Metrics {...props} view={view} />
    </div>
  );
}

// Where the host drawing stands the car: across the drawing, on its ground line
const GROUND = 236;
const FIT: CarFit = { kind: 'ground', x: 65, width: 590, groundY: GROUND, maxHeight: 200 };

// The ride heights over the car: a reference line at each wheel, the corner's name under it, the car's ride height
// reference point (approximate unless verified for this car), and each setup's chassis line between its two ride
// heights with their values. The heights are drawn about the mean and exaggerated, as before; only where along the car
// they're drawn comes from the drawing
function RideHeightOverlay({
  car,
  corners,
  fallbackXs,
  comparison,
  mode,
  exaggeration,
  approximateText,
  approximateTitle,
}: SuspensionDrawingProps & {
  car: PlacedCar;
  corners: [Corner, Corner];
  fallbackXs: [number, number];
  approximateText: string;
  approximateTitle: string;
}) {
  const reference = heightReference(comparison);
  const xs = corners.map((c, i) => car.wheel(c)?.[0] ?? fallbackXs[i]) as [number, number];
  return (
    <>
      {corners.map((corner, i) => {
        const point = car.rideHeight(corner);
        return (
          <g key={corner}>
            <line x1={xs[i]} y1="44" x2={xs[i]} y2="252" className="align-reference" />
            <text x={xs[i]} y="268" textAnchor="middle" className="align-wheel-label">
              {corner}
            </text>
            {point && (
              <path
                d={`M${point.x} ${point.y - 4} l4 4 l-4 4 l-4 -4 Z`}
                className="align-structure"
                strokeDasharray={point.verified ? undefined : '1.5 1.5'}
                data-ride-reference={corner}
              />
            )}
          </g>
        );
      })}
      {car.approximate && (
        <text x="66" y="270" className="ecv-source" data-ride-approximate>
          <title>{approximateTitle}</title>
          {approximateText.toUpperCase()}
        </text>
      )}
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
                    <path d={`M${i ? xs[1] + 50 : xs[0] - 50} ${GROUND} V${ys[i]} m-4 0 h8 M${i ? xs[1] + 46 : xs[0] - 54} ${GROUND} h8`} strokeWidth="1" />
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
    </>
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
