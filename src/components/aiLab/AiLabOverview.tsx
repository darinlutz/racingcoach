'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { serviceColor, type StatusColor } from '@/lib/aiLab/rules';
import {
  buttonClass,
  errorText,
  formatDuration,
  inputClass,
  labApi,
  labelClass,
  localTime,
  Notice,
  Panel,
  primaryClass,
  StatusDot,
  type useLabOverview,
} from './aiLabUi';

// AI Lab's Overview: each service's status (Open WebUI, Ollama, the gateway, the production heartbeat), versions,
// models, activity and the last 24 hours' counts, with Test Connection, Refresh Status, Launch Open WebUI and the
// production Enabled switch; then the lab's own settings and its audit log. A metric that can't be measured says so,
// rather than showing 0.

type Props = { overview: ReturnType<typeof useLabOverview> };

export default function AiLabOverview({ overview }: Props) {
  const { t, fmt, number } = useLanguage();
  const l = t.aiLab;
  const o = l.overview;
  const { data, error, busy, reload } = overview;
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [budget, setBudget] = useState('');

  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fills the settings boxes once they've loaded
    setUrl((current) => current || (data.settings.openWebuiUrl ?? ''));
    setBudget((current) => current || String(data.settings.dailyCloudBudgetUsd));
  }, [data]);

  const fail = (e: unknown) => setProblem(errorText(e, l.errors, l.common.failed));
  const unknown = l.common.unavailable;

  if (!data) {
    return <Panel title={o.title}>{error ? <Notice tone="error">{errorText(error, l.errors, l.common.failed)}</Notice> : <p className="text-sm text-muted-foreground">{l.common.loading}</p>}</Panel>;
  }

  const lab = data.lab;
  const gw = lab.reachable ? lab.data : null;
  const server = data.production.servers.find((s) => s.id === lab.serverId) ?? data.production.servers[0] ?? null;

  const services: { key: string; name: string; color: StatusColor; detail: string | null }[] = [
    {
      key: 'gateway',
      name: o.gateway,
      color: !server || !data.production.configured.sharedSecret ? 'gray' : lab.reachable ? 'green' : lab.reason === 'labDisabled' ? 'yellow' : 'red',
      detail: gw ? fmt(o.version, { version: gw.agentVersion }) : !lab.reachable ? (l.errors as Record<string, string>)[lab.reason] ?? lab.reason : null,
    },
    {
      key: 'ollama',
      name: o.ollama,
      color: gw ? serviceColor({ configured: true, ok: gw.ollama.ok }) : server ? 'red' : 'gray',
      detail: gw?.ollama.version ? fmt(o.version, { version: gw.ollama.version }) : gw?.ollama.error ?? null,
    },
    {
      key: 'openWebui',
      name: o.openWebui,
      color: gw ? serviceColor({ configured: gw.openWebui.configured, ok: gw.openWebui.ok, degraded: !gw.openWebui.apiKey }) : 'gray',
      detail: gw?.openWebui.version ? fmt(o.version, { version: gw.openWebui.version }) : gw?.openWebui.error ?? null,
    },
    {
      key: 'production',
      name: o.production,
      color: !server ? 'gray' : !server.enabled ? 'gray' : server.online ? 'green' : server.availability === 'localNotAccepting' ? 'yellow' : 'red',
      detail: server ? fmt(o.mode, { mode: (t.admin.localAi.modes as Record<string, string>)[data.production.mode] ?? data.production.mode }) : null,
    },
  ];

  const testConnection = async () => {
    setMessage(null);
    setProblem(null);
    await reload(true);
  };

  const toggleServer = async (enabled: boolean) => {
    if (!server) return;
    if (!enabled && !window.confirm(fmt(o.confirmDisable, { server: server.label }))) return;
    try {
      await labApi('/api/admin/local-ai', {
        method: 'PUT',
        body: { action: 'saveServer', id: server.id, label: server.label, gatewayUrl: server.gatewayUrl, maxConcurrency: server.maxConcurrency, enabled },
      });
      await reload(true);
    } catch (e) {
      fail(e);
    }
  };

  const saveSettings = async () => {
    setMessage(null);
    setProblem(null);
    try {
      await labApi('/api/admin/ai-lab/settings', { method: 'PUT', body: { openWebuiUrl: url.trim() || null, dailyCloudBudgetUsd: Number(budget) } });
      setMessage(l.common.saved);
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  const heartbeat = server?.receivedAt ?? server?.lastHeartbeatAt ?? null;
  const tiles: [string, string][] = [
    [o.lastHeartbeat, localTime(heartbeat) ?? o.never],
    [o.lastSuccess, localTime(data.history.lastSuccessAt) ?? o.never],
    [o.lastError, data.history.lastError ? `${localTime(data.history.lastError.at)}: ${(l.errors as Record<string, string>)[data.history.lastError.reason] ?? data.history.lastError.reason}` : l.common.none],
    [o.uptime, gw ? formatDuration(gw.uptimeSeconds) : unknown],
    [o.roundTrip, lab.reachable ? `${number(lab.latencyMs)} ms` : unknown],
    [o.loadedModels, gw ? gw.loaded.map((m) => m.name).join(', ') || l.common.none : unknown],
    [o.availableModels, gw ? String(gw.models.length) : unknown],
    [
      o.activeRequests,
      gw ? fmt(o.activeValue, { production: gw.production.active, max: gw.production.maxConcurrency, lab: gw.lab.active, labMax: gw.lab.maxConcurrency }) : unknown,
    ],
  ];
  const counts: [string, string][] = [
    [o.localRequests, number(data.inference24h.localRequests)],
    [o.frontierRequests, number(data.inference24h.cloudRequests)],
    [o.avgLatency, data.inference24h.avgLatencyMs === null ? l.common.notMeasured : `${number(Math.round(data.inference24h.avgLatencyMs))} ms`],
    [o.labSpend, fmt(o.labSpendValue, { spent: data.spentTodayUsd.toFixed(4), budget: data.settings.dailyCloudBudgetUsd.toFixed(2) })],
  ];

  return (
    <div className="space-y-4">
      <Panel title={o.title} intro={o.intro}>
        {!lab.reachable && (
          <Notice tone={lab.reason === 'labDisabled' ? 'warn' : 'error'}>
            {lab.reason === 'noServer' ? l.common.noServer : lab.reason === 'noSecret' ? l.common.noSecret : lab.reason === 'labDisabled' ? l.common.labOff : l.common.macOffline}
            {lab.detail && lab.reason !== 'labDisabled' ? ` (${lab.detail})` : ''}
          </Notice>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => (
            <div key={s.key} className="rounded-lg border border-border bg-card p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{s.name}</p>
              <StatusDot color={s.color} label={l.status[s.color]} />
              {s.detail && <p className="text-xs text-muted-foreground break-words">{s.detail}</p>}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void testConnection()} data-track="ai-lab-test-connection">
            {o.testConnection}
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void reload(true)} data-track="ai-lab-refresh-status">
            {o.refreshStatus}
          </button>
          {data.settings.openWebuiUrl && (
            <a className={primaryClass} href={data.settings.openWebuiUrl} target="_blank" rel="noopener noreferrer" data-track="ai-lab-launch-webui">
              {o.launch}
            </a>
          )}
        </div>
        {busy && <p className="text-xs text-muted-foreground">{l.common.loading}</p>}

        {server && (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-1" checked={server.enabled} onChange={(e) => void toggleServer(e.target.checked)} data-track="ai-lab-server-enabled" />
            <span>
              {o.serverEnabled} ({server.label})
              <span className="block text-xs text-muted-foreground">{o.serverEnabledHelp}</span>
            </span>
          </label>
        )}

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
          {tiles.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground text-right break-words">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">{o.last24h}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {counts.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="text-lg font-semibold text-foreground">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={o.settingsTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ai-lab-webui-url">{o.openWebuiUrl}</label>
            <input id="ai-lab-webui-url" className={inputClass} value={url} placeholder="https://ai-lab.racingcoach.app" onChange={(e) => setUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{o.openWebuiUrlHelp}</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-lab-budget">{o.budget}</label>
            <input id="ai-lab-budget" type="number" min={0} max={100} step={0.5} className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{o.budgetHelp}</p>
          </div>
        </div>
        <button type="button" className={primaryClass} onClick={() => void saveSettings()} data-track="ai-lab-save-settings">
          {l.common.save}
        </button>
        {message && <Notice>{message}</Notice>}
        {problem && <Notice tone="error">{problem}</Notice>}
      </Panel>

      <Panel title={o.auditTitle}>
        {data.audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{o.auditEmpty}</p>
        ) : (
          <ul className="text-sm divide-y divide-border/60">
            {data.audit.map((a) => (
              <li key={a.id} className="py-1.5 flex flex-wrap gap-x-3">
                <span className="text-muted-foreground">{localTime(a.at)}</span>
                <span className="text-foreground font-mono text-xs self-center">{a.action}</span>
                {a.target && <span className="text-foreground break-all">{a.target}</span>}
                <span className={a.outcome === 'ok' ? 'text-green-500' : 'text-red-500'}>{a.outcome}</span>
                {a.user && <span className="text-muted-foreground">{a.user}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
