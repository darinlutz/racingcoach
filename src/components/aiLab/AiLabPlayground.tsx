'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { aiModelProvider, AI_MODELS } from '@/lib/aiModelList';
import { LAB_PARAMS, PARAM_RANGES, supportedParams, type LabParam, type LabProvider } from '@/lib/aiLab/rules';
import { buttonClass, dangerClass, errorText, inputClass, labApi, labelClass, localTime, Notice, Panel, primaryClass, type LabOverview } from './aiLabUi';
import { runModel, type RunResult } from './playgroundClient';

// AI Lab's Model Playground: one prompt on up to four models side by side, local (any model installed on the Mac) or
// frontier (any cloud model the site offers). Each model is its own request, so each is measured on its own. Only
// the parameters a provider takes are sent to it; the others are listed as not offered. The answer, time to first
// token (on this server, and on the Mac for local models), total time, tokens, tokens a second, estimated cost and
// the model that actually answered are shown, and a fallback is always "none": the lab never substitutes a model.
// Prompts and results can be saved.

type Column = { id: number; provider: 'Local' | 'Cloud'; model: string; running: boolean; result: RunResult | null; live: string };
type Saved = {
  prompts: { id: number; name: string; system: string; prompt: string; params: Record<string, number>; models: string[]; updatedAt: string }[];
  benchmarks: { id: number; name: string; system: string; prompt: string; results: { model: string; provider: string; text: string; error: string | null; metrics: Record<string, unknown> | null }[]; createdAt: string }[];
};

const MAX_COLUMNS = 4;
let nextId = 1;

const providerOf = (column: { provider: 'Local' | 'Cloud'; model: string }): LabProvider => (column.provider === 'Local' ? 'Local' : aiModelProvider(column.model));
const encodeTarget = (c: { provider: 'Local' | 'Cloud'; model: string }) => `${c.provider}|${c.model}`;

export default function AiLabPlayground({ data, initialModel }: { data: LabOverview | null; initialModel: string | null }) {
  const { t, fmt, number } = useLanguage();
  const l = t.aiLab;
  const p = l.playground;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const localModels = gw?.models.map((m) => m.name) ?? [];
  const [columns, setColumns] = useState<Column[]>([]);
  const [system, setSystem] = useState('');
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<Partial<Record<LabParam, number>>>({});
  const [stream, setStream] = useState(true);
  const [adding, setAdding] = useState('');
  const [saved, setSaved] = useState<Saved>({ prompts: [], benchmarks: [] });
  const [viewing, setViewing] = useState<Saved['benchmarks'][number] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const aborts = useRef(new Map<number, AbortController>());

  const loadSaved = useCallback(async () => {
    try {
      setSaved(await labApi<Saved>('/api/admin/ai-lab/saved'));
    } catch {
      // shown as empty
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the saved prompts and results once
    void loadSaved();
  }, [loadSaved]);

  // The first column: the model Test was pressed for, else the playground default, else the first installed model
  useEffect(() => {
    const first = initialModel ?? data?.settings.defaultModel ?? localModels[0] ?? null;
    if (!first) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adds the model Test was pressed for, or the first column once models are known
    setColumns((current) => {
      if (initialModel && !current.some((c) => c.provider === 'Local' && c.model === initialModel)) {
        return [...current, { id: nextId++, provider: 'Local' as const, model: initialModel, running: false, result: null, live: '' }].slice(-MAX_COLUMNS);
      }
      return current.length ? current : [{ id: nextId++, provider: 'Local', model: first, running: false, result: null, live: '' }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialModel, data?.settings.defaultModel, localModels.join(',')]);

  const update = (id: number, change: Partial<Column> | ((c: Column) => Partial<Column>)) =>
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...(typeof change === 'function' ? change(c) : change) } : c)));

  const add = () => {
    if (!adding || columns.length >= MAX_COLUMNS) return;
    const [provider, model] = adding.split('|') as ['Local' | 'Cloud', string];
    setColumns((cols) => [...cols, { id: nextId++, provider, model, running: false, result: null, live: '' }]);
    setAdding('');
  };

  // A local model's saved defaults fill the parameters left empty here
  const paramsFor = (c: Column) => {
    const defaults = c.provider === 'Local' ? (data?.settings.modelParams[c.model] ?? {}) : {};
    return { ...defaults, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) };
  };

  const runAll = async () => {
    setProblem(null);
    await Promise.all(
      columns.map(async (c) => {
        const abort = new AbortController();
        aborts.current.set(c.id, abort);
        update(c.id, { running: true, result: null, live: '' });
        const result = await runModel(
          { target: { provider: c.provider, model: c.model }, system, prompt, params: paramsFor(c) },
          { signal: abort.signal, onToken: (text) => stream && update(c.id, (col) => ({ live: col.live + text })) }
        );
        aborts.current.delete(c.id);
        update(c.id, { running: false, result });
      })
    );
  };

  const stop = () => {
    for (const abort of aborts.current.values()) abort.abort();
  };

  const savePrompt = async () => {
    const name = window.prompt(p.namePrompt);
    if (!name) return;
    try {
      await labApi('/api/admin/ai-lab/saved', { body: { kind: 'prompt', name, system, prompt, params, models: columns.map(encodeTarget) } });
      await loadSaved();
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    }
  };

  const saveResults = async () => {
    const name = window.prompt(p.namePrompt);
    if (!name) return;
    try {
      await labApi('/api/admin/ai-lab/saved', {
        body: {
          kind: 'benchmark',
          name,
          system,
          prompt,
          results: columns.filter((c) => c.result).map((c) => ({ model: c.model, provider: providerOf(c), text: c.result!.text, error: c.result!.error, metrics: c.result!.metrics })),
        },
      });
      await loadSaved();
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    }
  };

  const loadPrompt = (s: Saved['prompts'][number]) => {
    setSystem(s.system);
    setPrompt(s.prompt);
    setParams(s.params);
    const cols = s.models
      .map((m) => m.split('|') as ['Local' | 'Cloud', string])
      .filter(([provider, model]) => (provider === 'Local' || provider === 'Cloud') && model)
      .map(([provider, model]) => ({ id: nextId++, provider, model, running: false, result: null, live: '' }));
    if (cols.length) setColumns(cols.slice(0, MAX_COLUMNS));
  };

  const remove = async (kind: 'prompt' | 'benchmark', id: number) => {
    await fetch(`/api/admin/ai-lab/saved?kind=${kind}&id=${id}`, { method: 'DELETE' });
    await loadSaved();
  };

  const running = columns.some((c) => c.running);
  const ms = (v: number | null | undefined) => (v === null || v === undefined ? l.common.notMeasured : `${number(v)} ms`);

  return (
    <div className="space-y-4">
      <Panel title={p.title} intro={p.intro}>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-64">
            <label className={labelClass} htmlFor="ai-lab-add-model">{p.addModel}</label>
            <select id="ai-lab-add-model" className={inputClass} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="" />
              <optgroup label={p.local}>
                {localModels.map((m) => (
                  <option key={m} value={`Local|${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
              <optgroup label={p.cloud}>
                {AI_MODELS.map((m) => (
                  <option key={m} value={`Cloud|${m}`}>
                    {m} ({aiModelProvider(m)})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <button type="button" className={buttonClass} disabled={!adding || columns.length >= MAX_COLUMNS} onClick={add}>
            {l.common.add}
          </button>
          <span className="text-xs text-muted-foreground">{p.maxModels}</span>
        </div>

        <div>
          <label className={labelClass} htmlFor="ai-lab-system">{p.system}</label>
          <textarea id="ai-lab-system" data-no-track rows={2} maxLength={8000} className={inputClass} value={system} onChange={(e) => setSystem(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ai-lab-prompt">{p.prompt}</label>
          <textarea id="ai-lab-prompt" data-no-track rows={4} maxLength={20000} className={inputClass} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>

        <div>
          <p className={labelClass}>{p.params}</p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {LAB_PARAMS.map((key) => (
              <div key={key}>
                <label className={labelClass} htmlFor={`ai-lab-param-${key}`}>{p.paramNames[key]}</label>
                <input
                  id={`ai-lab-param-${key}`}
                  type="number"
                  className={inputClass}
                  min={PARAM_RANGES[key].min}
                  max={PARAM_RANGES[key].max}
                  step={PARAM_RANGES[key].step}
                  value={params[key] ?? ''}
                  onChange={(e) => setParams((v) => ({ ...v, [key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
            {p.streaming}
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryClass} disabled={running || !prompt.trim() || columns.length === 0} onClick={() => void runAll()} data-track="ai-lab-run">
            {running ? p.running : p.run}
          </button>
          {running && (
            <button type="button" className={dangerClass} onClick={stop}>
              {p.stop}
            </button>
          )}
          <button type="button" className={buttonClass} disabled={!prompt.trim()} onClick={() => void savePrompt()}>
            {p.savePrompt}
          </button>
          <button type="button" className={buttonClass} disabled={running || !columns.some((c) => c.result)} onClick={() => void saveResults()}>
            {p.saveResults}
          </button>
        </div>

        <div className={`grid gap-3 ${columns.length > 1 ? 'lg:grid-cols-2' : ''} ${columns.length > 2 ? 'xl:grid-cols-4' : ''}`}>
          {columns.map((c) => {
            const provider = providerOf(c);
            const unsupported = LAB_PARAMS.filter((k) => !supportedParams(provider, c.model).includes(k) && params[k] !== undefined);
            const r = c.result;
            const m = r?.metrics;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-2 min-w-0">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-foreground break-all">{c.model}</p>
                    <p className="text-xs text-muted-foreground">{provider === 'Local' ? p.local : `${p.cloud}, ${provider}`}</p>
                  </div>
                  <button type="button" className={buttonClass} disabled={c.running} onClick={() => setColumns((cols) => cols.filter((x) => x.id !== c.id))}>
                    {p.remove}
                  </button>
                </div>
                {unsupported.length > 0 && (
                  <p className="text-xs text-yellow-500">{fmt(p.notSupported, { provider, model: c.model, params: unsupported.map((k) => p.paramNames[k]).join(', ') })}</p>
                )}
                {r?.error && (
                  <Notice tone="error">
                    {(l.errors as Record<string, string>)[r.error]?.replace('{detail}', r.detail ?? '') ??
                      fmt(l.common.failed, { error: `${r.error}${r.detail ? `: ${r.detail}` : ''}` })}
                  </Notice>
                )}
                {r?.thinking && (
                  <details className="text-xs text-muted-foreground">
                    <summary>{p.thinking}</summary>
                    <p className="whitespace-pre-wrap">{r.thinking}</p>
                  </details>
                )}
                <div className="text-sm text-foreground whitespace-pre-wrap break-words max-h-96 overflow-y-auto" data-no-track>
                  {r ? r.text : c.running ? c.live || l.common.loading : ''}
                </div>
                {m && (
                  <dl className="text-xs grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-border pt-2">
                    <dt className="text-muted-foreground">{p.metrics.actual}</dt>
                    <dd className="break-all">{m.actualModel ?? l.common.unavailable}{m.serverId ? ` (${m.serverId})` : ''}</dd>
                    <dt className="text-muted-foreground">{p.metrics.fallback}</dt>
                    <dd>{p.metrics.noFallback}</dd>
                    <dt className="text-muted-foreground">{p.metrics.firstToken}</dt>
                    <dd>
                      {ms(m.firstTokenMs)}
                      {m.macFirstTokenMs !== null ? ` (${p.metrics.macFirstToken}: ${ms(m.macFirstTokenMs)})` : ''}
                    </dd>
                    <dt className="text-muted-foreground">{p.metrics.total}</dt>
                    <dd>{ms(m.totalMs)}</dd>
                    <dt className="text-muted-foreground">{p.metrics.input}</dt>
                    <dd>{m.inputTokens === null ? l.common.notMeasured : number(m.inputTokens)}</dd>
                    <dt className="text-muted-foreground">{p.metrics.output}</dt>
                    <dd>{m.outputTokens === null ? l.common.notMeasured : number(m.outputTokens)}</dd>
                    <dt className="text-muted-foreground">{p.metrics.speed}</dt>
                    <dd>{m.tokensPerSecond === null ? l.common.notMeasured : number(m.tokensPerSecond)}</dd>
                    <dt className="text-muted-foreground">{p.metrics.cost}</dt>
                    <dd>{m.provider === 'Local' ? p.free : m.costUsd === null ? l.common.notMeasured : `$${m.costUsd.toFixed(5)}`}</dd>
                    {m.doneReason && (
                      <>
                        <dt className="text-muted-foreground">{p.metrics.doneReason}</dt>
                        <dd>{m.doneReason}</dd>
                      </>
                    )}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title={p.savedPrompts}>
        {saved.prompts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{p.noSaved}</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {saved.prompts.map((s) => (
              <li key={s.id} className="py-1.5 flex flex-wrap items-center gap-2 justify-between">
                <span className="text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">{localTime(s.updatedAt)}</span>
                <span className="flex gap-1">
                  <button type="button" className={buttonClass} onClick={() => loadPrompt(s)}>
                    {p.loadPrompt}
                  </button>
                  <button type="button" className={dangerClass} onClick={() => void remove('prompt', s.id)}>
                    {l.common.delete}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={p.savedResults}>
        {saved.benchmarks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{p.noSaved}</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {saved.benchmarks.map((b) => (
              <li key={b.id} className="py-1.5 space-y-2">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <span className="text-foreground">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {localTime(b.createdAt)} · {b.results.map((r) => r.model).join(', ')}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" className={buttonClass} onClick={() => setViewing(viewing?.id === b.id ? null : b)}>
                      {p.view}
                    </button>
                    <button type="button" className={dangerClass} onClick={() => void remove('benchmark', b.id)}>
                      {l.common.delete}
                    </button>
                  </span>
                </div>
                {viewing?.id === b.id && (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {b.results.map((r, i) => (
                      <div key={i} className="rounded border border-border p-2 text-xs space-y-1">
                        <p className="font-mono">{r.model} ({r.provider})</p>
                        {r.error && <p className="text-red-500">{r.error}</p>}
                        <p className="whitespace-pre-wrap text-foreground">{r.text}</p>
                        {r.metrics && (
                          <p className="text-muted-foreground">
                            {p.metrics.total}: {ms(r.metrics.totalMs as number)} · {p.metrics.firstToken}: {ms(r.metrics.firstTokenMs as number | null)} · {p.metrics.speed}:{' '}
                            {(r.metrics.tokensPerSecond as number | null) ?? l.common.notMeasured}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
