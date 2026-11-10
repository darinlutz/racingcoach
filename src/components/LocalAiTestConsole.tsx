'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { LOCAL_MODEL_IDS, LOCAL_MODELS, type LocalModelId } from '@/lib/localAi/config';
import type { InferenceAttempt } from '@/lib/localAi/routedModel';
import type { ConnectivityResult, TestRouting } from '@/lib/localAi/testConsole';

// The Admin page's Local AI Test Console (docs/local-ai.md): a real prompt through the router to the Mac (or the
// cloud), showing which provider and model answered, tokens, time and any fallback; Test Local Connectivity (a
// signed /health through Cloudflare); Test Cloud Fallback (the local attempt made to fail). Each call shows up in
// AI Inference Monitoring, which this asks to refresh. POST /api/admin/local-ai/test.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

const ROUTINGS: TestRouting[] = ['production', 'forceLocal', 'simulateFailure'];

type Result = { text: string; attempts: InferenceAttempt[]; totalMs: number };

export default function LocalAiTestConsole() {
  const { t, fmt, number } = useLanguage();
  const l = t.admin.localAi;
  const [servers, setServers] = useState<{ id: string; label: string }[]>([]);
  const [serverId, setServerId] = useState('');
  const [model, setModel] = useState<LocalModelId>('gpt-oss:20b');
  const [routing, setRouting] = useState<TestRouting>('forceLocal');
  const [prompt, setPrompt] = useState(l.defaultPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityResult[] | null>(null);

  useEffect(() => {
    fetch('/api/admin/local-ai', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setServers(data.servers.map((s: { id: string; label: string }) => ({ id: s.id, label: s.label }))))
      .catch(() => {});
  }, []);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/local-ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, serverId: serverId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    } catch (e) {
      setError(fmt(l.failed, { error: (e as Error).message }));
      return null;
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event('local-ai:refresh'));
    }
  };

  const send = async (how: TestRouting) => {
    setResult(null);
    const data = await call({ action: 'prompt', prompt, model, routing: how });
    if (data) setResult(data);
  };

  const testConnectivity = async () => {
    setConnectivity(null);
    const data = await call({ action: 'connectivity' });
    if (data) setConnectivity(data.results);
  };

  const final = result?.attempts.find((a) => a.status === 'completed') ?? result?.attempts.at(-1);
  const fallback = result?.attempts.find((a) => a.isFallback);
  const providerName = (value: string) => (value === 'Local' ? l.local : value);

  return (
    <div id="local-ai-test" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground">{l.testTitle}</h2>
        <p className="text-sm text-muted-foreground">{l.testIntro}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="local-ai-test-server">{l.serversTitle}</label>
          <select id="local-ai-test-server" className={inputClass} value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">{l.anyServer}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.label} ({server.id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="local-ai-test-model">{l.localModel}</label>
          <select id="local-ai-test-model" className={inputClass} value={model} onChange={(e) => setModel(e.target.value as LocalModelId)}>
            {LOCAL_MODEL_IDS.map((id) => (
              <option key={id} value={id}>
                {LOCAL_MODELS[id].label} ({id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="local-ai-test-routing">{l.routing}</label>
          <select id="local-ai-test-routing" className={inputClass} value={routing} onChange={(e) => setRouting(e.target.value as TestRouting)}>
            {ROUTINGS.map((value) => (
              <option key={value} value={value}>
                {l.routings[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="local-ai-test-prompt">{l.prompt}</label>
        {/* data-no-track: the activity log never records typed text, and test prompts aren't kept */}
        <textarea
          id="local-ai-test-prompt"
          data-no-track
          rows={3}
          maxLength={4000}
          className={inputClass}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={busy || !prompt.trim()} onClick={() => void send(routing)} data-track="local-ai-test-send">
          {l.send}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void testConnectivity()} data-track="local-ai-test-connectivity">
          {l.testConnectivity}
        </button>
        <button type="button" className={buttonClass} disabled={busy || !prompt.trim()} onClick={() => void send('simulateFailure')} data-track="local-ai-test-fallback">
          {l.testFallback}
        </button>
      </div>

      {busy && <p className="text-sm text-muted-foreground">{l.sending}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {connectivity && (
        <ul className="space-y-1 text-sm">
          {connectivity.length === 0 && <li className="text-muted-foreground">{l.noServers}</li>}
          {connectivity.map((item) => {
            const body = (item.body ?? {}) as { runtime?: string };
            const age = item.heartbeatAgeMs === null ? l.never : fmt(l.secondsAgo, { seconds: Math.round(item.heartbeatAgeMs / 1000) });
            return (
              <li key={item.serverId} className={item.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                {item.ok
                  ? fmt(l.connectivityOk, { server: item.serverId, ms: item.latencyMs ?? 0, runtime: body.runtime ?? l.unknown, age })
                  : fmt(l.connectivityFailed, { server: item.serverId, detail: item.error ?? `HTTP ${item.status}` })}
              </li>
            );
          })}
        </ul>
      )}

      {result && final && (
        <div className="space-y-3" data-testid="local-ai-test-result">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-foreground">
              {fmt(l.answeredBy, { provider: providerName(final.provider), model: final.actualModel ?? final.requestedModel })}
            </span>
            <span className={fallback ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
              {fallback ? fmt(l.fallbackOccurred, { reason: (l.reasons as Record<string, string>)[fallback.routeReason] ?? fallback.routeReason }) : l.noFallback}
            </span>
            <span className="text-muted-foreground">{fmt(l.totalTime, { ms: number(result.totalMs) })}</span>
          </div>
          <div>
            <div className={labelClass}>{l.response}</div>
            <div className="whitespace-pre-wrap text-sm text-foreground bg-card border border-border rounded-lg p-3">{result.text}</div>
          </div>
          <div className="overflow-x-auto">
            <div className={labelClass}>{l.attempts}</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">{l.provider}</th>
                  <th className="py-1 pr-3">{l.actualModel}</th>
                  <th className="py-1 pr-3">{l.result}</th>
                  <th className="py-1 pr-3 text-right">{l.tokens}</th>
                  <th className="py-1 pr-3 text-right">{l.latency}</th>
                  <th className="py-1">{l.reason}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="py-1 pr-3">{attempt.attempt}</td>
                    <td className="py-1 pr-3">
                      {providerName(attempt.provider)}
                      {attempt.serverId ? ` · ${attempt.serverId}` : ''}
                    </td>
                    <td className="py-1 pr-3">{attempt.actualModel ?? attempt.requestedModel}</td>
                    <td className="py-1 pr-3">
                      {(l.statuses as Record<string, string>)[attempt.status] ?? attempt.status}
                      {attempt.errorKind ? ` (${attempt.errorKind})` : ''}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {attempt.inputTokens ?? '—'} / {attempt.outputTokens ?? '—'}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{number(attempt.latencyMs)} ms</td>
                    <td className="py-1">{(l.reasons as Record<string, string>)[attempt.routeReason] ?? attempt.routeReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
