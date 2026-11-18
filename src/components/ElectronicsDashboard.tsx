'use client';

import { Cpu, LayoutDashboard, Play, Square, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Caveat, DiagramHeader, Section } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import SetupDashboardView, { type DashboardControls } from '@/components/SetupDashboardView';
import { byRole, dialRange, formatDash, numberOf, toneOf, visibleKinds, type DashboardComparison, type DashboardItem } from '@/lib/setupDashboards';
import { keyLabel } from '@/lib/setupYaml';

// An illustrative rear wheel slip trace, 0-100 across a corner exit, for the TC illustration (not a recording)
const SLIP = [4, 6, 9, 14, 21, 30, 41, 55, 66, 72, 70, 63, 54, 47, 42, 38, 35, 33, 31, 30];
const THRESHOLD = 50;

// The Setups page's Electronics tab (the design came from the Lovable project darinlutz/screenshot-match): every
// discrete in-car control as a dial with each setup's position (TC, ABS, maps), an illustration of traction control
// cutting torque as the wheel slips, and the operational settings (displays, lights) apart from performance
export default function ElectronicsDashboard({ comparison, engineer }: { comparison: DashboardComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t } = useLanguage();
  const e = t.setups.dashboards.electronics;
  const topic = (i: DashboardItem) => (i.role && i.role in e.topics ? e.topics[i.role as keyof typeof e.topics] : e.topics.other);
  return (
    <SetupDashboardView comparison={comparison} icon={Cpu} text={e} topicOf={topic} engineer={engineer} exaggerates={false} hero={(c) => <Cockpit comparison={comparison} controls={c} />}>
      {(c) => (
        <>
          <Section icon={<Zap className="size-4" aria-hidden />} title={e.tc.title}>
            <TcIllustration comparison={comparison} controls={c} />
            <Caveat>{e.tc.caveat}</Caveat>
          </Section>
          <Operational comparison={comparison} controls={c} />
        </>
      )}
    </SetupDashboardView>
  );
}

const nameOf = (e: ReturnType<typeof useLanguage>['t']['setups']['dashboards']['electronics'], item: DashboardItem) =>
  item.role && item.role in e.names ? e.names[item.role as keyof typeof e.names] : keyLabel(item.key);

// Every numeric control as a dial: a 270° scale, a needle per setup
function Cockpit({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t, fmt } = useLanguage();
  const e = t.setups.dashboards.electronics;
  const dials = comparison.items.filter((i) => numberOf(i, 'baseline', [null]) != null || numberOf(i, 'comparison', [null]) != null);
  const [selected, setSelected] = useState<string | null>(null);
  const kinds = visibleKinds(controls.mode);
  if (!dials.length) return null;
  const current = dials.find((d) => d.path === selected) ?? dials[0];
  return (
    <div className="rounded-lg border border-border p-3 align-grid">
      <DiagramHeader title={e.cockpit.title} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label={e.cockpit.aria}>
        {dials.map((item) => {
          const range = dialRange(item);
          const name = nameOf(e, item);
          return (
            <button
              key={item.path}
              type="button"
              aria-pressed={current.path === item.path}
              aria-label={fmt(e.cockpit.select, { name })}
              onClick={() => setSelected(item.path)}
              className={`rounded-xl border bg-card p-3 transition-colors ${current.path === item.path ? 'border-align-baseline shadow-[0_0_0_1px_var(--align-baseline)]' : 'border-border hover:border-align-baseline'}`}
            >
              <svg viewBox="-60 -60 120 110" className="align-svg mx-auto h-auto w-full max-w-[10rem]" aria-hidden>
                <path d="M-42.4 42.4 A60 60 0 1 1 42.4 42.4" transform="scale(.8)" className="tire-gauge-track" />
                {Array.from({ length: range + 1 }, (_, i) => {
                  const a = -135 + (i / range) * 270;
                  return <path key={i} d="M0 -48 V-42" transform={`rotate(${a})`} className="align-structure" />;
                })}
                {kinds.map((kind) => {
                  const v = numberOf(item, kind, [null]);
                  if (v == null) return null;
                  const a = -135 + (Math.max(0, Math.min(range, v)) / range) * 270;
                  return (
                    <g key={kind} className={toneOf(item, kind)}>
                      <g className="align-rotate" style={{ transform: `rotate(${a}deg)` }}>
                        <path d="M0 6 V-38" strokeWidth="3" strokeLinecap="round" strokeDasharray={kind === 'comparison' ? '5 3' : undefined} />
                      </g>
                    </g>
                  );
                })}
                <circle r="7" className="align-chassis" />
                <text y="34" textAnchor="middle" className="align-wheel-label">
                  {kinds.map((k) => formatDash(item[k])).join(' → ')}
                </text>
              </svg>
              <div className="mt-1 text-center text-sm font-semibold text-foreground">{name}</div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {kinds.map((kind) => (
          <div key={kind} className="flex items-center justify-between rounded-md border border-border bg-secondary px-3 py-2">
            <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison} · {nameOf(e, current)}
            </span>
            <strong className="font-mono text-lg tabular-nums text-foreground">{current[kind] ? fmt(e.dial.position, { value: formatDash(current[kind]) }) : '—'}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// The same illustrative slip trace for both setups, with the TC cutting torque above the threshold as it plays
function TcIllustration({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const e = t.setups.dashboards.electronics;
  const tc = byRole(comparison, 'tc');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, SLIP.length - 1)), 220);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the illustration stops at its last step
    if (step >= SLIP.length - 1) setPlaying(false);
  }, [step]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the toolbar's reset starts the illustration over
    setStep(0);
    setPlaying(false);
  }, [controls.resetKey]);
  if (!tc) return <p className="text-sm text-muted-foreground">{e.tc.none}</p>;
  const x = (i: number) => 40 + (i / (SLIP.length - 1)) * 520;
  const y = (v: number) => 200 - v * 1.6;
  const shown = SLIP.slice(0, step + 1);
  const cutting = SLIP[step] > THRESHOLD;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <svg viewBox="0 0 600 230" className="align-svg h-auto w-full" role="img" aria-label={e.tc.aria}>
          <path d="M40 200 H560 M40 20 V200" className="align-structure" />
          <path d={`M40 ${y(THRESHOLD)} H560`} className="brake-circuit-front brake-line" strokeDasharray="6 4" strokeWidth="1.5" />
          <text x="556" y={y(THRESHOLD) - 6} textAnchor="end" className="brake-circuit-label">
            {e.tc.threshold.toUpperCase()}
          </text>
          <path d={SLIP.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ')} className="align-reference" />
          <path d={shown.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ')} className="align-baseline" strokeWidth="2.5" />
          {SLIP.map((v, i) => (i <= step && v > THRESHOLD ? <circle key={i} cx={x(i)} cy={y(v)} r="4" className="brake-abs-pulse" /> : null))}
          <text x="44" y="16">
            {e.tc.slip.toUpperCase()}
          </text>
        </svg>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
        <div className="flex flex-wrap gap-3 font-mono text-sm font-bold">
          {visibleKinds(controls.mode).map((kind) => (
            <span key={kind} className={kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}>
              {(kind === 'baseline' ? t.setups.dashboards.common.baseline : t.setups.dashboards.common.comparison).toUpperCase()} {formatDash(tc[kind])}
            </span>
          ))}
        </div>
        <div role="status" className={`rounded-md border px-3 py-2 font-mono text-sm uppercase tracking-wide ${cutting ? 'border-[var(--brake-front)] text-foreground' : 'border-border text-muted-foreground'}`}>
          {cutting ? e.tc.intervene : e.tc.slip} · {SLIP[step]}%
        </div>
        <button
          type="button"
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              setStep(0);
              setPlaying(true);
            }
          }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong"
        >
          {playing ? <Square className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {playing ? e.tc.stop : e.tc.play}
        </button>
      </div>
    </div>
  );
}

// Text settings (displays, lights ...), apart from performance
function Operational({ comparison, controls }: { comparison: DashboardComparison; controls: DashboardControls }) {
  const { t } = useLanguage();
  const e = t.setups.dashboards.electronics;
  const items = comparison.items.filter((i) => i.baseline?.value == null && i.comparison?.value == null);
  if (!items.length) return null;
  return (
    <Section icon={<LayoutDashboard className="size-4" aria-hidden />} title={e.ops.title}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={item.path} className="rounded-lg border border-border bg-secondary p-3">
            <div className="text-sm font-semibold text-foreground">{nameOf(e, item)}</div>
            <div className="mt-1 flex flex-wrap gap-2 font-mono text-sm">
              {visibleKinds(controls.mode).map((kind) => (
                <span key={kind} className={item.status === 'same' ? 'text-align-neutral' : kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}>
                  {formatDash(item[kind])}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Caveat>{e.ops.caveat}</Caveat>
    </Section>
  );
}
