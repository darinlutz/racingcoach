'use client';

import { ArrowDownToLine, Gauge, MoveVertical, Plane, Wind } from 'lucide-react';
import { EngineeringCarLayer } from '@/components/EngineeringCarView';
import { Caveat, DiagramHeader, Section } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import type { CarFit } from '@/lib/carViews/anchors';
import SetupDashboardView, { type DashboardControls } from '@/components/SetupDashboardView';
import {
  aeroBalance,
  byRole,
  formatDash,
  heightAtSpeedDifference,
  numberOf,
  toneOf,
  visibleKinds,
  wingDrawAngle,
  type DashboardComparison,
  type DashboardItem,
  type Which,
} from '@/lib/setupDashboards';

// An inverted airfoil (downforce side down), chord along x, centered: the rear wing's element
const AIRFOIL = 'M-80 0 C-72 4 -40 8 0 7 C40 6 68 3 80 0 C62 -8 30 -16 -10 -17 C-44 -17 -70 -10 -80 0 Z';
const LENGTH_UNITS = ['mm', 'in'];

// The Setups page's Aerodynamics tab (the design came from the Lovable project darinlutz/screenshot-match): the car from
// the side with its rear wing turned to each setup's angle, the splitter at its clearance and iRacing's ride heights
// at speed, air flowing over it; then the wing's airfoil, the aero balance, the heights at speed and the splitter
export default function AeroDashboard({ comparison, engineer }: { comparison: DashboardComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t } = useLanguage();
  const a = t.setups.dashboards.aero;
  const topic = (i: DashboardItem) => (i.role === 'wingAngle' ? a.topics.wingAngle : i.role === 'splitter' ? a.topics.splitter : a.topics.other);
  return (
    <SetupDashboardView comparison={comparison} icon={Plane} text={a} topicOf={topic} engineer={engineer} hero={(c) => <AeroCar comparison={comparison} controls={c} />}>
      {(c) => (
        <>
          <Section icon={<Wind className="size-4" aria-hidden />} title={a.wing.title}>
            <Wing comparison={comparison} controls={c} />
            <Caveat>{a.wing.caveat}</Caveat>
          </Section>
          <div className="grid gap-6 xl:grid-cols-2">
            <Section icon={<Gauge className="size-4" aria-hidden />} title={a.balance.title}>
              <Balance comparison={comparison} controls={c} />
              <Caveat>{a.balance.caveat}</Caveat>
            </Section>
            <Section icon={<MoveVertical className="size-4" aria-hidden />} title={a.height.title}>
              <Heights comparison={comparison} controls={c} />
              <Caveat>{a.height.caveat}</Caveat>
            </Section>
          </div>
          <Section icon={<ArrowDownToLine className="size-4" aria-hidden />} title={a.splitter.title}>
            <Splitter comparison={comparison} controls={c} />
            <Caveat>{a.splitter.caveat}</Caveat>
          </Section>
        </>
      )}
    </SetupDashboardView>
  );
}

const label = (t: ReturnType<typeof useLanguage>['t'], kind: Which) => (kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison);

// Where the hero stands the car: across the drawing, on its ground line
const FIT: CarFit = { kind: 'ground', x: 40, width: 820, groundY: 292, maxHeight: 210 };

// The car from the side, nose left: body, wheels, the splitter, the rear wing per setup, the heights at speed and air
function AeroCar({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const a = t.setups.dashboards.aero;
  const wing = byRole(comparison, 'wingAngle');
  const splitter = byRole(comparison, 'splitter');
  const front = byRole(comparison, 'frontRhSpeed');
  const rear = byRole(comparison, 'rearRhSpeed');
  const kinds = visibleKinds(controls.mode);
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <DiagramHeader title={a.hero} badge={a.labels.flow} />
      <svg viewBox="0 0 900 340" className="align-svg h-auto w-full" role="img" aria-label={a.heroAria}>
        {/* Streamlines over the car */}
        {[70, 92, 114].map((y, i) => (
          <path key={y} d={`M10 ${y + 40} C200 ${y + 30} 330 ${y - 30} 520 ${y - 26} S800 ${y + 6} 890 ${y + 2}`} className="aero-stream" style={{ animationDelay: `${i * -0.6}s` }} />
        ))}
        <path d="M30 292 H870" className="align-structure" strokeWidth="1.6" />
        {Array.from({ length: 70 }, (_, i) => (
          <path key={i} d={`M${36 + i * 12} 292 l-7 8`} className="align-structure" opacity=".35" />
        ))}
        {/* The compared setups' car from its left side, nose left, standing on the ground (EngineeringCarView.tsx). Its
            own aero parts are hidden: the wing is drawn here at each setup's angle and the splitter at its clearance */}
        <EngineeringCarLayer view="left-side" fit={FIT} showAero={false}>
          {(car) => {
            const [wx, wy] = car.part('wing') ?? [790, 110];
            const [dx, dy] = car.part('diffuser') ?? [800, 241];
            const sx = car.part('splitter')?.[0] ?? 66;
            const frontX = (car.wheel('LF')?.[0] ?? 208) - 58;
            const rearX = (car.wheel('LR')?.[0] ?? 708) + 62;
            return (
              <>
        {/* Diffuser */}
        <path d={`M${dx - 40} ${dy + 9} L${dx + 40} ${dy - 9}`} className="align-structure" strokeWidth="2" />
        <text x={dx + 42} y={dy - 15} textAnchor="end">
          {a.labels.diffuser.toUpperCase()}
        </text>
        {/* Wing mount and the wing per setup */}
        <path d={`M${wx - 42} ${wy + 72} L${wx - 20} ${wy + 10} M${wx + 2} ${wy + 76} L${wx + 16} ${wy + 10}`} className="align-structure" strokeWidth="2" />
        {kinds.map((kind) => {
          const deg = numberOf(wing, kind, ['degrees', 'deg', '°', null]);
          return (
            <g key={kind} transform={`translate(${wx} ${wy})`}>
              <g className={`align-rotate ${toneOf(wing, kind)}`} style={{ transform: `rotate(${-wingDrawAngle(deg, controls.exaggeration)}deg)` }}>
                <path d={AIRFOIL} transform="scale(.62)" strokeWidth="2" className="aero-foil" strokeDasharray={kind === 'comparison' ? '6 3' : undefined} />
              </g>
            </g>
          );
        })}
        <text x={wx} y={wy - 40} textAnchor="middle" className="align-wheel-label">
          {a.labels.wing.toUpperCase()}
        </text>
        {/* Splitter at its clearance, exaggerated about 50 mm */}
        {kinds.map((kind) => {
          const h = numberOf(splitter, kind, LENGTH_UNITS);
          const y = 292 - Math.max(4, Math.min(60, (h ?? 50) * (splitter?.[kind]?.unit === 'in' ? 25.4 : 1) * 0.3 + ((h ?? 50) - 50) * controls.exaggeration * 0.2));
          return (
            <g key={kind} className={toneOf(splitter, kind)}>
              <path d={`M${sx - 22} ${y} H${sx + 84}`} strokeWidth="3" strokeLinecap="round" strokeDasharray={kind === 'comparison' ? '6 3' : undefined} />
              {h != null && (
                <text x={sx - 26} y={y - 6} textAnchor="end" className="align-value">
                  {formatDash(splitter![kind])}
                </text>
              )}
            </g>
          );
        })}
        <text x={sx + 30} y="318" textAnchor="middle">
          {a.labels.splitter.toUpperCase()}
        </text>
        {/* Heights at speed: arrows from the ground ahead of the front wheels and behind the rear */}
        {(
          [
            [front, frontX],
            [rear, rearX],
          ] as const
        ).map(([item, x]) =>
          kinds.map((kind, j) => {
            const v = item?.[kind];
            if (!v || v.value == null) return null;
            const px = Math.max(6, Math.min(80, v.value * (v.unit === 'in' ? 25.4 : 1) * 0.8));
            const xx = x + j * 14;
            return (
              <g key={`${x}-${kind}`} className={toneOf(item, kind)}>
                <path d={`M${xx} 292 V${292 - px} m-4 6 l4 -6 l4 6`} strokeWidth="1.6" />
                <text x={xx + (x < 400 ? -8 : 8)} y={292 - px - 6} textAnchor={x < 400 ? 'end' : 'start'} className="align-value">
                  {formatDash(v)}
                </text>
              </g>
            );
          })
        )}
              </>
            );
          }}
        </EngineeringCarLayer>
        <text x="450" y="318" textAnchor="middle">
          {a.labels.ground.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

function Wing({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const a = t.setups.dashboards.aero;
  const wing = byRole(comparison, 'wingAngle');
  const setting = byRole(comparison, 'wingSetting');
  const kinds = visibleKinds(controls.mode);
  if (!wing) return <p className="text-sm text-muted-foreground">{a.wing.none}</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <svg viewBox="0 0 600 260" className="align-svg h-auto w-full" role="img" aria-label={a.wing.aria}>
          <path d="M60 130 H540" className="align-reference" />
          <path d="M300 30 V230" className="align-reference" />
          {kinds.map((kind) => {
            const deg = numberOf(wing, kind, ['degrees', 'deg', '°', null]);
            const drawn = wingDrawAngle(deg, controls.exaggeration);
            return (
              <g key={kind} transform="translate(300 130)">
                <g className={`align-rotate ${toneOf(wing, kind)}`} style={{ transform: `rotate(${-drawn}deg)` }}>
                  <path d={AIRFOIL} transform="scale(2.6)" strokeWidth="1" className="aero-foil" strokeDasharray={kind === 'comparison' ? '6 3' : undefined} />
                  <path d="M-220 0 H220" strokeWidth=".6" strokeDasharray="2 4" />
                </g>
                <text x={kind === 'baseline' ? -250 : 250} y={kind === 'baseline' ? -70 : 90} textAnchor={kind === 'baseline' ? 'start' : 'end'} className={`align-value ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
                  {label(t, kind).toUpperCase()} · {formatDash(wing[kind])}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-secondary p-4">
        <Stat label={a.wing.angle} item={wing} />
        {setting && <Stat label={a.wing.setting} item={setting} />}
      </div>
    </div>
  );
}

function Stat({ label: name, item }: { label: string; item: DashboardItem }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{name}</div>
      <div className="mt-1 flex items-baseline gap-2 font-mono text-lg tabular-nums">
        <span className={item.status === 'same' ? 'text-align-neutral' : 'text-align-baseline'}>{formatDash(item.baseline)}</span>
        <span className="text-sm text-muted-foreground">→</span>
        <span className={item.status === 'same' ? 'text-align-neutral' : 'text-align-comparison'}>{formatDash(item.comparison)}</span>
        {item.delta && item.status === 'changed' && <span className="ml-auto text-sm font-semibold text-foreground">{formatDash(item.delta, true)}</span>}
      </div>
    </div>
  );
}

function Balance({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t, fmt } = useLanguage();
  const a = t.setups.dashboards.aero;
  const kinds = visibleKinds(controls.mode);
  if (!kinds.some((k) => aeroBalance(comparison, k))) return <p className="text-sm text-muted-foreground">{a.balance.none}</p>;
  return (
    <div className="space-y-4">
      {kinds.map((kind) => {
        const b = aeroBalance(comparison, kind);
        if (!b) return null;
        const name = label(t, kind);
        return (
          <div key={kind}>
            <div className={`mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>{name}</div>
            <div className="relative h-8 overflow-hidden rounded-md bg-secondary" role="img" aria-label={fmt(a.balance.aria, { kind: name, front: b.front.toFixed(b.decimals), rear: b.rear.toFixed(b.decimals) })}>
              <div className={`susp-bar absolute inset-y-0 left-0 ${kind === 'baseline' ? 'bg-align-baseline/80' : 'bg-align-comparison/80'}`} style={{ width: `${b.front}%` }} />
              <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" aria-hidden />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>{fmt(a.balance.front, { value: b.front.toFixed(b.decimals) })}</span>
              <span>{fmt(a.balance.rear, { value: b.rear.toFixed(b.decimals) })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Heights({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const a = t.setups.dashboards.aero;
  const front = byRole(comparison, 'frontRhSpeed');
  const rear = byRole(comparison, 'rearRhSpeed');
  if (!front && !rear) return <p className="text-sm text-muted-foreground">{a.height.none}</p>;
  return (
    <div className="space-y-2">
      {front && <Stat label={a.height.front} item={front} />}
      {rear && <Stat label={a.height.rear} item={rear} />}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border bg-secondary px-3 py-2 text-xs">
        <span className="text-muted-foreground">{a.height.difference}</span>
        {visibleKinds(controls.mode).map((kind) => (
          <strong key={kind} className={`font-mono tabular-nums ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
            {formatDash(heightAtSpeedDifference(comparison, kind), true)}
          </strong>
        ))}
      </div>
    </div>
  );
}

function Splitter({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const a = t.setups.dashboards.aero;
  const splitter = byRole(comparison, 'splitter');
  if (!splitter) return <p className="text-sm text-muted-foreground">{a.splitter.none}</p>;
  const kinds = visibleKinds(controls.mode);
  const values = kinds.map((k) => numberOf(splitter, k, LENGTH_UNITS) ?? 0);
  const max = Math.max(...values, 1);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <svg viewBox="0 0 600 200" className="align-svg h-auto w-full" role="img" aria-label={a.splitter.aria}>
          <path d="M40 170 H560" className="align-structure" strokeWidth="1.6" />
          <path d="M120 40 Q200 30 300 60 L480 60 L480 100 L120 100 Z" className="align-chassis" />
          {kinds.map((kind, i) => {
            const v = values[i];
            const y = 170 - (v / max) * 100 - (v - max) * controls.exaggeration * 0.4;
            const yy = Math.max(30, Math.min(166, y));
            return (
              <g key={kind} className={toneOf(splitter, kind)}>
                <path d={`M100 ${yy} H420`} strokeWidth="4" strokeLinecap="round" strokeDasharray={kind === 'comparison' ? '8 4' : undefined} />
                <path d={`M${450 + i * 40} 170 V${yy} m-4 6 l4 -6 l4 6`} strokeWidth="1.4" />
                <text x={460 + i * 40} y={(yy + 170) / 2} className="align-value">
                  {formatDash(splitter[kind])}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-secondary p-4">
        <Stat label={a.splitter.title} item={splitter} />
      </div>
    </div>
  );
}
