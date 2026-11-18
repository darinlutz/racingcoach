'use client';

import { ChevronDown, ChevronRight, Gauge, Hand } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { SetupParameter } from '@/lib/setupClient';
import { keyLabel, SETUP_CATEGORIES, type SetupCategory } from '@/lib/setupYaml';

// A setup's values in expandable categories (Tires, Suspension, ...), each as iRacing wrote it with its unit and where
// it's from. Readings (measured or worked out by iRacing) are hidden unless asked for. With onEdit, numeric settings
// get a box to type a new value in (the revision editor); edits holds what's been typed, by path.
export default function SetupParameterTable({
  parameters,
  sourceLabel,
  edits,
  onEdit,
}: {
  parameters: SetupParameter[];
  sourceLabel: string;
  edits?: Record<string, string>;
  onEdit?: (path: string, value: string) => void;
}) {
  const { t } = useLanguage();
  const s = t.setups;
  const [showReadings, setShowReadings] = useState(false);
  const [open, setOpen] = useState<Set<SetupCategory>>(() => new Set(['tires', 'suspension', 'brakes']));
  const byCategory = useMemo(() => {
    const map = new Map<SetupCategory, SetupParameter[]>();
    for (const p of parameters) {
      if (!showReadings && p.kind === 'reading') continue;
      map.set(p.category, [...(map.get(p.category) ?? []), p]);
    }
    return SETUP_CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [parameters, showReadings]);

  const toggle = (category: SetupCategory) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={showReadings} onChange={(e) => setShowReadings(e.target.checked)} />
          {s.common.showReadings}
        </label>
        <button type="button" className="text-primary hover:underline" onClick={() => setOpen(new Set(SETUP_CATEGORIES))}>
          {s.common.expandAll}
        </button>
        <button type="button" className="text-primary hover:underline" onClick={() => setOpen(new Set())}>
          {s.common.collapseAll}
        </button>
      </div>
      <div className="space-y-2">
        {byCategory.map(([category, rows]) => (
          <div key={category} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => toggle(category)}
              aria-expanded={open.has(category)}
              className="flex w-full items-center justify-between bg-secondary px-3 py-2 text-left font-semibold text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                {open.has(category) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                {s.categories[category]}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
            </button>
            {open.has(category) && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-1.5 font-semibold">{s.common.parameter}</th>
                      <th className="px-3 py-1.5 text-right font-semibold">{s.common.value}</th>
                      <th className="px-3 py-1.5 font-semibold">{s.common.unit}</th>
                      <th className="hidden px-3 py-1.5 font-semibold md:table-cell">{s.common.source}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const editable = !!onEdit && p.kind === 'setting' && p.value != null;
                      const number = p.raw.replace(/\s*\(.*\)\s*$/, '').replace(p.unit ?? '\u0000', '').trim();
                      return (
                        <tr key={p.path} className="border-t border-border" title={p.path}>
                          <td className="px-3 py-1.5 text-foreground">
                            <span className="text-muted-foreground">{[p.section, p.group].filter(Boolean).map((part) => keyLabel(part!)).join(' › ')} › </span>
                            {keyLabel(p.key)}
                            {p.inCar && (
                              <span title={s.common.inCarNote} aria-label={s.common.inCarNote} role="img">
                                <Hand className="ml-1 inline size-3.5 text-info-text" aria-hidden />
                              </span>
                            )}
                            {p.kind === 'reading' && (
                              <span title={s.common.readingNote} aria-label={s.common.readingNote} role="img">
                                <Gauge className="ml-1 inline size-3.5 text-muted-foreground" aria-hidden />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">
                            {editable ? (
                              <input
                                type="number"
                                inputMode="decimal"
                                step={p.decimals ? 1 / 10 ** p.decimals : 1}
                                value={edits?.[p.path] ?? String(p.value)}
                                onChange={(e) => onEdit!(p.path, e.target.value)}
                                aria-label={keyLabel(p.key)}
                                className={`w-24 rounded border bg-background px-2 py-0.5 text-right ${edits?.[p.path] !== undefined && Number(edits[p.path]) !== p.value ? 'border-primary' : 'border-border'}`}
                              />
                            ) : p.unit && p.value != null ? (
                              number
                            ) : (
                              p.raw
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.value != null ? (p.unit ?? '') : ''}</td>
                          <td className="hidden px-3 py-1.5 text-xs text-muted-foreground md:table-cell">{sourceLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
