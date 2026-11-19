'use client';

import { Activity, ArrowDownUp, ArrowLeftRight, Box, BrainCircuit, Info, Layers, MoveVertical, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import AntiRollBarDiagram from '@/components/AntiRollBarDiagram';
import Car3DViewerLazy from '@/components/car3d/Car3DViewerLazy';
import { useSelectedCarKey } from '@/components/CarViewContext';
import { Caveat, Legend, SegmentButton, Segmented, Section, Slider } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import RideHeightDiagram from '@/components/RideHeightDiagram';
import SuspensionCarOverview from '@/components/SuspensionCarOverview';
import SuspensionChangesSummary from '@/components/SuspensionChangesSummary';
import SuspensionDamper from '@/components/SuspensionDamper';
import SuspensionSpring from '@/components/SuspensionSpring';
import {
  bumpEngaged,
  COMPONENT_FILTERS,
  CORNER_PARAMS,
  CORNERS,
  damperItems,
  damperScopes,
  DEFAULT_EXAGGERATION,
  EXAGGERATIONS,
  findItem,
  formatSuspension,
  gapScale,
  heightOffset,
  heightReference,
  LOAD_RANGE,
  percentChange,
  springCompression,
  SUSPENSION_VIEWS,
  toneOf,
  valueOf,
  visibleKinds,
  type ComponentFilter,
  type Corner,
  type CornerParam,
  type DamperParam,
  type DisplayMode,
  type SuspensionComparison,
  type SuspensionDrawingProps,
  type SuspensionItem,
  type SuspensionView,
  type Which,
} from '@/lib/suspensionGeometry';

const MODES: DisplayMode[] = ['baseline', 'comparison', 'overlay'];
const COMPRESSION: DamperParam[] = ['lsComp', 'hsComp', 'comp'];
const REBOUND: DamperParam[] = ['lsRbd', 'hsRbd', 'rbd'];
// The corner values that pick a component filter when their name is clicked
const FILTER_OF: Partial<Record<CornerParam, ComponentFilter>> = { rideHeight: 'rideHeight', springRate: 'springRate', bumpGap: 'bumpGap' };
// The springs' drawing scale: pixels per unit of compression (schematic)
const SPRING_PX = { mm: 5, in: 127 } as const;
// 2D Engineering (the drawings) or Interactive 3D (the car's model), kept for the visit while moving between the tabs
type DrawingMode = '2d' | '3d';
const DRAWING_MODE_KEY = 'setups.suspensionDrawing';

function useDrawingMode(): [DrawingMode, (mode: DrawingMode) => void] {
  const [mode, setMode] = useState<DrawingMode>('2d');
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this visit's storage
      if (sessionStorage.getItem(DRAWING_MODE_KEY) === '3d') setMode('3d');
    } catch {}
  }, []);
  const set = (next: DrawingMode) => {
    setMode(next);
    try {
      sessionStorage.setItem(DRAWING_MODE_KEY, next);
    } catch {}
  };
  return [mode, set];
}

// The Setups page's Suspension tab (docs/setups.md; the design came from the Lovable project
// darinlutz/screenshot-match): the suspension of two setups of the same car, at every corner. A workstation (the 3D
// overview, side, front and rear elevations, and the selected corner's cutaway, with display mode, exaggeration and a
// component filter), the four corners' values, then a section per system (ride height, springs, bump rubbers,
// dampers, anti-roll bars) and the list of changes with Ask Setup Engineer. Everything is drawn from
// compareSuspension's items, which are the setups' own values in their own units: the exaggeration and the
// demonstrations (load, compression, damper stroke) change the drawings only
export default function SuspensionEngineeringView({
  comparison,
  engineer,
}: {
  comparison: SuspensionComparison;
  // Ask Setup Engineer, when the Setup Engineer is on for this page
  engineer?: { onAsk: () => void; asking: boolean };
}) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const [view, setView] = useState<SuspensionView>('overview');
  const [component, setComponent] = useState<ComponentFilter>('all');
  const [mode, setMode] = useState<DisplayMode>('overlay');
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_EXAGGERATION);
  const [selected, setSelected] = useState<Corner>('LF');
  const [load, setLoad] = useState<number | null>(null);
  const [travel, setTravel] = useState(0);
  const [direction, setDirection] = useState<'compression' | 'rebound'>('compression');
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useDrawingMode();
  const carKey = useSelectedCarKey();
  const models = t.setups.carModels;
  const props: SuspensionDrawingProps = { comparison, mode, exaggeration, selected, onSelect: setSelected, component };

  // The springs' units decide the load's: N for N/mm, lbf for lb/in
  const springUnits = useMemo(
    () => new Set(comparison.items.filter((i) => i.param === 'springRate').flatMap((i) => [i.baseline?.unit, i.comparison?.unit]).filter(Boolean)),
    [comparison]
  );
  const range = LOAD_RANGE[springUnits.has('lb/in') && !springUnits.has('N/mm') ? 'lb/in' : 'N/mm'];
  const appliedLoad = load ?? range.initial;

  // The bump rubber's travel is in the selected corner's gap unit
  const gaps = [valueOf(comparison, selected, 'bumpGap', 'baseline'), valueOf(comparison, selected, 'bumpGap', 'comparison')];
  const gapUnit: 'mm' | 'in' = gaps.find((g) => g)?.unit === 'in' ? 'in' : 'mm';
  const maxGap = Math.max(...gaps.map((g) => (g && g.unit === gapUnit ? g.value : 0)), gapUnit === 'mm' ? 10 : 0.4);
  const travelMax = Number((maxGap * 1.25).toFixed(gapUnit === 'mm' ? 0 : 2));
  const shownTravel = Math.min(travel, travelMax);

  const reset = () => {
    setView('overview');
    setComponent('all');
    setMode('overlay');
    setExaggeration(DEFAULT_EXAGGERATION);
    setSelected('LF');
    setLoad(null);
    setTravel(0);
    setPlaying(false);
    setDirection('compression');
  };

  if (comparison.items.length === 0) {
    return <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{s.none}</p>;
  }

  const show = (system: ComponentFilter) => component === 'all' || component === system;
  const heading =
    view === 'overview' ? s.headings.overview : view === 'detail' ? fmt(s.headings.detail, { corner: s.corners[selected] }) : s.headings.elevation;
  const clamped = (() => {
    const reference = heightReference(comparison);
    return CORNERS.some((c) => visibleKinds(mode).some((k) => heightOffset(valueOf(comparison, c, 'rideHeight', k), reference, exaggeration).clamped));
  })();

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-mono text-base font-bold uppercase tracking-widest text-foreground">
            <Box className="size-5 text-align-baseline" aria-hidden />
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={models.suspension.title}>
              {(['2d', '3d'] as const).map((d) => (
                <SegmentButton key={d} active={drawing === d} onClick={() => setDrawing(d)}>
                  {d === '2d' ? models.suspension.view2d : models.suspension.view3d}
                </SegmentButton>
              ))}
            </Segmented>
            {drawing === '2d' && (
              <Segmented label={s.viewLabel}>
                {SUSPENSION_VIEWS.map((v) => (
                  <SegmentButton key={v} active={view === v} onClick={() => setView(v)}>
                    {v === 'overview' && <Box className="size-3.5" aria-hidden />}
                    {s.views[v]}
                  </SegmentButton>
                ))}
              </Segmented>
            )}
          </div>
          <button
            type="button"
            onClick={reset}
            title={s.reset}
            aria-label={s.reset}
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-secondary px-3 py-2">
          <Segmented label={s.modeLabel}>
            {MODES.map((m) => (
              <SegmentButton key={m} active={mode === m} onClick={() => setMode(m)}>
                {m === 'overlay' && <Layers className="size-3.5" aria-hidden />}
                {s.modes[m]}
              </SegmentButton>
            ))}
          </Segmented>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{s.exaggeration}</span>
            <span className="font-mono">1×</span>
            <input
              type="range"
              min={0}
              max={EXAGGERATIONS.length - 1}
              step={1}
              value={Math.max(0, EXAGGERATIONS.indexOf(exaggeration as (typeof EXAGGERATIONS)[number]))}
              onChange={(e) => setExaggeration(EXAGGERATIONS[Number(e.target.value)] ?? DEFAULT_EXAGGERATION)}
              aria-valuetext={`${exaggeration}×`}
              className="w-28 accent-[var(--align-baseline)]"
            />
            <span className="font-mono">10×</span>
            <output className="min-w-8 rounded border border-border bg-card px-1.5 py-0.5 text-center font-mono text-foreground">{exaggeration}×</output>
          </label>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Legend tone="text-align-baseline" label={s.baseline} />
            <Legend tone="text-align-comparison" label={s.comparison} dashed />
            <Legend tone="text-align-neutral" label={s.unchanged} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" role="group" aria-label={s.componentLabel}>
          <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.componentLabel}</span>
          {COMPONENT_FILTERS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={component === c}
              onClick={() => setComponent(c)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                component === c ? 'border-align-baseline bg-align-baseline/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.components[c]}
            </button>
          ))}
        </div>

        <div className="p-3">
          {drawing === '3d' ? (
            // The compared setups' car as its approved 3D model (or the generic car), turned and zoomed freely; picking
            // a corner here or in the cards below selects it in both, and the cards keep showing the setups' values
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">{models.suspension.title}</h4>
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-align-baseline">
                  {fmt(models.suspension.selected, { corner: s.corners[selected] })}
                </span>
              </div>
              <Car3DViewerLazy carKey={carKey} selectedCorner={selected} onSelectCorner={setSelected} height={460} />
              <p className="text-xs text-muted-foreground">{models.suspension.exteriorOnly}</p>
            </div>
          ) : view === 'side' || view === 'front' || view === 'rear' ? (
            <RideHeightDiagram {...props} view={view} />
          ) : (
            <div className="rounded-lg border border-border p-3 align-grid">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">{heading}</h4>
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-align-baseline">
                  {fmt(s.selectedBadge, { corner: selected })}
                </span>
              </div>
              {view === 'overview' ? (
                <SuspensionCarOverview {...props} />
              ) : (
                <CornerCutaway props={props} load={appliedLoad} travel={shownTravel} travelUnit={gapUnit} />
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-4">
          {CORNERS.map((corner) => (
            <CornerCard
              key={corner}
              comparison={comparison}
              corner={corner}
              selected={selected === corner}
              onSelect={() => setSelected(corner)}
              onPick={(param) => {
                setSelected(corner);
                const filter = FILTER_OF[param];
                if (filter) setComponent(filter);
              }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Info className="size-3.5" aria-hidden />
            {fmt(s.notice, { factor: exaggeration })}
            {clamped && ` · ${s.clampedNote}`}
          </span>
          <span>{s.noMotionRatios}</span>
        </div>
      </div>

      {show('rideHeight') && (
        <Section icon={<MoveVertical className="size-4" aria-hidden />} title={s.ride.title} aside={<span className="text-xs text-muted-foreground">{s.ride.subtitle}</span>}>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <RideHeightDiagram {...props} view="side" />
            <div className="grid min-w-0 gap-3">
              <RideHeightDiagram {...props} view="front" compact />
              <RideHeightDiagram {...props} view="rear" compact />
            </div>
          </div>
          <Caveat>{s.ride.caveat}</Caveat>
        </Section>
      )}

      {show('springRate') && (
        <Section
          icon={<Activity className="size-4" aria-hidden />}
          title={s.springs.title}
          aside={
            <Slider
              id="susp-load"
              label={s.springs.load}
              min={range.min}
              max={range.max}
              step={range.step}
              value={appliedLoad}
              onChange={setLoad}
              output={`${appliedLoad} ${range.unit}`}
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CORNERS.map((corner) => (
              <SpringPanel key={corner} props={props} corner={corner} load={appliedLoad} />
            ))}
          </div>
          {springUnits.size > 1 && <Caveat>{s.springs.unitsDiffer}</Caveat>}
          <Caveat>{s.springs.caveat}</Caveat>
        </Section>
      )}

      {show('bumpGap') && (
        <Section
          icon={<ArrowDownUp className="size-4" aria-hidden />}
          title={fmt(s.bump.title, { corner: s.corners[selected] })}
          aside={
            <Slider
              id="susp-travel"
              label={s.bump.travel}
              min={0}
              max={travelMax}
              step={gapUnit === 'mm' ? 0.5 : 0.02}
              value={shownTravel}
              onChange={setTravel}
              output={`${shownTravel.toFixed(gapUnit === 'mm' ? 1 : 2)} ${gapUnit}`}
            />
          }
        >
          <BumpRubber props={props} travel={shownTravel} travelUnit={gapUnit} onSelect={setSelected} />
        </Section>
      )}

      {show('dampers') && (
        <Section
          icon={<ArrowDownUp className="size-4" aria-hidden />}
          title={s.dampers.title}
          aside={
            <div className="flex items-center gap-2">
              <Segmented label={s.dampers.title}>
                {(['compression', 'rebound'] as const).map((d) => (
                  <SegmentButton key={d} active={direction === d} onClick={() => setDirection(d)}>
                    {s.dampers[d]}
                  </SegmentButton>
                ))}
              </Segmented>
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                aria-label={playing ? s.dampers.pause : s.dampers.play}
                title={playing ? s.dampers.pause : s.dampers.play}
                className="inline-flex size-8 items-center justify-center rounded-md border border-border text-foreground hover:border-primary"
              >
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              </button>
            </div>
          }
        >
          <Dampers props={props} direction={direction} playing={playing} />
          <Caveat>{s.dampers.caveat}</Caveat>
        </Section>
      )}

      {show('arb') && (
        <Section icon={<ArrowLeftRight className="size-4" aria-hidden />} title={s.arb.title} aside={<span className="text-xs text-muted-foreground">{s.arb.subtitle}</span>}>
          <div className="grid gap-3 lg:grid-cols-2">
            <AntiRollBarDiagram {...props} axle="front" />
            <AntiRollBarDiagram {...props} axle="rear" />
          </div>
          <Caveat>{s.arb.caveat}</Caveat>
        </Section>
      )}

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <SuspensionChangesSummary
          comparison={comparison}
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

// ---- Pieces ----

// One corner's values in the strip under the drawing: B, C and the delta of each, the selected one outlined
function CornerCard({
  comparison,
  corner,
  selected,
  onSelect,
  onPick,
}: {
  comparison: SuspensionComparison;
  corner: Corner;
  selected: boolean;
  onSelect: () => void;
  onPick: (param: CornerParam) => void;
}) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const items = CORNER_PARAMS.map((p) => findItem(comparison, corner, p)).filter((i): i is SuspensionItem => !!i);
  return (
    <section
      className={`min-w-0 rounded-lg border p-2 transition-colors ${selected ? 'border-align-baseline bg-align-baseline/5 shadow-[0_0_0_1px_var(--align-baseline)]' : 'border-border bg-secondary'}`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-sm font-semibold text-foreground">
        <span className="font-mono text-[10px] font-bold tracking-widest text-align-baseline">{corner}</span>
        {s.corners[corner]}
        <span className={`ml-auto size-2 rounded-full ${selected ? 'bg-align-baseline' : 'bg-border'}`} aria-hidden />
      </button>
      {items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">—</p>
      ) : (
        <table className="mt-1 w-full text-xs">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-0.5 text-left font-semibold" />
              <th className="py-0.5 text-right font-semibold">{s.baselineShort}</th>
              <th className="py-0.5 text-right font-semibold">{s.comparisonShort}</th>
              <th className="py-0.5 text-right font-semibold">Δ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const same = item.status === 'same';
              return (
                <tr key={item.id} className="border-t border-border/60" title={item.path}>
                  <td className="py-1 pr-1">
                    <button
                      type="button"
                      onClick={() => onPick(item.param as CornerParam)}
                      aria-label={fmt(s.highlight, { param: s.params[item.param], corner: s.corners[corner] })}
                      className="text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {s.params[item.param]}
                    </button>
                  </td>
                  <td className={`whitespace-nowrap py-1 text-right font-mono tabular-nums ${same ? 'text-align-neutral' : 'text-align-baseline'}`}>{formatSuspension(item.baseline)}</td>
                  <td className={`whitespace-nowrap py-1 text-right font-mono tabular-nums ${same ? 'text-align-neutral' : 'text-align-comparison'}`}>{formatSuspension(item.comparison)}</td>
                  <td className={`whitespace-nowrap py-1 text-right font-mono tabular-nums ${same ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>
                    {formatSuspension(item.delta, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Spring length in the drawing under the load (schematic scale), or null without a rate in a unit the load applies to
function springLength(load: number, item: SuspensionItem | null, which: Which, rest: number) {
  const c = springCompression(load, item?.[which] ?? null);
  return c ? { length: Math.max(rest * 0.45, rest - c.value * SPRING_PX[c.unit]), compression: c } : null;
}

// The selected corner's spring and damper side by side for each setup, under the springs' load and the bump
// rubber's compression
function CornerCutaway({ props, load, travel, travelUnit }: { props: SuspensionDrawingProps; load: number; travel: number; travelUnit: 'mm' | 'in' }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, selected, mode } = props;
  const spring = findItem(comparison, selected, 'springRate');
  const gap = findItem(comparison, selected, 'bumpGap');
  const scale = gapScale(comparison, selected, 70);
  const kinds = visibleKinds(mode);
  return (
    <svg viewBox="0 0 800 430" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.headings.detail, { corner: s.corners[selected] })}>
      <path d="M130 384 H670 M400 50 V400" className="align-reference" />
      {kinds.map((kind, i) => {
        const drawn = springLength(load, spring, kind, 160);
        const g = gap?.[kind] ?? null;
        const gapPx = g && g.unit === travelUnit ? g.value * scale : null;
        const x = kinds.length === 1 ? 330 : i ? 520 : 170;
        return (
          <g key={kind} transform={`translate(${x} 70)`}>
            {drawn ? (
              <SuspensionSpring tone={toneOf(spring, kind)} length={drawn.length} y={160 - drawn.length} />
            ) : (
              <text y="80" textAnchor="middle">
                {s.springs.noRate.toUpperCase()}
              </text>
            )}
            <g transform="translate(90 -40)">
              <SuspensionDamper
                tone={toneOf(gap, kind)}
                gapPx={gapPx}
                shiftPx={gapPx != null ? travel * scale : 0}
                remaining={g && gapPx != null ? formatSuspension({ ...g, value: Math.max(0, g.value - travel) }) : null}
              />
            </g>
            <text x="45" y="300" textAnchor="middle" className={`align-value ${toneOf(null, kind)}`}>
              {(kind === 'baseline' ? s.baseline : s.comparison).toUpperCase()} · {selected}
            </text>
            {drawn && (
              <text x="0" y="200" textAnchor="middle" className={`align-value ${toneOf(spring, kind)}`}>
                {formatSuspension(spring?.[kind] ?? null)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// One corner's springs under the hypothetical load: each setup's spring compressed by load / rate, its rate, the
// delta and a bar of the two rates
function SpringPanel({ props, corner, load }: { props: SuspensionDrawingProps; corner: Corner; load: number }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, mode, selected, onSelect } = props;
  const item = findItem(comparison, corner, 'springRate');
  const kinds = visibleKinds(mode);
  const pct = percentChange(item);
  const a = item?.baseline ?? null;
  const b = item?.comparison ?? null;
  const max = Math.max(a?.value ?? 0, b?.value ?? 0, 1);
  return (
    <section className={`min-w-0 rounded-lg border p-3 align-grid ${selected === corner ? 'border-align-baseline' : 'border-border'}`}>
      <button type="button" onClick={() => onSelect(corner)} className="flex w-full items-center justify-between text-sm font-semibold text-foreground">
        {s.corners[corner]}
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{corner}</span>
      </button>
      <svg viewBox="0 0 260 240" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.springs.compressionAria, { corner: s.corners[corner] })}>
        <path d="M40 42 H220 M40 200 H220" className="align-reference" />
        {kinds.map((kind, i) => {
          const drawn = springLength(load, item, kind, 120);
          const x = kinds.length === 1 ? 130 : i ? 175 : 85;
          return (
            <g key={kind} transform={`translate(${x} 55)`}>
              {drawn ? (
                <>
                  <SuspensionSpring tone={toneOf(item, kind)} length={drawn.length} y={120 - drawn.length} />
                  <text y="165" textAnchor="middle" className={`align-value ${toneOf(item, kind)}`}>
                    {drawn.compression.value.toFixed(drawn.compression.unit === 'mm' ? 2 : 3)} {drawn.compression.unit}
                  </text>
                </>
              ) : (
                <text y="65" textAnchor="middle">
                  {s.springs.noRate.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-sm tabular-nums">
        <span className="text-align-baseline">{formatSuspension(a)}</span>
        <span className="text-align-comparison">{formatSuspension(b)}</span>
      </div>
      <div className="mt-0.5 text-center font-mono text-xs tabular-nums text-foreground">
        Δ {formatSuspension(item?.delta ?? null, true)}
        {pct != null && ` (${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%)`}
      </div>
      {a && b && a.unit === b.unit && (
        <div className="mt-2 space-y-1" role="img" aria-label={s.springs.scaleAria}>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="susp-bar h-full rounded-full bg-align-baseline" style={{ width: `${(Math.max(0, a.value) / max) * 100}%` }} />
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="susp-bar h-full rounded-full bg-align-comparison" style={{ width: `${(Math.max(0, b.value) / max) * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

// The selected corner's bump rubber in cutaway for each setup, compressed by the travel, and whether it touches
function BumpRubber({ props, travel, travelUnit, onSelect }: { props: SuspensionDrawingProps; travel: number; travelUnit: 'mm' | 'in'; onSelect: (c: Corner) => void }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, selected, mode } = props;
  const item = findItem(comparison, selected, 'bumpGap');
  const scale = gapScale(comparison, selected, 70);
  const kinds = visibleKinds(mode);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-lg border border-border p-3 align-grid">
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={s.componentLabel}>
          {CORNERS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={selected === c}
              onClick={() => onSelect(c)}
              className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${selected === c ? 'border-align-baseline text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {c}
            </button>
          ))}
        </div>
        {!item ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{s.bump.noGap}</p>
        ) : (
          <svg viewBox="0 0 600 300" className="align-svg h-auto w-full" role="img" aria-label={s.bump.aria}>
            {kinds.map((kind, i) => {
              const g = item[kind];
              const gapPx = g && g.unit === travelUnit ? g.value * scale : null;
              return (
                <g key={kind} transform={`translate(${kinds.length === 1 ? 280 : i ? 400 : 170} 20)`}>
                  <SuspensionDamper
                    tone={toneOf(item, kind)}
                    gapPx={gapPx}
                    shiftPx={gapPx != null ? travel * scale : 0}
                    remaining={g && gapPx != null ? fmt(s.bump.remaining, { gap: formatSuspension({ ...g, value: Math.max(0, g.value - travel) }) }) : null}
                  />
                  <text y="280" textAnchor="middle" className={`align-value ${toneOf(item, kind)}`}>
                    {(kind === 'baseline' ? s.baseline : s.comparison).toUpperCase()} · {formatSuspension(g)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-secondary p-4">
        <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">{fmt(s.bump.analysis, { corner: s.corners[selected] })}</h4>
        {kinds.map((kind) => {
          const g = item?.[kind] ?? null;
          const engaged = bumpEngaged(travel, travelUnit, g);
          return (
            <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
              <span className={`font-mono text-xs ${kind === 'baseline' ? 'text-align-baseline' : 'text-align-comparison'}`}>
                {(kind === 'baseline' ? s.baseline : s.comparison).toUpperCase()} · {formatSuspension(g)}
              </span>
              <strong
                className={`rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${
                  engaged == null ? 'text-muted-foreground' : engaged ? 'bg-tele-neg/15 text-tele-neg' : 'bg-tele-pos/15 text-tele-pos'
                }`}
              >
                {engaged == null ? s.bump.unavailable : engaged ? s.bump.engaged : s.bump.clearance}
              </strong>
            </div>
          );
        })}
        <p className="text-sm text-muted-foreground">{s.bump.explanation}</p>
        <Caveat>{s.bump.caveat}</Caveat>
      </div>
    </div>
  );
}

// The dampers of each axle (or corner), the picked direction's stroke animated, and every click setting with a bar
// either side of zero
function Dampers({ props, direction, playing }: { props: SuspensionDrawingProps; direction: 'compression' | 'rebound'; playing: boolean }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, mode } = props;
  const scopes = damperScopes(comparison);
  if (!scopes.length) return <p className="text-sm text-muted-foreground">{s.dampers.none}</p>;
  const all = scopes.flatMap((scope) => damperItems(comparison, scope));
  const max = Math.max(1, ...all.flatMap((i) => [Math.abs(i.baseline?.value ?? 0), Math.abs(i.comparison?.value ?? 0)]));
  const kinds = visibleKinds(mode);
  const label = (p: DamperParam) => (p.startsWith('ls') ? s.dampers.low : p.startsWith('hs') ? s.dampers.high : s.dampers.single);
  return (
    <div className={`grid gap-3 ${scopes.length > 2 ? 'sm:grid-cols-2' : 'lg:grid-cols-2'}`}>
      {scopes.map((scope) => {
        const name = scope === 'front' || scope === 'rear' ? s.axles[scope] : s.corners[scope];
        const items = damperItems(comparison, scope);
        return (
          <section key={scope} className="min-w-0 rounded-lg border border-border p-3 align-grid">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
                {fmt(s.dampers.heading, { scope: name, direction: s.dampers[direction] })}
              </h4>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{s.dampers.adjustment}</span>
            </div>
            <div className="grid items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <svg viewBox="0 0 200 280" className="align-svg mx-auto h-auto w-full max-w-[11rem]" role="img" aria-label={fmt(s.dampers.aria, { scope: name, direction: s.dampers[direction] })}>
                {kinds.map((kind, i) => (
                  <g key={kind} transform={`translate(${kinds.length === 1 ? 100 : i ? 145 : 55} 10)`}>
                    <SuspensionDamper tone={toneOf(items.find((x) => x.status !== 'same') ?? items[0], kind)} motion={playing} direction={direction} />
                  </g>
                ))}
              </svg>
              <div className="space-y-3">
                {[COMPRESSION, REBOUND].map((params, row) => {
                  const list = params.map((p) => items.find((i) => i.param === p)).filter((i): i is SuspensionItem => !!i);
                  if (!list.length) return null;
                  const active = (row === 0 ? 'compression' : 'rebound') === direction;
                  return (
                    <div key={row} className={`rounded-md border px-3 py-2 transition-colors ${active ? 'border-align-baseline bg-card' : 'border-border bg-card/60 opacity-75'}`}>
                      <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{row === 0 ? s.dampers.compression : s.dampers.rebound}</div>
                      {list.map((item) => (
                        <div key={item.id} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-2 py-0.5 text-xs" title={item.path}>
                          <span className="truncate text-muted-foreground">{label(item.param as DamperParam)}</span>
                          <ClickBars item={item} max={max} />
                          <span className="whitespace-nowrap text-right font-mono tabular-nums">
                            <span className="text-align-baseline">{formatSuspension(item.baseline)}</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="text-align-comparison">{formatSuspension(item.comparison)}</span>
                            {item.status === 'changed' && <span className="ml-1 font-semibold text-foreground">({formatSuspension(item.delta, true)})</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Two bars, baseline above comparison, from a center line: negative clicks to the left, positive to the right
function ClickBars({ item, max }: { item: SuspensionItem; max: number }) {
  return (
    <span className="relative block h-4" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {(['baseline', 'comparison'] as const).map((kind, i) => {
        const v = item[kind];
        if (!v) return null;
        const share = (Math.abs(v.value) / max) * 50;
        return (
          <span
            key={kind}
            className={`susp-bar absolute h-1.5 rounded-full ${kind === 'baseline' ? 'bg-align-baseline' : 'bg-align-comparison'}`}
            style={{ top: i ? 9 : 2, width: `${share}%`, ...(v.value < 0 ? { right: '50%' } : { left: '50%' }) }}
          />
        );
      })}
    </span>
  );
}
