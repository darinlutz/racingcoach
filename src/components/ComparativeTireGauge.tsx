'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { formatTireTemp } from '@/lib/tireTempComparison';

const START = -125;
const END = 125;
// The gauge's range (°C); a reading outside it stays at the end of the arc
const MIN = 50;
const MAX = 130;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

// Two arcs: the outer ring is the Compare lap, the inner ring the Target lap, with the band between their needles
// showing the gap. A lap with no reading leaves its ring empty
export default function ComparativeTireGauge({ target, compare }: { target: number | null; compare: number | null }) {
  const { t, locale } = useLanguage();
  const labels = t.charts.tireDash;
  const units = useUnits();
  const angle = (value: number) => START + ((Math.max(MIN, Math.min(MAX, value)) - MIN) / (MAX - MIN)) * (END - START);
  const [cx, cy] = [75, 72];
  const ticks = Array.from({ length: 9 }, (_, i) => MIN + ((MAX - MIN) / 8) * i);
  const needles = [
    { key: 'compare', value: compare, color: 'var(--lap-compare)', ring: 60, tip: 62 },
    { key: 'target', value: target, color: 'var(--lap-target)', ring: 49, tip: 46 },
  ];
  const gap = target !== null && compare !== null ? [angle(target), angle(compare)].sort((a, b) => a - b) : null;
  const reading = (value: number | null) => (value === null ? labels.na : formatTireTemp(value, units, locale, 0));

  return (
    <svg viewBox="0 0 150 125" width={140} height={(140 * 125) / 150} aria-hidden>
      <path d={arc(cx, cy, 60, START, END)} stroke="var(--border)" strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d={arc(cx, cy, 49, START, END)} stroke="var(--border)" strokeWidth={6} fill="none" strokeLinecap="round" />
      {gap && gap[1] - gap[0] > 0.5 && (
        <path d={arc(cx, cy, 54.5, gap[0], gap[1])} stroke="var(--foreground)" strokeOpacity={0.15} strokeWidth={17} fill="none" />
      )}
      {needles.map(({ key, value, color, ring }) =>
        value === null ? null : <path key={key} d={arc(cx, cy, ring, START, angle(value))} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" />
      )}
      {ticks.map((tick, i) => {
        const [x0, y0] = polar(cx, cy, 68, angle(tick));
        const [x1, y1] = polar(cx, cy, i % 2 ? 66 : 64, angle(tick));
        return <line key={tick} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--muted-foreground)" strokeWidth={1} />;
      })}
      {needles.map(({ key, value, color, tip }) => {
        if (value === null) return null;
        const [x, y] = polar(cx, cy, tip, angle(value));
        return <line key={key} x1={cx} y1={cy} x2={x} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" />;
      })}
      <circle cx={cx} cy={cy} r={4} fill="var(--foreground)" />
      <text x={cx - 30} y={cy + 30} textAnchor="middle" fontSize={8} fill="var(--muted-foreground)" fontFamily="var(--font-display)" letterSpacing="0.1em">{labels.tgt}</text>
      <text x={cx - 30} y={cy + 42} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--lap-target)" className="tabular-nums">{reading(target)}</text>
      <text x={cx + 30} y={cy + 30} textAnchor="middle" fontSize={8} fill="var(--muted-foreground)" fontFamily="var(--font-display)" letterSpacing="0.1em">{labels.cmp}</text>
      <text x={cx + 30} y={cy + 42} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--lap-compare)" className="tabular-nums">{reading(compare)}</text>
    </svg>
  );
}
