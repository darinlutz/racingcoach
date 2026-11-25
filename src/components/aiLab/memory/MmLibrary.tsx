'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Pause, Pin, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import MmDetail from './MmDetail';
import MmGraph from './MmGraph';
import { btn, CategorySelect, danger, day, Field, input, memApi, NamespaceSelect, Notice, Pill, primary, Section, useErrorText, useReference } from './memoryUi';

// The Memory Library: every memory the Admin may see, filtered, sorted and paged on the server; keyword search is
// the library query, semantic and hybrid go through the retrieval engine (/search). Bulk actions confirm first.

export type MemoryRow = {
  id: string;
  title: string;
  content: string;
  namespaceId: string;
  namespacePath: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  importance: number;
  confidence: number;
  sourceApplication: string;
  sourceModel: string | null;
  sourceType: string;
  status: string;
  isPinned: boolean;
  isLocked: boolean;
  isActive: boolean;
  isSensitive: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  expiresAt: string | null;
  version: number;
};

const PAGE = 25;
const STATUSES = ['Active', 'Approved', 'Pending', 'Archived', 'Superseded', 'Expired', 'Rejected', 'Deleted'];

export default function MmLibrary({ openId, onOpened, preset, clearPreset }: { openId: string | null; onOpened: () => void; preset: { id: string; path: string } | null; clearPreset: () => void }) {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const l = m.library;
  const errorText = useErrorText();
  const { categories } = useReference();
  const [view, setView] = useState<'table' | 'graph'>('table');
  const [q, setQ] = useState('');
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic' | 'hybrid'>('keyword');
  const [ns, setNs] = useState(preset?.id ?? '');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [pinned, setPinned] = useState('');
  const [locked, setLocked] = useState('');
  const [sensitive, setSensitive] = useState('');
  const [expiring, setExpiring] = useState('');
  const [minImportance, setMinImportance] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('updated');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ sort, direction, limit: String(PAGE), offset: String(page * PAGE) });
    if (q.trim() && searchMode === 'keyword') p.set('q', q.trim());
    if (ns) p.set('namespace', ns);
    if (cat) p.set('category', cat);
    if (status) p.set('status', status);
    if (pinned) p.set('pinned', pinned);
    if (locked) p.set('locked', locked);
    if (sensitive) p.set('sensitive', sensitive);
    if (expiring) p.set('expiring', expiring);
    if (minImportance) p.set('minImportance', minImportance);
    if (from) p.set('createdFrom', new Date(from).toISOString());
    if (to) p.set('createdTo', new Date(to).toISOString());
    return p.toString();
  }, [q, searchMode, ns, cat, status, pinned, locked, sensitive, expiring, minImportance, from, to, sort, direction, page]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (q.trim() && searchMode !== 'keyword') {
        const r = await memApi<{ results: { id: string; score: number; memory: MemoryRow | null }[] }>('/search', { body: { query: q.trim(), mode: searchMode, limit: 50, namespaces: ns ? [ns] : undefined } });
        const rows = r.results.filter((x) => x.memory).map((x) => x.memory!);
        setItems(rows);
        setScores(Object.fromEntries(r.results.map((x) => [x.id, x.score])));
        setTotal(rows.length);
      } else {
        const r = await memApi<{ items: MemoryRow[]; total: number }>(`/memories?${query}`);
        setItems(r.items);
        setScores({});
        setTotal(r.total);
      }
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }, [query, q, searchMode, ns, errorText]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 250);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (openId) {
      setOpen(openId);
      onOpened();
    }
  }, [openId, onOpened]);

  const bulk = async (action: string) => {
    const ids = [...selected];
    const name = (l.bulk as Record<string, string>)[action];
    const ok = window.confirm(action === 'deletePermanent' ? fmt(l.bulk.confirmPermanent, { count: ids.length }) : fmt(l.bulk.confirm, { action: name, count: ids.length }));
    if (!ok) return;
    try {
      const r = await memApi<{ done: string[]; failed: unknown[] }>('/memories/bulk', { body: { action, ids } });
      setMessage({ tone: r.failed.length ? 'error' : 'ok', text: fmt(l.bulk.result, { done: r.done.length, failed: r.failed.length }) });
      setSelected(new Set());
      void load();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  };

  const flag = (value: string, set: (v: string) => void, text: string) => (
    <Field label={text}>
      <select className={input} value={value} onChange={(e) => (set(e.target.value), setPage(0))}>
        <option value="">{l.flag.any}</option>
        <option value="true">{l.flag.yes}</option>
        <option value="false">{l.flag.no}</option>
      </select>
    </Field>
  );
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const toggleSort = (key: string) => {
    if (sort === key) setDirection(direction === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDirection('desc');
    }
  };
  const th = (key: string | null, text: string, className = '') => (
    <th className={`py-2 pr-3 font-medium text-left ${className}`} aria-sort={key && sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      {key ? (
        <button type="button" className="hover:text-foreground" onClick={() => toggleSort(key)}>
          {text}
          {sort === key ? (direction === 'asc' ? ' ▲' : ' ▼') : ''}
        </button>
      ) : (
        text
      )}
    </th>
  );

  return (
    <Section
      title={m.sections.library}
      actions={
        <>
          <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group">
            {(['table', 'graph'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} className={`px-3 py-1.5 text-sm ${view === v ? 'bg-primary/15 text-foreground font-semibold' : 'text-muted-foreground'}`} onClick={() => setView(v)}>
                {l.view[v]}
              </button>
            ))}
          </div>
          <button type="button" className={primary} onClick={() => setOpen('new')}>
            {l.newMemory}
          </button>
        </>
      }
    >
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      {preset && ns === preset.id && (
        <div className="flex items-center gap-2">
          <Pill>{fmt(l.viewing, { path: preset.path })}</Pill>
          <button type="button" className={btn} onClick={() => (setNs(''), clearPreset())}>{m.common.clear}</button>
        </div>
      )}
      {view === 'graph' ? (
        <MmGraph onOpen={(id) => setOpen(id)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-56">
              <input className={input} type="search" placeholder={l.searchPlaceholder} aria-label={m.common.search} value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
            </div>
            <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label={l.searchMode}>
              {(['keyword', 'semantic', 'hybrid'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={searchMode === k} className={`px-3 py-2 text-sm ${searchMode === k ? 'bg-primary/15 text-foreground font-semibold' : 'text-muted-foreground'}`} onClick={() => setSearchMode(k)}>
                  {l[k]}
                </button>
              ))}
            </div>
          </div>
          <details className="rounded-lg border border-border bg-card px-3 py-2">
            <summary className="text-sm font-semibold text-foreground cursor-pointer">{m.common.filters}</summary>
            <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3">
              <Field label={m.fields.namespace}><NamespaceSelect value={ns} onChange={(v) => (setNs(v), setPage(0))} allowAll /></Field>
              <Field label={m.fields.category}><CategorySelect value={cat} onChange={(v) => (setCat(v), setPage(0))} allowAll /></Field>
              <Field label={m.fields.status}>
                <select className={input} value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))}>
                  <option value="">{m.common.any}</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{(m.statuses as Record<string, string>)[s]}</option>)}
                </select>
              </Field>
              {flag(pinned, setPinned, m.fields.pinned)}
              {flag(locked, setLocked, m.fields.locked)}
              {flag(sensitive, setSensitive, m.fields.sensitive)}
              <Field label={m.fields.expires}>
                <select className={input} value={expiring} onChange={(e) => (setExpiring(e.target.value), setPage(0))}>
                  <option value="">{l.expiring.any}</option>
                  <option value="expired">{l.expiring.expired}</option>
                  <option value="soon">{l.expiring.soon}</option>
                  <option value="never">{l.expiring.never}</option>
                </select>
              </Field>
              <Field label={l.minImportance}><input className={input} type="number" min={1} max={10} value={minImportance} onChange={(e) => (setMinImportance(e.target.value), setPage(0))} /></Field>
              <Field label={l.createdFrom}><input className={input} type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(0))} /></Field>
              <Field label={l.createdTo}><input className={input} type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(0))} /></Field>
              <Field label={l.sort}>
                <select className={input} value={sort} onChange={(e) => setSort(e.target.value)}>
                  {Object.entries(l.sorts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <div className="flex items-end">
                <button type="button" className={btn} onClick={() => { setNs(''); setCat(''); setStatus(''); setPinned(''); setLocked(''); setSensitive(''); setExpiring(''); setMinImportance(''); setFrom(''); setTo(''); setPage(0); }}>{m.common.clear}</button>
              </div>
            </div>
          </details>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="text-sm font-semibold text-foreground">{fmt(m.common.selected, { count: selected.size })}</span>
              {(['archive', 'restore', 'pin', 'unpin', 'lock', 'unlock', 'enable', 'disable', 'delete'] as const).map((a) => (
                <button key={a} type="button" className={btn} onClick={() => void bulk(a)}>{l.bulk[a]}</button>
              ))}
              <button type="button" className={danger} onClick={() => void bulk('deletePermanent')}>{l.bulk.deletePermanent}</button>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 px-3 w-8">
                    <input type="checkbox" aria-label={m.common.select} checked={items.length > 0 && items.every((i) => selected.has(i.id))} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
                  </th>
                  {th('title', m.fields.title)}
                  {th(null, m.fields.category)}
                  {th(null, m.fields.namespace)}
                  {th('importance', m.fields.importance, 'text-right')}
                  {th('confidence', m.fields.confidence, 'text-right')}
                  {th(null, m.fields.status)}
                  {th(null, m.fields.source)}
                  {th('created', m.fields.created)}
                  {th('accessed', m.fields.lastAccessed)}
                  {th('accessCount', m.fields.accessCount, 'text-right')}
                  {th('expires', m.fields.expires)}
                  {Object.keys(scores).length > 0 && th(null, l.score, 'text-right')}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-border hover:bg-secondary/60 cursor-pointer" onClick={() => setOpen(i.id)}>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={m.common.select} checked={selected.has(i.id)} onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(i.id); else next.delete(i.id); setSelected(next); }} />
                    </td>
                    <td className="py-2 pr-3 max-w-md">
                      <div className="font-medium text-foreground flex items-center gap-1">
                        {i.isPinned && <Pin size={14} className="shrink-0 text-primary" aria-label={m.fields.pinned} />}
                        {i.isLocked && <Lock size={14} className="shrink-0 text-muted-foreground" aria-label={m.fields.locked} />}
                        {i.isSensitive && <ShieldAlert size={14} className="shrink-0 text-yellow-600 dark:text-yellow-400" aria-label={m.fields.sensitive} />}
                        <span className="truncate">{i.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{i.content}</div>
                    </td>
                    <td className="py-2 pr-3"><Pill color={i.categoryColor}>{i.categoryName}</Pill></td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{i.namespacePath}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.importance}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{number(i.confidence, { maximumFractionDigits: 2 })}</td>
                    <td className="py-2 pr-3"><Pill>{(m.statuses as Record<string, string>)[i.status] ?? i.status}{i.status === 'Active' && !i.isActive && <Pause size={12} aria-label={m.fields.active} />}</Pill></td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{i.sourceApplication}{i.sourceModel ? ` · ${i.sourceModel}` : ''}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{day(i.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{day(i.lastAccessedAt) ?? m.common.never}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.accessCount}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{day(i.expiresAt) ?? '—'}</td>
                    {Object.keys(scores).length > 0 && <td className="py-2 pr-3 text-right tabular-nums">{scores[i.id] !== undefined ? number(scores[i.id], { maximumFractionDigits: 3 }) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && !busy && <p className="text-sm text-muted-foreground text-center py-8">{l.empty}</p>}
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{fmt(m.common.total, { count: number(total) })}</span>
            {!(q.trim() && searchMode !== 'keyword') && (
              <div className="flex items-center gap-2">
                <button type="button" className={btn} disabled={page === 0} onClick={() => setPage(page - 1)}>{m.common.previous}</button>
                <span>{fmt(m.common.page, { page: page + 1, pages })}</span>
                <button type="button" className={btn} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{m.common.next}</button>
              </div>
            )}
          </div>
        </>
      )}
      {open && <MmDetail id={open === 'new' ? null : open} categories={categories} onClose={() => setOpen(null)} onChanged={() => void load()} onOpen={(id) => setOpen(id)} />}
    </Section>
  );
}
