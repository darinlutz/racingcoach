'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { normalizeWeights, type RetrievalParams } from '@/lib/memory/rules';
import { Box, btn, danger, Field, input, memApi, Notice, primary, Section, Slider, useErrorText, useMemApi } from './memoryUi';
import { useSettings } from './useSettings';

// Retrieval Settings: the ranking weights (shown normalized, as the engine uses them), thresholds and budgets,
// and named profiles that apply to models, applications or namespaces

type Profile = { id: string; name: string; params: RetrievalParams; appliesTo: { models: string[]; applications: string[]; namespaces: string[] } };
const WEIGHT_KEYS = ['semantic', 'importance', 'recency', 'confidence'] as const;
const WEIGHT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

export function WeightBar({ weights }: { weights: RetrievalParams['weights'] }) {
  const { t, number } = useLanguage();
  const r = t.aiLab.memoryManager.retrieval;
  const n = normalizeWeights(weights);
  return (
    <div>
      <div className="flex h-3 rounded overflow-hidden gap-[2px]" role="img" aria-label={WEIGHT_KEYS.map((k) => `${r[k]} ${number(n[k] * 100, { maximumFractionDigits: 0 })}%`).join(', ')}>
        {WEIGHT_KEYS.map((k, i) => <div key={k} style={{ width: `${n[k] * 100}%`, background: WEIGHT_COLORS[i] }} />)}
      </div>
      <div className="flex flex-wrap gap-3 mt-1 text-xs text-foreground">
        {WEIGHT_KEYS.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: WEIGHT_COLORS[i] }} aria-hidden />
            {r[k]} {number(n[k] * 100, { maximumFractionDigits: 0 })}%
          </span>
        ))}
      </div>
    </div>
  );
}

export function RetrievalControls({ value, onChange }: { value: RetrievalParams; onChange: (v: RetrievalParams) => void }) {
  const { t, number } = useLanguage();
  const r = t.aiLab.memoryManager.retrieval;
  const n = normalizeWeights(value.weights);
  const setWeight = (k: (typeof WEIGHT_KEYS)[number], v: number) => onChange({ ...value, weights: { ...n, [k]: v } });
  const p = (v: number) => `${number(v * 100, { maximumFractionDigits: 0 })}%`;
  return (
    <div className="space-y-3">
      {WEIGHT_KEYS.map((k) => <Slider key={k} label={r[k]} value={Math.round(n[k] * 100) / 100} min={0} max={1} step={0.01} onChange={(v) => setWeight(k, v)} format={p} />)}
      <WeightBar weights={value.weights} />
      <Slider label={r.minSimilarity} value={value.minSimilarity} min={0} max={1} step={0.01} onChange={(v) => onChange({ ...value, minSimilarity: v })} format={(v) => number(v, { maximumFractionDigits: 2 })} />
      <Slider label={r.maxMemories} value={value.maxMemories} min={1} max={50} step={1} onChange={(v) => onChange({ ...value, maxMemories: v })} />
      <Slider label={r.maxContextTokens} value={value.maxContextTokens} min={128} max={8192} step={64} onChange={(v) => onChange({ ...value, maxContextTokens: v })} format={(v) => number(v)} />
      <Slider label={r.maxPerCategory} value={value.maxPerCategory} min={1} max={20} step={1} onChange={(v) => onChange({ ...value, maxPerCategory: v })} />
      <Slider label={r.recencyHalfLife} value={value.recencyHalfLifeDays} min={1} max={730} step={1} onChange={(v) => onChange({ ...value, recencyHalfLifeDays: v })} />
      <Slider label={r.keywordBlend} value={value.keywordBlend} min={0} max={1} step={0.05} onChange={(v) => onChange({ ...value, keywordBlend: v })} format={p} />
      <Slider label={r.pinnedBoost} value={value.pinnedBoost} min={0} max={0.5} step={0.01} onChange={(v) => onChange({ ...value, pinnedBoost: v })} format={(v) => number(v, { maximumFractionDigits: 2 })} />
    </div>
  );
}

export default function MmRetrieval() {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  const r = m.retrieval;
  const errorText = useErrorText();
  const { data, draft, setDraft, error, saved, save } = useSettings();
  const profiles = useMemApi<{ profiles: Profile[] }>('/profiles');
  const [name, setName] = useState('');
  const [applies, setApplies] = useState({ models: '', applications: '', namespaces: '' });
  const [compare, setCompare] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  if (!draft || !data) return error ? <Notice tone="error">{errorText(error)}</Notice> : <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const saveProfile = async () => {
    try {
      await memApi('/profiles', { body: { name, params: draft.retrieval, appliesTo: { models: list(applies.models), applications: list(applies.applications), namespaces: list(applies.namespaces) } } });
      setName('');
      await profiles.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  const other = profiles.data?.profiles.find((p) => p.id === compare);
  return (
    <Section title={m.sections.retrieval} intro={r.intro}>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {message && <Notice tone="error">{message}</Notice>}
      {saved && <Notice tone="ok">{m.common.saved}</Notice>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Box title={r.weights}>
          <RetrievalControls value={draft.retrieval} onChange={(v) => setDraft({ ...draft, retrieval: v })} />
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={() => void save({ retrieval: draft.retrieval })}>{m.common.save}</button>
            <button type="button" className={btn} onClick={() => setDraft({ ...draft, retrieval: data.defaults.retrieval })}>{m.common.restoreDefaults}</button>
          </div>
        </Box>
        <Box title={r.profiles}>
          {!profiles.data?.profiles.length && <p className="text-sm text-muted-foreground">{r.noProfiles}</p>}
          <ul className="space-y-2">
            {profiles.data?.profiles.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-2 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{p.name}</span>
                  {draft.system.activeProfileId === p.id && <span className="text-xs text-primary">{r.isDefault}</span>}
                  <span className="ml-auto flex gap-1">
                    <button type="button" className={btn} onClick={() => setDraft({ ...draft, retrieval: p.params })}>{r.load}</button>
                    <button type="button" className={btn} onClick={() => void save({ system: { ...draft.system, activeProfileId: draft.system.activeProfileId === p.id ? null : p.id } })}>{r.makeDefault}</button>
                    <button type="button" className={danger} onClick={() => void memApi(`/profiles/${p.id}`, { method: 'DELETE' }).then(() => profiles.reload())}>{m.common.delete}</button>
                  </span>
                </div>
                <WeightBar weights={p.params.weights} />
                {(p.appliesTo.models.length > 0 || p.appliesTo.applications.length > 0 || p.appliesTo.namespaces.length > 0) && (
                  <p className="text-xs text-muted-foreground">{r.appliesTo}: {[...p.appliesTo.models, ...p.appliesTo.applications, ...p.appliesTo.namespaces].join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-border pt-3">
            <Field label={r.profileName}><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid sm:grid-cols-3 gap-2">
              <Field label={r.appliesModels}><input className={input} value={applies.models} onChange={(e) => setApplies({ ...applies, models: e.target.value })} /></Field>
              <Field label={r.appliesApps}><input className={input} value={applies.applications} onChange={(e) => setApplies({ ...applies, applications: e.target.value })} /></Field>
              <Field label={r.appliesNamespaces}><input className={input} value={applies.namespaces} onChange={(e) => setApplies({ ...applies, namespaces: e.target.value })} /></Field>
            </div>
            <button type="button" className={primary} disabled={!name.trim()} onClick={() => void saveProfile()}>{r.saveProfile}</button>
          </div>
          {!!profiles.data?.profiles.length && (
            <div className="border-t border-border pt-3 space-y-2">
              <Field label={r.compare}>
                <select className={input} value={compare} onChange={(e) => setCompare(e.target.value)}>
                  <option value="">{m.common.none}</option>
                  {profiles.data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              {other && (
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground text-left"><th /><th>{m.inspector.currentSettings}</th><th>{other.name}</th></tr></thead>
                  <tbody>
                    {(['minSimilarity', 'maxMemories', 'maxContextTokens', 'maxPerCategory', 'recencyHalfLifeDays', 'keywordBlend', 'pinnedBoost'] as const).map((k) => (
                      <tr key={k} className="border-t border-border"><td className="py-1 text-muted-foreground">{k}</td><td>{draft.retrieval[k]}</td><td className={draft.retrieval[k] !== other.params[k] ? 'font-semibold text-foreground' : ''}>{other.params[k]}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{fmt(r.version, { version: 'rank-v1' })}</p>
        </Box>
      </div>
    </Section>
  );
}
