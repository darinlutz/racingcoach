'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, bytes, CategorySelect, Field, input, memApi, NamespaceSelect, Notice, Pill, primary, Section, Toggle, useErrorText, useMemApi, useReference, when } from './memoryUi';

// Import (a dry-run preview, then the rows picked), the Open WebUI migration (compare, preview, ask both),
// exports kept 72 hours for their maker, and the fine-tuning dataset preparation

type PreviewRow = { line: number; title: string | null; content: string; verdict: string; namespaceId: string | null; categoryId: string | null; importance: number | null; confidence: number | null; expiresAt: string | null; pinned: boolean; locked: boolean; externalId: string | null; createdAt: string | null; similar: { title: string; similarity: number } | null; sensitive: boolean };
type Preview = { rows: PreviewRow[]; errors: { line: number; error: string }[]; semantic: boolean };

export default function MmImportExport() {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const ie = m.importExport;
  const errorText = useErrorText();
  const { namespaces, categories } = useReference();
  const exports = useMemApi<{ exports: { id: string; kind: string; fileName: string; bytes: number; createdAt: string; expiresAt: string; stats: Record<string, unknown> }[] }>('/exports');
  const [format, setFormat] = useState<'json' | 'jsonl' | 'csv'>('json');
  const [text, setText] = useState('');
  const [nsId, setNsId] = useState('');
  const [catId, setCatId] = useState('');
  const [preview, setPreview] = useState<(Preview & { source: 'file' | 'openWebui' }) | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [compare, setCompare] = useState<{ native: number; migrated: number } | null>(null);
  const [ask, setAsk] = useState('');
  const [both, setBoth] = useState<{ central: { id: string; content: string; score: number }[]; native: { results?: { content: string; distance: number | null }[]; error?: string } } | null>(null);
  const [exp, setExp] = useState({ format: 'json' as 'json' | 'jsonl' | 'csv', approvedOnly: true, includeHistory: false, namespaceId: '' });
  const [ft, setFt] = useState({ name: 'memories', format: 'chat', train: 80, valid: 10, test: 10, seed: 'clarivex', system: 'You are a helpful assistant for the Clarivex team.', minImportance: 5, namespace: '' });
  const [ftResult, setFtResult] = useState<{ stats: { examples: number; eligible: number; splits: Record<string, number>; excluded: Record<string, number>; contamination: { groupsAcrossSplits: string[]; duplicateAnswersAcrossSplits: number } }; preview: { split: string; chat: { messages: { role: string; content: string }[] } }[]; id: string | null } | null>(null);
  const ns = nsId || namespaces.find((n) => n.path === 'personal')?.id || '';
  const cat = catId || categories.find((c) => c.key === 'semantic')?.id || '';
  const fail = (e: unknown) => setMessage({ tone: 'error', text: errorText(e) });

  const runPreview = async (source: 'file' | 'openWebui') => {
    setMessage(null);
    try {
      const r = await memApi<Preview>('/import', { body: { action: 'preview', format, text: source === 'file' ? text : undefined, source: source === 'openWebui' ? 'openWebui' : undefined, mapping: { defaultNamespaceId: ns, defaultCategoryId: cat } } });
      setPreview({ ...r, source });
      setPicked(new Set(r.rows.flatMap((x, i) => (x.verdict === 'new' ? [i] : []))));
      if (!r.semantic) setMessage({ tone: 'warn', text: ie.noSemantic });
    } catch (e) {
      fail(e);
    }
  };
  const commit = async () => {
    if (!preview) return;
    try {
      const rows = preview.rows.filter((_, i) => picked.has(i)).map((r) => ({ title: r.title, content: r.content, namespaceId: r.namespaceId, categoryId: r.categoryId, importance: r.importance, confidence: r.confidence, expiresAt: r.expiresAt, pinned: r.pinned, locked: r.locked, externalId: r.externalId, createdAt: r.createdAt }));
      const r = await memApi<{ created?: number; duplicates?: number; refused?: unknown[]; job: unknown }>('/import', { body: { action: 'commit', rows, source: preview.source } });
      setMessage({ tone: 'ok', text: r.job ? ie.queued : fmt(ie.imported, { created: r.created ?? 0, duplicates: r.duplicates ?? 0, refused: r.refused?.length ?? 0 }) });
      setPreview(null);
    } catch (e) {
      fail(e);
    }
  };
  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (/\.csv$/i.test(f.name)) setFormat('csv');
    else if (/\.jsonl$/i.test(f.name)) setFormat('jsonl');
    else setFormat('json');
    void f.text().then(setText);
  };
  const runDataset = async (previewOnly: boolean) => {
    try {
      setFtResult(await memApi('/fine-tuning', { body: { name: ft.name, format: ft.format, split: { train: ft.train, valid: ft.valid, test: ft.test }, seed: ft.seed, system: ft.system, minImportance: ft.minImportance, namespaces: [ft.namespace || namespaces.find((n) => n.path === 'racingcoach')?.path || 'racingcoach'], preview: previewOnly } }));
      if (!previewOnly) await exports.reload();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Section title={m.sections.importExport}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Box title={ie.importTitle}>
        <p className="text-sm text-muted-foreground">{ie.importIntro}</p>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label={ie.format}>
            <select className={input} value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              {(['json', 'jsonl', 'csv'] as const).map((f) => <option key={f} value={f}>{ie.formats[f]}</option>)}
            </select>
          </Field>
          <Field label={ie.file}><input className={input} type="file" accept=".json,.jsonl,.csv,application/json,text/csv" onChange={(e) => readFile(e.target.files?.[0])} /></Field>
          <Field label={ie.defaultNamespace}><NamespaceSelect value={ns} onChange={setNsId} /></Field>
          <Field label={ie.defaultCategory}><CategorySelect value={cat} onChange={setCatId} /></Field>
        </div>
        <Field label={ie.paste}><textarea className={`${input} min-h-20 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <button type="button" className={primary} disabled={!text.trim()} onClick={() => void runPreview('file')}>{ie.preview}</button>
      </Box>

      <Box title={ie.owuiTitle}>
        <p className="text-sm text-muted-foreground">{ie.owuiIntro}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => void memApi<{ native: number; migrated: number }>('/openwebui').then(setCompare, fail)}>{ie.compare}</button>
          <button type="button" className={primary} onClick={() => void runPreview('openWebui')}>{ie.loadNative}</button>
        </div>
        {compare && <p className="text-sm text-foreground">{fmt(ie.compareResult, compare)}</p>}
        <div className="flex gap-2 items-end">
          <Field label={ie.compareQuery}><input className={input} value={ask} onChange={(e) => setAsk(e.target.value)} /></Field>
          <button type="button" className={btn} disabled={!ask.trim()} onClick={() => void memApi<typeof both>('/openwebui', { body: { query: ask } }).then(setBoth, fail)}>{ie.compareQuery}</button>
        </div>
        {both && (
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div><div className="font-semibold">{ie.centralResults}</div><ul className="list-disc pl-5">{both.central.map((c) => <li key={c.id}>{c.content} <span className="text-xs text-muted-foreground">{number(c.score, { maximumFractionDigits: 3 })}</span></li>)}</ul></div>
            <div><div className="font-semibold">{ie.nativeResults}</div>{both.native.error ? <p className="text-muted-foreground">{both.native.error}</p> : <ul className="list-disc pl-5">{(both.native.results ?? []).map((c, i) => <li key={i}>{c.content}</li>)}</ul>}</div>
          </div>
        )}
      </Box>

      {preview && (
        <Box title={ie.preview} actions={<button type="button" className={primary} disabled={!picked.size} onClick={() => void commit()}>{fmt(ie.importSelected, { count: picked.size })}</button>}>
          {preview.errors.length > 0 && <Notice tone="warn">{fmt(ie.rowErrors, { count: preview.errors.length })}: {preview.errors.slice(0, 5).map((e) => `${e.line} ${e.error}`).join(', ')}</Notice>}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {preview.rows.map((r, i) => {
                  const selectable = r.verdict === 'new' || r.verdict === 'possibleDuplicate';
                  return (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="py-1 pr-2"><input type="checkbox" aria-label={m.common.select} disabled={!selectable} checked={picked.has(i)} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(i); else s.delete(i); setPicked(s); }} /></td>
                      <td className="py-1 pr-2"><Pill>{(ie.verdicts as Record<string, string>)[r.verdict]}</Pill>{r.sensitive && <Pill>{m.fields.sensitive}</Pill>}</td>
                      <td className="py-1 pr-2">{r.content}{r.similar && <div className="text-xs text-muted-foreground">≈ {r.similar.title} ({number(r.similar.similarity, { maximumFractionDigits: 2 })})</div>}</td>
                      <td className="py-1 text-xs text-muted-foreground whitespace-nowrap">{namespaces.find((n) => n.id === r.namespaceId)?.path} · {categories.find((c) => c.id === r.categoryId)?.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Box>
      )}

      <Box title={ie.exportTitle}>
        <p className="text-sm text-muted-foreground">{ie.exportIntro}</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label={ie.format}>
            <select className={input} value={exp.format} onChange={(e) => setExp({ ...exp, format: e.target.value as typeof exp.format })}>
              {(['json', 'jsonl', 'csv'] as const).map((f) => <option key={f} value={f}>{ie.formats[f]}</option>)}
            </select>
          </Field>
          <Field label={m.fields.namespace}><NamespaceSelect value={exp.namespaceId} onChange={(v) => setExp({ ...exp, namespaceId: v })} allowAll /></Field>
          <button type="button" className={primary} onClick={() => void memApi('/exports', { body: { format: exp.format, approvedOnly: exp.approvedOnly, includeHistory: exp.includeHistory, namespaceIds: exp.namespaceId ? [exp.namespaceId] : undefined } }).then(() => exports.reload(), fail)}>{ie.createExport}</button>
        </div>
        <div className="flex gap-4">
          <Toggle checked={exp.approvedOnly} onChange={(v) => setExp({ ...exp, approvedOnly: v })} label={ie.approvedOnly} />
          <Toggle checked={exp.includeHistory} onChange={(v) => setExp({ ...exp, includeHistory: v })} label={ie.includeHistory} />
        </div>
        <h4 className="text-sm font-semibold text-foreground">{ie.downloads}</h4>
        {!exports.data?.exports.length ? (
          <p className="text-sm text-muted-foreground">{ie.noExports}</p>
        ) : (
          <ul className="text-sm space-y-1">
            {exports.data.exports.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <a className="underline text-primary" href={`/api/memory/v1/exports/${x.id}`} download>{x.fileName}</a>
                <span className="text-xs text-muted-foreground">{bytes(x.bytes, number)} · {fmt(ie.expires, { time: when(x.expiresAt) ?? '' })}</span>
              </li>
            ))}
          </ul>
        )}
      </Box>

      <Box title={ie.fineTuning}>
        <p className="text-sm text-muted-foreground">{ie.fineTuningIntro}</p>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label={ie.ftName}><input className={input} value={ft.name} onChange={(e) => setFt({ ...ft, name: e.target.value })} /></Field>
          <Field label={ie.ftFormat}>
            <select className={input} value={ft.format} onChange={(e) => setFt({ ...ft, format: e.target.value })}>
              {Object.entries(ie.ftFormats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={m.fields.namespace}>
            <select className={input} value={ft.namespace} onChange={(e) => setFt({ ...ft, namespace: e.target.value })}>
              {namespaces.filter((n) => !n.isCustomerData).map((n) => <option key={n.id} value={n.path}>{n.path}</option>)}
            </select>
          </Field>
          <Field label={ie.ftMinImportance}><input className={input} type="number" min={1} max={10} value={ft.minImportance} onChange={(e) => setFt({ ...ft, minImportance: Number(e.target.value) })} /></Field>
          <Field label={ie.ftSplit}>
            <div className="flex gap-1">
              {(['train', 'valid', 'test'] as const).map((k) => <input key={k} aria-label={k} className={input} type="number" min={0} max={100} value={ft[k]} onChange={(e) => setFt({ ...ft, [k]: Number(e.target.value) })} />)}
            </div>
          </Field>
          <Field label={ie.ftSeed}><input className={input} value={ft.seed} onChange={(e) => setFt({ ...ft, seed: e.target.value })} /></Field>
        </div>
        <Field label={ie.ftSystem}><input className={input} value={ft.system} onChange={(e) => setFt({ ...ft, system: e.target.value })} /></Field>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => void runDataset(true)}>{ie.ftPreview}</button>
          <button type="button" className={primary} onClick={() => void runDataset(false)}>{ie.ftExport}</button>
        </div>
        {ftResult && (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">{fmt(ie.ftStats, { examples: ftResult.stats.examples, eligible: ftResult.stats.eligible, train: ftResult.stats.splits.train, valid: ftResult.stats.splits.valid, test: ftResult.stats.splits.test })}</p>
            {Object.keys(ftResult.stats.excluded).length > 0 && <p className="text-xs text-muted-foreground">{fmt(ie.ftExcluded, { list: Object.entries(ftResult.stats.excluded).map(([k, v]) => `${k} ${v}`).join(', ') })}</p>}
            <p className="text-xs text-muted-foreground">{fmt(ie.ftContamination, { groups: ftResult.stats.contamination.groupsAcrossSplits.length, answers: ftResult.stats.contamination.duplicateAnswersAcrossSplits })}</p>
            <pre className="text-xs bg-card border border-border rounded-lg p-2 max-h-64 overflow-auto">{ftResult.preview.slice(0, 5).map((p) => JSON.stringify(p.chat)).join('\n')}</pre>
          </div>
        )}
      </Box>
    </Section>
  );
}
