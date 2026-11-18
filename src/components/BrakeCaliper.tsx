// A ventilated disc and its caliper, centered on the hub: the disc's vanes and bolts (turning while braking, unless
// small), the caliper body with three pistons and the pad, pressed against the disc by the application (0-100), and
// with `thermal` the disc glowing as it brakes. Schematic. The Brakes tab (BrakeEngineeringView.tsx); `tone` is the
// setup's stroke class, or a circuit's (brake-circuit-front, brake-circuit-rear)
export default function BrakeCaliper({
  application,
  tone,
  thermal = false,
  small = false,
}: {
  application: number;
  tone: string;
  thermal?: boolean;
  small?: boolean;
}) {
  const close = (application / 100) * 9;
  return (
    <g className={tone}>
      <g className={application > 0 && !small ? 'brake-disc-turn' : undefined}>
        <circle r="69" strokeWidth="1.5" className={thermal && application > 0 ? 'brake-disc-hot' : undefined} />
        <circle r="55" strokeWidth=".6" />
        <circle r="22" strokeWidth="1.5" />
        {Array.from({ length: 24 }, (_, i) => (
          <path key={i} transform={`rotate(${i * 15})`} d="M26 0 L62 11 M43 3 L53 10" strokeWidth=".8" opacity=".65" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <circle key={i} transform={`rotate(${i * 72})`} cx="14" r="3" />
        ))}
      </g>
      <path d="M29 -60 H75 L84 -45 V44 L74 58 H28 L36 38 V-39 Z" strokeWidth="2" className="brake-caliper-body" />
      {[-33, 0, 33].map((y) => (
        <g key={y} className="brake-piston" style={{ transform: `translateX(${-close}px)` }}>
          <rect x="43" y={y - 9} width="24" height="18" rx="4" strokeWidth="1.3" />
          <path d={`M40 ${y - 10} V${y + 10}`} strokeWidth="3" />
        </g>
      ))}
      <path d="M32 -44 V44" strokeWidth={application > 0 ? 5 : 3} className="brake-piston" style={{ transform: `translateX(${-close}px)` }} />
      {!small && <path d="M-58 -70 Q-85 -30 -70 4 M-70 4 L-78 -3 M-70 4 L-65 -5" strokeWidth="1" />}
      {application > 0 && !small && <path d="M-49 67 Q-6 85 37 65 M37 65 L28 65 M37 65 L33 74" strokeWidth="2" />}
    </g>
  );
}
