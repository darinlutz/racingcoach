'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useNumbers } from '@/components/TelemetryPanels';

const SWEEP = 120;
const point = (r: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: 100 + r * Math.sin(radians), y: 100 - r * Math.cos(radians) };
};
const arc = (r: number, from: number, to: number) => {
  const [a, b] = [point(r, from), point(r, to)];
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
};

// Two arcs on one scale, min to max: the Target lap's outside, the Compare lap's inside, with their difference the
// largest number in the middle. Values outside the scale stop at its ends; the numbers stay exact.
export default function DualArcGauge({ min, max, target, compare, unit, digits, size = 180, label }: { min: number; max: number; target: number | null; compare: number | null; unit: string; digits: number; size?: number; label: string }) {
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const { num, signed } = useNumbers();
  const span = max - min || 1;
  const angle = (value: number) => -SWEEP + ((Math.max(min, Math.min(max, value)) - min) / span) * SWEEP * 2;
  const delta = target !== null && compare !== null ? Number(compare.toFixed(digits)) - Number(target.toFixed(digits)) : null;
  const ends = [
    { value: min, at: point(84, -SWEEP) },
    { value: max, at: point(84, SWEEP) },
  ];
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} role="img" aria-label={`${label}: ${labels.target} ${num(target, digits)} ${unit}, ${labels.compare} ${num(compare, digits)} ${unit}`} className="shrink-0">
      <path d={arc(80, -SWEEP, SWEEP)} stroke="var(--secondary)" strokeWidth={9} fill="none" strokeLinecap="round" />
      <path d={arc(66, -SWEEP, SWEEP)} stroke="var(--secondary)" strokeWidth={9} fill="none" strokeLinecap="round" />
      {Array.from({ length: 11 }, (_, i) => {
        const at = angle(min + (span * i) / 10);
        const [a, b] = [point(95, at), point(i % 5 === 0 ? 100 : 98, at)];
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted-foreground)" strokeWidth={i % 5 === 0 ? 1.2 : 0.6} />;
      })}
      {ends.map(({ value, at }) => (
        <text key={value} x={at.x} y={at.y + 14} fontSize={8} textAnchor="middle" fill="var(--muted-foreground)" className="tele-num">
          {num(value, digits)}
        </text>
      ))}
      {target !== null && <path d={arc(80, -SWEEP, angle(target))} stroke="var(--lap-target)" strokeWidth={9} fill="none" strokeLinecap="round" />}
      {compare !== null && <path d={arc(66, -SWEEP, angle(compare))} stroke="var(--lap-compare)" strokeWidth={9} fill="none" strokeLinecap="round" />}
      <text x={100} y={88} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)" className="tele-num">
        Δ {unit}
      </text>
      <text x={100} y={114} textAnchor="middle" fontSize={30} fontWeight={700} className="tele-num" fill={delta === null ? 'var(--muted-foreground)' : delta === 0 ? 'var(--foreground)' : delta > 0 ? 'var(--tele-pos)' : 'var(--tele-neg)'}>
        {signed(delta, digits)}
      </text>
      <text x={94} y={134} textAnchor="end" fontSize={11} className="tele-num" fill="var(--lap-target)">
        {labels.targetInitial} {num(target, digits)}
      </text>
      <text x={106} y={134} fontSize={11} className="tele-num" fill="var(--lap-compare)">
        {labels.compareInitial} {num(compare, digits)}
      </text>
    </svg>
  );
}
