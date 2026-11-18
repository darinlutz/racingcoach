'use client';

import { Calculator, Fuel, Weight } from 'lucide-react';
import { useState } from 'react';
import { Caveat, DiagramHeader, Section } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import SetupDashboardView, { type DashboardControls } from '@/components/SetupDashboardView';
import { byRole, formatDash, fuelLitres, fuelMassKg, fuelPlan, lapsForDuration, visibleKinds, type DashboardComparison, type DashboardItem, type Which } from '@/lib/setupDashboards';

const num = (text: string) => (text.trim() === '' ? NaN : Number(text.replace(',', '.')));

// The Setups page's Fuel tab (the design came from the Lovable project darinlutz/screenshot-match): each setup's fuel
// cell filled against the larger load (the tank's size isn't in the setup), the fuel's mass at a density the driver
// types, and a race estimate from the driver's own laps, consumption and reserve. Nothing here changes a setup
export default function FuelDashboard({ comparison, engineer }: { comparison: DashboardComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t } = useLanguage();
  const f = t.setups.dashboards.fuel;
  const topic = (i: DashboardItem) => (i.role === 'fuelLevel' ? f.topics.fuelLevel : f.topics.other);
  return (
    <SetupDashboardView comparison={comparison} icon={Fuel} text={f} topicOf={topic} engineer={engineer} exaggerates={false} hero={(c) => <Cells comparison={comparison} controls={c} />}>
      {(c) => (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Section icon={<Weight className="size-4" aria-hidden />} title={f.mass.title}>
            <Mass comparison={comparison} controls={c} />
          </Section>
          <Section icon={<Calculator className="size-4" aria-hidden />} title={f.plan.title}>
            <Plan comparison={comparison} controls={c} />
          </Section>
        </div>
      )}
    </SetupDashboardView>
  );
}

const name = (t: ReturnType<typeof useLanguage>['t'], kind: Which) => (kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison);

function Cells({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const f = t.setups.dashboards.fuel;
  const item = byRole(comparison, 'fuelLevel');
  const kinds = visibleKinds(controls.mode);
  if (!item) return <p className="text-sm text-muted-foreground">{f.cell.none}</p>;
  const max = Math.max(fuelLitres(comparison, 'baseline') ?? 0, fuelLitres(comparison, 'comparison') ?? 0, 1);
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <DiagramHeader title={f.cell.title} badge={f.cell.relative} />
      <svg viewBox="0 0 700 300" className="align-svg h-auto w-full" role="img" aria-label={f.cell.aria}>
        {kinds.map((kind, i) => {
          const litres = fuelLitres(comparison, kind) ?? 0;
          const share = litres / max;
          const x = kinds.length === 1 ? 250 : i ? 400 : 100;
          const h = 200 * share;
          return (
            <g key={kind} transform={`translate(${x} 40)`}>
              <rect x="0" y="0" width="200" height="200" rx="18" className="align-chassis" />
              <clipPath id={`fuel-clip-${kind}`}>
                <rect x="4" y="4" width="192" height="192" rx="15" />
              </clipPath>
              <g clipPath={`url(#fuel-clip-${kind})`}>
                <rect x="0" y={200 - h} width="200" height={h} className={`fuel-liquid ${kind === 'baseline' ? 'fuel-baseline' : 'fuel-comparison'}`} />
                <path d={`M0 ${200 - h} q25 -8 50 0 t50 0 t50 0 t50 0 V${206 - h} H0 Z`} className={`fuel-wave ${kind === 'baseline' ? 'fuel-baseline' : 'fuel-comparison'}`} />
              </g>
              {[0.25, 0.5, 0.75].map((m) => (
                <path key={m} d={`M200 ${200 - 200 * m} h-14`} className="align-structure" />
              ))}
              <rect x="80" y="-14" width="40" height="16" rx="3" className="align-structure" />
              <text x="100" y="232" textAnchor="middle" className={`align-value ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
                {name(t, kind).toUpperCase()} · {formatDash(item[kind])}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Mass({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const f = t.setups.dashboards.fuel;
  const [density, setDensity] = useState('');
  const d = num(density);
  const ok = Number.isFinite(d) && d > 0;
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{f.mass.density}</span>
        <input
          inputMode="decimal"
          value={density}
          onChange={(e) => setDensity(e.target.value)}
          placeholder="0.75"
          className="w-28 rounded border border-border bg-card px-2 py-1 text-right font-mono text-foreground"
        />
      </label>
      {density !== '' && !ok && <p className="text-xs text-bad-text">{f.mass.invalid}</p>}
      {visibleKinds(controls.mode).map((kind) => {
        const kg = ok ? fuelMassKg(fuelLitres(comparison, kind), d) : null;
        return (
          <div key={kind} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
            <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {name(t, kind)} · {f.mass.mass}
            </span>
            <strong className="font-mono text-lg tabular-nums text-foreground">{kg == null ? '—' : `${kg.toFixed(1)} kg`}</strong>
          </div>
        );
      })}
      <Caveat>{f.mass.caveat}</Caveat>
    </div>
  );
}

function Plan({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t, fmt } = useLanguage();
  const f = t.setups.dashboards.fuel;
  const [laps, setLaps] = useState('');
  const [minutes, setMinutes] = useState('');
  const [lapTime, setLapTime] = useState('');
  const [perLap, setPerLap] = useState('');
  const [reserve, setReserve] = useState('1');
  const fromDuration = lapsForDuration(num(minutes), num(lapTime));
  const raceLaps = Number.isFinite(num(laps)) ? num(laps) : (fromDuration ?? NaN);
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="w-24 rounded border border-border bg-card px-2 py-1 text-right font-mono text-foreground" />
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        {field(f.plan.laps, laps, setLaps)}
        {field(f.plan.duration, minutes, setMinutes)}
        {field(f.plan.lapTime, lapTime, setLapTime)}
        {fromDuration != null && !Number.isFinite(num(laps)) && <p className="text-xs text-muted-foreground">{fmt(f.plan.fromDuration, { laps: fromDuration })}</p>}
        {field(f.plan.perLap, perLap, setPerLap)}
        {field(f.plan.reserve, reserve, setReserve)}
      </div>
      <div className="space-y-2">
        {visibleKinds(controls.mode).map((kind) => {
          const plan = fuelPlan(fuelLitres(comparison, kind), raceLaps, num(perLap), num(reserve));
          return (
            <div key={kind} className="rounded-lg border border-border bg-secondary p-3">
              <div className={`mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>{name(t, kind)}</div>
              {!plan ? (
                <p className="text-xs text-muted-foreground">{f.plan.invalid}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{f.plan.required}</dt>
                  <dd className="text-right font-mono tabular-nums text-foreground">{plan.required.toFixed(1)} L</dd>
                  <dt className="text-muted-foreground">{f.plan.covered}</dt>
                  <dd className="text-right font-mono tabular-nums text-foreground">{plan.lapsCovered.toFixed(1)}</dd>
                  <dt className="text-muted-foreground">{f.plan.surplus}</dt>
                  <dd className={`text-right font-mono tabular-nums ${plan.surplus < 0 ? 'text-bad-text' : 'text-good-text'}`}>
                    {plan.surplus < 0 ? fmt(f.plan.short, { amount: `${Math.abs(plan.surplus).toFixed(1)} L` }) : `${plan.surplus.toFixed(1)} L`}
                  </dd>
                </dl>
              )}
            </div>
          );
        })}
        <Caveat>{f.plan.caveat}</Caveat>
      </div>
    </div>
  );
}
