'use client';

import type { Scales } from '@/components/TelemetryChart';

export type EventMarker = {
  pct: number | null; // lap position; null when the lap doesn't have the event, and it isn't drawn
  label: string;
  color: string;
  dashed?: boolean;
};

const LABEL_ROOM = 90; // Closer than this to the plot's right edge, a label goes on the marker's left

// Vertical lines with labels on a telemetry chart, in two rows so neighbours don't collide
export default function TelemetryEventMarkers({ s, markers, visible }: { s: Scales; markers: EventMarker[]; visible: boolean }) {
  if (!visible) return null;
  const shown = markers
    .filter((m): m is EventMarker & { pct: number } => m.pct !== null && s.inView(m.pct))
    .sort((a, b) => a.pct - b.pct);
  return (
    <g pointerEvents="none">
      {shown.map((m, i) => {
        const x = s.x(m.pct);
        const onLeft = x > s.plotRight - LABEL_ROOM;
        return (
          <g key={m.label + m.pct}>
            <line x1={x} x2={x} y1={s.plotTop} y2={s.plotBottom} stroke={m.color} strokeWidth={1} strokeDasharray={m.dashed ? '4 3' : undefined} opacity={0.9} />
            <text x={onLeft ? x - 4 : x + 4} y={s.plotTop + 10 + (i % 2) * 11} textAnchor={onLeft ? 'end' : 'start'} fontSize={9} className="font-display" letterSpacing="0.08em" fill={m.color}>
              {m.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// A horizontal bracket between two lap positions with its size beside it, kept inside the plot
export function MeasurementBracket({ s, from, to, y, label }: { s: Scales; from: number; to: number; y: number; label: string }) {
  const x1 = s.x(Math.min(from, to));
  const x2 = s.x(Math.max(from, to));
  if (x2 < s.plotLeft || x1 > s.plotRight) return null;
  const labelWidth = label.length * 5.6 + 10;
  const labelX = x2 + 4 + labelWidth > s.plotRight ? Math.max(s.plotLeft, x1 - 4 - labelWidth) : x2 + 4;
  return (
    <g pointerEvents="none">
      <line x1={x1} x2={x2} y1={y} y2={y} stroke="var(--foreground)" strokeWidth={1} />
      <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke="var(--foreground)" />
      <line x1={x2} x2={x2} y1={y - 4} y2={y + 4} stroke="var(--foreground)" />
      <rect x={labelX} y={y - 8} width={labelWidth} height={15} rx={2} fill="var(--secondary)" stroke="var(--border)" />
      <text x={labelX + 5} y={y + 3} fontSize={9.5} className="tele-num" fill="var(--foreground)">
        {label}
      </text>
    </g>
  );
}
