'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { InferenceReport, LocalAiStatus, MonitoringRange } from '@/lib/localAi/report';

// The Admin page's AI Inference Monitoring (docs/local-ai.md): every model call the site made, from
// racingcoach."AiInferenceEvents" (written as each call finished, so it's what the providers did), by model and
// feature, with the latest attempts and the local servers' live status. Refresh Statistics reloads it; auto-refresh
// is off until turned on. GET /api/admin/local-ai/monitoring.

const RANGES: MonitoringRange[] = ['today', '24h', '7d', '30d', 'all'];
const INTERVALS = [5, 10, 30, 60];
const selectClass = 'px-2 py-1.5 bg-card border border-border rounded-lg text-foreground text-sm';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

const STATUS_STYLE: Record<string, string> = {
  completed: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  timedOut: 'text-amber-600 dark:text-amber-400',
  canceled: 'text-muted-foreground',
};

export default function AiInferenceMonitoring({ timeZone }: { timeZone: string }) {
  const { t, fmt, locale, number } = useLanguage();
  const l = t.admin.localAi;
  const [range, setRange] = useState<MonitoringRange>('24h');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [feature, setFeature] = useState('');
  const [report, setReport] = useState<InferenceReport | null>(null);
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [auto, setAuto] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({ range, tz: timeZone });
      if (provider) params.set('provider', provider);
      if (model) params.set('model', model);
      if (feature) params.set('feature', feature);
      const response = await fetch(`/api/admin/local-ai/monitoring?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setReport(data.report);
      setStatus(data.status);
      setRefreshedAt(new Date());
      setError('');
    } catch (e) {
      setError(fmt(l.failed, { error: (e as Error).message }));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [range, provider, model, feature, timeZone, fmt, l.failed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when opened and when a filter changes
    void load();
    const refresh = () => void load();
    window.addEventListener('local-ai:refresh', refresh);
    return () => window.removeEventListener('local-ai:refresh', refresh);
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [auto, intervalSeconds, load]);

  const usd = (n: number | null) =>
    n === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);
  const ms = (n: number | null) => (n === null ? '—' : `${number(n)} ms`);
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { timeZone, dateStyle: 'short', timeStyle: 'medium' }) : '—';
  const ago = (iso: string | null) => {
    if (!iso) return l.never;
    // Measured from when the server answered, so rendering stays pure
    const seconds = Math.max(0, Math.round((new Date(status?.now ?? iso).getTime() - new Date(iso).getTime()) / 1000));
    return seconds < 120 ? fmt(l.secondsAgo, { seconds }) : time(iso);
  };
  const featureName = (value: string) =>
    value === 'localAiTest' ? l.testFeature : ((t.admin.aiFeatures as Record<string, string>)[value] ?? value);
  const reasonName = (value: string) => (l.reasons as Record<string, string>)[value] ?? value;
  const statusName = (value: string) => (l.statuses as Record<string, string>)[value] ?? value;
  const providerName = (value: string) => (value === 'Local' ? l.local : value);

  const totals = report?.totals;
  const online = status?.servers.filter((server) => server.online) ?? [];
  const lastHeartbeat = status?.servers.map((server) => server.receivedAt ?? server.lastHeartbeatAt).filter(Boolean).sort().at(-1) ?? null;
  const loaded = [...new Set(status?.servers.flatMap((server) => server.heartbeat?.loadedModels ?? []) ?? [])];
  const activeLocal = status?.servers.reduce((sum, server) => sum + server.inFlight, 0) ?? 0;

  const cards: { label: string; value: string; testId?: string }[] = totals
    ? [
        { label: l.totalRequests, value: number(totals.requests), testId: 'total-requests' },
        { label: l.localRequests, value: number(totals.localRequests) },
        { label: l.cloudRequests, value: number(totals.cloudRequests) },
        { label: l.localShare, value: totals.localShare === null ? '—' : number(totals.localShare, { style: 'percent', maximumFractionDigits: 1 }) },
        { label: l.fallbacks, value: number(totals.fallbacks) },
        { label: l.cloudCost, value: usd(totals.costUsd) },
        { label: l.avgLatency, value: ms(totals.avgLatencyMs) },
      ]
    : [];

  return (
    <div id="ai-inference-monitoring" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-xl font-bold text-foreground">{l.monitorTitle}</h2>
          <p className="text-sm text-muted-foreground">{l.monitorIntro}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button type="button" className={primaryClass} onClick={() => void load()} disabled={loading} data-track="ai-monitoring-refresh">
            {loading ? t.common.loading : l.refreshStatistics}
          </button>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-primary" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              {l.autoRefresh}
            </label>
            <select className={selectClass} value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} aria-label={l.autoRefresh}>
              {INTERVALS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {fmt(l.every, { seconds })}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">{refreshedAt ? fmt(l.lastRefresh, { time: refreshedAt.toLocaleTimeString(locale) }) : ' '}</p>
        </div>
      </div>

      {/* Live status */}
      {status && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="text-xs text-muted-foreground">{l.currentMode}</div>
            <div className="text-lg font-bold text-foreground">{l.modes[status.settings.mode]}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="text-xs text-muted-foreground">{l.localStatus}</div>
            <div className={`text-lg font-bold ${online.length ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {online.length ? l.online : l.offline}
              {status.servers.length > 1 && ` (${online.length}/${status.servers.length})`}
            </div>
            <div className="text-xs text-muted-foreground">
              {l.lastHeartbeat}: {ago(lastHeartbeat)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="text-xs text-muted-foreground">{l.loadedModels}</div>
            <div className="text-sm font-semibold text-foreground">{loaded.join(', ') || '—'}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <div className="text-xs text-muted-foreground">{l.activeLocal}</div>
            <div className="text-lg font-bold text-foreground tabular-nums">
              {activeLocal} / {status.servers.reduce((sum, server) => sum + server.capacity, 0)}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              range === value ? 'bg-primary/15 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {l.ranges[value]}
          </button>
        ))}
        <select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={l.provider}>
          <option value="">{l.allProviders}</option>
          {report?.options.providers.map((value) => (
            <option key={value} value={value}>
              {providerName(value)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)} aria-label={l.model}>
          <option value="">{l.allModels}</option>
          {report?.options.models.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select className={selectClass} value={feature} onChange={(e) => setFeature(e.target.value)} aria-label={l.feature}>
          <option value="">{l.allFeatures}</option>
          {report?.options.features.map((value) => (
            <option key={value} value={value}>
              {featureName(value)}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {totals && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {cards.map((card) => (
            <div key={card.label} className="bg-card border border-border rounded-xl p-3">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="text-xl font-bold text-foreground tabular-nums" data-testid={card.testId}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <>
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">{l.byModelTitle}</h3>
            {report.byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">{l.noEvents}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="model-usage">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">{l.model}</th>
                      <th className="py-2 pr-3">{l.provider}</th>
                      <th className="py-2 pr-3 text-right">{l.requests}</th>
                      <th className="py-2 pr-3 text-right">{l.successful}</th>
                      <th className="py-2 pr-3 text-right">{l.failedCount}</th>
                      <th className="py-2 pr-3 text-right">{l.timedOut}</th>
                      <th className="py-2 pr-3 text-right">{l.canceled}</th>
                      <th className="py-2 pr-3 text-right">{l.fallbacks}</th>
                      <th className="py-2 pr-3 text-right">{l.tokens}</th>
                      <th className="py-2 pr-3 text-right">{l.avgLatency}</th>
                      <th className="py-2 pr-3 text-right">{l.cost}</th>
                      <th className="py-2">{l.lastUsed}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.byModel.map((row) => (
                      <tr key={`${row.provider}:${row.model}`}>
                        <td className="py-2 pr-3">
                          <div className="font-medium text-foreground">{row.model}</div>
                          {row.actualModels.some((actual) => actual !== row.model) && (
                            <div className="text-xs text-muted-foreground">
                              {l.actualModel}: {row.actualModels.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">{providerName(row.provider)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.attempts)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-green-600 dark:text-green-400">{number(row.completed)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.failed)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.timedOut)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.canceled)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.fallbacks)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {number(row.inputTokens)} / {number(row.outputTokens)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{ms(row.avgLatencyMs)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{usd(row.costUsd)}</td>
                        <td className="py-2 whitespace-nowrap text-muted-foreground">{ago(row.lastUsed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{l.attemptNote}</p>
          </div>

          {report.byFeature.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">{l.byFeatureTitle}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">{l.feature}</th>
                      <th className="py-2 pr-3 text-right">{l.requests}</th>
                      <th className="py-2 pr-3 text-right">{l.local}</th>
                      <th className="py-2 pr-3 text-right">{l.cloud}</th>
                      <th className="py-2 text-right">{l.fallbacks}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.byFeature.map((row) => (
                      <tr key={row.feature}>
                        <td className="py-2 pr-3 text-foreground">{featureName(row.feature)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.attempts)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.local)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{number(row.cloud)}</td>
                        <td className="py-2 text-right tabular-nums">{number(row.fallbacks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">{l.recentTitle}</h3>
            {report.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{l.noEvents}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="recent-attempts">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">{l.time}</th>
                      <th className="py-2 pr-3">{l.feature}</th>
                      <th className="py-2 pr-3">{l.provider}</th>
                      <th className="py-2 pr-3">{l.actualModel}</th>
                      <th className="py-2 pr-3">{l.result}</th>
                      <th className="py-2 pr-3 text-right">{l.tokens}</th>
                      <th className="py-2 pr-3 text-right">{l.latency}</th>
                      <th className="py-2 pr-3">{l.reason}</th>
                      <th className="py-2 text-right">{l.cost}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.recent.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{time(row.startedAt)}</td>
                        <td className="py-2 pr-3 text-foreground">{featureName(row.feature)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {providerName(row.provider)}
                          {row.serverId && <span className="text-xs text-muted-foreground"> · {row.serverId}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="text-foreground">{row.actualModel ?? row.requestedModel}</div>
                          {row.actualModel && row.actualModel !== row.requestedModel && (
                            <div className="text-xs text-muted-foreground">{row.requestedModel}</div>
                          )}
                        </td>
                        <td className={`py-2 pr-3 whitespace-nowrap ${STATUS_STYLE[row.status] ?? ''}`}>
                          {statusName(row.status)}
                          {row.errorKind && <span className="text-xs text-muted-foreground"> ({row.errorKind})</span>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {row.inputTokens === null ? '—' : number(row.inputTokens)} / {row.outputTokens === null ? '—' : number(row.outputTokens)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{ms(row.latencyMs)}</td>
                        <td className={`py-2 pr-3 ${row.isFallback ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                          {reasonName(row.routeReason)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{usd(row.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
