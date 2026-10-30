'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { COMPARE_COLOR, TARGET_COLOR } from '@/components/TelemetryChart';
import { useTelemetry } from '@/components/TelemetryCursor';
import { CHART_MARGIN as M } from '@/lib/lapCharts';
import type { CornerPhaseId } from '@/lib/lapEvents';

const HEIGHT = 30;
const MIN_LABEL_WIDTH = 50; // A narrower phase has no room for its name
const PHASE_FILL: Record<CornerPhaseId, string> = {
  braking: 'var(--phase-brake)',
  turnIn: 'var(--phase-turn-in)',
  apex: 'var(--phase-apex)',
  exit: 'var(--phase-exit)',
};

// A strip above the telemetry charts, lined up with their plots: the Target lap's corner phases with the one under
// the crosshair outlined, and triangles at both laps' brakepoints and pickups and the Target lap's apex.
export default function CornerPhaseIndicator({ id, width: outerWidth }: { id: string; width: number }) {
  const width = outerWidth - 2; // The panel's border, as the charts under it take off
  const { t } = useLanguage();
  const labels = t.charts.telemetry;
  const { axis, phases, events, cursorPct, settings } = useTelemetry();
  const plotW = Math.max(10, width - M.left - M.right);
  const [d0, d1] = axis.domain;
  const x = (pct: number) => M.left + ((pct - d0) / (d1 - d0)) * plotW;
  const markers = [
    { pct: events.target.brakePoint, color: TARGET_COLOR },
    { pct: events.compare.brakePoint, color: COMPARE_COLOR },
    { pct: events.target.throttlePickup, color: TARGET_COLOR },
    { pct: events.compare.throttlePickup, color: COMPARE_COLOR },
    { pct: events.target.apex?.pct ?? null, color: 'var(--foreground)' },
  ].filter((m): m is { pct: number; color: string } => m.pct !== null);

  return (
    <div className="rounded-md border border-border bg-card">
      <svg width={width} height={HEIGHT} className="block" role="img" aria-label={labels.phase}>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={M.left} y={0} width={plotW} height={HEIGHT} />
          </clipPath>
        </defs>
        <text x={8} y={19} fontSize={9} className="font-display" letterSpacing="0.12em" fill="var(--muted-foreground)">
          {labels.phase.toUpperCase()}
        </text>
        {phases.length === 0 && (
          <text x={M.left + 6} y={19} fontSize={10} fill="var(--muted-foreground)">
            {labels.phasesNone}
          </text>
        )}
        <g clipPath={`url(#${id}-clip)`}>
          {phases.map(({ id: phase, start, end }) => {
            const [x1, x2] = [x(start), x(end)];
            const active = cursorPct !== null && cursorPct >= start && cursorPct < end;
            return (
              <g key={phase}>
                <rect x={x1} y={5} width={Math.max(0, x2 - x1)} height={20} fill={PHASE_FILL[phase]} stroke={active ? 'var(--foreground)' : 'none'} strokeOpacity={0.5} />
                {x2 - x1 > MIN_LABEL_WIDTH && (
                  <text x={(x1 + x2) / 2} y={19} textAnchor="middle" fontSize={9.5} className="font-display" fontWeight={600} letterSpacing="0.12em" fill={active ? 'var(--foreground)' : 'var(--muted-foreground)'}>
                    {labels.phaseNames[phase].toUpperCase()}
                  </text>
                )}
              </g>
            );
          })}
          {settings.showEvents && markers.map(({ pct, color }, i) => <polygon key={i} points={`${x(pct) - 4},0 ${x(pct) + 4},0 ${x(pct)},6`} fill={color} />)}
          {settings.showCursor && cursorPct !== null && <line x1={x(cursorPct)} x2={x(cursorPct)} y1={0} y2={HEIGHT} stroke="var(--foreground)" opacity={0.7} />}
        </g>
      </svg>
    </div>
  );
}
