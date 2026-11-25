'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, Field, input, memApi, ModeSelect, Notice, primary, Section, Toggle, useErrorText, useReference, type Category } from './memoryUi';

// Categories: create and edit every setting (color, icon, default importance, retention, extraction, approval,
// AI updates, mode override, enabled)

const RULES = ['untilChanged', 'days', 'untilSuperseded', 'untilCompleted', 'configurable', 'followsRelated'] as const;
const UPDATES = ['never', 'propose', 'automatic'] as const;
const blank: Partial<Category> & { key: string } = { key: '', name: '', description: '', example: '', color: '#64748b', icon: 'Tag', defaultImportance: 5, retentionRule: 'untilChanged', retentionDays: null, extractionEligible: true, requiresApproval: true, autoUpdate: 'propose', mode: null, enabled: true };

export default function MmCategories() {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  const c = m.categories;
  const errorText = useErrorText();
  const { categories, reload } = useReference();
  const [edit, setEdit] = useState<(Partial<Category> & { key: string }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setMessage(null);
    try {
      const { id, memoryCount: _count, ...body } = edit as Category;
      void _count;
      await memApi(id ? `/categories/${id}` : '/categories', { method: id ? 'PATCH' : 'POST', body });
      setEdit(null);
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  return (
    <Section title={m.sections.categories} intro={c.intro} actions={<button type="button" className={primary} onClick={() => setEdit({ ...blank })}>{c.add}</button>}>
      {message && <Notice tone="error">{message}</Notice>}
      {edit && (
        <Box title={edit.id ? edit.name : c.add}>
          <div className="grid sm:grid-cols-3 gap-3">
            {!edit.id && <Field label={c.key}><input className={input} value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} /></Field>}
            <Field label={c.name}><input className={input} value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={c.color}><input className={`${input} h-10`} type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <Field label={c.icon}><input className={input} value={edit.icon ?? ''} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} /></Field>
            <Field label={c.defaultImportance}><input className={input} type="number" min={1} max={10} value={edit.defaultImportance} onChange={(e) => setEdit({ ...edit, defaultImportance: Number(e.target.value) })} /></Field>
            <Field label={c.retention}>
              <select className={input} value={edit.retentionRule} onChange={(e) => setEdit({ ...edit, retentionRule: e.target.value })}>
                {RULES.map((r) => <option key={r} value={r}>{c.retentionRules[r]}</option>)}
              </select>
            </Field>
            {(edit.retentionRule === 'days' || edit.retentionRule === 'configurable') && (
              <Field label={c.retentionDays}><input className={input} type="number" min={1} value={edit.retentionDays ?? ''} onChange={(e) => setEdit({ ...edit, retentionDays: e.target.value ? Number(e.target.value) : null })} /></Field>
            )}
            <Field label={c.autoUpdate}>
              <select className={input} value={edit.autoUpdate} onChange={(e) => setEdit({ ...edit, autoUpdate: e.target.value })}>
                {UPDATES.map((u) => <option key={u} value={u}>{c.autoUpdates[u]}</option>)}
              </select>
            </Field>
            <Field label={c.mode}><ModeSelect value={edit.mode ?? null} onChange={(v) => setEdit({ ...edit, mode: v })} allowNone /></Field>
          </div>
          <Field label={c.description}><input className={input} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label={c.example}><input className={input} value={edit.example ?? ''} onChange={(e) => setEdit({ ...edit, example: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-4">
            <Toggle checked={edit.extractionEligible ?? true} onChange={(v) => setEdit({ ...edit, extractionEligible: v })} label={c.extractionEligible} />
            <Toggle checked={edit.requiresApproval ?? true} onChange={(v) => setEdit({ ...edit, requiresApproval: v })} label={c.requiresApproval} />
            <Toggle checked={edit.enabled ?? true} onChange={(v) => setEdit({ ...edit, enabled: v })} label={c.enabled} />
          </div>
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={() => void save()}>{m.common.save}</button>
            <button type="button" className={btn} onClick={() => setEdit(null)}>{m.common.cancel}</button>
          </div>
        </Box>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {categories.map((x) => (
          <Box key={x.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: x.color }} aria-hidden />
                <span className="font-semibold text-foreground">{x.name}</span>
                {!x.enabled && <span className="text-xs text-muted-foreground">({m.common.no})</span>}
              </div>
              <button type="button" className={btn} onClick={() => setEdit({ ...x })}>{m.common.edit}</button>
            </div>
            <p className="text-sm text-muted-foreground">{x.description}</p>
            {x.example && <p className="text-xs text-muted-foreground italic">“{x.example}”</p>}
            <dl className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
              <div>{c.defaultImportance}: {x.defaultImportance}</div>
              <div>{c.retentionRules[x.retentionRule as keyof typeof c.retentionRules]}{x.retentionDays ? ` (${x.retentionDays})` : ''}</div>
              <div>{c.requiresApproval}: {x.requiresApproval ? m.common.yes : m.common.no}</div>
              <div>{c.autoUpdate}: {c.autoUpdates[x.autoUpdate as keyof typeof c.autoUpdates]}</div>
              {x.mode && <div>{c.mode}: {m.modes[x.mode as keyof typeof m.modes]}</div>}
              <div>{fmt(c.count, { count: x.memoryCount })}</div>
            </dl>
          </Box>
        ))}
      </div>
    </Section>
  );
}
