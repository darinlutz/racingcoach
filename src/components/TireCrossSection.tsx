// One tire in cross-section, centered on the rim: tread and carcass, sidewalls bulging by a conceptual `deflection`
// (tiresGeometry's conceptualDeflection, never a stiffness model), the rim, beads, the air chamber's pressure arrows,
// and grooves on a wet tire. `labels` names the parts; none for a small copy. The Tires tab (TireEngineeringView.tsx)
export default function TireCrossSection({
  deflection,
  tone,
  wet = false,
  labels = null,
}: {
  deflection: number;
  tone: string;
  wet?: boolean;
  labels?: { tread: string; sidewall: string; bead: string; air: string; rim: string } | null;
}) {
  const d = deflection;
  return (
    <g className={tone}>
      <path
        d={`M-105 73 C-130 ${25 + d} -128 -53 -101 -88 Q0 -110 101 -88 C128 -53 130 ${25 + d} 105 73 L65 73 L60 31 L75 -48 Q0 -64 -75 -48 L-60 31 L-65 73 Z`}
        className="tire-rubber"
      />
      <path
        d="M-101 67 C-119 21 -117 -50 -96 -78 Q0 -99 96 -78 C117 -50 119 21 101 67 M-90 62 C-106 10 -109 -39 -87 -69 Q0 -88 87 -69 C109 -39 106 10 90 62"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <path d="M-63 68 V35 L-76 -43 H-55 V-28 H55 V-43 H76 L63 35 V68 H49 V44 H-49 V68 Z" className="tire-rim" />
      <path d="M-48 43 V-12 H48 V43 M-42 13 H42 M-35 -6 L-35 36 M35 -6 V36" className="align-structure" />
      <path d="M-63 58 H-85 M63 58 H85" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M-24 -74 V-47 M-28 -55 L-24 -47 L-20 -55 M24 -74 V-47 M20 -55 L24 -47 L28 -55 M-93 -17 L-78 -17 M-86 -21 L-78 -17 L-86 -13 M93 -17 L78 -17 M86 -21 L78 -17 L86 -13"
        className="tire-arrows"
      />
      {wet && [-76, -38, 0, 38, 76].map((x) => <path key={x} d={`M${x - 3} -91 l3 13 3 -13`} strokeWidth="1.5" />)}
      <path d="M0 -121 V83" className="align-reference" />
      <path d="M-146 75 H146" className="align-structure" strokeWidth="1.6" />
      {labels && (
        <>
          <path d="M-102 -80 L-143 -103 H-167 M104 13 L141 0 H167 M60 53 L137 51 H167" className="align-structure" />
          <text x="-166" y="-110">
            {labels.tread.toUpperCase()}
          </text>
          <text x="125" y="-7">
            {labels.sidewall.toUpperCase()}
          </text>
          <text x="137" y="44">
            {labels.bead.toUpperCase()}
          </text>
          <text x="0" y="-15" textAnchor="middle" className="align-value">
            {labels.air.toUpperCase()}
          </text>
          <text x="0" y="31" textAnchor="middle">
            {labels.rim.toUpperCase()}
          </text>
        </>
      )}
    </g>
  );
}
