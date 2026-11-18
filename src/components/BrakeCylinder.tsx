import { formatBrake, type BrakeValue } from '@/lib/brakesGeometry';

// A master cylinder in cutaway, lying along x from its pushrod (left) to its outlet (right): the bore drawn at `radius`
// (the setups' difference exaggerated, brakesGeometry's boreRadius), the piston and its seals pushed in by the
// pedal application (0-100), the fluid chamber ahead of it and the reservoir on top. Schematic. The Brakes tab
// (BrakeEngineeringView.tsx); `tone` is the setup's stroke class
export default function BrakeCylinder({
  bore,
  radius,
  tone,
  application = 0,
  label = null,
}: {
  bore: BrakeValue | null;
  radius: number;
  tone: string;
  application?: number;
  // The caption under it, or none
  label?: string | null;
}) {
  const shift = application * 0.36;
  return (
    <g className={tone}>
      <path d={`M30 ${-radius - 8} H210 V${radius + 8} H30 Z`} strokeWidth="1.3" className="brake-cyl-body" />
      <path d={`M38 ${-radius} H199 V${radius} H38 Z`} strokeWidth=".6" />
      <path d={`M${111 + shift * 0.5} ${-radius} H195 V${radius} H${111 + shift * 0.5} Z`} className="brake-fluid" />
      <g className="align-rotate" style={{ transform: `translateX(${shift}px)` }}>
        <path d="M-20 0 H88" strokeWidth="4" strokeLinecap="round" />
        <rect x="88" y={-radius + 3} width="18" height={radius * 2 - 6} strokeWidth="2" />
        <path d={`M92 ${-radius + 3} V${radius - 3} M102 ${-radius + 3} V${radius - 3}`} strokeWidth="3" />
        <path d="M108 0 l8 -8 l8 16 l8 -16 l8 16 l8 -16 l8 16 l8 -16 l8 8" strokeWidth="1.2" />
      </g>
      {/* Reservoir and outlet */}
      <path d={`M165 ${-radius - 8} V${-radius - 24} H188 V${-radius - 8} M210 0 H235`} strokeWidth="2" />
      {/* The bore's dimension */}
      <path d={`M240 ${-radius} H252 M240 ${radius} H252 M246 ${-radius} V${radius}`} strokeWidth=".8" />
      <text x="258" y="4" className="align-value">
        {formatBrake(bore)}
      </text>
      {label && (
        <text x="118" y={radius + 28} textAnchor="middle">
          {label.toUpperCase()}
        </text>
      )}
    </g>
  );
}
