// A coil spring with its seats and the damper body through it, drawn standing up from its top seat (y = 0) down to
// `length`: the Suspension tab's drawings (SuspensionEngineeringView.tsx). Schematic: the coil's size and number of turns
// say nothing about the real spring. `tone` is the setup's stroke class (align-baseline, align-comparison, align-unchanged)
export default function SuspensionSpring({ length = 100, tone, x = 0, y = 0 }: { length?: number; tone: string; x?: number; y?: number }) {
  const turns = 12;
  const coil = Array.from({ length: turns + 1 }, (_, i) => `${i === 0 ? 'M' : 'L'} ${i % 2 === 0 ? -13 : 13} ${(12 + (i * (length - 24)) / turns).toFixed(2)}`).join(' ');
  return (
    <g transform={`translate(${x} ${y})`} className={`${tone} susp-spring`}>
      <path d={`M0 -12 V${length + 12}`} strokeWidth="3" opacity=".55" />
      <path d={`M-20 0 H20 M-20 ${length} H20`} strokeWidth="5" strokeLinecap="round" />
      <path d={coil} strokeWidth="3" strokeLinejoin="round" />
      <rect x="-8" y={length * 0.55} width="16" height={length * 0.4} rx="2" strokeWidth="1" />
      <circle cy="-17" r="5" strokeWidth="1.5" />
      <circle cy={length + 17} r="5" strokeWidth="1.5" />
    </g>
  );
}
