'use client';

import { ListTree, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Caveat, Slider } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import SetupDashboardView, { type DashboardControls } from '@/components/SetupDashboardView';
import { byRole, formatDash, illustrativeThrottle, numberOf, toneOf, visibleKinds, type DashboardComparison, type DashboardItem } from '@/lib/setupDashboards';

// The Setups page's Other tab (the design came from the Lovable project darinlutz/screenshot-match): a throttle
// shape setting as illustrative pedal-to-command curves (the car's map isn't in the setup), and everything else the
// setup has that no other tab takes
export default function OtherDashboard({ comparison, engineer }: { comparison: DashboardComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t } = useLanguage();
  const o = t.setups.dashboards.other;
  const throttle = byRole(comparison, 'throttleShape');
  const topic = (i: DashboardItem) => (i.role === 'throttleShape' ? o.topics.throttleShape : o.topics.other);
  if (!comparison.items.length) {
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 font-mono text-base font-bold uppercase tracking-widest text-foreground">
          <ListTree className="size-5 text-align-baseline" aria-hidden />
          {o.title}
        </h3>
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{o.list.none}</p>
      </div>
    );
  }
  return (
    <SetupDashboardView
      comparison={comparison}
      icon={ListTree}
      text={o}
      topicOf={topic}
      engineer={engineer}
      exaggerates={false}
      hero={(c) => (throttle ? <Throttle item={throttle} controls={c} /> : <p className="py-4 text-center text-sm text-muted-foreground">{o.list.title}</p>)}
    />
  );
}

// Pedal against command for each setup's throttle shape, with a pedal slider moving a marker along both curves
function Throttle({ item, controls }: { item: DashboardItem; controls: DashboardControls }) {
  const { t, fmt } = useLanguage();
  const o = t.setups.dashboards.other;
  const [pedal, setPedal] = useState(50);
  const kinds = visibleKinds(controls.mode);
  const x = (p: number) => 60 + p * 4.4;
  const y = (c: number) => 250 - c * 2.1;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <div className="mb-1 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
          <SlidersHorizontal className="size-3.5" aria-hidden />
          {o.throttle.title}
        </div>
        <svg viewBox="0 0 540 290" className="align-svg h-auto w-full" role="img" aria-label={o.throttle.aria}>
          <path d="M60 250 H500 M60 40 V250" className="align-structure" />
          <path d={`M${x(0)} ${y(0)} L${x(100)} ${y(100)}`} className="align-reference" />
          {[25, 50, 75, 100].map((p) => (
            <text key={p} x={x(p)} y="268" textAnchor="middle">
              {p}
            </text>
          ))}
          <text x="280" y="286" textAnchor="middle">
            {o.throttle.pedal.toUpperCase()}
          </text>
          <text x="20" y="34">
            {o.throttle.command.toUpperCase()}
          </text>
          <path d={`M${x(pedal)} 250 V40`} className="align-reference" />
          {kinds.map((kind) => {
            const setting = numberOf(item, kind, [null, 'THR']);
            const pts = Array.from({ length: 41 }, (_, i) => i * 2.5).map((p) => `${x(p)} ${y(illustrativeThrottle(p, setting))}`);
            const c = illustrativeThrottle(pedal, setting);
            return (
              <g key={kind} className={toneOf(item, kind)}>
                <path d={`M${pts.join(' L')}`} strokeWidth="2.5" strokeDasharray={kind === 'comparison' ? '7 4' : undefined} />
                <circle cx={x(pedal)} cy={y(c)} r="5" className="tire-valve" />
                <text x={x(pedal) + 8} y={y(c) - 8} className="align-value">
                  {c.toFixed(0)}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
        <Slider id="throttle-pedal" label={o.throttle.pedal} min={0} max={100} step={1} value={pedal} onChange={setPedal} output={`${pedal}%`} />
        {kinds.map((kind) => (
          <div key={kind} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
            <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison}
            </span>
            <strong className="font-mono text-base text-foreground">{fmt(o.throttle.setting, { value: formatDash(item[kind]) })}</strong>
          </div>
        ))}
        <Caveat>{o.throttle.caveat}</Caveat>
      </div>
    </div>
  );
}
