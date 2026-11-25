'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { RetrievalParams } from '@/lib/memory/rules';
import { RetrievalControls } from './MmRetrieval';
import { Box, btn, Field, input, memApi, NamespaceSelect, Notice, Pill, primary, Section, useErrorText, useMemApi } from './memoryUi';
import { useSettings } from './useSettings';

// The Retrieval Inspector: one retrieval for a test prompt with every candidate's factors, combined score, rank or
// exclusion reason, the timings and the exact context the model would get (read only). Runs are flagged as
// inspector runs, so they don't count as memories being used. A second profile can run beside it.

type Scored = {
  id: string;
  title: string;
  content: string;
  categoryName: string;
  namespacePath: string;
  importance: number;
  confidence: number;
  isPinned: boolean;
  score: number;
  pinnedBoost: number;
  tokens: number;
  rank: number | null;
  excluded: string | null;
  factors: { relevance: number; semantic: number | null; keyword: number | null; importance: number; recency: number; confidence: number };
};
type Result = {
  context: string;
  tokens: number;
  mode: string;
  degraded: string | null;
  accessLogId: number | null;
  inspector: { namespaces: string[]; embeddingModel: string | null; params: RetrievalParams; profile: { id: string; name: string } | null; candidates: number; selected: Scored[]; excluded: Scored[]; timings: { totalMs: number; embedMs: number | null; semanticMs: number | null; keywordMs: number | null } };
};

function Run({ result, openMemory }: { result: Result; openMemory: (id: string) => void }) {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const i = m.inspector;
  const errorText = useErrorText();
  const [feedback, setFeedback] = useState<string | null>(null);
  const f2 = (v: number | null) => (v === null ? '—' : number(v, { maximumFractionDigits: 3 }));
  const x = result.inspector;
  const rate = async (memoryId: string | null, rating: string) => {
    try {
      await memApi('/feedback', { body: { memoryId, rating, accessLogId: result.accessLogId } });
      setFeedback(i.feedbackSaved);
    } catch (e) {
      setFeedback(errorText(e));
    }
  };
  const row = (s: Scored) => (
    <tr key={s.id} className="border-t border-border align-top">
      <td className="py-1.5 pr-2 tabular-nums">{s.rank ?? '—'}</td>
      <td className="py-1.5 pr-2 max-w-sm">
        <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => openMemory(s.id)}>{s.title}</button>
        <div className="text-xs text-muted-foreground">{s.categoryName} · {s.namespacePath}{s.isPinned ? ` · ${m.fields.pinned}` : ''}</div>
        {s.excluded && <div className="text-xs text-yellow-600 dark:text-yellow-400">{(i.reasons as Record<string, string>)[s.excluded] ?? s.excluded}</div>}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{f2(s.factors.semantic)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{f2(s.factors.keyword)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{f2(s.factors.importance)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{f2(s.factors.recency)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{f2(s.factors.confidence)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{f2(s.score)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{s.tokens}</td>
      <td className="py-1.5">
        {!s.excluded && (
          <select className="text-xs bg-card border border-border rounded" aria-label={m.detail.retrievals.feedback} defaultValue="" onChange={(e) => e.target.value && void rate(s.id, e.target.value)}>
            <option value="">{m.detail.retrievals.feedback}</option>
            {Object.entries(i.feedback).filter(([k]) => k !== 'missingContext').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </td>
    </tr>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Pill>{i.mode}: {result.mode}</Pill>
        <Pill>{i.embeddingModel}: {x.embeddingModel ?? '—'}</Pill>
        <Pill>{fmt(i.candidates, { count: x.candidates })}</Pill>
        <Pill>{fmt(i.tokens, { count: result.tokens })}</Pill>
        <Pill>{fmt(i.latency, { ms: x.timings.totalMs, embed: x.timings.embedMs ?? '—', semantic: x.timings.semanticMs ?? '—', keyword: x.timings.keywordMs ?? '—' })}</Pill>
        {x.profile && <Pill>{i.profile}: {x.profile.name}</Pill>}
      </div>
      <p className="text-xs text-muted-foreground">{i.namespaces}: {x.namespaces.join(', ')}</p>
      {result.degraded && <Notice tone="warn">{fmt(i.degraded, { reason: result.degraded })}</Notice>}
      {feedback && <Notice tone="ok">{feedback}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left">{i.rank}</th>
              <th className="text-left">{m.fields.title}</th>
              <th className="text-right">{m.library.semantic}</th>
              <th className="text-right">{m.library.keyword}</th>
              <th className="text-right">{m.fields.importance}</th>
              <th className="text-right">{m.retrieval.recency}</th>
              <th className="text-right">{m.fields.confidence}</th>
              <th className="text-right">{i.combined}</th>
              <th className="text-right">{fmt(i.tokens, { count: '' }).trim()}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={10} className="pt-2 text-xs font-semibold text-foreground">{i.selected}</td></tr>
            {x.selected.map(row)}
            <tr><td colSpan={10} className="pt-3 text-xs font-semibold text-foreground">{i.excluded}</td></tr>
            {x.excluded.map(row)}
          </tbody>
        </table>
      </div>
      <Field label={i.context}>
        {result.context ? <pre className="text-xs whitespace-pre-wrap bg-card border border-border rounded-lg p-3 max-h-80 overflow-auto">{result.context}</pre> : <p className="text-sm text-muted-foreground">{i.noContext}</p>}
      </Field>
      <button type="button" className={btn} onClick={() => void rate(null, 'missingContext')}>{i.missingContext}</button>
    </div>
  );
}

export default function MmInspector({ openMemory }: { openMemory: (id: string) => void }) {
  const { t } = useLanguage();
  const m = t.aiLab.memoryManager;
  const i = m.inspector;
  const errorText = useErrorText();
  const { draft } = useSettings();
  const profiles = useMemApi<{ profiles: { id: string; name: string }[] }>('/profiles');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'hybrid' | 'semantic' | 'keyword'>('hybrid');
  const [ns, setNs] = useState('');
  const [profileId, setProfileId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [adjust, setAdjust] = useState(false);
  const [params, setParams] = useState<RetrievalParams | null>(null);
  const [results, setResults] = useState<[Result | null, Result | null]>([null, null]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = (pid: string) => ({ query: prompt, mode, inspect: true, namespaces: ns ? [ns] : undefined, profileId: pid || undefined, params: adjust && params && !pid ? params : undefined });
      const [a, b] = await Promise.all([memApi<Result>('/retrieve', { body: body(profileId) }), compareId ? memApi<Result>('/retrieve', { body: body(compareId) }) : Promise.resolve(null)]);
      setResults([a, b]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={m.sections.inspector} intro={i.intro}>
      <Box>
        <Field label={i.prompt}><textarea className={`${input} min-h-16`} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label={i.mode}>
            <select className={input} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="hybrid">{m.library.hybrid}</option>
              <option value="semantic">{m.library.semantic}</option>
              <option value="keyword">{m.library.keyword}</option>
            </select>
          </Field>
          <Field label={i.namespaces}><NamespaceSelect value={ns} onChange={setNs} allowAll /></Field>
          <Field label={i.profile}>
            <select className={input} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">{i.currentSettings}</option>
              {profiles.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={i.compareWith}>
            <select className={input} value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">{m.common.none}</option>
              {profiles.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <details open={adjust} onToggle={(e) => setAdjust((e.target as HTMLDetailsElement).open)}>
          <summary className="text-sm font-semibold text-foreground cursor-pointer">{i.adjust}</summary>
          {draft && <div className="pt-3"><RetrievalControls value={params ?? draft.retrieval} onChange={setParams} /></div>}
        </details>
        <button type="button" className={primary} disabled={busy || !prompt.trim()} onClick={() => void run()}>{i.run}</button>
      </Box>
      {error && <Notice tone="error">{error}</Notice>}
      {results[0] && (
        <div className={results[1] ? 'grid xl:grid-cols-2 gap-4' : ''}>
          <Box title={results[0].inspector.profile?.name ?? i.currentSettings}><Run result={results[0]} openMemory={openMemory} /></Box>
          {results[1] && <Box title={results[1].inspector.profile?.name ?? ''}><Run result={results[1]} openMemory={openMemory} /></Box>}
        </div>
      )}
    </Section>
  );
}
