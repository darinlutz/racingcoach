'use client';

import { BrainCircuit, CircleDot, Gauge, Layers, RotateCcw, Scale, Thermometer, Waves } from 'lucide-react';
import { useState } from 'react';
import { Caveat, DiagramHeader, ExaggerationSlider, FilterChip, Legend, SegmentButton, Segmented, Section, Slider } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import TireCrossSection from '@/components/TireCrossSection';
import TireFourCornerOverview from '@/components/TireFourCornerOverview';
import {
  BALANCE_KEYS,
  bandsOnScreen,
  conceptualDeflection,
  constantVolumePressure,
  CORNERS,
  DEFAULT_EXAGGERATION,
  EXAGGERATIONS,
  findItem,
  formatPressure,
  formatSigned,
  formatTemps,
  formatValuePressure,
  fromKpa,
  GAS_REFERENCE,
  heatFraction,
  percentChange,
  PRESSURE_UNITS,
  pressureBalance,
  pressureRise,
  tempRange,
  tempSpread,
  TIRE_VIEWS,
  tireKind,
  toKpa,
  toneOf,
  treadLeft,
  treadTemps,
  visibleKinds,
  type Corner,
  type DisplayMode,
  type PressureUnit,
  type TireComparison,
  type TireDrawingProps,
  type TireItem,
  type TireView,
  type Which,
} from '@/lib/tiresGeometry';

const MODES: DisplayMode[] = ['baseline', 'comparison', 'overlay'];
const signedPct = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p).toFixed(1)}%`);

// The Setups page's Tires tab (docs/setups.md; the design came from the Lovable project darinlutz/screenshot-match): the
// tires of two setups of the same car. A workstation (the four corners with gauges and the last run's heat bands, a
// cross-section, a contact patch, the tire type and the last run's readings, and an inspector), then an illustration of
// a pressure change, the cross-sections, contact patches, tire types, iRacing's readings, the pressure balance, the gas
// law, and the list of changes with Ask Setup Engineer. Pressures show in the unit picked (converted exactly; the
// stored values never change); every drawing of deformation or contact is conceptual and says so
export default function TireEngineeringView({ comparison, engineer }: { comparison: TireComparison; engineer?: { onAsk: () => void; asking: boolean } }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const [mode, setMode] = useState<DisplayMode>('overlay');
  const [view, setView] = useState<TireView>('overview');
  const [selected, setSelected] = useState<Corner>('LF');
  const [unit, setUnit] = useState<PressureUnit>(comparison.sourceUnit);
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_EXAGGERATION);
  const [hypothetical, setHypothetical] = useState<number | null>(null);
  const [demoSetup, setDemoSetup] = useState<Which>('baseline');
  const [gas, setGas] = useState(false);
  const [kelvin, setKelvin] = useState(330);
  const props: TireDrawingProps = { comparison, mode, selected, onSelect: (c) => (setSelected(c), setHypothetical(null)), unit, exaggeration };

  if (comparison.items.length === 0) {
    return <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{s.none}</p>;
  }

  const item = findItem(comparison, selected, 'startPressure');
  const type = findItem(comparison, 'car', 'type');
  const reference = item?.[demoSetup] ?? null;
  const referenceKpa = toKpa(reference);
  const demoKpa = hypothetical ?? referenceKpa;
  const demoMin = referenceKpa == null ? 0 : Math.max(0, referenceKpa - 50);
  const demoMax = referenceKpa == null ? 100 : referenceKpa + 50;
  const reset = () => {
    setMode('overlay');
    setView('overview');
    setSelected('LF');
    setUnit(comparison.sourceUnit);
    setExaggeration(DEFAULT_EXAGGERATION);
    setHypothetical(null);
    setDemoSetup('baseline');
  };
  const hasReadings = comparison.items.some((i) => i.reading);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-mono text-base font-bold uppercase tracking-widest text-foreground">
            <CircleDot className="size-5 text-align-baseline" aria-hidden />
            {s.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{s.tagline}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{s.intro}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <i className="susp-pulse size-2 rounded-full bg-align-baseline" aria-hidden />
          {s.badge}
        </span>
      </div>

      {/* The workstation */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-secondary px-3 py-2">
          <Segmented label={s.modeLabel}>
            {MODES.map((m) => (
              <SegmentButton key={m} active={mode === m} onClick={() => setMode(m)}>
                {m === 'overlay' && <Layers className="size-3.5" aria-hidden />}
                {s.modes[m]}
              </SegmentButton>
            ))}
          </Segmented>
          <label className="inline-flex items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">{s.units}</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as PressureUnit)} className="rounded border border-border bg-card px-2 py-1 font-mono text-foreground">
              {PRESSURE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <ExaggerationSlider label={s.exaggeration} value={exaggeration} steps={EXAGGERATIONS} onChange={setExaggeration} />
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Legend tone="text-align-baseline" label={s.baseline} />
            <Legend tone="text-align-comparison" label={s.comparison} dashed />
          </div>
          <button
            type="button"
            onClick={reset}
            title={s.reset}
            aria-label={s.reset}
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" role="group" aria-label={s.viewLabel}>
          <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.viewLabel}</span>
          {TIRE_VIEWS.map((v) => (
            <FilterChip key={v} active={view === v} onClick={() => setView(v)}>
              {s.views[v]}
            </FilterChip>
          ))}
        </div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,8fr)_minmax(16rem,3fr)]">
          <div className="min-w-0 rounded-lg border border-border p-3 align-grid">
            <DiagramHeader
              title={s.views[view]}
              badge={view === 'overview' ? s.viewBadge.pressures : view === 'readings' ? s.viewBadge.readings : s.viewBadge.conceptual}
            />
            {view === 'overview' ? (
              <TireFourCornerOverview {...props} />
            ) : view === 'cutaway' ? (
              <CrossSections props={props} />
            ) : view === 'patch' ? (
              <ContactPatch props={props} />
            ) : view === 'type' ? (
              <TireTypes props={props} />
            ) : (
              <Readings props={props} />
            )}
          </div>
          <aside aria-live="polite" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-secondary p-4">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-align-baseline">{s.inspector.title}</div>
            <h4 className="text-lg font-bold uppercase leading-tight text-foreground">{s.corners[selected]}</h4>
            <p className="text-sm text-muted-foreground">{s.inspector.note}</p>
            <div className="space-y-2">
              {visibleKinds(mode).map((kind) => (
                <Row key={kind} label={kind === 'baseline' ? s.baseline : s.comparison} tone={kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'} value={formatValuePressure(item?.[kind] ?? null, unit)} />
              ))}
              <Row label={s.delta} value={formatPressure(item?.deltaKpa ?? null, unit, { signed: true })} />
              <Row label={s.inspector.relative} value={signedPct(percentChange(item?.baseline ?? null, item?.comparison ?? null))} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-align-baseline">{type?.baseline?.raw.trim() ?? s.inspector.typeUnavailable}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono text-align-comparison">{type?.comparison?.raw.trim() ?? s.inspector.typeUnavailable}</span>
            </div>
            <p className="mt-auto text-xs text-muted-foreground">{s.inspector.caveat}</p>
          </aside>
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-4">
          {CORNERS.map((c) => {
            const p = findItem(comparison, c, 'startPressure');
            return (
              <button
                key={c}
                type="button"
                aria-pressed={selected === c}
                onClick={() => props.onSelect(c)}
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected === c ? 'border-align-baseline bg-align-baseline/5 shadow-[0_0_0_1px_var(--align-baseline)]' : 'border-border bg-secondary hover:border-align-baseline'
                }`}
              >
                <strong className="font-mono text-xs tracking-widest text-foreground">{c}</strong>
                <span className="font-mono text-sm tabular-nums text-align-baseline">{formatValuePressure(p?.baseline ?? null, unit)}</span>
                <span className="font-mono text-sm tabular-nums text-align-comparison">{formatValuePressure(p?.comparison ?? null, unit)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{fmt(s.notice, { factor: exaggeration })}</span>
          <span>{s.coldHot}</span>
        </div>
      </div>

      {/* Illustrative behavior at another pressure */}
      <Section
        icon={<Gauge className="size-4" aria-hidden />}
        title={s.demo.title}
        aside={
          <Segmented label={s.demo.title}>
            {(['baseline', 'comparison'] as const).map((k) => (
              <SegmentButton key={k} active={demoSetup === k} onClick={() => (setDemoSetup(k), setHypothetical(null))}>
                {k === 'baseline' ? s.demo.baselineRef : s.demo.comparisonRef}
              </SegmentButton>
            ))}
          </Segmented>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-lg border border-border p-3 align-grid">
            <svg viewBox="0 0 480 310" className="align-svg h-auto w-full" role="img" aria-label={s.demo.aria}>
              <g transform="translate(240 174)">
                <TireCrossSection
                  deflection={conceptualDeflection(demoKpa, referenceKpa, exaggeration)}
                  tone={demoSetup === 'baseline' ? 'align-baseline' : 'align-comparison'}
                  wet={tireKind(type, demoSetup) === 'wet'}
                  labels={{ tread: s.cutaway.tread, sidewall: s.cutaway.sidewall, bead: s.cutaway.bead, air: s.cutaway.air, rim: s.cutaway.rim }}
                />
              </g>
              <text x="240" y="300" textAnchor="middle">
                {s.demo.footer.toUpperCase()}
              </text>
            </svg>
          </div>
          <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {fmt(s.demo.reference, { corner: selected, setup: (demoSetup === 'baseline' ? s.baseline : s.comparison).toUpperCase() })}
            </div>
            <Row label={s.demo.start} value={formatValuePressure(reference, unit)} />
            <Slider
              id="tire-hypothetical"
              label={s.demo.hypothetical}
              min={Number(fromKpa(demoMin, unit).toFixed(3))}
              max={Number(fromKpa(demoMax, unit).toFixed(3))}
              step={unit === 'bar' ? 0.005 : unit === 'psi' ? 0.05 : 0.5}
              value={Number(fromKpa(demoKpa ?? 0, unit).toFixed(3))}
              onChange={(v) => referenceKpa != null && setHypothetical(v / fromKpa(1, unit))}
              output={formatPressure(demoKpa, unit)}
            />
            <button
              type="button"
              onClick={() => setHypothetical(null)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {s.demo.reset}
            </button>
            <p className="text-sm text-muted-foreground">{s.demo.explanation}</p>
            <Caveat>
              {s.demo.caveat} {referenceKpa == null && s.demo.unavailable}
            </Caveat>
          </div>
        </div>
        <div className="rounded-lg border border-border p-3 align-grid">
          <div className="mb-1 flex gap-4 font-mono text-[10px] uppercase tracking-widest">
            <span className="text-align-baseline">{s.demo.legendRef}</span>
            <span className="text-align-comparison">{s.demo.legendHypo}</span>
          </div>
          <PatchDrawing props={props} layers={[{ kpa: referenceKpa, tone: 'align-baseline' }, { kpa: demoKpa, tone: 'align-comparison' }]} referenceKpa={referenceKpa} />
        </div>
      </Section>

      <Section icon={<CircleDot className="size-4" aria-hidden />} title={s.cutaway.title} aside={<Badge text={selected} />}>
        <div className="rounded-lg border border-border p-3 align-grid">
          <CrossSections props={props} />
        </div>
        <Caveat>{s.cutaway.caveat}</Caveat>
      </Section>

      <Section icon={<Waves className="size-4" aria-hidden />} title={s.patch.title} aside={<Badge text={selected} />}>
        <div className="rounded-lg border border-border p-3 align-grid">
          <ContactPatch props={props} />
        </div>
        <Caveat>{s.patch.caveat}</Caveat>
      </Section>

      <Section icon={<CircleDot className="size-4" aria-hidden />} title={s.type.title}>
        <TireTypes props={props} />
        <Caveat>{s.type.weather}</Caveat>
      </Section>

      {hasReadings && (
        <Section icon={<Thermometer className="size-4" aria-hidden />} title={s.readings.title} aside={<span className="text-xs text-muted-foreground">{s.readings.subtitle}</span>}>
          <Readings props={props} />
          <Caveat>{s.readings.caveat}</Caveat>
        </Section>
      )}

      <Section icon={<Scale className="size-4" aria-hidden />} title={s.balance.title}>
        <Balance comparison={comparison} unit={unit} />
      </Section>

      <Section
        icon={<Thermometer className="size-4" aria-hidden />}
        title={s.gas.title}
        aside={
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
            <input type="checkbox" checked={gas} onChange={(e) => setGas(e.target.checked)} />
            {s.gas.toggle}
          </label>
        }
      >
        {gas && <GasLaw kelvin={kelvin} onKelvin={setKelvin} />}
      </Section>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <Summary
          comparison={comparison}
          unit={unit}
          actions={
            engineer && (
              <button
                type="button"
                disabled={engineer.asking}
                onClick={engineer.onAsk}
                title={s.askEngineerHelp}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
              >
                <BrainCircuit className="size-4" aria-hidden />
                {engineer.asking ? t.setups.engineer.asking : s.askEngineer}
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

function Row({ label, value, tone = 'text-muted-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${tone}`}>{label}</span>
      <strong className="font-mono text-base tabular-nums text-foreground">{value}</strong>
    </div>
  );
}

const Badge = ({ text }: { text: string }) => (
  <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-align-baseline">{text}</span>
);

// The selected corner's tire in cross-section for each setup, bulging by its pressure against the other's
function CrossSections({ props }: { props: TireDrawingProps }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const { comparison, selected, mode, unit, exaggeration } = props;
  const item = findItem(comparison, selected, 'startPressure');
  const type = findItem(comparison, 'car', 'type');
  const ref = toKpa(item?.baseline ?? null) ?? toKpa(item?.comparison ?? null);
  const kinds = visibleKinds(mode);
  return (
    <svg viewBox="0 0 820 320" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.cutaway.aria, { corner: s.corners[selected] })}>
      {kinds.map((kind, i) => (
        <g key={kind} transform={`translate(${kinds.length === 1 ? 410 : i ? 610 : 210} 180)`}>
          <TireCrossSection
            deflection={conceptualDeflection(toKpa(item?.[kind] ?? null), ref, exaggeration)}
            tone={toneOf(item, kind)}
            wet={tireKind(type, kind) === 'wet'}
            labels={kinds.length === 1 ? { tread: s.cutaway.tread, sidewall: s.cutaway.sidewall, bead: s.cutaway.bead, air: s.cutaway.air, rim: s.cutaway.rim } : null}
          />
          <text y="-140" textAnchor="middle" className={`align-value ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
            {(kind === 'baseline' ? s.baseline : s.comparison).toUpperCase()} · {formatValuePressure(item?.[kind] ?? null, unit)}
          </text>
          <text y="108" textAnchor="middle">
            {fmt(s.cutaway.load, { type: type?.[kind]?.raw.trim() ?? s.cutaway.typeUnknown }).toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  );
}

// The conceptual footprint from the side and above, for each layer
function PatchDrawing({ props, layers, referenceKpa }: { props: TireDrawingProps; layers: { kpa: number | null; tone: string }[]; referenceKpa: number | null }) {
  const { t } = useLanguage();
  const s = t.setups.tires;
  return (
    <svg viewBox="0 0 820 280" className="align-svg h-auto w-full" role="img" aria-label={s.patch.aria}>
      <text x="190" y="27" textAnchor="middle">
        {s.patch.side.toUpperCase()}
      </text>
      <text x="603" y="27" textAnchor="middle">
        {s.patch.top.toUpperCase()}
      </text>
      <path d="M30 210 H351 M411 210 H790 M190 52 V96 M183 85 L190 96 L197 85" className="align-structure" />
      <text x="209" y="69">
        {s.patch.load.toUpperCase()}
      </text>
      {layers.map(({ kpa, tone }, i) => {
        const def = conceptualDeflection(kpa, referenceKpa, props.exaggeration);
        const width = 94 + def * 2;
        return (
          <g key={i} className={tone}>
            <path d={`M${190 - width / 2} 208 C81 206 87 90 190 87 C293 90 299 206 ${190 + width / 2} 208 Z`} strokeWidth="2" className="tire-patch-shape" />
            <circle cx="190" cy="147" r="39" />
            <circle cx="190" cy="147" r="12" />
            <path d={`M${190 - width / 2} 221 H${190 + width / 2} M${190 - width / 2} 216 V227 M${190 + width / 2} 216 V227`} />
            <rect x={603 - width / 2} y={70 - def} width={width} height={140 + def * 2} rx="22" className="tire-patch-outline" strokeDasharray={i ? '6 4' : undefined} />
          </g>
        );
      })}
      <text x="190" y="253" textAnchor="middle">
        {s.patch.length.toUpperCase()}
      </text>
      <text x="603" y="253" textAnchor="middle">
        {s.patch.area.toUpperCase()}
      </text>
    </svg>
  );
}

function ContactPatch({ props }: { props: TireDrawingProps }) {
  const item = findItem(props.comparison, props.selected, 'startPressure');
  const ref = toKpa(item?.baseline ?? null) ?? toKpa(item?.comparison ?? null);
  const layers = visibleKinds(props.mode).map((kind) => ({ kpa: toKpa(item?.[kind] ?? null), tone: toneOf(item, kind) }));
  return <PatchDrawing props={props} layers={layers} referenceKpa={ref} />;
}

// Each setup's tire type drawn: slick, grooved or a plain schematic
function TireTypes({ props }: { props: TireDrawingProps }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const type = findItem(props.comparison, 'car', 'type');
  const kinds = visibleKinds(props.mode);
  return (
    <div className={`grid gap-3 ${kinds.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {kinds.map((kind) => {
        const k = tireKind(type, kind);
        const name = type?.[kind]?.raw.trim() ?? s.inspector.typeUnavailable;
        const label = kind === 'baseline' ? s.baseline : s.comparison;
        return (
          <div key={kind} className="rounded-lg border border-border p-3 align-grid">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>{label}</span>
              <strong className="text-foreground">{name}</strong>
            </div>
            <svg viewBox="0 0 430 265" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.type.aria, { kind: label, type: name })}>
              <g className={toneOf(type, kind)}>
                <path d="M146 40 C61 53 64 231 145 239 L271 220 C346 191 346 44 270 24 Z" className="tire-rubber" />
                <ellipse cx="146" cy="139" rx="66" ry="99" strokeDasharray="3 3" />
                <ellipse cx="146" cy="139" rx="43" ry="65" className="tire-rim" />
                <ellipse cx="146" cy="139" rx="11" ry="16" />
                {[0, 60, 120, 180, 240, 300].map((a) => (
                  <path key={a} transform={`rotate(${a} 146 139)`} d="M146 122 L135 88 M146 156 L156 188" className="align-structure" />
                ))}
                <path d="M207 36 C269 47 278 194 206 231 M239 30 C301 37 312 185 238 226" strokeDasharray="3 3" />
                {k === 'wet' &&
                  [62, 91, 120, 149, 178, 207].map((y, i) => (
                    <path key={y} d={`M${204 + i * 1.5} ${y} l21 7 19 -10 34 5 M${200 + i * 1.5} ${y + 10} l21 7 19 -10 34 5`} strokeWidth="1.4" />
                  ))}
                <circle cx="164" cy="183" r="3" className="tire-valve" />
              </g>
              <text x="372" y="100" textAnchor="middle">
                {(k === 'wet' ? s.type.grooved : k === 'dry' ? s.type.slick : s.type.unverified).toUpperCase()}
              </text>
              <text x="372" y="116" textAnchor="middle">
                {s.type.tread.toUpperCase()}
              </text>
              <path d="M290 127 H400" className="align-reference" />
            </svg>
            <p className="text-xs text-muted-foreground">{k === 'wet' ? s.type.wet : k === 'dry' ? s.type.dry : s.type.unknown}</p>
          </div>
        );
      })}
    </div>
  );
}

// iRacing's last-run readings at each corner: hot pressure and its rise, the tread temperatures as heat bands with
// their spreads, and the tread left
function Readings({ props }: { props: TireDrawingProps }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const { comparison, mode, unit, selected, onSelect } = props;
  const heat = tempRange(comparison);
  const kinds = visibleKinds(mode);
  if (!comparison.items.some((i) => i.reading)) return <p className="py-6 text-center text-sm text-muted-foreground">{s.readings.none}</p>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {CORNERS.map((corner) => {
          const temps = findItem(comparison, corner, 'temps');
          const tread = findItem(comparison, corner, 'tread');
          return (
            <button
              key={corner}
              type="button"
              onClick={() => onSelect(corner)}
              aria-pressed={selected === corner}
              className={`min-w-0 rounded-lg border bg-card p-3 text-left transition-colors ${selected === corner ? 'border-align-baseline' : 'border-border hover:border-align-baseline'}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm text-foreground">{s.corners[corner]}</strong>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{corner}</span>
              </div>
              {kinds.map((kind) => {
                const tt = treadTemps(temps, kind);
                const spread = tempSpread(tt);
                const left = treadLeft(tread, kind);
                const hot = findItem(comparison, corner, 'hotPressure')?.[kind] ?? null;
                const rise = pressureRise(comparison, corner, kind);
                const tone = kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison';
                return (
                  <div key={kind} className="mb-2 space-y-1 last:mb-0">
                    <div className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${tone}`}>{kind === 'baseline' ? s.baseline : s.comparison}</div>
                    {tt && (
                      <div className="flex h-5 overflow-hidden rounded" role="img" aria-label={fmt(s.readings.aria, { corner: s.corners[corner], kind: kind === 'baseline' ? s.baseline : s.comparison })}>
                        {bandsOnScreen(tt, corner).map((v, b) => (
                          <span
                            key={b}
                            className="flex flex-1 items-center justify-center font-mono text-[10px] font-semibold text-black/80"
                            style={{ background: `var(--tire-heat-${Math.round(heatFraction(v, heat) * 4)})` }}
                          >
                            {v.toFixed(tt.decimals)}
                          </span>
                        ))}
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      {hot && (
                        <>
                          <dt className="text-muted-foreground">{s.readings.hot}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{formatValuePressure(hot, unit)}</dd>
                        </>
                      )}
                      {rise != null && (
                        <>
                          <dt className="text-muted-foreground">{s.readings.rise}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{formatPressure(rise, unit, { signed: true })}</dd>
                        </>
                      )}
                      {tt && spread && (
                        <>
                          <dt className="text-muted-foreground">{s.readings.temps}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{formatTemps(tt)}</dd>
                          <dt className="text-muted-foreground">{s.readings.innerOuter}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{formatSigned(spread.innerOuter, tt.decimals, `°${tt.unit}`)}</dd>
                          <dt className="text-muted-foreground">{s.readings.middleEdges}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{formatSigned(spread.middleEdges, tt.decimals + 1, `°${tt.unit}`)}</dd>
                        </>
                      )}
                      {left && (
                        <>
                          <dt className="text-muted-foreground">{s.readings.tread}</dt>
                          <dd className="text-right font-mono tabular-nums text-foreground">{left.values.map((v) => `${v}%`).join(' · ')}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>
      {heat && (
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="h-2 w-32 rounded-full tire-heat-scale" aria-hidden />
          {fmt(s.readings.scale, { min: `${heat.min}°${heat.unit}`, max: `${heat.max}°${heat.unit}` })}
        </div>
      )}
    </div>
  );
}

// The corners' starting pressures and the balance metrics, both setups
function Balance({ comparison, unit }: { comparison: TireComparison; unit: PressureUnit }) {
  const { t } = useLanguage();
  const s = t.setups.tires;
  const a = pressureBalance(comparison, 'baseline');
  const b = pressureBalance(comparison, 'comparison');
  const head = (first: string) => (
    <thead className="bg-secondary text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      <tr>
        <th className="px-3 py-2 font-semibold">{first}</th>
        <th className="px-3 py-2 text-right font-semibold">{s.baseline}</th>
        <th className="px-3 py-2 text-right font-semibold">{s.comparison}</th>
        <th className="px-3 py-2 text-right font-semibold">{s.delta}</th>
      </tr>
    </thead>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            {head(s.balance.corner)}
            <tbody className="font-mono tabular-nums">
              {CORNERS.map((c) => {
                const item = findItem(comparison, c, 'startPressure');
                return (
                  <tr key={c} className="border-t border-border">
                    <td className="px-3 py-1.5 font-sans text-foreground">{s.corners[c]}</td>
                    <td className="px-3 py-1.5 text-right text-align-baseline">{formatValuePressure(item?.baseline ?? null, unit)}</td>
                    <td className="px-3 py-1.5 text-right text-align-comparison">{formatValuePressure(item?.comparison ?? null, unit)}</td>
                    <td className="px-3 py-1.5 text-right text-foreground">{formatPressure(item?.deltaKpa ?? null, unit, { signed: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            {head(s.balance.metric)}
            <tbody className="font-mono tabular-nums">
              {BALANCE_KEYS.map((k) => {
                const signed = k === 'frontRear' || k === 'leftRight';
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-1.5 font-sans text-foreground">{s.balance[k]}</td>
                    <td className="px-3 py-1.5 text-right text-align-baseline">{formatPressure(a[k], unit, { signed })}</td>
                    <td className="px-3 py-1.5 text-right text-align-comparison">{formatPressure(b[k], unit, { signed })}</td>
                    <td className="px-3 py-1.5 text-right text-foreground">{a[k] == null || b[k] == null ? '—' : formatPressure(b[k]! - a[k]!, unit, { signed: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Caveat>
        {s.balance.caveat} {Math.abs(a.leftRight ?? 0) > 1e-6 || Math.abs(b.leftRight ?? 0) > 1e-6 ? s.balance.asymmetric : s.balance.symmetric}
      </Caveat>
    </div>
  );
}

// P₁/T₁ = P₂/T₂ for a hypothetical tire at a constant volume
function GasLaw({ kelvin, onKelvin }: { kelvin: number; onKelvin: (k: number) => void }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.tires;
  const p = constantVolumePressure(GAS_REFERENCE.absoluteKpa, GAS_REFERENCE.kelvin, kelvin);
  const x = 90 + ((kelvin - 280) / 120) * 375;
  const y = 163 - ((kelvin - 280) / 120) * 118;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <svg viewBox="0 0 520 230" className="align-svg h-auto w-full" role="img" aria-label={s.gas.aria}>
          <path d="M65 24 V180 H485" className="align-structure" />
          <path d="M90 163 L465 45" className="align-baseline" strokeWidth="2" />
          <path d={`M${x} 180 V${y} H65`} className="align-reference" />
          <circle cx={x} cy={y} r="6" className="tire-valve" />
          <text x="270" y="217" textAnchor="middle">
            {s.gas.axisT.toUpperCase()}
          </text>
          <text x="10" y="13">
            {s.gas.axisP.toUpperCase()}
          </text>
          <text x="29" y="167">
            243
          </text>
          <text x="29" y="49">
            347
          </text>
        </svg>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
        <Slider id="tire-gas" label={s.gas.label} min={280} max={400} step={1} value={kelvin} onChange={onKelvin} output={`${kelvin} K`} />
        <p className="font-mono text-sm text-foreground">{fmt(s.gas.output, { kelvin, pressure: p == null ? '—' : p.toFixed(1) })}</p>
        <p className="text-sm text-muted-foreground">{s.gas.formula}</p>
        <Caveat>{s.gas.caveat}</Caveat>
      </div>
    </div>
  );
}

// The list of changes: tire type and starting pressures, then the readings that differ, marked as readings
function Summary({ comparison, unit, actions }: { comparison: TireComparison; unit: PressureUnit; actions?: React.ReactNode }) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups.tires;
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const name = (i: TireItem) => (i.scope === 'car' ? s.params[i.param] : `${s.corners[i.scope]} · ${s.params[i.param]}`);
  const value = (i: TireItem, which: Which) =>
    i.param === 'startPressure' || i.param === 'hotPressure'
      ? formatValuePressure(i[which], unit)
      : i.param === 'temps'
        ? formatTemps(treadTemps(i, which))
        : (i[which]?.raw.trim() ?? '—');
  const explanation = (i: TireItem) => {
    if (i.reading) return i.status === 'changed' ? `${s.direction.readingChanged} ${s.topics.reading}` : s.direction[i.status === 'same' ? 'unchanged' : i.status];
    if (i.status !== 'changed') return s.direction[i.status === 'same' ? 'unchanged' : i.status];
    if (i.param === 'type') return `${s.direction.typeChanged} ${s.topics.type}`;
    const amount = formatPressure(Math.abs(i.deltaKpa ?? 0), unit);
    return `${fmt(i.deltaKpa! > 0 ? s.direction.pressureUp : s.direction.pressureDown, { amount })} ${s.topics.pressure}`;
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          {s.summaryTitle}
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            {plural(comparison.changedCount, s.summaryCount, { count: comparison.changedCount })}
          </span>
        </h3>
        {actions}
      </div>
      {comparison.changedCount === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{s.summaryNone}</p>}
      {changed.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-secondary text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{t.setups.common.parameter}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.baseline}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.comparison}</th>
                <th className="px-3 py-2 text-right font-semibold">{s.delta}</th>
                <th className="px-3 py-2 font-semibold">{s.interpretation}</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((i) => (
                <tr key={i.id} className={`border-t border-border align-top ${i.reading ? 'bg-secondary/40' : ''}`} title={i.path}>
                  <td className="px-3 py-2 font-semibold text-foreground">
                    {name(i)}
                    {i.reading && <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-normal text-muted-foreground">{s.readingTag}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-baseline">{value(i, 'baseline')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-comparison">{value(i, 'comparison')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">
                    {i.deltaKpa != null ? formatPressure(i.deltaKpa, unit, { signed: true }) : '—'}
                    {i.param === 'startPressure' && i.status === 'changed' && <span className="block text-[11px] text-muted-foreground">{signedPct(percentChange(i.baseline, i.comparison))}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{explanation(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {comparison.changedCount > 0 && <p className="text-xs text-muted-foreground">{s.hedge}</p>}
      {comparison.unsupported.length > 0 && (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground">{s.unsupportedTitle}</div>
          {comparison.unsupported.map((i) => (
            <div key={i.path} className="font-mono">
              {fmt(s.unsupportedItem, { path: i.path, baseline: i.baselineRaw ?? '—', comparison: i.comparisonRaw ?? '—' })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
