'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, Dot, Field, input, memApi, Notice, primary, Section, Toggle, useErrorText, useMemApi, when } from './memoryUi';
import { useSettings } from './useSettings';

// Providers: what each memory task uses, chosen from the installed Ollama models (found at run time), the
// services' circuit breakers and figures, Test Connection / Test Model, and the privacy switches for frontier use

type Providers = {
  ollama: { reachable: boolean; models: { name: string; family: string | null; capabilities: string[] | null; parameterSize: string | null }[]; version: string | null; error: string | null };
  mem0: { ok: boolean; detail: string | null; version?: string | null };
  breakers: Record<'ollama' | 'mem0', { open: boolean; requests: number; errors: number; totalMs: number; lastOkAt: number | null; lastError: string | null }>;
  devOverride: { ollama: boolean; mem0: boolean };
  usage: { provider: string; jobs: number; failed: number; last_ok: string | null; avg_ms: number | null }[];
};

export default function MmProviders() {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const p = m.providers;
  const errorText = useErrorText();
  const { data: status, reload } = useMemApi<Providers>('/providers');
  const { draft, setDraft, data, error, saved, save } = useSettings();
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const test = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    setResult(null);
    try {
      const r = await memApi<{ ms?: number; answer?: string; dimensions?: number; detail?: string | null; ok?: boolean }>('/providers', { body: { action, ...body } });
      setResult({ tone: r.ok === false ? 'error' : 'ok', text: `${fmt(p.testResult, { ms: number(r.ms ?? 0) })}${r.dimensions ? ` · ${r.dimensions} dims` : ''}${r.answer ? ` · ${r.answer}` : ''}${r.detail ? ` · ${r.detail}` : ''}` });
      await reload();
    } catch (e) {
      setResult({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  if (!draft || !data) return error ? <Notice tone="error">{errorText(error)}</Notice> : <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  const pr = draft.providers;
  const set = (patch: Partial<typeof pr>) => setDraft({ ...draft, providers: { ...pr, ...patch } });
  const models = status?.ollama.models ?? [];
  const chat = models.filter((x) => !x.capabilities || x.capabilities.includes('completion')).map((x) => x.name);
  const embed = models.filter((x) => x.capabilities?.includes('embedding') || /embed/.test(x.name)).map((x) => x.name);
  const pick = (value: string, options: string[], onChange: (v: string) => void) => (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const breaker = (k: 'ollama' | 'mem0') => status?.breakers[k];
  return (
    <Section title={m.sections.providers} intro={p.intro}>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {saved && <Notice tone="ok">{m.common.saved}</Notice>}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {(status?.devOverride.ollama || status?.devOverride.mem0) && <Notice>{p.devOverride}</Notice>}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr><th className="text-left py-2 px-3">{m.common.details}</th><th className="text-left py-2 px-3">{m.fields.provider} / {m.fields.model}</th><th className="text-left py-2 px-3">{m.common.actions}</th></tr>
          </thead>
          <tbody>
            <tr className="border-t border-border"><td className="py-2 px-3">{p.tasks.conversation}</td><td className="py-2 px-3 text-muted-foreground" colSpan={2}>{p.conversationNote}</td></tr>
            <tr className="border-t border-border">
              <td className="py-2 px-3">{p.tasks.intelligence}</td>
              <td className="py-2 px-3">
                <select className={input} value={pr.intelligence} onChange={(e) => set({ intelligence: e.target.value as 'mem0' | 'native' })}>
                  <option value="mem0">{p.intelligenceOptions.mem0}</option>
                  <option value="native">{p.intelligenceOptions.native}</option>
                </select>
                <div className="mt-1"><Toggle checked={pr.fallbackToNative} onChange={(v) => set({ fallbackToNative: v })} label={p.fallbackToNative} /></div>
              </td>
              <td className="py-2 px-3 space-x-2 whitespace-nowrap">
                <button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testMem0')}>{p.testConnection}</button>
                <button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testNative')}>{p.intelligenceOptions.native}</button>
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 px-3">{p.tasks.extraction}</td>
              <td className="py-2 px-3">{pick(pr.extractionModel, chat, (v) => set({ extractionModel: v }))}</td>
              <td className="py-2 px-3"><button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testModel', { model: pr.extractionModel })}>{p.testModel}</button></td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 px-3">{p.tasks.conflict}</td>
              <td className="py-2 px-3">{pick(pr.conflictModel, chat, (v) => set({ conflictModel: v }))}</td>
              <td className="py-2 px-3"><button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testModel', { model: pr.conflictModel })}>{p.testModel}</button></td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 px-3">{p.tasks.summarization}</td>
              <td className="py-2 px-3">{pick(pr.summarizationModel, chat, (v) => set({ summarizationModel: v }))}</td>
              <td className="py-2 px-3"><button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testModel', { model: pr.summarizationModel })}>{p.testModel}</button></td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 px-3">{p.tasks.embeddings}</td>
              <td className="py-2 px-3">
                <div className="text-foreground">{pr.embeddingProvider} · {pr.embeddingModel}</div>
                <div className="text-xs text-muted-foreground">{p.embeddingChange}</div>
                {embed.length > 0 && <div className="text-xs text-muted-foreground">{p.installed}: {embed.join(', ')}</div>}
              </td>
              <td className="py-2 px-3"><button type="button" className={btn} disabled={busy !== null} onClick={() => void test('testEmbedding', { model: pr.embeddingModel, provider: pr.embeddingProvider })}>{p.testEmbedding}</button></td>
            </tr>
            <tr className="border-t border-border"><td className="py-2 px-3">{p.tasks.retrieval}</td><td className="py-2 px-3 text-muted-foreground" colSpan={2}>{p.retrievalNote}</td></tr>
          </tbody>
        </table>
      </div>
      <Box title={p.allowFrontier}>
        <Toggle checked={pr.allowFrontierFallback} onChange={(v) => set({ allowFrontierFallback: v })} label={p.allowFrontier} />
        <Toggle checked={pr.allowExternalPrivateContent} onChange={(v) => set({ allowExternalPrivateContent: v })} label={p.allowExternal} hint={p.externalWarning} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={p.frontierModel}><input className={input} value={pr.frontierModel} onChange={(e) => set({ frontierModel: e.target.value })} /></Field>
          <Field label={p.budget}><input className={input} type="number" min={0} value={pr.monthlyFrontierBudgetUsd} onChange={(e) => set({ monthlyFrontierBudgetUsd: Number(e.target.value) })} /></Field>
        </div>
      </Box>
      <button type="button" className={primary} onClick={() => void save({ providers: pr })}>{m.common.save}</button>
      <div className="grid lg:grid-cols-2 gap-4">
        {(['ollama', 'mem0'] as const).map((k) => {
          const b = breaker(k);
          const ok = k === 'ollama' ? status?.ollama.reachable ?? null : status?.mem0.ok ?? null;
          return (
            <Box key={k} title={<Dot ok={ok} label={k === 'ollama' ? `Ollama ${status?.ollama.version ?? ''}` : `Mem0 ${status?.mem0.version ?? ''}`} />}>
              {b && (
                <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <div>{p.requests}: {b.requests}</div>
                  <div>{p.errors}: {b.errors}</div>
                  <div>{p.avgLatency}: {b.requests - b.errors > 0 ? `${number(b.totalMs / (b.requests - b.errors), { maximumFractionDigits: 0 })} ms` : '—'}</div>
                  <div>{p.lastOk}: {b.lastOkAt ? when(new Date(b.lastOkAt).toISOString()) : m.common.never}</div>
                  {b.open && <div className="col-span-2 text-yellow-600 dark:text-yellow-400">{m.overview.circuitOpen}</div>}
                  {b.lastError && <div className="col-span-2 break-all">{b.lastError}</div>}
                </dl>
              )}
              {k === 'ollama' && !status?.ollama.reachable && <p className="text-xs text-muted-foreground">{p.noModels} {status?.ollama.error}</p>}
              {k === 'mem0' && status?.mem0.detail && <p className="text-xs text-muted-foreground">{status.mem0.detail}</p>}
            </Box>
          );
        })}
      </div>
      <Box title={p.installed}>
        <ul className="grid sm:grid-cols-2 gap-1 text-sm">
          {models.map((x) => (
            <li key={x.name} className="text-foreground">
              {x.name} <span className="text-xs text-muted-foreground">{[x.family, x.parameterSize, x.capabilities?.join('/')].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
        {!models.length && <p className="text-sm text-muted-foreground">{p.noModels}</p>}
        <button type="button" className={btn} onClick={() => void test('resetBreakers')}>{p.resetBreakers}</button>
      </Box>
      {!!status?.usage.length && (
        <Box title={p.usage}>
          <table className="w-full text-sm">
            <tbody>
              {status.usage.map((u) => (
                <tr key={u.provider} className="border-t border-border first:border-0">
                  <td className="py-1">{u.provider}</td>
                  <td className="py-1 text-right tabular-nums">{u.jobs}</td>
                  <td className="py-1 text-right tabular-nums">{u.failed} {p.errors.toLowerCase()}</td>
                  <td className="py-1 text-right tabular-nums">{u.avg_ms === null ? '—' : `${number(u.avg_ms)} ms`}</td>
                  <td className="py-1 text-right text-xs text-muted-foreground">{when(u.last_ok) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Section>
  );
}
