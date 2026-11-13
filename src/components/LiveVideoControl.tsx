'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LiveOBSPlayer, { type PlayerMetrics } from '@/components/LiveOBSPlayer';
import type { LiveVideoSettings } from '@/lib/liveVideo/broadcastSource';
import type { LiveVideoSessionView, TvVideoReport } from '@/lib/liveVideo/broadcastSourceRuntime';
import type { Playback, StreamHealth } from '@/lib/liveVideo/cloudflareStream';
import { deliveryCostUsd } from '@/lib/liveVideo/streamRules';
import type { LiveStream } from '@/lib/liveVideoDb';

// The Admin page's Live Video & Broadcast Control (docs/live-video.md, GET/PUT /api/admin/live-video and
// /api/admin/live-video/streams): what's set up, the streams and their health, the synchronization and its
// calibration, the audio, and each broadcast TVs are watching now with its OBS stream. There's no camera to direct:
// TVs always show the OBS live video beside the track map, and the Broadcast Director section decides when a recorded
// clip takes the map's place.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
const POLL_MS = 3000;

type Overview = {
  settings: LiveVideoSettings;
  setup: { playback: boolean; api: boolean; signing: boolean };
  maxStreams: number;
  streams: (LiveStream & { health: StreamHealth | null; preview: Playback | null })[];
  sessions: LiveVideoSessionView[];
  reports: TvVideoReport[];
  serverNow: number;
};

const ms = (n: number | null | undefined) => (n == null ? '—' : `${(n / 1000).toFixed(1)} s`);

export default function LiveVideoControl() {
  const { t, fmt } = useLanguage();
  const v = t.liveVideo;
  const a = v.admin;
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<LiveVideoSettings | null>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', inputId: '', requireSigned: false });
  const [preview, setPreview] = useState<number | null>(null);
  const [previewMetrics, setPreviewMetrics] = useState<PlayerMetrics | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/live-video', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setData(json);
      setDraft((current) => current ?? json.settings);
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : v.api.failedLoad);
    }
  }, [v.api.failedLoad]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first load, then every POLL_MS
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const send = async (url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setMessage('');
    setNotice('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(json.error || v.api.invalidDetails);
        return null;
      }
      await load();
      return json;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const json = await send('/api/admin/live-video', 'PUT', draft);
    if (json?.settings) {
      setDraft(json.settings as LiveVideoSettings);
      setNotice(a.saved);
    }
  };

  const addStream = async () => {
    const json = await send('/api/admin/live-video/streams', 'POST', {
      email: form.email,
      name: form.name,
      requireSigned: form.requireSigned,
      ...(form.inputId.trim() ? { inputId: form.inputId.trim() } : {}),
    });
    if (json) {
      setForm({ email: '', name: '', inputId: '', requireSigned: false });
      setNotice(json.rtmpsUrl ? fmt(a.added, { url: String(json.rtmpsUrl) }) : a.addedNoUrl);
    }
  };

  const removeStream = async (stream: LiveStream) => {
    if (!window.confirm(a.removeConfirm)) return;
    const deleteInput = stream.createdVia === 'api' && window.confirm(a.removeInputConfirm);
    await send(`/api/admin/live-video/streams/${stream.id}${deleteInput ? '?deleteInput=1' : ''}`, 'DELETE');
  };

  if (!data || !draft) {
    return (
      <div id="live-video" className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
        <h2 className="text-xl font-bold text-foreground">{a.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message || a.loading}</p>
      </div>
    );
  }

  const set = (changes: Partial<LiveVideoSettings>) => setDraft({ ...draft, ...changes });
  const setSync = (changes: Partial<LiveVideoSettings['sync']>) => setDraft({ ...draft, sync: { ...draft.sync, ...changes } });
  const viewers = data.sessions.reduce((sum, s) => sum + s.viewers, 0);
  // The preview plays only when picked: each minute it plays is a delivered minute
  const previewStream = data.streams.find((s) => s.id === preview) ?? null;
  const previewLatency = previewMetrics?.measuredLatencyMs ?? (previewMetrics?.latencyS != null ? previewMetrics.latencyS * 1000 : null);

  return (
    <div id="live-video" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6" data-testid="live-video-control">
      <div>
        <h2 className="text-xl font-bold text-foreground">{a.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{a.intro}</p>
      </div>
      {message && (
        <p className="text-sm text-red-500" role="alert">
          {message}
        </p>
      )}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      {/* Setup */}
      <div className="rounded-lg border border-border p-4 space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{a.setup}</h3>
        <ul className="text-sm space-y-1">
          {(
            [
              [a.setupPlayback, data.setup.playback, false],
              [a.setupApi, data.setup.api, false],
              [a.setupSigning, data.setup.signing, true],
            ] as const
          ).map(([label, ok, optional]) => (
            <li key={label} className="flex gap-2">
              <span className={ok ? 'text-emerald-500' : optional ? 'text-muted-foreground' : 'text-amber-500'}>{ok ? a.configured : optional ? a.optional : a.missing}</span>
              <span className="text-foreground">{label}</span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-sm text-foreground pt-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-1 accent-primary" />
          <span>
            {a.enabled}
            <span className="block text-xs text-muted-foreground">{a.enabledHint}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={draft.liveRacingEnabled} onChange={(e) => set({ liveRacingEnabled: e.target.checked })} className="accent-primary" />
          {a.liveRacingEnabled}
        </label>
      </div>

      {/* Broadcasts now */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{a.sessions}</h3>
        {data.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{a.noSessions}</p>
        ) : (
          data.sessions.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-3 border-t border-border pt-3 first:border-0 first:pt-0" data-testid="live-video-session">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{s.label}</p>
                <p className="text-xs text-muted-foreground">
                  {a.sessionStream}: <strong data-testid="live-video-stream">{s.stream ? `${s.stream.name} · ${v.status[s.stream.status]}` : v.views.noStream}</strong> · {fmt(a.viewers, { n: s.viewers })}
                </p>
              </div>
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">{a.layoutHint}</p>
        <p className="text-xs text-muted-foreground">{fmt(a.estimatedCost, { viewers: Math.max(viewers, 1), minutes: 60, usd: deliveryCostUsd(Math.max(viewers, 1), 60).toFixed(2) })}</p>
      </div>

      {/* Streams */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{fmt(a.streams, { n: data.streams.length, max: data.maxStreams })}</h3>
        {data.streams.length === 0 ? (
          <p className="text-sm text-muted-foreground">{a.noStreams}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">{a.streamName}</th>
                  <th className="py-1 pr-3">{a.streamOwner}</th>
                  <th className="py-1 pr-3">{a.streamStatus}</th>
                  <th className="py-1 pr-3">{a.streamHealth}</th>
                  <th className="py-1 pr-3">{a.signed}</th>
                  <th className="py-1 pr-3">{a.streamEnabled}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.streams.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2 pr-3 text-foreground">
                      {s.name}
                      <span className="block font-mono text-[11px] text-muted-foreground">{s.inputId}</span>
                    </td>
                    <td className="py-2 pr-3 text-foreground">{s.userName}</td>
                    <td className={`py-2 pr-3 font-semibold ${s.health?.status === 'LIVE' ? 'text-red-500' : 'text-muted-foreground'}`}>{v.status[s.health?.status ?? 'UNKNOWN']}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {s.health?.lastLiveAt ? fmt(a.lastLive, { time: new Date(s.health.lastLiveAt).toLocaleTimeString() }) : a.neverLive}
                      {' · '}
                      {fmt(a.interruptions, { n: s.health?.interruptions ?? 0 })}
                      {s.health?.error && <span className="block text-amber-500">{s.health.error}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={s.requireSigned}
                        disabled={busy || (!data.setup.signing && !s.requireSigned)}
                        onChange={(e) => send(`/api/admin/live-video/streams/${s.id}`, 'PATCH', { requireSigned: e.target.checked })}
                        className="accent-primary"
                        aria-label={a.signed}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        disabled={busy}
                        onChange={(e) => send(`/api/admin/live-video/streams/${s.id}`, 'PATCH', { enabled: e.target.checked })}
                        className="accent-primary"
                        aria-label={a.streamEnabled}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" className="text-xs text-red-500 hover:underline" disabled={busy} onClick={() => removeStream(s)}>
                        {a.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end border-t border-border pt-3">
          <p className="sm:col-span-2 lg:col-span-4 text-xs font-semibold text-foreground">{a.addStream}</p>
          <div>
            <label className={labelClass}>{a.ownerEmail}</label>
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{a.streamName}</label>
            <input className={inputClass} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="lg:col-span-2">
            <label className={labelClass} title={a.inputIdHint}>
              {a.inputId}
            </label>
            <input className={`${inputClass} font-mono`} value={form.inputId} maxLength={32} onChange={(e) => setForm({ ...form, inputId: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.requireSigned} disabled={!data.setup.signing} onChange={(e) => setForm({ ...form, requireSigned: e.target.checked })} className="accent-primary" />
            {a.requireSigned}
          </label>
          <button type="button" className={primaryClass} disabled={busy || !form.email || !form.name || data.streams.length >= data.maxStreams} onClick={addStream}>
            {a.add}
          </button>
          <p className="sm:col-span-2 text-xs text-muted-foreground">{a.inputIdHint}</p>
        </div>
      </div>

      {/* Synchronization and calibration */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{a.sync}</h3>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={draft.sync.enabled} onChange={(e) => setSync({ enabled: e.target.checked })} className="accent-primary" />
          {a.syncEnabled}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>{a.sync}</label>
            <select className={inputClass} value={draft.sync.mode} onChange={(e) => setSync({ mode: e.target.value as 'auto' | 'manual' })}>
              <option value="auto">{a.syncAuto}</option>
              <option value="manual">{a.syncManual}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{a.offset}</label>
            <input className={inputClass} type="number" step={100} value={draft.sync.manualOffsetMs} onChange={(e) => setSync({ manualOffsetMs: Number(e.target.value) })} />
          </div>
          <div>
            <label className={labelClass}>{a.maxBuffer}</label>
            <input className={inputClass} type="number" step={1000} min={5000} value={draft.sync.maxBufferMs} onChange={(e) => setSync({ maxBufferMs: Number(e.target.value) })} />
          </div>
        </div>
        <input
          type="range"
          min={-10_000}
          max={Math.max(draft.sync.maxBufferMs, 10_000)}
          step={100}
          value={draft.sync.manualOffsetMs}
          onChange={(e) => setSync({ manualOffsetMs: Number(e.target.value) })}
          className="w-full accent-primary"
          aria-label={a.offset}
        />
        <p className="text-xs text-muted-foreground">{a.syncNote}</p>

        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-semibold text-foreground">{a.calibration}</p>
          <p className="text-xs text-muted-foreground">{a.calibrationHint}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48">
              <label className={labelClass}>{a.pickStream}</label>
              <select className={inputClass} value={preview ?? ''} onChange={(e) => setPreview(e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {data.streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {v.status[s.health?.status ?? 'UNKNOWN']}
                  </option>
                ))}
              </select>
            </div>
            {previewLatency != null && (
              <>
                <p className="text-sm text-foreground tabular-nums">
                  {fmt(a.measuredLatency, { s: (previewLatency / 1000).toFixed(1), basis: previewMetrics?.measuredLatencyMs != null ? v.basis.measured : v.basis.estimated })}
                </p>
                {/* In manual mode the offset is the whole delay: start the calibration from what the player says */}
                {draft.sync.mode === 'manual' && (
                  <button type="button" className={buttonClass} onClick={() => setSync({ manualOffsetMs: Math.round(previewLatency) })}>
                    {a.useLatency}
                  </button>
                )}
              </>
            )}
          </div>
          {previewStream && (
            <div className="max-w-xl">
              <LiveOBSPlayer
                src={previewStream.preview?.hls ?? null}
                sourceKey={previewStream.id}
                serverStatus={previewStream.health?.status ?? 'UNKNOWN'}
                onMetrics={setPreviewMetrics}
                className="rounded-lg"
              />
            </div>
          )}
        </div>
      </div>

      {/* Audio */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{a.audio}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            {a.obsVolume}: {draft.obsVolume}
            <input type="range" min={0} max={100} value={draft.obsVolume} onChange={(e) => set({ obsVolume: Number(e.target.value) })} className="w-full accent-primary" />
          </label>
          <label className="text-sm text-foreground">
            {a.duckLevel}: {Math.round(draft.duckLevel * 100)}%
            <input type="range" min={0} max={100} value={Math.round(draft.duckLevel * 100)} onChange={(e) => set({ duckLevel: Number(e.target.value) / 100 })} className="w-full accent-primary" />
          </label>
        </div>
      </div>

      <button type="button" className={primaryClass} disabled={busy} onClick={save}>
        {a.save}
      </button>

      {/* TV diagnostics */}
      <div className="rounded-lg border border-border p-4 space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{a.reports}</h3>
        {data.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">{a.noReports}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3">TV</th>
                  <th className="py-1 pr-3">{a.streamStatus}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.latency}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.delay}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.error}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.buffer}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.samples}</th>
                  <th className="py-1 pr-3">{v.tv.diagnosticsRows.stalls}</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.viewer} className="border-t border-border text-foreground tabular-nums">
                    <td className="py-1 pr-3">{r.viewer}</td>
                    <td className="py-1 pr-3">
                      {v.status[r.status as keyof typeof v.status] ?? r.status}
                      {r.degraded && <span className="ml-1 text-amber-500">· {v.tv.syncDegraded}</span>}
                    </td>
                    <td className="py-1 pr-3">
                      {ms(r.latencyMs)} ({v.basis[r.latencyBasis]})
                    </td>
                    <td className="py-1 pr-3">
                      {ms(r.appliedDelayMs)} ({v.basis[r.delayBasis as keyof typeof v.basis] ?? r.delayBasis})
                    </td>
                    <td className="py-1 pr-3">{r.syncErrorMs == null ? v.tv.notMeasured : ms(r.syncErrorMs)}</td>
                    <td className="py-1 pr-3">{ms(r.timelineSpanMs)}</td>
                    <td className="py-1 pr-3">
                      {r.lateSamples} / {r.outOfOrder} / {r.duplicates}
                    </td>
                    <td className="py-1 pr-3">{r.stalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
