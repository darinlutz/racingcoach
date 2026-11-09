'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { AI_FEATURE_VALUES, type AiFeature } from '@/lib/aiModelList';
import { LOCAL_AI_MODES, LOCAL_MODEL_IDS, LOCAL_MODELS, type LocalAiMode, type LocalModelId } from '@/lib/localAi/config';
import type { LocalAiStatus, ServerStatus } from '@/lib/localAi/report';

// The Admin page's Local AI Server Mode section (docs/local-ai.md): the mode (Automatic, Development, Cloud Only;
// saved in Postgres, Cloud Only until changed), the registered local servers with their live heartbeat, slots and
// circuit, which features may run locally and on which model, and the timeouts. GET/PUT /api/admin/local-ai.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

const MODE_STYLE: Record<LocalAiMode, string> = {
  automatic: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40',
  development: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
  cloudOnly: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40',
};

type ServerForm = { id: string; label: string; gatewayUrl: string; maxConcurrency: string; enabled: boolean };
const emptyForm: ServerForm = { id: 'macbook-pro', label: 'MacBook Pro', gatewayUrl: '', maxConcurrency: '2', enabled: true };

export default function LocalAiServerMode() {
  const { t, fmt, locale, number } = useLanguage();
  const l = t.admin.localAi;
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<ServerForm | null>(null);
  const [tuning, setTuning] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/local-ai', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
    } catch (error) {
      setMessage({ ok: false, text: fmt(l.failed, { error: (error as Error).message }) });
    }
  }, [fmt, l.failed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the section opens
    void load();
    const refresh = () => void load();
    window.addEventListener('local-ai:refresh', refresh);
    return () => window.removeEventListener('local-ai:refresh', refresh);
  }, [load]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/local-ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
      setMessage({ ok: true, text: l.saved });
      window.dispatchEvent(new Event('local-ai:refresh'));
      return true;
    } catch (error) {
      setMessage({ ok: false, text: fmt(l.failed, { error: (error as Error).message }) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setMode = (mode: LocalAiMode) => {
    if (mode === status?.settings.mode) return;
    if (mode === 'automatic' && !window.confirm(l.confirmAutomatic)) return;
    void save({ action: 'mode', mode });
  };

  const when = (iso: string | null) => {
    if (!iso) return l.never;
    const seconds = Math.max(0, Math.round((new Date(status?.now ?? iso).getTime() - new Date(iso).getTime()) / 1000));
    return seconds < 120 ? fmt(l.secondsAgo, { seconds }) : new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const gb = (bytes: number | null | undefined) => (bytes ? `${number(bytes / 1024 ** 3, { maximumFractionDigits: 1 })} GB` : '—');
  const featureName = (feature: AiFeature) => t.admin.aiFeatures[feature] ?? feature;
  const availabilityName = (server: ServerStatus) => l.availability[server.availability as keyof typeof l.availability] ?? server.availability;

  if (!status) {
    return (
      <div id="local-ai" className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
        <h2 className="text-xl font-bold text-foreground">{l.modeTitle}</h2>
        <p className="text-sm text-muted-foreground mt-2">{message?.text ?? t.common.loading}</p>
      </div>
    );
  }

  const mode = status.settings.mode;
  const tuningValues = tuning ?? {
    localTimeoutMs: String(status.settings.localTimeoutMs / 1000),
    circuitFailures: String(status.settings.circuitFailures),
    circuitOpenMs: String(status.settings.circuitOpenMs / 1000),
    contextShare: String(Math.round(status.settings.contextShare * 100)),
  };

  return (
    <div id="local-ai" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-xl font-bold text-foreground">{l.modeTitle}</h2>
          <p className="text-sm text-muted-foreground">{l.modeIntro}</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border text-center ${MODE_STYLE[mode]}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">{l.currentMode}</div>
          <div className="text-lg font-bold" data-testid="local-ai-mode">{l.modes[mode]}</div>
        </div>
      </div>

      {!status.configured.sharedSecret && <p className="text-sm text-amber-600 dark:text-amber-400">{l.secretMissing}</p>}
      {!status.configured.cloudflareAccess && <p className="text-sm text-amber-600 dark:text-amber-400">{l.accessMissing}</p>}

      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={l.modeTitle}>
        {LOCAL_AI_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            disabled={busy}
            onClick={() => setMode(option)}
            data-track={`local-ai-mode-${option}`}
            className={`text-left p-4 rounded-xl border transition-colors disabled:opacity-50 ${
              mode === option ? `${MODE_STYLE[option]} ring-1 ring-current` : 'border-border bg-card hover:border-primary'
            }`}
          >
            <div className="font-semibold text-foreground">{l.modes[option]}</div>
            <div className="text-xs text-muted-foreground mt-1">{l.modeHelp[option]}</div>
          </button>
        ))}
      </div>

      {message && <p className={`text-sm ${message.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{message.text}</p>}

      {/* Servers */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">{l.serversTitle}</h3>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={() => void load()} disabled={busy}>
              {l.refresh}
            </button>
            <button type="button" className={buttonClass} onClick={() => setForm(emptyForm)} disabled={busy}>
              {l.addServer}
            </button>
          </div>
        </div>
        {status.servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{l.noServers}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">{l.serverName}</th>
                  <th className="py-2 pr-3">{l.status}</th>
                  <th className="py-2 pr-3">{l.lastHeartbeat}</th>
                  <th className="py-2 pr-3">{l.loadedModels}</th>
                  <th className="py-2 pr-3">{l.installedModels}</th>
                  <th className="py-2 pr-3 text-right">{l.active}</th>
                  <th className="py-2 pr-3 text-right">{l.memory}</th>
                  <th className="py-2 pr-3">{l.circuit}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {status.servers.map((server) => (
                  <tr key={server.id} className="align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-foreground">{server.label}</div>
                      <div className="text-xs text-muted-foreground">{server.id} · {server.gatewayUrl}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center gap-1.5 ${server.online ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        <span className={`h-2 w-2 rounded-full ${server.online ? 'bg-green-500' : 'bg-red-500'}`} />
                        {availabilityName(server)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{when(server.receivedAt ?? server.lastHeartbeatAt)}</td>
                    <td className="py-2 pr-3 text-foreground">{server.heartbeat?.loadedModels.join(', ') || '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{server.heartbeat?.installedModels.join(', ') || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {server.inFlight} / {server.capacity}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{gb(server.heartbeat?.freeMemoryBytes)}</td>
                    <td className="py-2 pr-3">{l.circuitStates[server.circuit.status]}</td>
                    <td className="py-2 whitespace-nowrap space-x-2 text-right">
                      {server.circuit.status !== 'closed' && (
                        <button type="button" className={buttonClass} disabled={busy} onClick={() => void save({ action: 'resetCircuit', id: server.id })}>
                          {l.resetCircuit}
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={() =>
                          setForm({
                            id: server.id,
                            label: server.label,
                            gatewayUrl: server.gatewayUrl,
                            maxConcurrency: String(server.maxConcurrency),
                            enabled: server.enabled,
                          })
                        }
                      >
                        {l.editServer}
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={() => window.confirm(fmt(l.confirmRemove, { id: server.id })) && void save({ action: 'deleteServer', id: server.id })}
                      >
                        {l.removeServer}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {form && (
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end bg-card border border-border rounded-xl p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await save({ action: 'saveServer', ...form, maxConcurrency: Number(form.maxConcurrency) })) setForm(null);
            }}
          >
            <div>
              <label className={labelClass} htmlFor="local-ai-id">{l.serverId}</label>
              <input id="local-ai-id" className={inputClass} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor="local-ai-label">{l.serverName}</label>
              <input id="local-ai-label" className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="lg:col-span-2">
              <label className={labelClass} htmlFor="local-ai-url">{l.gatewayUrl}</label>
              <input
                id="local-ai-url"
                className={inputClass}
                placeholder={l.gatewayPlaceholder}
                value={form.gatewayUrl}
                onChange={(e) => setForm({ ...form, gatewayUrl: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="local-ai-slots">{l.slots}</label>
              <input
                id="local-ai-slots"
                type="number"
                min={1}
                max={16}
                className={inputClass}
                value={form.maxConcurrency}
                onChange={(e) => setForm({ ...form, maxConcurrency: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="accent-primary" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              {l.enabled}
            </label>
            <div className="flex gap-2 lg:col-span-4">
              <button type="submit" className={primaryClass} disabled={busy}>
                {l.saveServer}
              </button>
              <button type="button" className={buttonClass} onClick={() => setForm(null)}>
                {t.common.cancel}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Feature mappings */}
      <div className="space-y-2">
        <h3 className="font-semibold text-foreground">{l.featuresTitle}</h3>
        <p className="text-sm text-muted-foreground">{l.featuresIntro}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AI_FEATURE_VALUES.map((feature) => (
            <label key={feature} className="flex items-center justify-between gap-3 bg-card border border-border rounded-lg px-3 py-2">
              <span className="text-sm text-foreground">{featureName(feature)}</span>
              <select
                className="px-2 py-1 bg-card border border-border rounded-lg text-foreground text-sm"
                value={status.settings.featureModels[feature] ?? ''}
                disabled={busy}
                onChange={(e) => void save({ action: 'featureModel', feature, model: (e.target.value || null) as LocalModelId | null })}
              >
                <option value="">{l.cloudOnly}</option>
                {LOCAL_MODEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {LOCAL_MODELS[id].label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {/* Tuning */}
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await save({
            action: 'tuning',
            localTimeoutMs: Number(tuningValues.localTimeoutMs) * 1000,
            circuitFailures: Number(tuningValues.circuitFailures),
            circuitOpenMs: Number(tuningValues.circuitOpenMs) * 1000,
            contextShare: Number(tuningValues.contextShare) / 100,
          });
          if (ok) setTuning(null);
        }}
      >
        <h3 className="font-semibold text-foreground">{l.tuningTitle}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
          {(
            [
              ['localTimeoutMs', l.localTimeout],
              ['circuitFailures', l.circuitFailures],
              ['circuitOpenMs', l.circuitOpen],
              ['contextShare', l.contextShare],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className={labelClass} htmlFor={`local-ai-${key}`}>{label}</label>
              <input
                id={`local-ai-${key}`}
                type="number"
                className={inputClass}
                value={tuningValues[key]}
                onChange={(e) => setTuning({ ...tuningValues, [key]: e.target.value })}
              />
            </div>
          ))}
          <button type="submit" className={primaryClass} disabled={busy || !tuning}>
            {l.saveTuning}
          </button>
        </div>
      </form>
    </div>
  );
}
