import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

// The small pieces the Setups page's engineering tabs (SuspensionEngineeringView.tsx, BrakeEngineeringView.tsx) share:
// segmented buttons, the legend, a section card, a caveat line and a labelled slider. Kept together as they're only
// ever used together, on the alignment's tokens (globals.css's --align-*)

export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-md border border-border [&>*+*]:border-l [&>*+*]:border-border">
      {children}
    </div>
  );
}

export function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--align-baseline)]' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export function Legend({ tone, label, dashed = false }: { tone: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block w-4 border-t-2 border-current ${tone} ${dashed ? 'border-dashed' : ''}`} aria-hidden />
      {label}
    </span>
  );
}

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active ? 'border-align-baseline bg-align-baseline/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export function Section({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          <span className="text-align-baseline">{icon}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

// A drawing's heading row: its title and a badge
export function DiagramHeader({ title, badge, badgeTone = 'text-muted-foreground' }: { title: string; badge?: string; badgeTone?: string }) {
  return (
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">{title}</h4>
      {badge && <span className={`rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${badgeTone}`}>{badge}</span>}
    </div>
  );
}

export function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
  output,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  output: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <label htmlFor={id} className="font-semibold text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 accent-[var(--align-baseline)]"
      />
      <output htmlFor={id} className="min-w-16 rounded border border-border bg-secondary px-1.5 py-0.5 text-center font-mono tabular-nums text-foreground">
        {output}
      </output>
    </div>
  );
}

// The exaggeration slider over EXAGGERATIONS (1, 2, 5, 10)
export function ExaggerationSlider({
  label,
  value,
  steps,
  onChange,
}: {
  label: string;
  value: number;
  steps: readonly number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="font-mono">{steps[0]}×</span>
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={Math.max(0, steps.indexOf(value))}
        onChange={(e) => onChange(steps[Number(e.target.value)] ?? value)}
        aria-valuetext={`${value}×`}
        className="w-28 accent-[var(--align-baseline)]"
      />
      <span className="font-mono">{steps[steps.length - 1]}×</span>
      <output className="min-w-8 rounded border border-border bg-card px-1.5 py-0.5 text-center font-mono text-foreground">{value}×</output>
    </label>
  );
}
