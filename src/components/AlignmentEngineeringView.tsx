'use client';

import { BrainCircuit, Crosshair, Info, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import AlignmentComparisonSummary from '@/components/AlignmentComparisonSummary';
import FrontCamberDiagram from '@/components/FrontCamberDiagram';
import { useLanguage } from '@/components/LanguageProvider';
import RearCamberDiagram from '@/components/RearCamberDiagram';
import TopDownToeDiagram from '@/components/TopDownToeDiagram';
import {
  camberLayers,
  changeDirection,
  CORNERS,
  cornerAxle,
  DEFAULT_EXAGGERATION,
  EXAGGERATIONS,
  findItem,
  formatAlignment,
  MAX_DRAWN_ANGLE,
  toeLayers,
  topicOf,
  type AlignmentComparison,
  type AlignmentItem,
  type Corner,
  type DisplayMode,
} from '@/lib/alignmentGeometry';

const MODES: DisplayMode[] = ['baseline', 'comparison', 'overlay'];

// The Compare tab's Wheel Alignment Engineering Comparison (docs/setups.md): the top view's toe, the front and rear
// views' camber, both setups at once or one at a time, exaggerated for clarity; the four corners' values; the selected
// wheel's analysis; the list of changes; and Ask Setup Engineer. Everything is drawn from compareAlignment's items,
// which are the setups' own values: the exaggeration changes the drawing only
export default function AlignmentEngineeringView({
  comparison,
  engineer,
}: {
  comparison: AlignmentComparison;
  // Ask Setup Engineer, when the Setup Engineer is on for this page
  engineer?: { onAsk: () => void; asking: boolean };
}) {
  const { t, fmt } = useLanguage();
  const a = t.setups.alignment;
  const [mode, setMode] = useState<DisplayMode>('overlay');
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_EXAGGERATION);
  const [selected, setSelected] = useState<Corner>('LF');
  const props = { comparison, mode, exaggeration, selected, onSelect: setSelected };

  const notes = useMemo(() => {
    const out: string[] = [];
    const toes = comparison.items.filter((i) => i.param === 'toe' || i.param === 'totalToe');
    const keys = new Map<string, AlignmentItem['toeSign']>();
    for (const i of toes) keys.set(i.path.split('.').pop()!, i.toeSign);
    for (const [key, sign] of keys) out.push(fmt(a.toeSign[sign ?? 'unknown'], { key }));
    const units = new Set(toes.flatMap((i) => [i.baseline?.unit, i.comparison?.unit]).filter(Boolean));
    if (units.has('mm') || units.has('in')) out.push(a.schematicToe);
    if (units.has('deg')) out.push(a.realToe);
    if (comparison.frontToe === 'total') out.push(a.axleTotal);
    if (comparison.frontToe === 'none') out.push(a.frontToeNone);
    if (comparison.rearToe === 'total') out.push(a.axleTotalRear);
    return out;
  }, [comparison, a, fmt]);

  const clamped = CORNERS.some((c) =>
    [...toeLayers(comparison, c, mode, exaggeration), ...camberLayers(comparison, c, c.endsWith('F') ? 'front' : 'rear', mode, exaggeration)].some((l) => l.visible && l.clamped)
  );

  if (comparison.items.length === 0) {
    return <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{a.none}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{a.intro}</p>
        {engineer && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={engineer.asking}
              onClick={engineer.onAsk}
              title={a.askEngineerHelp}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
            >
              <BrainCircuit className="size-4" aria-hidden />
              {engineer.asking ? t.setups.engineer.asking : a.askEngineer}
            </button>
          </div>
        )}
      </div>

      {/* Toolbar: display mode, exaggeration, legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-secondary px-3 py-2">
        <div role="group" aria-label={a.modeLabel} className="inline-flex overflow-hidden rounded-md border border-border">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === m ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
              } ${m !== 'baseline' ? 'border-l border-border' : ''}`}
            >
              {m === 'overlay' && <Layers className="size-3.5" aria-hidden />}
              {a.modes[m]}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{a.exaggeration}</span>
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
          <Legend tone="text-align-baseline" label={a.baseline} />
          <Legend tone="text-align-comparison" label={a.comparison} dashed />
          <Legend tone="text-align-neutral" label={a.unchanged} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <TopDownToeDiagram {...props} />
        <div className="grid min-w-0 gap-4">
          <FrontCamberDiagram {...props} />
          <RearCamberDiagram {...props} />
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        <p className="flex items-start gap-1.5 font-semibold text-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {exaggeration === 1 ? a.trueAngles : fmt(a.exaggerated, { factor: exaggeration })}
        </p>
        {clamped && <p className="pl-5">{fmt(a.clamped, { max: MAX_DRAWN_ANGLE })}</p>}
        {notes.map((n) => (
          <p key={n} className="pl-5">
            {n}
          </p>
        ))}
      </div>

      <WheelAnalysis comparison={comparison} corner={selected} />

      <AlignmentComparisonSummary comparison={comparison} />
    </div>
  );
}

function Legend({ tone, label, dashed = false }: { tone: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block w-4 border-t-2 border-current ${tone} ${dashed ? 'border-dashed' : ''}`} aria-hidden />
      {label}
    </span>
  );
}

// The selected wheel's values and what each change does physically
function WheelAnalysis({ comparison, corner }: { comparison: AlignmentComparison; corner: Corner }) {
  const { t, fmt } = useLanguage();
  const a = t.setups.alignment;
  const items = comparison.items.filter((i) => i.scope === corner);
  const axleTotal = !findItem(comparison, corner, 'toe') ? findItem(comparison, cornerAxle(corner), 'totalToe') : null;
  const shown = axleTotal ? [...items, axleTotal] : items;
  return (
    <section aria-live="polite" className="grid gap-4 rounded-lg border border-border bg-secondary p-4 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div>
        <div className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-align-baseline">
          <Crosshair className="size-3.5" aria-hidden />
          {a.cornerShort[corner]} · {a.selected}
        </div>
        <h4 className="mt-1 text-lg font-bold uppercase text-foreground">{fmt(a.analysisTitle, { corner: a.corners[corner] })}</h4>
      </div>
      <div className="space-y-4">
        {shown.length === 0 && <p className="text-sm text-muted-foreground">{a.noCornerData}</p>}
        {shown.map((item) => {
          const direction = changeDirection(item);
          const name = item.param === 'totalToe' ? `${a.axles[item.scope as 'front' | 'rear']} · ${a.params.totalToe}` : a.params[item.param];
          return (
            <div key={item.id}>
              <div className="grid grid-cols-3 gap-3">
                <Value label={`${a.baseline} · ${name}`} value={formatAlignment(item.baseline)} tone={item.status === 'same' ? 'text-align-neutral' : 'text-align-baseline'} />
                <Value label={`${a.comparison} · ${name}`} value={formatAlignment(item.comparison)} tone={item.status === 'same' ? 'text-align-neutral' : 'text-align-comparison'} />
                <Value label={a.delta} value={formatAlignment(item.delta, true)} tone={item.status === 'same' ? 'text-align-neutral' : 'text-foreground'} />
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {fmt(a.direction[direction], { amount: item.delta ? formatAlignment({ ...item.delta, value: Math.abs(item.delta.value) }) : '' })}
              </p>
              {item.status === 'changed' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {a.topics[topicOf(item)]} {a.hedge}
                </p>
              )}
              {item.param === 'totalToe' && <p className="mt-1 text-xs text-muted-foreground">{fmt(a.fromAxle, { axle: a.axles[cornerAxle(corner)].toLowerCase() })}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Value({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={label}>
        {label}
      </div>
      <div className={`font-mono text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
