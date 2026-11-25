'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { btn, CategorySelect, danger, Drawer, Field, input, memApi, NamespaceSelect, Notice, Pill, primary, Slider, Toggle, useErrorText, when, type Category } from './memoryUi';

// One memory in a drawer: edit (with the version the Admin saw, so a concurrent change is refused, not
// overwritten), lifecycle actions, history with restore, relationships, retrievals and feedback, and its source.
// A locked memory is read-only here until it's unlocked.

type Memory = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  namespaceId: string;
  namespacePath: string;
  categoryId: string;
  importance: number;
  confidence: number;
  sourceModel: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  sourceApplication: string;
  sourceType: string;
  sourceReference: string | null;
  isPinned: boolean;
  isLocked: boolean;
  isActive: boolean;
  isSensitive: boolean;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  accessCount: number;
  supersedesMemoryId: string | null;
  metadata: Record<string, unknown>;
  embedding: { model: string; dimensions: number; status: string; version: number; current: boolean } | null;
};
type Detail = {
  memory: Memory;
  relationships: { id: string; fromId: string; toId: string; type: string; origin: string; status: string; note: string }[];
  retrievals: { at: string; client: string; mode: string }[];
  feedback: { rating: string; n: number }[];
  conflicts: { id: string; status: string; kind: string }[];
};
type History = { id: number; version: number; changeType: string; snapshot: Record<string, unknown>; changedFields: string[]; actor: string | null; reason: string | null; at: string };

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

export default function MmDetail({ id, categories, onClose, onChanged, onOpen }: { id: string | null; categories: Category[]; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const d = m.detail;
  const errorText = useErrorText();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<History[] | null>(null);
  const [tab, setTab] = useState<keyof typeof d.tabs>('details');
  const [draft, setDraft] = useState({ title: '', content: '', summary: '', namespaceId: '', categoryId: '', importance: 5, expiresAt: '', isPinned: false, isLocked: false, isSensitive: false });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rel, setRel] = useState({ toId: '', type: 'relatedTo', note: '' });
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await memApi<Detail>(`/memories/${id}`);
      setDetail(r);
      setLoadedAt(Date.now());
      const x = r.memory;
      setDraft({ title: x.title, content: x.content, summary: x.summary ?? '', namespaceId: x.namespaceId, categoryId: x.categoryId, importance: x.importance, expiresAt: toLocalInput(x.expiresAt), isPinned: x.isPinned, isLocked: x.isLocked, isSensitive: x.isSensitive });
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  }, [id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the memory, or a new one's defaults
    if (id) void load();
    else {
      const semantic = categories.find((c) => c.key === 'semantic');
      setDraft((v) => ({ ...v, categoryId: semantic?.id ?? '', importance: semantic?.defaultImportance ?? 5 }));
    }
  }, [id, load, categories]);

  useEffect(() => {
    if (id && tab === 'history') void memApi<{ history: History[] }>(`/memories/${id}/history`).then((r) => setHistory(r.history)).catch((e) => setMessage({ tone: 'error', text: errorText(e) }));
  }, [id, tab, errorText, detail?.memory.version]);

  const run = async (work: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      if (ok) setMessage({ tone: 'ok', text: ok });
      await load();
      onChanged();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const mem = detail?.memory;
  const patch = (body: Record<string, unknown>, ok = m.common.saved) => run(() => memApi(`/memories/${mem!.id}`, { method: 'PATCH', body: { ...body, expectedVersion: mem!.version } }), ok);

  const save = async () => {
    const body = {
      title: draft.title,
      content: draft.content,
      summary: draft.summary || null,
      namespaceId: draft.namespaceId,
      categoryId: draft.categoryId,
      importance: draft.importance,
      expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      isPinned: draft.isPinned,
      isSensitive: draft.isSensitive,
    };
    if (!id) {
      setBusy(true);
      try {
        const r = await memApi<{ memory: Memory }>('/memories', { body: { ...body, isLocked: draft.isLocked } });
        onChanged();
        onOpen(r.memory.id);
      } catch (e) {
        setMessage({ tone: 'error', text: errorText(e) });
      } finally {
        setBusy(false);
      }
      return;
    }
    await patch(body);
  };

  const readOnly = Boolean(mem?.isLocked);
  const stale = mem && (mem.status === 'Superseded' || mem.status === 'Expired');
  // Measured at the time the memory was loaded (render stays pure)
  const unverified = mem && loadedAt - new Date(mem.lastVerifiedAt ?? mem.createdAt).getTime() > 180 * 86_400_000;

  return (
    <Drawer open title={id ? mem?.title ?? d.title : d.newTitle} onClose={onClose} wide>
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      {mem && (
        <div className="flex flex-wrap gap-2">
          <Pill>{(m.statuses as Record<string, string>)[mem.status]}</Pill>
          <Pill>{m.fields.version} {mem.version}</Pill>
          {mem.isPinned && <Pill>{m.fields.pinned}</Pill>}
          {mem.isLocked && <Pill>{m.fields.locked}</Pill>}
          {mem.isSensitive && <Pill>{m.fields.sensitive}</Pill>}
          {!mem.isActive && mem.status === 'Active' && <Pill>{d.disable}</Pill>}
          {stale && <Pill>{mem.status === 'Superseded' ? d.outdated : d.expired}</Pill>}
          {unverified && <Pill>{d.unverified}</Pill>}
        </div>
      )}
      {mem?.isLocked && <Notice tone="warn">{d.lockedNote}</Notice>}
      {mem?.isSensitive && <Notice>{d.sensitiveNote}</Notice>}
      {id && (
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
          {(Object.keys(d.tabs) as (keyof typeof d.tabs)[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === k ? 'border-primary text-foreground font-semibold' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab(k)}>
              {d.tabs[k]}
            </button>
          ))}
        </div>
      )}

      {(tab === 'details' || !id) && (
        <div className="space-y-3">
          <Field label={m.fields.title}><input className={input} value={draft.title} disabled={readOnly} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label={m.fields.content}><textarea className={`${input} min-h-28`} value={draft.content} disabled={readOnly} maxLength={4000} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></Field>
          <Field label={m.fields.summary}><textarea className={`${input} min-h-14`} value={draft.summary} disabled={readOnly} maxLength={1000} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={m.fields.category}><CategorySelect value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} /></Field>
            <Field label={m.fields.namespace}><NamespaceSelect value={draft.namespaceId} onChange={(v) => setDraft({ ...draft, namespaceId: v })} /></Field>
          </div>
          <Slider label={m.fields.importance} value={draft.importance} min={1} max={10} step={1} onChange={(v) => setDraft({ ...draft, importance: v })} hint={d.importanceHint} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={m.fields.expires} hint={d.expiresHint}><input className={input} type="datetime-local" disabled={readOnly} value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} /></Field>
            {mem && <Field label={m.fields.confidence}><div className="text-sm text-foreground py-2 tabular-nums">{number(mem.confidence, { maximumFractionDigits: 2 })}</div></Field>}
          </div>
          <div className="flex flex-wrap gap-4">
            <Toggle checked={draft.isPinned} onChange={(v) => setDraft({ ...draft, isPinned: v })} label={m.fields.pinned} disabled={readOnly} />
            <Toggle checked={draft.isSensitive} onChange={(v) => setDraft({ ...draft, isSensitive: v })} label={m.fields.sensitive} disabled={readOnly} />
            {!id && <Toggle checked={draft.isLocked} onChange={(v) => setDraft({ ...draft, isLocked: v })} label={m.fields.locked} />}
          </div>
          {mem && (
            <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div>{m.fields.created}: {when(mem.createdAt)}</div>
              <div>{m.fields.updated}: {when(mem.updatedAt)}</div>
              <div>{m.fields.lastAccessed}: {when(mem.lastAccessedAt) ?? m.common.never}</div>
              <div>{m.fields.accessCount}: {mem.accessCount}</div>
              <div className="sm:col-span-2">
                {m.fields.embedding}:{' '}
                {!mem.embedding ? d.embeddingNone : mem.embedding.current ? fmt(d.embeddingCurrent, { model: mem.embedding.model, dimensions: mem.embedding.dimensions }) : fmt(d.embeddingStale, { model: mem.embedding.model })}
              </div>
              {mem.supersedesMemoryId && (
                <div className="sm:col-span-2">
                  {d.supersedes}: <button type="button" className="underline" onClick={() => onOpen(mem.supersedesMemoryId!)}>{mem.supersedesMemoryId}</button>
                </div>
              )}
            </dl>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className={primary} disabled={busy || readOnly || !draft.content.trim()} onClick={() => void save()}>{id ? m.common.save : m.common.create}</button>
            {mem && (
              <>
                {mem.status === 'Active' && <button type="button" className={btn} disabled={busy} onClick={() => void patch({ isActive: !mem.isActive })}>{mem.isActive ? d.disable : d.enable}</button>}
                {mem.status === 'Active' && <button type="button" className={btn} disabled={busy} onClick={() => void patch({ status: 'Archived' })}>{d.archive}</button>}
                {['Archived', 'Superseded', 'Expired', 'Approved'].includes(mem.status) && <button type="button" className={btn} disabled={busy} onClick={() => void patch({ status: 'Active' })}>{d.restore}</button>}
                <button type="button" className={btn} disabled={busy} onClick={() => void patch({ isPinned: !mem.isPinned })}>{mem.isPinned ? d.unpin : d.pin}</button>
                <button type="button" className={btn} disabled={busy} onClick={() => void patch({ isLocked: !mem.isLocked })}>{mem.isLocked ? d.unlock : d.lock}</button>
                <button type="button" className={btn} disabled={busy || readOnly} onClick={() => void patch({ lastVerifiedAt: new Date().toISOString() })}>{d.verify}</button>
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => void run(async () => {
                    const r = await memApi<{ model?: string; dimensions?: number }>(`/memories/${mem.id}/embed`, { body: {} });
                    setMessage({ tone: 'ok', text: fmt(d.reembedded, { model: r.model ?? '', dimensions: r.dimensions ?? 0 }) });
                  })}
                >
                  {d.reembed}
                </button>
                {mem.status !== 'Deleted' && <button type="button" className={danger} disabled={busy} onClick={() => window.confirm(d.confirmDelete) && void run(() => memApi(`/memories/${mem.id}`, { method: 'DELETE' }))}>{d.deleteSoft}</button>}
                <button
                  type="button"
                  className={danger}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(d.confirmPermanent)) return;
                    void memApi(`/memories/${mem.id}?permanent=true`, { method: 'DELETE' }).then(() => (onChanged(), onClose())).catch((e) => setMessage({ tone: 'error', text: errorText(e) }));
                  }}
                >
                  {d.deletePermanent}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {id && tab === 'history' && (
        <ol className="space-y-3">
          {(history ?? []).map((h) => (
            <li key={h.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{fmt(d.history.version, { version: h.version })} · {h.changeType}</span>
                <span className="text-xs text-muted-foreground">{when(h.at)}{h.actor ? ` · ${fmt(d.history.by, { actor: h.actor })}` : ''}</span>
              </div>
              {h.changedFields.length > 0 && <div className="text-xs text-muted-foreground">{fmt(d.history.changed, { fields: h.changedFields.join(', ') })}</div>}
              {h.reason && <div className="text-xs text-muted-foreground">{h.reason}</div>}
              <p className="text-sm text-foreground whitespace-pre-wrap">{String(h.snapshot.content ?? '')}</p>
              {mem && h.version !== mem.version && (
                <button type="button" className={btn} disabled={busy || readOnly} onClick={() => window.confirm(fmt(d.history.confirmRestore, { version: h.version })) && void run(() => memApi(`/memories/${mem.id}/restore`, { body: { version: h.version, expectedVersion: mem.version } }), m.common.saved)}>
                  {d.history.restore}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {id && tab === 'relationships' && detail && (
        <div className="space-y-3">
          {!detail.relationships.length && <p className="text-sm text-muted-foreground">{d.relationships.empty}</p>}
          <ul className="space-y-2">
            {detail.relationships.map((r) => {
              const other = r.fromId === mem!.id ? r.toId : r.fromId;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-border bg-card px-3 py-2">
                  <span className="font-medium text-foreground">{r.fromId === mem!.id ? '→' : '←'} {(m.relationshipTypes as Record<string, string>)[r.type]}</span>
                  <button type="button" className="underline text-xs text-muted-foreground" onClick={() => onOpen(other)}>{other}</button>
                  {r.status === 'proposed' && <Pill>{d.relationships.proposed}</Pill>}
                  {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                  <span className="ml-auto flex gap-1">
                    {r.status === 'proposed' && <button type="button" className={btn} onClick={() => void run(() => memApi(`/relationships/${r.id}`, { method: 'PATCH', body: { status: 'active' } }))}>{d.relationships.accept}</button>}
                    {r.status === 'proposed' && <button type="button" className={btn} onClick={() => void run(() => memApi(`/relationships/${r.id}`, { method: 'PATCH', body: { status: 'rejected' } }))}>{d.relationships.reject}</button>}
                    <button type="button" className={danger} onClick={() => void run(() => memApi(`/relationships/${r.id}`, { method: 'DELETE' }))}>{d.relationships.remove}</button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="grid sm:grid-cols-4 gap-2 items-end">
            <Field label={d.relationships.type}>
              <select className={input} value={rel.type} onChange={(e) => setRel({ ...rel, type: e.target.value })}>
                {Object.entries(m.relationshipTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={d.relationships.to}><input className={input} value={rel.toId} onChange={(e) => setRel({ ...rel, toId: e.target.value.trim() })} /></Field>
            <Field label={d.relationships.note}><input className={input} value={rel.note} onChange={(e) => setRel({ ...rel, note: e.target.value })} /></Field>
            <button type="button" className={primary} disabled={!rel.toId} onClick={() => void run(() => memApi('/relationships', { body: { fromId: mem!.id, ...rel } }).then(() => setRel({ toId: '', type: 'relatedTo', note: '' })))}>{d.relationships.add}</button>
          </div>
        </div>
      )}

      {id && tab === 'retrievals' && detail && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="text-sm font-semibold text-foreground">{d.retrievals.feedback}:</span>
            {detail.feedback.length ? detail.feedback.map((f) => <Pill key={f.rating}>{(m.inspector.feedback as Record<string, string>)[f.rating]}: {f.n}</Pill>) : <span className="text-sm text-muted-foreground">{m.analytics.noFeedback}</span>}
          </div>
          {!detail.retrievals.length ? (
            <p className="text-sm text-muted-foreground">{d.retrievals.empty}</p>
          ) : (
            <ul className="text-sm space-y-1">
              {detail.retrievals.map((r, i) => <li key={i} className="text-foreground">{when(r.at)} · {r.client} · {r.mode}</li>)}
            </ul>
          )}
          {detail.conflicts.length > 0 && (
            <div className="text-sm">
              <span className="font-semibold text-foreground">{d.conflicts}: </span>
              {detail.conflicts.map((c) => <Pill key={c.id}>{(m.conflicts.kinds as Record<string, string>)[c.kind]} · {c.status}</Pill>)}
            </div>
          )}
        </div>
      )}

      {id && tab === 'source' && mem && (
        <dl className="text-sm space-y-2">
          <div><dt className="text-xs text-muted-foreground">{m.fields.sourceType}</dt><dd className="text-foreground">{mem.sourceType}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{m.fields.sourceApplication}</dt><dd className="text-foreground">{mem.sourceApplication}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{m.fields.sourceModel}</dt><dd className="text-foreground">{mem.sourceModel ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{d.sourceInfo.conversation}</dt><dd className="text-foreground break-all">{mem.sourceConversationId ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{d.sourceInfo.message}</dt><dd className="text-foreground break-all">{mem.sourceMessageId ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{d.sourceInfo.reference}</dt><dd className="text-foreground break-all">{mem.sourceReference ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{d.sourceInfo.metadata}</dt><dd><pre className="text-xs bg-card border border-border rounded-lg p-2 overflow-auto">{JSON.stringify(mem.metadata, null, 2)}</pre></dd></div>
        </dl>
      )}
    </Drawer>
  );
}
