'use client';

import { BrainCircuit, Info, Layers, RotateCcw, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ExaggerationSlider, Legend, SegmentButton, Segmented } from '@/components/engineeringUi';
import { useLanguage } from '@/components/LanguageProvider';
import { DEFAULT_EXAGGERATION, EXAGGERATIONS } from '@/lib/alignmentGeometry';
import { formatDash, type DashboardComparison, type DashboardItem, type DisplayMode } from '@/lib/setupDashboards';
import { keyLabel } from '@/lib/setupYaml';

const MODES: DisplayMode[] = ['baseline', 'comparison', 'overlay'];

export type DashboardControls = { mode: DisplayMode; exaggeration: number; resetKey: number };

// The frame every Setups dashboard tab shares (Aerodynamics, Drivetrain, Fuel, Electronics, Other): the title, the
// display mode, exaggeration and legend, the dashboard's own drawings (`hero` in the workstation, `children` under it,
// both given the controls), every parameter of the category with both setups' values, and the list of changes with
// Ask Setup Engineer. The words of each dashboard are setups.dashboards[dashboard]
export default function SetupDashboardView({
  comparison,
  icon: Icon,
  text,
  hero,
  children,
  topicOf,
  engineer,
  exaggerates = true,
}: {
  comparison: DashboardComparison;
  icon: LucideIcon;
  text: { title: string; tagline: string; badge: string };
  hero: (controls: DashboardControls) => ReactNode;
  children?: (controls: DashboardControls) => ReactNode;
  // What a changed item influences in general
  topicOf: (item: DashboardItem) => string;
  engineer?: { onAsk: () => void; asking: boolean };
  // Whether the drawings have an exaggeration to change
  exaggerates?: boolean;
}) {
  const { t, fmt, plural } = useLanguage();
  const c = t.setups.dashboards.common;
  const [mode, setMode] = useState<DisplayMode>('overlay');
  const [exaggeration, setExaggeration] = useState<number>(DEFAULT_EXAGGERATION);
  const [resetKey, setResetKey] = useState(0);
  const controls = { mode, exaggeration, resetKey };
  const changed = comparison.items.filter((i) => i.status !== 'same');
  const name = (i: DashboardItem) => `${[i.section, i.group].filter(Boolean).map((x) => keyLabel(x!)).join(' › ')} › ${keyLabel(i.key)}`;
  const explanation = (i: DashboardItem) => {
    if (i.status !== 'changed') return c.direction[i.status === 'same' ? 'unchanged' : i.status];
    const direction = i.delta ? fmt(i.delta.value > 0 ? c.direction.up : c.direction.down, { amount: formatDash({ ...i.delta, value: Math.abs(i.delta.value) }) }) : c.direction.changed;
    return `${direction} ${i.reading ? c.calc : topicOf(i)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-mono text-base font-bold uppercase tracking-widest text-foreground">
            <Icon className="size-5 text-align-baseline" aria-hidden />
            {text.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{text.tagline}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <i className="susp-pulse size-2 rounded-full bg-align-baseline" aria-hidden />
          {text.badge}
        </span>
      </div>

      {comparison.items.length === 0 ? (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{c.none}</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-secondary px-3 py-2">
              <Segmented label={c.modeLabel}>
                {MODES.map((m) => (
                  <SegmentButton key={m} active={mode === m} onClick={() => setMode(m)}>
                    {m === 'overlay' && <Layers className="size-3.5" aria-hidden />}
                    {c.modes[m]}
                  </SegmentButton>
                ))}
              </Segmented>
              {exaggerates && <ExaggerationSlider label={c.exaggeration} value={exaggeration} steps={EXAGGERATIONS} onChange={setExaggeration} />}
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <Legend tone="text-align-baseline" label={c.baseline} />
                <Legend tone="text-align-comparison" label={c.comparison} dashed />
                <Legend tone="text-align-neutral" label={c.unchanged} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('overlay');
                  setExaggeration(DEFAULT_EXAGGERATION);
                  setResetKey((k) => k + 1);
                }}
                title={c.reset}
                aria-label={c.reset}
                className="ml-auto inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-foreground"
              >
                <RotateCcw className="size-4" aria-hidden />
              </button>
            </div>
            <div className="p-3">{hero(controls)}</div>
            {exaggerates && (
              <div className="flex items-center gap-1.5 border-t border-border bg-secondary px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Info className="size-3.5" aria-hidden />
                {fmt(c.notice, { factor: exaggeration })}
              </div>
            )}
          </div>

          {children?.(controls)}

          {/* Every parameter of the category */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="font-mono text-sm font-bold uppercase tracking-widest text-foreground">{c.parameters}</h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {comparison.items.map((i) => (
                <div key={i.path} className={`rounded-lg border px-3 py-2 ${i.status === 'same' ? 'border-border bg-secondary' : 'border-align-comparison/60 bg-align-comparison/5'}`} title={i.path}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{keyLabel(i.key)}</span>
                    <span className="flex gap-1">
                      {i.reading && <Tag>{c.readingTag}</Tag>}
                      {i.borrowed && <Tag>{c.borrowedTag}</Tag>}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-sm tabular-nums">
                    <span className={i.status === 'same' ? 'text-align-neutral' : 'text-align-baseline'}>{formatDash(i.baseline)}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className={i.status === 'same' ? 'text-align-neutral' : 'text-align-comparison'}>{formatDash(i.comparison)}</span>
                    <span className={`ml-auto text-xs ${i.status === 'same' ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>{i.delta ? formatDash(i.delta, true) : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Changes */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground">
                {c.summaryTitle}
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                  {plural(comparison.changedCount, c.summaryCount, { count: comparison.changedCount })}
                </span>
              </h3>
              {engineer && (
                <button
                  type="button"
                  disabled={engineer.asking}
                  onClick={engineer.onAsk}
                  title={c.askEngineerHelp}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
                >
                  <BrainCircuit className="size-4" aria-hidden />
                  {engineer.asking ? t.setups.engineer.asking : c.askEngineer}
                </button>
              )}
            </div>
            {changed.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{c.summaryNone}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-secondary text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{t.setups.common.parameter}</th>
                      <th className="px-3 py-2 text-right font-semibold">{c.baseline}</th>
                      <th className="px-3 py-2 text-right font-semibold">{c.comparison}</th>
                      <th className="px-3 py-2 text-right font-semibold">{c.delta}</th>
                      <th className="px-3 py-2 font-semibold">{c.interpretation}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((i) => (
                      <tr key={i.path} className={`border-t border-border align-top ${i.reading ? 'bg-secondary/40' : ''}`} title={i.path}>
                        <td className="px-3 py-2 font-semibold text-foreground">
                          {name(i)}
                          {i.reading && <span className="ml-1.5"><Tag>{c.readingTag}</Tag></span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-baseline">{formatDash(i.baseline)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-align-comparison">{formatDash(i.comparison)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-foreground">{i.delta ? formatDash(i.delta, true) : '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{explanation(i)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {changed.some((i) => i.status === 'changed' && !i.reading) && <p className="text-xs text-muted-foreground">{c.hedge}</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded bg-card px-1 py-0.5 text-[10px] font-normal text-muted-foreground">{children}</span>;
}
