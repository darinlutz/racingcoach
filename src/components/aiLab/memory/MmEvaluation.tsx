'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, danger, Field, input, memApi, Notice, pct, primary, Section, Toggle, useErrorText, useMemApi, when } from './memoryUi';

// The Evaluation Lab: cases with known expected (and excluded) memories and answers, runs with a mode, profile, K
// and optional answer model (memory on, and off for comparison), and every run's metrics kept for regression

type Case = { id: string; dataset: string; prompt: string; expected_memory_ids: string[]; excluded_memory_ids: string[]; expected_answer: string; namespaces: string[] };
type Run = { id: string; dataset: string; config: Record<string, unknown>; metrics: Record<string, number | null | object>; createdAt: string };
const METRICS = ['precisionAtK', 'recallAtK', 'mrr', 'unauthorizedRate', 'utilization', 'answerOverlapWithMemory', 'answerOverlapWithoutMemory', 'meanTokens', 'meanLatencyMs'] as const;

export default function MmEvaluation() {
  const { t, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const ev = m.evaluation;
  const errorText = useErrorText();
  const { data, reload } = useMemApi<{ cases: Case[]; runs: Run[] }>('/evaluation');
  const profiles = useMemApi<{ profiles: { id: string; name: string }[] }>('/profiles');
  const [draft, setDraft] = useState({ dataset: 'default', prompt: '', expected: '', excluded: '', expectedAnswer: '', namespaces: '' });
  const [run, setRun] = useState({ dataset: 'default', mode: 'hybrid', profileId: '', k: 5, answerModel: '', compareDisabled: true });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await memApi('/evaluation', { body });
      await reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const datasets = [...new Set(data?.cases.map((c) => c.dataset) ?? [])];
  const fmtMetric = (k: string, v: unknown) => (typeof v !== 'number' ? '—' : k === 'meanTokens' ? number(v, { maximumFractionDigits: 0 }) : k === 'meanLatencyMs' ? `${number(v, { maximumFractionDigits: 0 })} ms` : pct(v, number));
  return (
    <Section title={m.sections.evaluation} intro={ev.intro}>
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Box title={ev.addCase}>
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label={ev.dataset}><input className={input} value={draft.dataset} onChange={(e) => setDraft({ ...draft, dataset: e.target.value })} /></Field>
            <Field label={ev.namespaces}><input className={input} value={draft.namespaces} onChange={(e) => setDraft({ ...draft, namespaces: e.target.value })} /></Field>
          </div>
          <Field label={ev.prompt}><textarea className={`${input} min-h-14`} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} /></Field>
          <Field label={ev.expected}><input className={input} value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} /></Field>
          <Field label={ev.excludedIds}><input className={input} value={draft.excluded} onChange={(e) => setDraft({ ...draft, excluded: e.target.value })} /></Field>
          <Field label={ev.expectedAnswer}><input className={input} value={draft.expectedAnswer} onChange={(e) => setDraft({ ...draft, expectedAnswer: e.target.value })} /></Field>
          <button type="button" className={primary} disabled={busy || !draft.prompt.trim()} onClick={() => void call({ action: 'addCase', dataset: draft.dataset, prompt: draft.prompt, expectedMemoryIds: list(draft.expected), excludedMemoryIds: list(draft.excluded), expectedAnswer: draft.expectedAnswer, namespaces: list(draft.namespaces) }).then(() => setDraft({ ...draft, prompt: '', expected: '', excluded: '', expectedAnswer: '' }))}>
            {ev.addCase}
          </button>
        </Box>
        <Box title={ev.run}>
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label={ev.dataset}>
              <select className={input} value={run.dataset} onChange={(e) => setRun({ ...run, dataset: e.target.value })}>
                {(datasets.length ? datasets : ['default']).map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label={m.inspector.mode}>
              <select className={input} value={run.mode} onChange={(e) => setRun({ ...run, mode: e.target.value })}>
                <option value="hybrid">{m.library.hybrid}</option>
                <option value="semantic">{m.library.semantic}</option>
                <option value="keyword">{m.library.keyword}</option>
              </select>
            </Field>
            <Field label={m.inspector.profile}>
              <select className={input} value={run.profileId} onChange={(e) => setRun({ ...run, profileId: e.target.value })}>
                <option value="">{m.inspector.currentSettings}</option>
                {profiles.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={ev.k}><input className={input} type="number" min={1} max={50} value={run.k} onChange={(e) => setRun({ ...run, k: Number(e.target.value) })} /></Field>
            <Field label={ev.answerModel}><input className={input} value={run.answerModel} placeholder="qwen3:8b" onChange={(e) => setRun({ ...run, answerModel: e.target.value })} /></Field>
          </div>
          <Toggle checked={run.compareDisabled} onChange={(v) => setRun({ ...run, compareDisabled: v })} label={ev.compareDisabled} />
          <button type="button" className={primary} disabled={busy} onClick={() => void call({ action: 'run', ...run, profileId: run.profileId || undefined, answerModel: run.answerModel || undefined })}>{ev.run}</button>
        </Box>
      </div>
      <Box title={ev.cases}>
        {!data?.cases.length ? (
          <p className="text-sm text-muted-foreground">{ev.noCases}</p>
        ) : (
          <ul className="text-sm divide-y divide-border">
            {data.cases.map((c) => (
              <li key={c.id} className="py-2 flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-foreground">{c.prompt}</div>
                  <div className="text-xs text-muted-foreground">{c.dataset} · {c.expected_memory_ids.length} / {c.excluded_memory_ids.length} · {c.namespaces.join(', ')}</div>
                </div>
                <button type="button" className={danger} onClick={() => void call({ action: 'deleteCase', id: c.id })}>{m.common.delete}</button>
              </li>
            ))}
          </ul>
        )}
      </Box>
      <Box title={ev.runs}>
        {!data?.runs.length ? (
          <p className="text-sm text-muted-foreground">{ev.noRuns}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">{ev.dataset}</th>
                  {METRICS.map((k) => <th key={k} className="text-right py-1 px-1">{ev.metrics[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1">{r.dataset}<div className="text-xs text-muted-foreground">{when(r.createdAt)} · {String(r.config.mode)} · K={String(r.config.k)}</div></td>
                    {METRICS.map((k) => <td key={k} className="text-right tabular-nums px-1">{fmtMetric(k, r.metrics[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" className={btn} onClick={() => void reload()}>{m.common.refresh}</button>
      </Box>
    </Section>
  );
}
