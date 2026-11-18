'use client';

import { Cog, Layers3, Pause, Play, Settings2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Caveat, DiagramHeader, Section } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import SetupDashboardView, { type DashboardControls } from '@/components/SetupDashboardView';
import { byRole, formatDash, frictionFaces, preloadShare, toneOf, visibleKinds, type DashboardComparison, type DashboardItem } from '@/lib/setupDashboards';

// The Setups page's Differential & Drivetrain tab (the design came from the Lovable project darinlutz/screenshot-match):
// the powertrain from engine to driven wheels with the torque flowing through it, the limited-slip differential's
// friction stack (one line per friction face), the preload spring squeezing its clutch pack, and the gear stack
export default function DrivetrainDashboard({ comparison, engineer }: { comparison: DashboardComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t } = useLanguage();
  const d = t.setups.dashboards.drivetrain;
  const topic = (i: DashboardItem) =>
    i.role === 'preload' ? d.topics.preload : i.role === 'frictionFaces' ? d.topics.frictionFaces : i.role === 'gearStack' ? d.topics.gearStack : d.topics.other;
  return (
    <SetupDashboardView comparison={comparison} icon={Cog} text={d} topicOf={topic} engineer={engineer} exaggerates={false} hero={() => <Powertrain />}>
      {(c) => (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Section icon={<Layers3 className="size-4" aria-hidden />} title={d.lsd.title}>
              <FrictionStack comparison={comparison} controls={c} />
              <Caveat>{d.lsd.caveat}</Caveat>
            </Section>
            <Section icon={<Settings2 className="size-4" aria-hidden />} title={d.preload.title}>
              <Preload comparison={comparison} controls={c} />
              <Caveat>{d.preload.caveat}</Caveat>
            </Section>
          </div>
          <Section icon={<Cog className="size-4" aria-hidden />} title={d.gears.title}>
            <GearStack comparison={comparison} controls={c} />
            <Caveat>{d.gears.caveat}</Caveat>
          </Section>
        </>
      )}
    </SetupDashboardView>
  );
}

// Engine, gearbox, differential and the driven axle from above, the torque path lit and flowing when played
function Powertrain() {
  const { t } = useLanguage();
  const d = t.setups.dashboards.drivetrain;
  const [flowing, setFlowing] = useState(true);
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <DiagramHeader title={d.schematic.title} badge={d.schematic.torque} />
        <button
          type="button"
          onClick={() => setFlowing(!flowing)}
          aria-label={flowing ? d.schematic.pause : d.schematic.play}
          title={flowing ? d.schematic.pause : d.schematic.play}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-foreground hover:border-primary"
        >
          {flowing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
      </div>
      <svg viewBox="0 0 900 300" className="align-svg h-auto w-full" role="img" aria-label={d.schematic.aria}>
        {/* Engine */}
        <rect x="60" y="100" width="200" height="100" rx="10" className="align-chassis" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={78 + i * 30} y="114" width="20" height="30" rx="3" className="align-structure" />
        ))}
        <circle cx="160" cy="172" r="16" className="align-structure" />
        <text x="160" y="226" textAnchor="middle" className="align-wheel-label">
          {d.schematic.engine.toUpperCase()}
        </text>
        {/* Gearbox */}
        <rect x="320" y="118" width="170" height="64" rx="8" className="align-chassis" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <circle cx={346 + i * 24} cy="138" r={9 - (i % 2) * 2} className="align-structure" />
            <circle cx={346 + i * 24} cy="162" r={6 + (i % 2) * 2} className="align-structure" />
          </g>
        ))}
        <text x="405" y="206" textAnchor="middle" className="align-wheel-label">
          {d.schematic.gearbox.toUpperCase()}
        </text>
        {/* Differential and axle */}
        <circle cx="640" cy="150" r="46" className="align-chassis" />
        <circle cx="640" cy="150" r="30" className="align-structure" />
        <path d="M640 120 V180 M610 150 H670" className="align-structure" />
        <text x="640" y="220" textAnchor="middle" className="align-wheel-label">
          {d.schematic.diff.toUpperCase()}
        </text>
        <path d="M640 104 V40 M640 196 V260" className="align-structure" strokeWidth="6" />
        {[22, 278].map((y) => (
          <rect key={y} x="610" y={y - 22} width="60" height="44" rx="10" className="align-chassis" />
        ))}
        <text x="700" y="44">
          {d.schematic.axle.toUpperCase()}
        </text>
        {/* The torque path */}
        <path d="M260 150 H320 M490 150 H594 M640 104 V44 M640 196 V256" className={`drive-torque ${flowing ? 'drive-torque-flow' : ''}`} />
        <text x="450" y="290" textAnchor="middle">
          {d.schematic.torque.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

// The clutch pack in cutaway, one line per friction face, for each setup
function FrictionStack({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t, fmt } = useLanguage();
  const d = t.setups.dashboards.drivetrain;
  const item = byRole(comparison, 'frictionFaces');
  const kinds = visibleKinds(controls.mode);
  if (!item) return <p className="text-sm text-muted-foreground">{d.lsd.none}</p>;
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <svg viewBox="0 0 520 240" className="align-svg h-auto w-full" role="img" aria-label={d.lsd.aria}>
        {kinds.map((kind, k) => {
          const faces = frictionFaces(comparison, kind) ?? 0;
          const x0 = kinds.length === 1 ? 160 : k ? 290 : 40;
          return (
            <g key={kind} transform={`translate(${x0} 20)`} className={toneOf(item, kind)}>
              <rect x="0" y="20" width="200" height="150" rx="12" className="drive-case" />
              <rect x="70" y="40" width="60" height="110" rx="4" strokeWidth="1" />
              {Array.from({ length: faces }, (_, i) => {
                const x = 74 + (i * 52) / Math.max(1, faces - 1);
                return <path key={i} d={`M${x} 44 V146`} strokeWidth={i % 2 ? 1.2 : 2.4} className="drive-face" />;
              })}
              <path d="M0 95 H70 M130 95 H200" strokeWidth="5" />
              <text x="100" y="196" textAnchor="middle" className="align-value">
                {fmt(d.lsd.faces, { count: formatDash(item[kind]) })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// The preload spring squeezing the clutch pack, relative to the larger preload
function Preload({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const d = t.setups.dashboards.drivetrain;
  const item = byRole(comparison, 'preload');
  const kinds = visibleKinds(controls.mode);
  if (!item) return <p className="text-sm text-muted-foreground">{d.preload.none}</p>;
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <svg viewBox="0 0 520 240" className="align-svg h-auto w-full" role="img" aria-label={d.preload.aria}>
        {kinds.map((kind, k) => {
          const share = preloadShare(comparison, kind) ?? 0;
          const length = 120 - share * 50;
          const coil = Array.from({ length: 11 }, (_, i) => `${i ? 'L' : 'M'} ${(i * length) / 10} ${i % 2 ? -14 : 14}`).join(' ');
          const y = kinds.length === 1 ? 110 : k ? 160 : 60;
          return (
            <g key={kind} transform={`translate(60 ${y})`} className={toneOf(item, kind)}>
              <path d="M-10 -26 V26" strokeWidth="5" />
              <g className="susp-lift">
                <path d={coil} strokeWidth="2.4" strokeLinejoin="round" />
              </g>
              <rect x={length} y="-26" width="16" height="52" rx="2" strokeWidth="2" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <path key={i} d={`M${length + 22 + i * 8} -24 V24`} strokeWidth={i % 2 ? 1 : 2.2} />
              ))}
              <path d={`M${length + 72} -26 V26`} strokeWidth="5" />
              <text x="300" y="5" className="align-value">
                {formatDash(item[kind])}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{d.preload.squeeze}</p>
    </div>
  );
}

function GearStack({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const d = t.setups.dashboards.drivetrain;
  const item = byRole(comparison, 'gearStack');
  if (!item) return <p className="text-sm text-muted-foreground">{d.gears.none}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visibleKinds(controls.mode).map((kind) => (
        <div key={kind} className="flex items-center gap-4 rounded-lg border border-border bg-secondary p-4">
          <Workflow className={`size-8 shrink-0 ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`} aria-hidden />
          <div>
            <div className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison}
            </div>
            <div className="text-xl font-bold text-foreground">{formatDash(item[kind])}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
