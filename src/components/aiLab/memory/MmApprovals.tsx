'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, CategorySelect, danger, day, Field, input, memApi, NamespaceSelect, Notice, Pill, primary, Section, Slider, useErrorText, useMemApi } from './memoryUi';

// The Approval Queue: each candidate with its evidence, source, proposed classification, duplicate or conflict and
// why it was proposed; approve (as is, with edits, locked, or as a separate memory), merge, replace or reject.
// Bulk approval only takes eligible candidates (the server checks again).

type Candidate = {
  id: string;
  namespaceId: string;
  namespacePath: string;
  categoryId: string;
  categoryName: string;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  operation: 'add' | 'update' | 'merge' | 'delete';
  target: { id: string; title: string; content: string; isLocked: boolean } | null;
  duplicate: { id: string; title: string; content: string } | null;
  evidence: string;
  rationale: string;
  speaker: 'user' | 'assistant' | 'unknown';
  sensitivity: string;
  flags: string[];
  expiresAt: string | null;
  sourceApplication: string;
  sourceModel: string | null;
  provider: string;
  status: string;
  createdAt: string;
  conflicts: { id: string; kind: string; explanation: string }[];
};

export default function MmApprovals() {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const a = m.approvals;
  const errorText = useErrorText();
  const [status, setStatus] = useState('Pending');
  const { data, error, reload } = useMemApi<{ items: Candidate[]; total: number }>(`/candidates?status=${status}&limit=100`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [edits, setEdits] = useState<{ title: string; content: string; categoryId: string; namespaceId: string; importance: number; expiresAt: string }>({ title: '', content: '', categoryId: '', namespaceId: '', importance: 5, expiresAt: '' });
  const [merging, setMerging] = useState<{ id: string; targetId: string; text: string } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (id: string, action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setMessage(null);
    try {
      await memApi(`/candidates/${id}/${action}`, { body });
      setEditing(null);
      setMerging(null);
      await reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const bulk = async (decision: 'approve' | 'reject') => {
    try {
      const r = await memApi<{ done: string[]; skipped: unknown[] }>('/candidates/bulk', { body: { decision, ids: [...selected] } });
      setMessage({ tone: 'ok', text: fmt(a.bulkResult, { done: r.done.length, skipped: r.skipped.length }) });
      setSelected(new Set());
      await reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  };
  const startEdit = (c: Candidate) => {
    setEditing(c.id);
    setEdits({ title: c.title, content: c.content, categoryId: c.categoryId, namespaceId: c.namespaceId, importance: c.importance, expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '' });
  };
  const editBody = () => ({ ...edits, expiresAt: edits.expiresAt ? new Date(edits.expiresAt).toISOString() : null });

  return (
    <Section
      title={m.sections.approvals}
      intro={a.intro}
      actions={
        <>
          <select className={input} aria-label={a.statusFilter} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(a.filterStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" className={btn} onClick={() => void reload()}>{m.common.refresh}</button>
        </>
      }
    >
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      {status === 'Pending' && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-sm font-semibold">{fmt(m.common.selected, { count: selected.size })}</span>
          <button type="button" className={primary} onClick={() => void bulk('approve')}>{a.bulkApprove}</button>
          <button type="button" className={danger} onClick={() => void bulk('reject')}>{a.bulkReject}</button>
        </div>
      )}
      {data && !data.items.length && <p className="text-sm text-muted-foreground py-6 text-center">{a.empty}</p>}
      <ul className="space-y-3">
        {data?.items.map((c) => (
          <li key={c.id}>
            <Box>
              <div className="flex items-start gap-3">
                {status === 'Pending' && (
                  <input type="checkbox" className="mt-1" aria-label={m.common.select} checked={selected.has(c.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(c.id); else s.delete(c.id); setSelected(s); }} />
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{c.title}</span>
                    <Pill>{c.categoryName}</Pill>
                    <Pill>{c.namespacePath}</Pill>
                    <Pill>{m.fields.importance} {c.importance}</Pill>
                    <Pill>{m.fields.confidence} {number(c.confidence, { maximumFractionDigits: 2 })}</Pill>
                    <Pill>{(a.operations as Record<string, string>)[c.operation]}</Pill>
                  </div>
                  <p className="text-sm text-foreground">{c.content}</p>
                  {c.evidence && (
                    <blockquote className="text-xs text-muted-foreground border-l-2 border-border pl-2">
                      <span className="font-semibold">{a.evidence}: </span>“{c.evidence}”
                    </blockquote>
                  )}
                  {c.rationale && <p className="text-xs text-muted-foreground"><span className="font-semibold">{a.rationale}: </span>{c.rationale}</p>}
                  <p className="text-xs text-muted-foreground">
                    {a.speaker}: {a.speakers[c.speaker]} · {fmt(a.from, { application: c.sourceApplication, model: c.sourceModel ?? '—', provider: c.provider })} · {day(c.createdAt)}
                  </p>
                  {c.flags.filter((f) => !f.startsWith('sensitive:')).map((f) => (
                    <Notice key={f} tone={f === 'possibleInjection' || f === 'secret' ? 'error' : 'warn'}>{(a.flags as Record<string, string>)[f] ?? f}</Notice>
                  ))}
                  {c.sensitivity !== 'none' && <Notice tone="warn">{fmt(a.sensitive, { kinds: c.flags.filter((f) => f.startsWith('sensitive:')).map((f) => f.slice(10)).join(', ') || c.sensitivity })}</Notice>}
                  {c.target && (
                    <div className="text-xs rounded-lg border border-border p-2">
                      <span className="font-semibold">{a.target}{c.target.isLocked ? ` (${m.fields.locked})` : ''}: </span>{c.target.content}
                    </div>
                  )}
                  {c.duplicate && (
                    <div className="text-xs rounded-lg border border-border p-2">
                      <span className="font-semibold">{a.duplicate}: </span>{c.duplicate.content}
                    </div>
                  )}
                  {c.conflicts.map((k) => (
                    <Notice key={k.id} tone="warn">{(m.conflicts.kinds as Record<string, string>)[k.kind]}: {k.explanation}</Notice>
                  ))}

                  {editing === c.id && (
                    <div className="space-y-2 rounded-lg border border-primary/40 p-3">
                      <Field label={m.fields.title}><input className={input} value={edits.title} onChange={(e) => setEdits({ ...edits, title: e.target.value })} /></Field>
                      <Field label={m.fields.content}><textarea className={`${input} min-h-20`} value={edits.content} onChange={(e) => setEdits({ ...edits, content: e.target.value })} /></Field>
                      <div className="grid sm:grid-cols-3 gap-2">
                        <Field label={m.fields.category}><CategorySelect value={edits.categoryId} onChange={(v) => setEdits({ ...edits, categoryId: v })} /></Field>
                        <Field label={m.fields.namespace}><NamespaceSelect value={edits.namespaceId} onChange={(v) => setEdits({ ...edits, namespaceId: v })} /></Field>
                        <Field label={m.fields.expires}><input className={input} type="date" value={edits.expiresAt} onChange={(e) => setEdits({ ...edits, expiresAt: e.target.value })} /></Field>
                      </div>
                      <Slider label={m.fields.importance} value={edits.importance} min={1} max={10} step={1} onChange={(v) => setEdits({ ...edits, importance: v })} />
                      <div className="flex gap-2">
                        <button type="button" className={primary} disabled={busy} onClick={() => void act(c.id, 'approve', editBody())}>{a.approve}</button>
                        <button type="button" className={btn} onClick={() => setEditing(null)}>{m.common.cancel}</button>
                      </div>
                    </div>
                  )}
                  {merging?.id === c.id && (
                    <div className="space-y-2 rounded-lg border border-primary/40 p-3">
                      <Field label={a.mergedContent}><textarea className={`${input} min-h-20`} value={merging.text} onChange={(e) => setMerging({ ...merging, text: e.target.value })} /></Field>
                      <div className="flex gap-2">
                        <button type="button" className={primary} disabled={busy} onClick={() => void act(c.id, 'merge', { targetId: merging.targetId, mergedContent: merging.text })}>{a.merge}</button>
                        <button type="button" className={btn} onClick={() => setMerging(null)}>{m.common.cancel}</button>
                      </div>
                    </div>
                  )}

                  {c.status === 'Pending' && editing !== c.id && merging?.id !== c.id && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" className={primary} disabled={busy} onClick={() => void act(c.id, 'approve')}>{a.approve}</button>
                      <button type="button" className={btn} disabled={busy} onClick={() => startEdit(c)}>{a.approveEdits}</button>
                      <button type="button" className={btn} disabled={busy} onClick={() => void act(c.id, 'approveLocked')}>{a.approveLock}</button>
                      {(c.target || c.duplicate) && (
                        <>
                          <button type="button" className={btn} disabled={busy} onClick={() => void act(c.id, 'separate')}>{a.separate}</button>
                          <button type="button" className={btn} disabled={busy} onClick={() => { const tg = c.target ?? c.duplicate!; setMerging({ id: c.id, targetId: tg.id, text: `${tg.content} ${c.content}` }); }}>{a.merge}</button>
                          <button type="button" className={btn} disabled={busy} onClick={() => void act(c.id, 'replace', { targetId: (c.target ?? c.duplicate)!.id })}>{a.replace}</button>
                        </>
                      )}
                      <button type="button" className={danger} disabled={busy} onClick={() => void act(c.id, 'reject')}>{a.reject}</button>
                    </div>
                  )}
                </div>
              </div>
            </Box>
          </li>
        ))}
      </ul>
    </Section>
  );
}
