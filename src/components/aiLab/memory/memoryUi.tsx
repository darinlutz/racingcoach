'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { MemoryManagerText } from '@/lib/i18n/dictionaries/memoryManagerText';

// What the Memory Manager's sections share: the Memory API client, the reference data (namespaces, categories,
// settings) loaded once, and small pieces of UI: stat cards, a drawer, toggles, sliders and the charts. Charts are
// plain SVG with a hover tooltip and a table view; one series is blue, two are blue and orange (the dataviz
// reference palette, validated for both themes), and a category's own color only ever marks that category.

export type MemoryText = MemoryManagerText;

export class MemApiError extends Error {
  constructor(public code: string, public detail: string | null, public status: number) {
    super(code);
  }
}

export async function memApi<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/memory/v1${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    throw new MemApiError(e?.code ?? `http${response.status}`, e?.message ?? null, response.status);
  }
  return data as T;
}

export function useErrorText() {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  return useCallback(
    (error: unknown) => {
      if (error instanceof MemApiError) {
        const known = (m.errors as Record<string, string>)[error.code];
        if (known) return fmt(known, { detail: error.detail ?? '' });
        return fmt(m.common.failed, { error: [error.code, error.detail].filter(Boolean).join(': ') });
      }
      return fmt(m.common.failed, { error: error instanceof Error ? error.message : String(error) });
    },
    [m, fmt]
  );
}

// A GET that reloads on demand (and when its path changes)
export function useMemApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await memApi<T>(path));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the path changes
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

// ---- Reference data ----

export type Namespace = { id: string; parentId: string | null; path: string; name: string; kind: string; description: string; isCustomerData: boolean; globalApproved: boolean; enabled: boolean; mode: string | null; memoryCount: number };
export type Category = {
  id: string;
  key: string;
  name: string;
  description: string;
  example: string;
  color: string;
  icon: string;
  defaultImportance: number;
  retentionRule: string;
  retentionDays: number | null;
  extractionEligible: boolean;
  requiresApproval: boolean;
  autoUpdate: string;
  mode: string | null;
  enabled: boolean;
  memoryCount: number;
};

type Ref = { namespaces: Namespace[]; categories: Category[]; reload: () => Promise<void> };
const RefContext = createContext<Ref>({ namespaces: [], categories: [], reload: async () => undefined });
export const useReference = () => useContext(RefContext);

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const reload = useCallback(async () => {
    const [n, c] = await Promise.all([memApi<{ namespaces: Namespace[] }>('/namespaces'), memApi<{ categories: Category[] }>('/categories')]);
    setNamespaces(n.namespaces);
    setCategories(c.categories);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once
    void reload().catch(() => undefined);
  }, [reload]);
  return <RefContext.Provider value={{ namespaces, categories, reload }}>{children}</RefContext.Provider>;
}

// ---- Styles and small pieces ----

export const input = 'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
export const label = 'block text-xs font-medium text-muted-foreground mb-1';
export const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
export const primary = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
export const danger = 'px-3 py-1.5 rounded-lg text-sm font-semibold border border-red-500/60 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50';
export const card = 'bg-card rounded-xl border border-border';

export function Section({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Box({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`${card} p-4 space-y-3 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' | 'ok' }) {
  const styles = { info: 'border-border text-muted-foreground', warn: 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400', error: 'border-red-500/50 text-red-500', ok: 'border-green-600/50 text-green-700 dark:text-green-400' }[tone];
  return (
    <p className={`text-sm rounded-lg border px-3 py-2 ${styles}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

// A stat card. `value` null means not measured (shown as such, never as 0).
export function Stat({ label: name, value, hint, tone }: { label: string; value: string | number | null; hint?: ReactNode; tone?: 'warn' | 'ok' }) {
  const { t } = useLanguage();
  return (
    <div className={`${card} p-3`}>
      <div className="text-xs font-medium text-muted-foreground">{name}</div>
      <div className={`text-2xl font-bold tabular-nums ${value === null ? 'text-muted-foreground text-base font-medium py-1' : tone === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : 'text-foreground'}`}>
        {value === null ? t.aiLab.memoryManager.common.notMeasured : value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function Dot({ ok, label: text }: { ok: boolean | null; label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok === null ? 'bg-gray-400' : ok ? 'bg-green-500' : 'bg-red-500'}`} aria-hidden />
      {text}
    </span>
  );
}

export function Pill({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground whitespace-nowrap">
      {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label: text, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2 text-sm text-foreground ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {text}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function Slider({ label: text, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-medium text-muted-foreground mb-1">
        <span>{text}</span>
        <span className="tabular-nums text-foreground">{format ? format(value) : value}</span>
      </span>
      <input type="range" className="w-full accent-[var(--color-primary)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Field({ label: text, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{text}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
    </label>
  );
}

// A slide-over panel; Escape closes it
export function Drawer({ open, title, onClose, children, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label={t.aiLab.memoryManager.common.close} onClick={onClose} />
      <div className={`relative h-full w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} bg-secondary border-l border-border shadow-xl overflow-y-auto`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-secondary border-b border-border px-5 py-3">
          <h2 className="text-lg font-bold text-foreground truncate">{title}</h2>
          <button type="button" className={btn} onClick={onClose}>
            {t.aiLab.memoryManager.common.close}
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : null);
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : null);

export function ModeSelect({ value, onChange, allowNone, noneLabel }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const { t } = useLanguage();
  const m = t.aiLab.memoryManager;
  return (
    <select className={input} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel ?? m.categories.noOverride}</option>}
      {(Object.keys(m.modes) as (keyof typeof m.modes)[]).map((k) => (
        <option key={k} value={k}>
          {m.modes[k]} — {m.modeHelp[k]}
        </option>
      ))}
    </select>
  );
}

export function NamespaceSelect({ value, onChange, allowAll, multiple }: { value: string; onChange: (v: string) => void; allowAll?: boolean; multiple?: false }) {
  const { namespaces } = useReference();
  const { t } = useLanguage();
  void multiple;
  return (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">{t.aiLab.memoryManager.common.all}</option>}
      {namespaces.map((n) => (
        <option key={n.id} value={n.id}>
          {'  '.repeat(n.path.split('/').length - 1)}
          {n.path}
          {n.isCustomerData ? ' ★' : ''}
        </option>
      ))}
    </select>
  );
}

export function CategorySelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const { categories } = useReference();
  const { t } = useLanguage();
  return (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">{t.aiLab.memoryManager.common.all}</option>}
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// ---- Charts ----

export const SERIES = ['var(--mm-series-1)', 'var(--mm-series-2)'] as const;
// The validated reference palette (dataviz skill): blue and orange, stepped for each theme
export const chartVars = '[--mm-series-1:#2a78d6] [--mm-series-2:#eb6834] dark:[--mm-series-1:#3987e5] dark:[--mm-series-2:#d95926]';

type Point = { x: string; values: (number | null)[] };

// A line chart over days: thin 2px lines, a crosshair and tooltip on hover, a table view. One y-axis only.
export function LineChart({ points, series, height = 180, title, valueFormat }: { points: Point[]; series: string[]; height?: number; title: string; valueFormat?: (v: number) => string }) {
  const { t, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const f = valueFormat ?? ((v: number) => number(v));
  const W = 640;
  const H = height;
  const pad = { l: 40, r: 12, t: 10, b: 22 };
  const all = points.flatMap((p) => p.values).filter((v): v is number => v !== null);
  const hasData = all.some((v) => v !== 0);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  return (
    <div className={`space-y-2 ${chartVars}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground text-sm">{title}</span>
          {series.length > 1 &&
            series.map((s, i) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES[i] }} aria-hidden />
                {s}
              </span>
            ))}
        </div>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setTable(!table)}>
          {table ? m.common.showChart : m.common.showTable}
        </button>
      </div>
      {!hasData ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{m.analytics.noData}</p>
      ) : table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1 pr-2">{m.analytics.range}</th>
                {series.map((s) => (
                  <th key={s} className="py-1 pr-2 text-right">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.x} className="border-t border-border">
                  <td className="py-1 pr-2">{p.x}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="py-1 pr-2 text-right tabular-nums">
                      {v === null ? '—' : f(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            role="img"
            aria-label={title}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = ref.current!.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
              setHover(Math.max(0, Math.min(points.length - 1, i)));
            }}
          >
            {ticks.map((tv) => (
              <g key={tv}>
                <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} className="stroke-border" strokeWidth={1} />
                <text x={pad.l - 6} y={y(tv) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                  {f(Math.round(tv))}
                </text>
              </g>
            ))}
            {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground" fontSize={10}>
                {points[i]?.x.slice(5)}
              </text>
            ))}
            {series.map((s, si) => {
              const d = points.map((p, i) => (p.values[si] === null ? null : `${x(i)},${y(p.values[si]!)}`)).filter(Boolean);
              return <polyline key={s} points={d.join(' ')} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
            })}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
                {series.map((s, si) =>
                  points[hover].values[si] === null ? null : <circle key={s} cx={x(hover)} cy={y(points[hover].values[si]!)} r={4} fill={SERIES[si]} className="stroke-card" strokeWidth={2} />
                )}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}>
              <div className="font-semibold text-foreground">{points[hover].x}</div>
              {series.map((s, si) => (
                <div key={s} className="flex items-center gap-1 text-foreground">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: SERIES[si] }} aria-hidden />
                  {s}: <span className="tabular-nums">{points[hover].values[si] === null ? '—' : f(points[hover].values[si]!)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Horizontal bars, each labelled with its name and value (identity never by color alone)
export function BarList({ items, title, valueFormat, onPick }: { items: { key: string; label: string; value: number; color?: string }[]; title: string; valueFormat?: (v: number) => string; onPick?: (key: string) => void }) {
  const { t, number } = useLanguage();
  const f = valueFormat ?? ((v: number) => number(v));
  const max = Math.max(1, ...items.map((i) => i.value));
  const shown = items.filter((i) => i.value > 0);
  return (
    <div className={`space-y-2 ${chartVars}`}>
      <div className="font-semibold text-foreground text-sm">{title}</div>
      {!shown.length ? (
        <p className="text-sm text-muted-foreground py-3">{t.aiLab.memoryManager.analytics.noData}</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((i) => (
            <li key={i.key}>
              <button type="button" className="w-full text-left group" onClick={onPick ? () => onPick(i.key) : undefined} disabled={!onPick} title={`${i.label}: ${f(i.value)}`}>
                <div className="flex justify-between text-xs text-foreground mb-0.5">
                  <span className="truncate pr-2">{i.label}</span>
                  <span className="tabular-nums text-muted-foreground">{f(i.value)}</span>
                </div>
                <div className="h-2 rounded bg-border/40">
                  <div className="h-2 rounded group-hover:opacity-80" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? SERIES[0] }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function pct(v: number | null | undefined, number: (n: number, o?: Intl.NumberFormatOptions) => string) {
  return v === null || v === undefined ? null : `${number(v * 100, { maximumFractionDigits: 1 })}%`;
}

export function bytes(v: number | null | undefined, number: (n: number, o?: Intl.NumberFormatOptions) => string) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let u = 0;
  while (x >= 1000 && u < units.length - 1) {
    x /= 1000;
    u++;
  }
  return `${number(x, { maximumFractionDigits: x < 10 ? 1 : 0 })} ${units[u]}`;
}
