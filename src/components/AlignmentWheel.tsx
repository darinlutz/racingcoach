'use client';

import { arcPath } from '@/lib/alignmentGeometry';

// One selectable wheel in the alignment diagrams (TopDownToeDiagram, AlignmentCamberDiagram): a tire drawn per setup,
// turned (plan) or leaned (front and rear views) by its angle, with an arc from the reference line to it. Every layer
// is always drawn and faded in or out, so switching Baseline / Comparison / Overlay and the exaggeration animate.
// The angles come from alignmentGeometry.ts; this only draws them.

export type WheelLayer = {
  kind: 'baseline' | 'comparison';
  // SVG degrees, clockwise positive; null when this setup has no value to draw
  angle: number | null;
  visible: boolean;
  // Both setups' values are the same: drawn in the neutral color
  unchanged: boolean;
  // Shown beside the wheel, e.g. "−4.0°"
  label: string | null;
};

export default function AlignmentWheel({
  x,
  y,
  variant,
  layers,
  selected,
  onSelect,
  name,
  tooltip,
  labelSide,
  shortName,
  noDataText,
}: {
  x: number;
  y: number;
  // plan: seen from above, the wheel centered on (x, y); elevation: seen from the front or rear, standing on (x, y)
  variant: 'plan' | 'elevation';
  layers: WheelLayer[];
  selected: boolean;
  onSelect: () => void;
  name: string;
  tooltip: string;
  labelSide: 'left' | 'right';
  shortName: string;
  noDataText: string;
}) {
  const plan = variant === 'plan';
  const anchor = labelSide === 'left' ? 'end' : 'start';
  const labelX = plan ? (labelSide === 'left' ? -34 : 34) : labelSide === 'left' ? -52 : 52;
  const drawn = layers.filter((l) => l.angle != null);
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="align-wheel"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={name}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{tooltip}</title>
      {plan ? (
        <rect className="align-ring" x="-30" y="-50" width="60" height="100" rx="6" />
      ) : (
        <rect className="align-ring" x="-48" y="-120" width="96" height="126" rx="5" />
      )}
      {/* The reference: the car's longitudinal direction (plan) or the vertical (elevation) */}
      {plan ? <line x1="0" y1="-66" x2="0" y2="64" className="align-reference" /> : <line x1="0" y1="-124" x2="0" y2="8" className="align-reference" />}
      {layers.map((layer) => {
        if (layer.angle == null) return null;
        const tone = layer.unchanged ? 'align-unchanged' : layer.kind === 'baseline' ? 'align-baseline' : 'align-comparison';
        const dashed = layer.kind === 'comparison' && layers.every((l) => l.visible);
        return (
          <g key={layer.kind} className={tone} style={{ opacity: layer.visible ? (layer.kind === 'baseline' && dashed ? 0.85 : 1) : 0 }} aria-hidden>
            <g className="align-rotate" style={{ transform: `rotate(${layer.angle}deg)` }}>
              {plan ? <PlanTire dashed={dashed} /> : <ElevationTire dashed={dashed} />}
            </g>
            <path d={arcPath(layer.angle, plan ? 52 : 108)} strokeWidth="1.4" />
          </g>
        );
      })}
      {drawn.length === 0 && (
        <text x="0" y={plan ? 4 : -50} textAnchor="middle">
          {noDataText}
        </text>
      )}
      <text x={labelX} y={plan ? -14 : -96} textAnchor={anchor} className="align-wheel-label">
        {shortName}
      </text>
      {layers.map((layer, i) =>
        layer.label && layer.visible ? (
          <text
            key={layer.kind}
            x={labelX}
            y={(plan ? 0 : -82) + i * 13}
            textAnchor={anchor}
            className={`align-value ${layer.unchanged ? 'align-unchanged' : layer.kind === 'baseline' ? 'align-baseline' : 'align-comparison'}`}
          >
            {layer.label}
          </text>
        ) : null
      )}
    </g>
  );
}

// From above: the tire's outline, its tread blocks, and its centerline with an arrow at the front
function PlanTire({ dashed }: { dashed: boolean }) {
  return (
    <>
      <rect x="-14" y="-36" width="28" height="72" rx="5" strokeWidth="1.7" strokeDasharray={dashed ? '6 2' : undefined} />
      <rect x="-9" y="-31" width="18" height="62" rx="3" strokeWidth="0.5" opacity="0.6" />
      {[-24, -16, -8, 0, 8, 16, 24].map((v) => (
        <path key={v} d={`M-14 ${v} h5 M9 ${v} h5`} opacity="0.5" strokeWidth="0.7" />
      ))}
      <line x1="0" y1="-58" x2="0" y2="50" strokeWidth="1" />
      <path d="M-3.5 -51 L0 -58 L3.5 -51" strokeWidth="1" />
    </>
  );
}

// From the front or rear: the tire's cross-section standing on its contact patch, its rim and its centerline
function ElevationTire({ dashed }: { dashed: boolean }) {
  return (
    <>
      <rect x="-15" y="-94" width="30" height="94" rx="6" strokeWidth="1.7" strokeDasharray={dashed ? '6 2' : undefined} />
      <rect x="-10" y="-72" width="20" height="50" rx="2" strokeWidth="0.6" opacity="0.65" />
      <line x1="0" y1="-112" x2="0" y2="0" strokeWidth="0.8" />
      {[-86, -9].map((y) => (
        <path key={y} d={`M-15 ${y} h30`} strokeWidth="0.6" opacity="0.5" />
      ))}
    </>
  );
}
