'use client';

import { ArrowDownUp, BrainCircuit, CircleGauge, Disc3, Flame, Gauge, Info, Layers, Lightbulb, Play, RotateCcw, ShieldAlert, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import BrakeCaliper from '@/components/BrakeCaliper';
import BrakeChangesSummary from '@/components/BrakeChangesSummary';
import BrakeCylinder from '@/components/BrakeCylinder';
import BrakeHydraulicOverview from '@/components/BrakeHydraulicOverview';
import BrakePedalAssembly from '@/components/BrakePedalAssembly';
import { EngineeringCarLayer } from '@/components/EngineeringCarView';
import type { CarFit } from '@/lib/carViews/anchors';
import { Caveat, DiagramHeader, ExaggerationSlider, FilterChip, Legend, SegmentButton, Segmented, Section, Slider } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import {
  ABS_APPLICATION,
  ABS_STAGES,
  biasDelta,
  boreRadius,
  BRAKE_COMPONENTS,
  CORNERS,
  DEFAULT_EXAGGERATION,
  distribution,
  EXAGGERATIONS,
  findItem,
  formatBrake,
  ledSwatch,
  meanBore,
  pistonArea,
  pressure,
  relativeChange,
  toneOf,
  travelRatio,
  visibleKinds,
  type BrakeComparison,
  type BrakeComponent,
  type BrakeDrawingProps,
  type DisplayMode,
  type SelectedBrake,
  type Which,
} from '@/lib/brakesGeometry';

const MODES: DisplayMode[] = ['baseline', 'comparison', 'overlay'];

// The Setups page's Brakes tab (docs/setups.md; the design came from the Lovable project darinlutz/screenshot-match):
// the brake system of two setups of the same car. A workstation (the hydraulic plan view with every part selectable,
// and an inspector), then a section per part (bias, master cylinders, pedal box, calipers and pads, ABS), the LED strip
// apart from the brakes, and the list of changes with Ask Setup Engineer. Everything comes from compareBrakes's items,
// the setups' own values in their own units; the exaggeration, the pedal application, the piston force and the ABS
// event are illustrations that never change a value
export default function BrakeEngineeringView({
  comparison,
  engineer,
}: {
  comparison: BrakeComparison;
  engineer?: { onAsk: () => void; asking: boolean };
}) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const [mode, setMode] = useState<DisplayMode>('overlay');
  const [component, setComponent] = useState<BrakeComponent>('all');
  const [selected, setSelected] = useState<SelectedBrake>('frontMaster');
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_EXAGGERATION);
  const [application, setApplication] = useState(0);
  const [force, setForce] = useState(500);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [thermal, setThermal] = useState(false);

  // The ABS event steps once a second through its stages, then stops on the last
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setStage((prev) => {
        if (prev >= ABS_STAGES.length - 1) {
          setRunning(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const shownApplication = running || stage > 0 ? (ABS_APPLICATION[stage] ?? application) : application;
  const props: BrakeDrawingProps = { comparison, mode, exaggeration, application: shownApplication, selected, onSelect: setSelected, component, absStage: stage };

  if (comparison.items.length === 0) {
    return <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{b.none}</p>;
  }

  const reset = () => {
    setMode('overlay');
    setComponent('all');
    setSelected('frontMaster');
    setExaggeration(DEFAULT_EXAGGERATION);
    setApplication(0);
    setForce(500);
    setStage(0);
    setRunning(false);
    setThermal(false);
  };
  const setPedal = (value: number) => {
    setStage(0);
    setRunning(false);
    setApplication(value);
  };
  const show = (part: BrakeComponent) => component === 'all' || component === part;
  const bias = findItem(comparison, 'bias');
  const pads = findItem(comparison, 'pads');
  const led = findItem(comparison, 'led');
  const bd = biasDelta(comparison);
  const kinds = visibleKinds(mode);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-mono text-base font-bold uppercase tracking-widest text-foreground">
            <CircleGauge className="size-5 text-align-baseline" aria-hidden />
            {b.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{b.tagline}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{b.intro}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <i className="susp-pulse size-2 rounded-full bg-[var(--brake-front)]" aria-hidden />
          {b.badge}
        </span>
      </div>

      {/* The workstation */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-secondary px-3 py-2">
          <Segmented label={b.modeLabel}>
            {MODES.map((m) => (
              <SegmentButton key={m} active={mode === m} onClick={() => setMode(m)}>
                {m === 'overlay' && <Layers className="size-3.5" aria-hidden />}
                {b.modes[m]}
              </SegmentButton>
            ))}
          </Segmented>
          <ExaggerationSlider label={b.exaggeration} value={exaggeration} steps={EXAGGERATIONS} onChange={setExaggeration} />
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Legend tone="text-align-baseline" label={b.baseline} />
            <Legend tone="text-align-comparison" label={b.comparison} dashed />
            <Legend tone="text-align-neutral" label={b.unchanged} />
          </div>
          <button
            type="button"
            onClick={reset}
            title={b.reset}
            aria-label={b.reset}
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" role="group" aria-label={b.componentLabel}>
          <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{b.componentLabel}</span>
          {BRAKE_COMPONENTS.map((c) => (
            <FilterChip key={c} active={component === c} onClick={() => setComponent(c)}>
              {b.components[c]}
            </FilterChip>
          ))}
        </div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,8fr)_minmax(16rem,3fr)]">
          <div className="min-w-0 rounded-lg border border-border p-3 align-grid">
            <DiagramHeader title={b.overview.heading} badge={fmt(b.overview.bore, { factor: exaggeration })} />
            <BrakeHydraulicOverview {...props} />
          </div>
          <Inspector props={props} applied={application > 0} onPedal={() => setPedal(application > 0 ? 0 : 100)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Info className="size-3.5" aria-hidden />
            {fmt(b.notice, { factor: exaggeration })}
          </span>
          <span>{b.nominal}</span>
        </div>
      </div>

      {show('bias') && (
        <Section
          icon={<Gauge className="size-4" aria-hidden />}
          title={b.bias.title}
          aside={
            <span className="rounded-md border border-border bg-secondary px-2 py-1 font-mono text-sm font-bold tabular-nums text-foreground">
              {fmt(b.bias.deltaPp, { value: bd == null ? '—' : formatBrake({ value: bd, unit: 'setting', decimals: Math.max(bias?.baseline?.decimals ?? 1, bias?.comparison?.decimals ?? 1) }, true) })}
            </span>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <BiasCar comparison={comparison} kinds={kinds} />
            <div className="space-y-4">
              {kinds.map((kind) => (
                <BiasBar key={kind} comparison={comparison} which={kind} />
              ))}
              {bias && !bias.frontPercentage && <Caveat>{fmt(b.bias.noConvention, { key: bias.key })}</Caveat>}
              <Caveat>{b.bias.caveat}</Caveat>
            </div>
          </div>
        </Section>
      )}

      {show('masters') && (
        <Section
          icon={<ArrowDownUp className="size-4 rotate-90" aria-hidden />}
          title={b.masters.title}
          aside={<Slider id="brake-force" label={b.masters.force} min={100} max={1500} step={50} value={force} onChange={setForce} output={`${force} N`} />}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {(['frontMaster', 'rearMaster'] as const).map((param) => (
              <MasterPanel key={param} props={props} param={param} force={force} />
            ))}
          </div>
          <Caveat>{b.masters.caveat}</Caveat>
        </Section>
      )}

      {show('pedal') && (
        <Section
          icon={<ArrowDownUp className="size-4" aria-hidden />}
          title={b.pedal.title}
          aside={<Slider id="brake-pedal" label={b.pedal.application} min={0} max={100} step={1} value={shownApplication} onChange={setPedal} output={`${shownApplication}%`} />}
        >
          <div className="rounded-lg border border-border p-3 align-grid">
            <BrakePedalAssembly {...props} />
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-2 font-mono text-xs">
              {kinds.map((kind) => (
                <span key={kind} className={kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}>
                  {fmt(b.pedal.bias, { kind: (kind === 'baseline' ? b.baseline : b.comparison).toUpperCase(), value: formatBrake(bias?.[kind] ?? null) })}
                </span>
              ))}
            </div>
          </div>
        </Section>
      )}

      {show('calipers') && (
        <Section
          icon={<Disc3 className="size-4" aria-hidden />}
          title={b.calipers.title}
          aside={
            <button
              type="button"
              aria-pressed={thermal}
              onClick={() => setThermal(!thermal)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                thermal ? 'border-[var(--brake-front)] bg-[var(--brake-front)]/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Flame className="size-3.5" aria-hidden />
              {b.calipers.thermal}
            </button>
          }
        >
          <div className={`grid gap-3 ${kinds.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {kinds.map((kind) => {
              const value = pads?.[kind] ?? null;
              const label = (kind === 'baseline' ? b.baseline : b.comparison).toUpperCase();
              return (
                <section key={kind} className="min-w-0 rounded-lg border border-border p-3 align-grid">
                  <DiagramHeader
                    title={fmt(b.calipers.heading, { kind: label })}
                    badge={value ? formatBrake(value) : b.calipers.unavailable}
                    badgeTone={kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}
                  />
                  <svg viewBox="0 0 440 290" className="align-svg h-auto w-full" role="img" aria-label={fmt(b.calipers.aria, { kind: label })}>
                    <g transform="translate(195 145) scale(1.3)">
                      <BrakeCaliper application={shownApplication} tone={toneOf(pads, kind)} thermal={thermal} />
                    </g>
                    <path d="M299 91 H350 M285 162 H350 M169 229 L130 257 H64" className="align-reference" />
                    <text x="353" y="94">
                      {b.calipers.pistons.toUpperCase()}
                    </text>
                    <text x="353" y="166">
                      {b.calipers.padContact.toUpperCase()}
                    </text>
                    <text x="64" y="272">
                      {b.calipers.disc.toUpperCase()}
                    </text>
                  </svg>
                  <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 font-mono text-xs">
                    <span className={kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}>{value ? formatBrake(value) : b.calipers.unavailable}</span>
                    <span className="uppercase tracking-wide text-muted-foreground">{shownApplication > 0 ? b.calipers.contact : b.calipers.released}</span>
                  </div>
                </section>
              );
            })}
          </div>
          <Caveat>{b.calipers.caveat}</Caveat>
        </Section>
      )}

      {show('abs') && (
        <Section
          icon={<ShieldAlert className="size-4" aria-hidden />}
          title={b.abs.title}
          aside={
            <button
              type="button"
              onClick={() => {
                if (running) {
                  setRunning(false);
                  setStage(0);
                } else {
                  setStage(1);
                  setRunning(true);
                }
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong"
            >
              {running ? <Square className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {running ? b.abs.stop : b.abs.simulate}
            </button>
          }
        >
          <AbsPanel comparison={comparison} stage={stage} />
        </Section>
      )}

      {/* The LED strip: lighting, apart from everything above */}
      {led && (
        <section className="rounded-xl border border-dashed border-border p-4">
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Lightbulb className="size-4" aria-hidden />
            {b.aux.title}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {kinds.map((kind) => {
              const value = led[kind];
              const swatch = ledSwatch(value);
              return (
                <div key={kind} className="flex items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-2">
                  <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
                    {kind === 'baseline' ? b.baseline : b.comparison}
                  </span>
                  <span
                    className={`brake-led h-2.5 flex-1 rounded-full ${swatch ? `brake-led-${swatch}` : 'bg-border'}`}
                    role="img"
                    aria-label={fmt(b.aux.aria, { color: value ? formatBrake(value) : b.aux.unavailable })}
                  />
                  <strong className="font-mono text-sm text-foreground">{value ? formatBrake(value) : b.aux.unavailable}</strong>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{b.aux.note}</p>
        </section>
      )}

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <BrakeChangesSummary
          comparison={comparison}
          actions={
            engineer && (
              <button
                type="button"
                disabled={engineer.asking}
                onClick={engineer.onAsk}
                title={b.askEngineerHelp}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
              >
                <BrainCircuit className="size-4" aria-hidden />
                {engineer.asking ? t.setups.engineer.asking : b.askEngineer}
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

// The selected part: its name, what it does, each setup's value, the circuit and setup legends, and Apply the brakes
function Inspector({ props, applied, onPedal }: { props: BrakeDrawingProps; applied: boolean; onPedal: () => void }) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const { comparison, selected, mode } = props;
  const corner = selected.length === 2;
  const name = corner ? fmt(b.parts.caliper, { corner: b.corners[selected as 'LF'] }) : b.parts[selected as 'pedal'];
  const explanation = corner ? (selected.endsWith('F') ? b.explanations.frontCaliper : b.explanations.rearCaliper) : b.explanations[selected as 'pedal'];
  const valueOf = (kind: Which) => {
    const item =
      selected === 'frontMaster' || selected === 'rearMaster'
        ? findItem(comparison, selected)
        : selected === 'abs'
          ? findItem(comparison, 'abs')
          : selected === 'pedal' || selected === 'balance'
            ? findItem(comparison, 'bias')
            : findItem(comparison, 'pads');
    return formatBrake(item?.[kind] ?? null);
  };
  return (
    <aside aria-live="polite" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-secondary p-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-align-baseline">{b.inspector.title}</div>
      <h4 className="text-lg font-bold uppercase leading-tight text-foreground">{name}</h4>
      <p className="text-sm text-muted-foreground">{explanation}</p>
      <div className="space-y-2">
        {visibleKinds(mode).map((kind) => (
          <div key={kind} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
            <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {kind === 'baseline' ? b.baseline : b.comparison}
            </span>
            <strong className="font-mono text-base tabular-nums text-foreground">{valueOf(kind)}</strong>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-1">
        <Swatch className="bg-[var(--brake-front)]" label={b.inspector.frontCircuit} />
        <Swatch className="bg-[var(--brake-rear)]" label={b.inspector.rearCircuit} />
        <Swatch className="bg-align-baseline" label={b.inspector.baselineSetup} />
        <Swatch className="bg-align-comparison" label={b.inspector.comparisonSetup} />
      </div>
      <button
        type="button"
        onClick={onPedal}
        className={`mt-auto inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
          applied ? 'border border-border text-foreground hover:border-primary' : 'bg-primary text-primary-foreground hover:bg-primary-strong'
        }`}
      >
        <ArrowDownUp className="size-4" aria-hidden />
        {applied ? b.inspector.release : b.inspector.apply}
      </button>
      <span className="text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{b.inspector.caveat}</span>
    </aside>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <i className={`inline-block h-1 w-5 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}

// Where the bias car's axles are in its drawing, and each axle's corners from the car's left
const BIAS_FIT: CarFit = { kind: 'axles', centerX: 140, frontY: 65, rearY: 224 };
const AXLES = [
  ['LF', 'RF'],
  ['LR', 'RR'],
] as const;

// A top view of the car with each axle's brakes outlined as heavily as their share, and the shares written between
function BiasCar({ comparison, kinds }: { comparison: BrakeComparison; kinds: Which[] }) {
  const { t } = useLanguage();
  const b = t.setups.brakes;
  const bias = findItem(comparison, 'bias');
  return (
    <div className="rounded-lg border border-border p-2 align-grid">
      <svg viewBox="0 0 280 290" className="align-svg mx-auto h-auto w-full max-w-[16rem]" role="img" aria-label={b.bias.carAria}>
        {/* The compared setups' car from above (EngineeringCarView.tsx); its wheels hidden, as each axle's brakes are
            drawn at them here */}
        <EngineeringCarLayer view="top" fit={BIAS_FIT} showWheels={false}>
          {(car) =>
        kinds.map((kind, j) => {
          const d = distribution(comparison, kind);
          return AXLES.map(([l, r], i) => {
            const y = car.wheel(l)?.[1] ?? (i ? 224 : 65);
            return (
            <g key={`${kind}-${i}`} className={toneOf(bias, kind)}>
              {[car.wheel(l)?.[0] ?? 69, car.wheel(r)?.[0] ?? 211].map((x) => (
                <rect key={x} x={x - 9 + j * 3} y={y - 21} width="18" height="42" rx="4" strokeWidth={d ? 1 + (i ? d.rear : d.front) / 25 : 1} className="brake-share" />
              ))}
              <text x={car.centerlineX ?? 140} y={y + j * 14} textAnchor="middle" className="align-value">
                {d ? `${(i ? d.rear : d.front).toFixed(d.decimals)}%` : '—'}
              </text>
            </g>
            );
          });
        })
          }
        </EngineeringCarLayer>
        <text x="140" y="283" textAnchor="middle">
          {b.bias.distribution.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

// One setup's front/rear split as a bar
function BiasBar({ comparison, which }: { comparison: BrakeComparison; which: Which }) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const bias = findItem(comparison, 'bias');
  const d = distribution(comparison, which);
  const label = which === 'baseline' ? b.baseline : b.comparison;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${which === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>{label}</span>
        <strong className="font-mono text-lg tabular-nums text-foreground">{formatBrake(bias?.[which] ?? null)}</strong>
      </div>
      {d ? (
        <>
          <div className="relative h-8 overflow-hidden rounded-md bg-secondary" role="img" aria-label={fmt(b.bias.aria, { kind: label, front: d.front.toFixed(d.decimals), rear: d.rear.toFixed(d.decimals) })}>
            <div className={`susp-bar absolute inset-y-0 left-0 ${which === 'baseline' ? 'bg-align-baseline/80' : 'bg-align-comparison/80'}`} style={{ width: `${d.front}%` }} />
            <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" aria-hidden />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>{fmt(b.bias.front, { value: d.front.toFixed(d.decimals) })}</span>
            <span>{fmt(b.bias.rear, { value: d.rear.toFixed(d.decimals) })}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

// One master cylinder: both setups' bores in cutaway, then the area, the pressure for the hypothetical force, and the
// pressure change and travel ratio
function MasterPanel({ props, param, force }: { props: BrakeDrawingProps; param: 'frontMaster' | 'rearMaster'; force: number }) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const { comparison, mode, exaggeration, application } = props;
  const item = findItem(comparison, param);
  const a = item?.baseline ?? null;
  const c = item?.comparison ?? null;
  const pa = pressure(force, a);
  const pc = pressure(force, c);
  const change = relativeChange(pa, pc);
  const ratio = travelRatio(a, c);
  const mean = meanBore(comparison);
  const axle = param === 'frontMaster' ? b.masters.front : b.masters.rear;
  const kinds = visibleKinds(mode);
  const inches = [a, c].some((v) => v?.unit === 'in');
  const area = (v: typeof a) => {
    const x = pistonArea(v);
    return x == null ? '—' : `${x.toFixed(2)} mm²`;
  };
  return (
    <section className="min-w-0 rounded-lg border border-border p-3 align-grid">
      <DiagramHeader title={fmt(b.masters.heading, { axle })} badge={b.masters.units} />
      <svg viewBox="0 0 430 245" className="align-svg h-auto w-full" role="img" aria-label={fmt(b.masters.aria, { axle })}>
        {kinds.map((kind, i) => (
          <g key={kind} transform={`translate(40 ${kinds.length === 1 ? 120 : i ? 175 : 70}) scale(.9)`}>
            <BrakeCylinder
              bore={item?.[kind] ?? null}
              radius={boreRadius(item?.[kind] ?? null, mean, exaggeration)}
              tone={toneOf(item, kind)}
              application={application}
              label={kinds.length === 1 ? (pistonArea(item?.[kind] ?? null) ? b.masters.pistonLabel : b.masters.unavailable) : null}
            />
            <text x="0" y="-40" className={`align-value ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
              {(kind === 'baseline' ? b.baseline : b.comparison).toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
      <table className="mt-1 w-full text-xs">
        <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-semibold">{b.masters.measurement}</th>
            <th className="py-1 text-right font-semibold text-align-baseline">{b.baseline}</th>
            <th className="py-1 text-right font-semibold text-align-comparison">{b.comparison}</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          <tr className="border-t border-border/60">
            <td className="py-1 font-sans text-muted-foreground">{b.masters.bore}</td>
            <td className="py-1 text-right">{formatBrake(a)}</td>
            <td className="py-1 text-right">{formatBrake(c)}</td>
          </tr>
          <tr className="border-t border-border/60">
            <td className="py-1 font-sans text-muted-foreground">{b.masters.area}</td>
            <td className="py-1 text-right">{area(a)}</td>
            <td className="py-1 text-right">{area(c)}</td>
          </tr>
          <tr className="border-t border-border/60">
            <td className="py-1 font-sans text-muted-foreground">{b.masters.pressure}</td>
            <td className="py-1 text-right">{pa == null ? '—' : `${pa.toFixed(3)} MPa`}</td>
            <td className="py-1 text-right">{pc == null ? '—' : `${pc.toFixed(3)} MPa`}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          {b.masters.pressureDelta}{' '}
          <strong className="font-mono tabular-nums text-foreground">{change == null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(1)}%`}</strong>
        </span>
        <span>
          {b.masters.travel} <strong className="font-mono tabular-nums text-foreground">{ratio == null ? '—' : `${ratio.toFixed(3)}×`}</strong>
        </span>
      </div>
      {inches && <p className="mt-1 text-xs text-muted-foreground">{b.masters.inches}</p>}
    </section>
  );
}

// The illustrative ABS event: four wheels, the left front modulating, the stage, its sequence and both settings
function AbsPanel({ comparison, stage }: { comparison: BrakeComparison; stage: number }) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const abs = findItem(comparison, 'abs');
  const current = ABS_STAGES[stage];
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <svg viewBox="0 0 600 260" className="align-svg h-auto w-full" role="img" aria-label={b.abs.aria}>
          <path d="M210 25 Q300 8 390 25 V225 Q300 244 210 225 Z" className="align-chassis" />
          <path d="M300 30 V228" className="align-reference" />
          {CORNERS.map((corner, i) => {
            const x = i % 2 ? 413 : 187;
            const y = i < 2 ? 71 : 192;
            const intervening = corner === 'LF' && stage >= 5 && stage <= 6;
            const state = intervening ? b.abs.wheel.modulating : stage >= 7 ? b.abs.wheel.recovered : stage > 0 ? b.abs.wheel.rotating : b.abs.wheel.ready;
            return (
              <g key={corner} transform={`translate(${x} ${y})`}>
                <rect x="-16" y="-28" width="32" height="56" rx="5" className={intervening ? 'brake-abs-pulse' : 'align-structure'} />
                <g className={stage > 0 && !intervening ? 'brake-wheel-turn' : undefined}>
                  <path d="M-10 0 H10 M0 -20 V20" className="align-structure" />
                </g>
                <text x="0" y="-40" textAnchor="middle" className="align-wheel-label">
                  {corner}
                </text>
                <path d="M-60 40 l8 -6 l8 6 l8 -9 l8 9 l8 -4" className={intervening ? 'brake-circuit-front brake-line' : 'align-reference'} />
                <text x={i % 2 ? 30 : -30} y="4" textAnchor={i % 2 ? 'start' : 'end'} className={intervening ? 'brake-circuit-label' : undefined}>
                  {state.toUpperCase()}
                </text>
              </g>
            );
          })}
          <path d="M282 17 L300 3 L318 17" className="align-structure" />
        </svg>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
        <div className="flex flex-wrap gap-3 font-mono text-sm font-bold">
          <span className="text-align-baseline">{fmt(b.abs.setting, { kind: b.baseline.toUpperCase(), value: formatBrake(abs?.baseline ?? null) })}</span>
          <span className="text-align-comparison">{fmt(b.abs.setting, { kind: b.comparison.toUpperCase(), value: formatBrake(abs?.comparison ?? null) })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{b.abs.positions}</p>
        <div role="status" className="rounded-md border border-border bg-card px-3 py-2">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{fmt(b.abs.event, { stage })}</div>
          <strong className="text-lg text-foreground">{b.abs.stages[current]}</strong>
        </div>
        <ol className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {ABS_STAGES.slice(1).map((name, i) => {
            const n = i + 1;
            const state = stage === n ? 'border-[var(--brake-front)] text-foreground' : stage > n ? 'border-border text-foreground/70' : 'border-border text-muted-foreground';
            return (
              <li key={name} className={`flex items-center gap-2 rounded border bg-card px-2 py-1 ${state}`}>
                <span className="font-mono text-[10px]">{String(n).padStart(2, '0')}</span>
                {b.abs.stages[name]}
              </li>
            );
          })}
        </ol>
        <Caveat>{b.abs.caveat}</Caveat>
      </div>
    </div>
  );
}
