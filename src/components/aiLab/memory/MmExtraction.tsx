'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, Field, input, ModeSelect, Notice, primary, Section, Slider, Toggle, useErrorText } from './memoryUi';
import { useSettings } from './useSettings';

// Extraction Settings: the default operating mode, per-application and per-user overrides, thresholds, limits and
// the sensitive-information policy. Precedence is spelled out; the ceilings are the server's (effectiveMode).

const TRIGGERS = ['turn', 'messages', 'conversationEnd', 'explicit', 'scheduled'] as const;

export default function MmExtraction() {
  const { t, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const x = m.extraction;
  const errorText = useErrorText();
  const { data, draft, setDraft, error, saved, save } = useSettings();
  const [override, setOverride] = useState({ type: 'application' as 'application' | 'user', key: '', mode: 'readOnly' });
  if (!draft || !data) return error ? <Notice tone="error">{errorText(error)}</Notice> : <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  const e = draft.extraction;
  const set = (patch: Partial<typeof e>) => setDraft({ ...draft, extraction: { ...e, ...patch } });
  const p = (v: number) => `${number(v * 100, { maximumFractionDigits: 0 })}%`;
  return (
    <Section title={m.sections.extraction} intro={x.intro}>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {saved && <Notice tone="ok">{m.common.saved}</Notice>}
      <Notice>{x.secretsNever}</Notice>
      <div className="grid lg:grid-cols-2 gap-4">
        <Box title={x.defaultMode}>
          <ModeSelect value={draft.system.defaultMode} onChange={(v) => v && setDraft({ ...draft, system: { ...draft.system, defaultMode: v as typeof draft.system.defaultMode } })} />
          <p className="text-xs text-muted-foreground">{x.precedence}</p>
          <Toggle checked={e.paused} onChange={(v) => set({ paused: v })} label={x.paused} />
          <Field label={x.trigger}>
            <select className={input} value={e.trigger} onChange={(ev) => set({ trigger: ev.target.value as typeof e.trigger })}>
              {TRIGGERS.map((k) => <option key={k} value={k}>{x.triggers[k]}</option>)}
            </select>
          </Field>
          {e.trigger === 'messages' && <Field label={x.everyMessages}><input className={input} type="number" min={1} value={e.everyMessages} onChange={(ev) => set({ everyMessages: Number(ev.target.value) })} /></Field>}
          <Field label={x.sensitivePolicy}>
            <select className={input} value={draft.system.sensitivePolicy} onChange={(ev) => setDraft({ ...draft, system: { ...draft.system, sensitivePolicy: ev.target.value as 'flagAndReview' | 'reject' } })}>
              {Object.entries(x.sensitivePolicies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </Box>
        <Box title={m.common.filters}>
          <Slider label={x.minConfidence} value={e.minConfidence} min={0} max={1} step={0.05} onChange={(v) => set({ minConfidence: v })} format={p} />
          <Slider label={x.minImportance} value={e.minImportance} min={1} max={10} step={1} onChange={(v) => set({ minImportance: v })} />
          <Slider label={x.autoApproveConfidence} value={e.autoApproveConfidence} min={0.5} max={1} step={0.01} onChange={(v) => set({ autoApproveConfidence: v })} format={p} />
          <Slider label={x.hybridMaxImportance} value={e.hybridMaxImportance} min={1} max={10} step={1} onChange={(v) => set({ hybridMaxImportance: v })} />
          <Slider label={x.duplicateSimilarity} value={e.duplicateSimilarity} min={0.5} max={1} step={0.01} onChange={(v) => set({ duplicateSimilarity: v })} format={p} />
          <Slider label={x.conflictSimilarity} value={e.conflictSimilarity} min={0.3} max={1} step={0.01} onChange={(v) => set({ conflictSimilarity: v })} format={p} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={x.maxPerConversation}><input className={input} type="number" min={0} value={e.maxPerConversation} onChange={(ev) => set({ maxPerConversation: Number(ev.target.value) })} /></Field>
            <Field label={x.maxPerDay}><input className={input} type="number" min={0} value={e.maxPerDay} onChange={(ev) => set({ maxPerDay: Number(ev.target.value) })} /></Field>
          </div>
          <Toggle checked={e.allowUpdateProposals} onChange={(v) => set({ allowUpdateProposals: v })} label={x.allowUpdateProposals} />
          <Toggle checked={e.allowDeleteProposals} onChange={(v) => set({ allowDeleteProposals: v })} label={x.allowDeleteProposals} />
        </Box>
      </div>
      <div className="flex gap-2">
        <button type="button" className={primary} onClick={() => void save({ extraction: e, system: draft.system })}>{m.common.save}</button>
        <button type="button" className={btn} onClick={() => setDraft({ ...draft, extraction: data.defaults.extraction })}>{m.common.restoreDefaults}</button>
      </div>
      <Box title={`${x.applicationModes} / ${x.userModes}`}>
        <ul className="text-sm space-y-1">
          {[...data.applications.map((a) => ({ ...a, type: 'application' as const })), ...data.users.map((u) => ({ ...u, type: 'user' as const }))].map((o) => (
            <li key={`${o.type}:${o.key}`} className="flex items-center gap-2">
              <span className="text-foreground">{o.type === 'application' ? x.applicationModes : x.userModes}: {o.key}</span>
              <span className="text-muted-foreground">{o.settings.mode ? m.modes[o.settings.mode as keyof typeof m.modes] : m.categories.noOverride}</span>
              {o.settings.mode && <button type="button" className={btn} onClick={() => void save({}, { type: o.type, key: o.key, mode: null })}>{m.common.clear}</button>}
            </li>
          ))}
        </ul>
        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <Field label={x.addOverride}>
            <select className={input} value={override.type} onChange={(ev) => setOverride({ ...override, type: ev.target.value as 'application' | 'user' })}>
              <option value="application">{x.applicationModes}</option>
              <option value="user">{x.userModes}</option>
            </select>
          </Field>
          <Field label={x.key}><input className={input} value={override.key} onChange={(ev) => setOverride({ ...override, key: ev.target.value.trim().toLowerCase() })} /></Field>
          <ModeSelect value={override.mode} onChange={(v) => setOverride({ ...override, mode: v ?? 'readOnly' })} />
          <button type="button" className={primary} disabled={!override.key} onClick={() => void save({}, override)}>{m.common.apply}</button>
        </div>
      </Box>
    </Section>
  );
}
