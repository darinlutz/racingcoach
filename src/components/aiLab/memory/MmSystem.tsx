'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, danger, Field, input, memApi, Notice, Pill, primary, Section, Toggle, useErrorText, useMemApi, useReference, when } from './memoryUi';
import { useSettings } from './useSettings';

// System Settings: service-wide switches (each change audited; the ones needing a re-embed, restart or approval
// say so) and the API clients for Open WebUI and future applications

type Client = { id: string; name: string; application: string; keyPrefix: string; scopes: string[]; namespaceIds: string[]; globalRead: boolean; subjects: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export default function MmSystem() {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  const s = m.system;
  const errorText = useErrorText();
  const { namespaces } = useReference();
  const { data, draft, setDraft, error, saved, save } = useSettings();
  const clients = useMemApi<{ clients: Client[]; scopes: string[] }>('/clients');
  const [client, setClient] = useState({ name: 'Open WebUI', application: 'open-webui', scopes: ['memory:read', 'memory:extract', 'memory:feedback'], namespaceIds: [] as string[], subjects: '', globalRead: false });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!draft || !data) return error ? <Notice tone="error">{errorText(error)}</Notice> : <p className="text-sm text-muted-foreground">{m.common.loading}</p>;
  const sys = draft.system;
  const set = (patch: Partial<typeof sys>) => setDraft({ ...draft, system: { ...sys, ...patch } });
  const needs = (key: string) => {
    const e = data.effects[key];
    return e ? <Pill>{s.needs[e]}</Pill> : null;
  };
  const create = async () => {
    setMessage(null);
    try {
      const r = await memApi<{ key: string }>('/clients', { body: { ...client, subjects: client.subjects.split(',').map((x) => x.trim()).filter(Boolean) } });
      setNewKey(r.key);
      await clients.reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  return (
    <Section title={m.sections.system} intro={s.intro}>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {saved && <Notice tone="ok">{m.common.saved}</Notice>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Box>
          <Toggle checked={sys.enabled} onChange={(v) => set({ enabled: v })} label={s.enabled} />
          <Field label={s.defaultNamespace}>
            <select className={input} value={sys.defaultNamespace} onChange={(e) => set({ defaultNamespace: e.target.value })}>
              {namespaces.map((n) => <option key={n.id} value={n.path}>{n.path}</option>)}
            </select>
          </Field>
          <div className="flex items-center gap-2"><Toggle checked={sys.customerCaptureEnabled} onChange={(v) => (!v || window.confirm(s.customerCaptureWarning)) && set({ customerCaptureEnabled: v })} label={s.customerCapture} hint={s.customerCaptureWarning} />{needs('system.customerCaptureEnabled')}</div>
          <Toggle checked={sys.autoConflictResolution} onChange={(v) => set({ autoConflictResolution: v })} label={s.autoConflict} hint={s.autoConflictNote} />
          <Toggle checked={false} onChange={() => undefined} label={s.autoFineTuning} hint={s.autoFineTuningNote} disabled />
        </Box>
        <Box>
          <div className="grid grid-cols-2 gap-3">
            <Field label={s.syncInterval}><input className={input} type="number" min={1} value={sys.syncIntervalMinutes} onChange={(e) => set({ syncIntervalMinutes: Number(e.target.value) })} /></Field>
            <Field label={s.concurrency}><input className={input} type="number" min={1} max={8} value={sys.jobConcurrency} onChange={(e) => set({ jobConcurrency: Number(e.target.value) })} /></Field>
            <Field label={s.maxAttempts}><input className={input} type="number" min={1} max={20} value={sys.jobMaxAttempts} onChange={(e) => set({ jobMaxAttempts: Number(e.target.value) })} /></Field>
            <Field label={s.deletedRetention}><input className={input} type="number" min={0} max={365} value={sys.deletedRetentionDays} onChange={(e) => set({ deletedRetentionDays: Number(e.target.value) })} /></Field>
            <Field label={s.logLevel}>
              <select className={input} value={sys.logLevel} onChange={(e) => set({ logLevel: e.target.value as typeof sys.logLevel })}>
                {Object.entries(s.logLevels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1">{needs('system.jobConcurrency')}{needs('system.syncIntervalMinutes')}</div>
        </Box>
      </div>
      <div className="flex gap-2">
        <button type="button" className={primary} onClick={() => void save({ system: sys })}>{m.common.save}</button>
        <button type="button" className={btn} onClick={() => setDraft({ ...draft, system: data.defaults.system })}>{m.common.restoreDefaults}</button>
      </div>

      <Box title={s.clients}>
        <p className="text-sm text-muted-foreground">{s.clientsIntro}</p>
        <p className="text-xs text-muted-foreground">{fmt(s.endpoints, { url: typeof window === 'undefined' ? '' : `${window.location.origin}/api/memory/v1` })}</p>
        {message && <Notice tone="error">{message}</Notice>}
        {newKey && (
          <Notice tone="ok">
            {s.newKey} <code className="select-all break-all font-mono">{newKey}</code>
          </Notice>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={s.clientName}><input className={input} value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} /></Field>
          <Field label={s.application}><input className={input} value={client.application} onChange={(e) => setClient({ ...client, application: e.target.value.toLowerCase() })} /></Field>
          <Field label={s.subjects}><input className={input} value={client.subjects} onChange={(e) => setClient({ ...client, subjects: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <span className="text-xs font-medium text-muted-foreground">{s.scopes}:</span>
          {(clients.data?.scopes ?? []).map((sc) => (
            <Toggle key={sc} checked={client.scopes.includes(sc)} onChange={(v) => setClient({ ...client, scopes: v ? [...client.scopes, sc] : client.scopes.filter((x) => x !== sc) })} label={sc} />
          ))}
        </div>
        <div>
          <span className="text-xs font-medium text-muted-foreground">{s.clientNamespaces}:</span>
          <div className="flex flex-wrap gap-3 mt-1">
            {namespaces.filter((n) => !n.parentId).map((n) => (
              <Toggle key={n.id} checked={client.namespaceIds.includes(n.id)} onChange={(v) => setClient({ ...client, namespaceIds: v ? [...client.namespaceIds, n.id] : client.namespaceIds.filter((x) => x !== n.id) })} label={n.path} />
            ))}
          </div>
        </div>
        <Toggle checked={client.globalRead} onChange={(v) => setClient({ ...client, globalRead: v })} label={s.globalRead} />
        <button type="button" className={primary} disabled={!client.namespaceIds.length || !client.scopes.length} onClick={() => void create()}>{s.createClient}</button>
        {!clients.data?.clients.length ? (
          <p className="text-sm text-muted-foreground">{s.noClients}</p>
        ) : (
          <ul className="divide-y divide-border">
            {clients.data.clients.map((c) => (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{c.name}</span>
                <Pill>{c.application}</Pill>
                <code className="text-xs text-muted-foreground">{c.keyPrefix}…</code>
                <span className="text-xs text-muted-foreground">{c.scopes.join(', ')} · {c.namespaceIds.map((id) => namespaces.find((n) => n.id === id)?.path ?? id).join(', ')}{c.subjects.length ? ` · ${c.subjects.join(', ')}` : ''}</span>
                <span className="text-xs text-muted-foreground">{c.lastUsedAt ? fmt(s.lastUsed, { time: when(c.lastUsedAt) ?? '' }) : m.common.never}</span>
                {c.revokedAt ? <Pill>{s.revoked}</Pill> : <button type="button" className={`${danger} ml-auto`} onClick={() => window.confirm(m.common.confirm) && void memApi(`/clients/${c.id}`, { method: 'DELETE' }).then(() => clients.reload())}>{s.revoke}</button>}
              </li>
            ))}
          </ul>
        )}
      </Box>
    </Section>
  );
}
