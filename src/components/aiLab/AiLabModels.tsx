'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { LAB_PARAMS, PARAM_RANGES, validModelName, type LabParams } from '@/lib/aiLab/rules';
import { buttonClass, dangerClass, errorText, formatBytes, inputClass, labApi, labelClass, localTime, Notice, Panel, primaryClass, type LabGatewayStatus, type LabOverview, chatModelNames } from './aiLabUi';

// AI Lab's Model Management: every model Ollama has on the Mac (read live through the gateway), loaded or not, with
// memory Ollama reports for loaded models and an estimate (the file size) for the rest, labelled as such; details
// from /api/show (the model's maximum context and the num_ctx it's configured with); Load, Unload, Test, Make
// default, per-model default parameters, Remove (typed confirmation; never a production model) and Download (size
// checked first where the registry can say; typed confirmation; progress polled while it runs on the Mac).

type Details = { contextLength: number | null; configuredNumCtx: number | null; capabilities: string[]; architecture: string | null };
type Pull = LabGatewayStatus['pulls'];

const LARGE_BYTES = 10e9;

export default function AiLabModels({ data, reload, onTest }: { data: LabOverview | null; reload: (fresh?: boolean) => Promise<void>; onTest: (model: string) => void }) {
  const { t, fmt, number } = useLanguage();
  const l = t.aiLab;
  const m = l.models;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const chatModels = chatModelNames(gw);
  const [details, setDetails] = useState<Record<string, Details>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [params, setParams] = useState<LabParams>({});
  const [pullName, setPullName] = useState('');
  const [size, setSize] = useState<{ name: string; known: boolean; sizeBytes: number | null } | null>(null);
  // Downloads as last polled; until then (or after a refresh) as the status had them
  const [polled, setPolled] = useState<Pull | null>(null);
  const pulls: Pull = polled ?? gw?.pulls ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const bytes = (n: number | null | undefined) => formatBytes(n, number) ?? l.common.unavailable;
  const fail = (e: unknown) => setProblem(errorText(e, l.errors, l.common.failed));

  const act = async (action: string, name: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${action}:${name}`);
    setProblem(null);
    try {
      const answer = await labApi('/api/admin/ai-lab/models', { body: { action, name, ...extra } });
      return answer;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const loadPulls = useCallback(async () => {
    try {
      const answer = await labApi<{ pulls: Pull }>('/api/admin/ai-lab/models');
      setPolled(answer.pulls);
      return answer.pulls;
    } catch {
      return [];
    }
  }, []);

  // Polled every 2 s only while a download is running
  const running = pulls.some((p) => p.finishedAt === null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const now = await loadPulls();
      if (!now.some((p) => p.finishedAt === null)) await reload(true).then(() => setPolled(null));
    }, 2_000);
    return () => clearInterval(timer);
  }, [running, loadPulls, reload]);

  if (!gw) {
    return (
      <Panel title={m.title} intro={m.intro}>
        <Notice tone="warn">{data && !data.lab.reachable && data.lab.reason === 'labDisabled' ? l.common.labOff : l.common.macOffline}</Notice>
      </Panel>
    );
  }

  const loaded = new Map(gw.loaded.map((x) => [x.name, x]));
  const production = new Set(gw.production.models);

  const toggleDetails = async (name: string) => {
    if (open === name) return setOpen(null);
    setOpen(name);
    setParams(data?.settings.modelParams[name] ?? {});
    if (!details[name]) {
      const answer = (await act('show', name)) as Details | null;
      if (answer) setDetails((d) => ({ ...d, [name]: answer }));
    }
  };

  const remove = async (name: string) => {
    const typed = window.prompt(fmt(m.confirmDelete, { name }));
    if (typed === null) return;
    if (await act('delete', name, { confirm: typed.trim() })) await reload(true);
  };

  const checkSize = async () => {
    setSize(null);
    const answer = (await act('remoteSize', pullName.trim())) as { name: string; known: boolean; sizeBytes: number | null } | null;
    if (answer) setSize(answer);
  };

  const download = async () => {
    const name = pullName.trim();
    const shown = size?.name === name && size.known ? bytes(size.sizeBytes) : l.common.unavailable;
    const warning = size?.name === name && (size.sizeBytes ?? 0) > LARGE_BYTES ? `\n\n${m.largeWarning}` : '';
    const typed = window.prompt(`${fmt(m.confirmDownload, { name, size: shown })}${warning}`);
    if (typed === null) return;
    if (await act('pull', name, { confirm: typed.trim() })) {
      setPullName('');
      setSize(null);
      await loadPulls();
    }
  };

  return (
    <div className="space-y-4">
      <Panel title={m.title} intro={m.intro}>
        {problem && <Notice tone="error">{problem}</Notice>}
        {!gw.lab.manage && <Notice tone="warn">{m.manageOff}</Notice>}
        {gw.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">{m.name}</th>
                  <th className="py-2 pr-3">{m.family}</th>
                  <th className="py-2 pr-3">{m.parameters}</th>
                  <th className="py-2 pr-3">{m.quantization}</th>
                  <th className="py-2 pr-3">{m.size}</th>
                  <th className="py-2 pr-3">{m.modified}</th>
                  <th className="py-2 pr-3">{m.loaded}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {gw.models.map((model) => {
                  const live = loaded.get(model.name);
                  const d = details[model.name];
                  const isDefault = data?.settings.defaultModel === model.name;
                  const canChat = chatModels.includes(model.name);
                  return [
                    <tr key={model.name} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 font-mono text-xs text-foreground">
                        {model.name}
                        {production.has(model.name) && (
                          <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary" title={m.productionHelp}>
                            {m.production}
                          </span>
                        )}
                        {isDefault && <span className="ml-2 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-500">{m.default}</span>}
                        {!canChat && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={m.embeddingHelp}>
                            {m.embedding}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{model.family ?? l.common.unavailable}</td>
                      <td className="py-2 pr-3">{model.parameterSize ?? l.common.unavailable}</td>
                      <td className="py-2 pr-3">{model.quantization ?? l.common.unavailable}</td>
                      <td className="py-2 pr-3">{bytes(model.sizeBytes)}</td>
                      <td className="py-2 pr-3">{localTime(model.modifiedAt) ?? l.common.unavailable}</td>
                      <td className="py-2 pr-3 text-xs">
                        {live
                          ? fmt(m.memoryReported, { size: bytes(live.sizeBytes), vram: bytes(live.vramBytes) })
                          : `${m.unloaded}. ${fmt(m.memoryEstimated, { size: bytes(model.sizeBytes) })}`}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <button type="button" className={buttonClass} onClick={() => void toggleDetails(model.name)}>
                            {m.details}
                          </button>
                          {live ? (
                            <button type="button" className={buttonClass} disabled={busy !== null} onClick={async () => (await act('unload', model.name)) && reload(true)}>
                              {m.unload}
                            </button>
                          ) : (
                            <button type="button" className={buttonClass} disabled={busy !== null} onClick={async () => (await act('load', model.name, { keepAlive: '30m' })) && reload(true)}>
                              {busy === `load:${model.name}` ? l.common.loading : m.load}
                            </button>
                          )}
                          {canChat && (
                            <button type="button" className={buttonClass} onClick={() => onTest(model.name)}>
                              {m.test}
                            </button>
                          )}
                          {canChat && !isDefault && (
                            <button type="button" className={buttonClass} disabled={busy !== null} onClick={async () => (await act('setDefault', model.name)) && reload()}>
                              {m.makeDefault}
                            </button>
                          )}
                          {gw.lab.manage && !production.has(model.name) && (
                            <button type="button" className={dangerClass} disabled={busy !== null} onClick={() => void remove(model.name)}>
                              {m.remove}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,
                    open === model.name && (
                      <tr key={`${model.name}-details`} className="border-b border-border/60">
                        <td colSpan={8} className="py-3 space-y-3">
                          {d ? (
                            <dl className="grid gap-2 sm:grid-cols-3 text-sm">
                              <div>
                                <dt className="text-xs text-muted-foreground">{m.context}</dt>
                                <dd>
                                  {fmt(m.contextValue, {
                                    served: live?.contextLength ? number(live.contextLength) : l.common.unavailable,
                                    max: d.contextLength ? number(d.contextLength) : l.common.unavailable,
                                  })}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">{m.configuredCtx}</dt>
                                <dd>{d.configuredNumCtx ? number(d.configuredNumCtx) : l.common.none}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-muted-foreground">{m.capabilities}</dt>
                                <dd>{d.capabilities.join(', ') || l.common.unavailable}</dd>
                              </div>
                            </dl>
                          ) : (
                            <p className="text-sm text-muted-foreground">{l.common.loading}</p>
                          )}
                          <div>
                            <p className="text-sm font-semibold text-foreground">{fmt(m.paramsTitle, { model: model.name })}</p>
                            <p className="text-xs text-muted-foreground mb-2">{m.paramsHelp}</p>
                            <div className="grid gap-2 sm:grid-cols-4">
                              {LAB_PARAMS.map((key) => (
                                <div key={key}>
                                  <label className={labelClass} htmlFor={`param-${model.name}-${key}`}>{l.playground.paramNames[key]}</label>
                                  <input
                                    id={`param-${model.name}-${key}`}
                                    type="number"
                                    className={inputClass}
                                    min={PARAM_RANGES[key].min}
                                    max={PARAM_RANGES[key].max}
                                    step={PARAM_RANGES[key].step}
                                    value={params[key] ?? ''}
                                    onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                                  />
                                </div>
                              ))}
                            </div>
                            <button type="button" className={`${primaryClass} mt-2`} onClick={async () => (await act('setParams', model.name, { params })) && reload()}>
                              {l.common.save}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={m.downloadTitle} intro={m.downloadHelp}>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputClass} max-w-md`} value={pullName} placeholder="qwen3:14b" onChange={(e) => setPullName(e.target.value)} aria-label={m.downloadTitle} />
          <button type="button" className={buttonClass} disabled={!validModelName(pullName.trim()) || busy !== null} onClick={() => void checkSize()}>
            {m.checkSize}
          </button>
          <button type="button" className={primaryClass} disabled={!gw.lab.manage || !validModelName(pullName.trim()) || busy !== null || running} onClick={() => void download()}>
            {m.download}
          </button>
        </div>
        {size && size.name === pullName.trim() && (
          <Notice tone={(size.sizeBytes ?? 0) > LARGE_BYTES ? 'warn' : 'info'}>
            {size.known ? fmt(m.sizeKnown, { size: bytes(size.sizeBytes) }) : m.sizeUnknown}
            {(size.sizeBytes ?? 0) > LARGE_BYTES ? ` ${m.largeWarning}` : ''}
          </Notice>
        )}
        {pulls.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{m.pulls}</h3>
            <ul className="space-y-2">
              {pulls.map((p) => {
                const pct = p.total && p.completed !== null ? Math.round((p.completed / p.total) * 100) : null;
                return (
                  <li key={p.name} className="text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-mono text-xs">{p.name}</span>
                      <span className="text-muted-foreground">
                        {fmt(m.pullProgress, { status: p.error ?? p.status, done: bytes(p.completed), total: bytes(p.total) })}
                      </span>
                      {p.finishedAt === null && (
                        <button type="button" className={buttonClass} onClick={async () => (await act('cancelPull', p.name)) && loadPulls()}>
                          {m.cancelPull}
                        </button>
                      )}
                    </div>
                    {pct !== null && (
                      <div className="h-1.5 rounded bg-border mt-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-1.5 rounded ${p.error ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
