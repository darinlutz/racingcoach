'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Admin page's Race Engineering Knowledge section (docs/race-engineering-rag.md): the knowledge base the Setup
// Engineer and the Race Coach retrieve from. Lists documents with their trust level and status, sources, ingestion
// jobs and failures; loads the starter corpus, uploads approved documents, embeds, reindexes, deactivates outdated
// content and marks content reviewed or rejected; and tests a question, for any track conditions and tires, to show
// what would be retrieved, why, and the context, weather facts and diagnosis the agents would get. It also shows each
// live driver's weather context (docs/wet-weather.md) and the agents' recent use of the knowledge base.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

type Doc = {
  id: number;
  key: string;
  version: number;
  title: string;
  sourceKey: string;
  format: string;
  authority: string;
  verification: string;
  status: string;
  statusReason: string | null;
  simulators: string[];
  carClasses: string[];
  cars: string[];
  chunks: number;
  embedded: number;
};
type Source = { key: string; title: string; url: string | null; kind: string; license: string; publisher: string | null };
type Job = { id: number; kind: string; status: string; error: string | null; startedAt: string; detail: Record<string, unknown> };
type Compound = { kind: string; index: number | null; name: string | null; confidence: string; source: string };
type LiveWeather = {
  userId: number;
  driver: string;
  track: string;
  ageMs: number;
  fresh: boolean;
  condition: string;
  rain: number | null;
  rainLabel: string | null;
  wetness: string | null;
  declaredWet: boolean | null;
  trackTemp: number | null;
  tires: Compound;
  nextPit: Compound | null;
  available: { index: number; name: string; kind: string }[] | null;
  mismatch: string | null;
  trend: { minutes: number; rain: string | null; wetness: string | null; trackTemp: string | null } | null;
  forecast: string;
  warnings: string[];
};
type KnowledgeUse = { at: number; agent: string; model: string | null; car: string | null; weather: string; question: string; confidence: string; documents: string[]; source: string };
type Report = {
  documents: Doc[];
  sources: Source[];
  jobs: Job[];
  embeddingModel: string;
  retrievalSource: string;
  queryEmbeddingModel: string | null;
  liveWeather?: LiveWeather[];
  knowledgeUses?: KnowledgeUse[];
};

// The wet-weather knowledge (src/lib/engineering/wetWeatherCorpus.ts) by its keys
const isWetDocument = (key: string) => key.startsWith('wet-') || key.startsWith('dx-wet-');
const compoundText = (c: Compound | null) => (!c ? '' : `${c.name ?? c.kind}${c.index != null ? ` #${c.index}` : ''} (${c.kind}, ${c.confidence})`);
type TestResult = {
  source: string;
  carClass: string;
  capabilitiesKnown: boolean;
  allowed: string[];
  confidence: string;
  excluded: number;
  results: { id: string; title: string; score: number; reasons: string[]; authority: string; verification: string; sources: string[] }[];
  diagnosis: { symptom: string | null; phase: string | null; focus: string; conflicts: string[]; missing: string[]; hypotheses: { cause: string; kind: string; confidence: string }[]; setupChanges: { label: string; direction: string }[] };
  context: string;
  tokens: number;
  weatherFacts: string[];
};

export default function EngineeringKnowledgeManager() {
  const { t, fmt } = useLanguage();
  const s = t.admin.engineeringKnowledge;
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [wetOnly, setWetOnly] = useState(false);
  const [chunks, setChunks] = useState<{ docId: number; items: { index: number; title: string; text: string; embedded: boolean }[] } | null>(null);
  const [upload, setUpload] = useState({ format: 'markdown', text: '' });
  const [test, setTest] = useState({ question: '', car: 'Lamborghini Huracan GT3 EVO', simulator: 'iracing', fixed: false, conditions: '', tires: '' });
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/engineering-knowledge', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setReport(await response.json());
    } catch {
      setMessage(s.loadFailed);
    }
  }, [s.loadFailed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the section opens
    void load();
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/engineering-knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(fmt(s.actionFailed, { error: data.error ?? response.status }));
        return null;
      }
      return data;
    } catch {
      setMessage(fmt(s.actionFailed, { error: 'network' }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const ingestion = async (payload: Record<string, unknown>) => {
    const data = await post(payload);
    if (!data) return;
    const count = (status: string) => (data.outcomes ?? []).filter((o: { status: string }) => o.status === status).length;
    setMessage(fmt(s.ingested, { created: count('new'), updated: count('updated'), unchanged: count('unchanged'), failed: (data.failures ?? []).length }));
    await load();
  };

  const embed = async (payload: Record<string, unknown>) => {
    if (!window.confirm(s.embedConfirm)) return;
    const data = await post(payload);
    if (data) setMessage(fmt(s.embedded, { count: data.embedded, cost: Number(data.costUsd ?? 0).toFixed(4), remaining: data.remaining }));
    await load();
  };

  const simple = async (payload: Record<string, unknown>) => {
    if (await post(payload)) await load();
  };

  const showChunks = async (docId: number) => {
    if (chunks?.docId === docId) return setChunks(null);
    const data = await post({ action: 'chunks', id: docId });
    if (data) setChunks({ docId, items: data.chunks });
  };

  const runTest = async () => {
    const data = await post({ action: 'test', ...test, conditions: test.conditions || null, tires: test.tires || null });
    if (data) setTestResult(data);
  };

  const docs = (report?.documents ?? []).filter((d) => (showSuperseded || d.status !== 'superseded') && (!wetOnly || isWetDocument(d.key)));
  const failedJobs = (report?.jobs ?? []).filter((j) => j.status === 'failed' || j.status === 'partial');

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-6" id="engineering-knowledge">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.intro}</p>
        {report && (
          <p className="text-xs text-muted-foreground mt-2">
            {fmt(report.retrievalSource === 'database' ? s.readingDatabase : s.readingStarter, {
              model: report.embeddingModel,
              query: report.queryEmbeddingModel ?? s.keywordsOnly,
            })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void ingestion({ action: 'ingestStarter' })}>
          {s.ingestStarter}
        </button>
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void embed({ action: 'embed' })}>
          {s.embedPending}
        </button>
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void load()}>
          {s.refresh}
        </button>
      </div>
      {message && <p className="text-sm text-foreground">{message}</p>}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-foreground">{fmt(s.documents, { count: docs.length })}</h3>
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <input type="checkbox" checked={wetOnly} onChange={(e) => setWetOnly(e.target.checked)} />
              {s.wetOnly}
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} />
              {s.showSuperseded}
            </label>
          </div>
        </div>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noDocuments}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">{s.document}</th>
                  <th className="py-1 pr-2">{s.trust}</th>
                  <th className="py-1 pr-2">{s.appliesTo}</th>
                  <th className="py-1 pr-2">{s.chunks}</th>
                  <th className="py-1 pr-2">{s.status}</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-border align-top">
                    <td className="py-2 pr-2">
                      <div className="font-medium text-foreground">{d.title}</div>
                      <div className="text-muted-foreground">
                        {d.key} v{d.version} Â· {d.format} Â· {d.sourceKey}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-foreground">
                      {d.authority}
                      <div className={d.verification === 'reviewed' ? 'text-green-500' : d.verification === 'rejected' ? 'text-red-500' : 'text-amber-500'}>{d.verification}</div>
                    </td>
                    <td className="py-2 pr-2 text-muted-foreground">
                      {[d.simulators.join(', '), d.carClasses.join(', '), d.cars.join(', ')].filter(Boolean).join(' Â· ')}
                    </td>
                    <td className="py-2 pr-2 text-foreground">
                      {d.chunks} / {fmt(s.embeddedCount, { count: d.embedded })}
                    </td>
                    <td className="py-2 pr-2 text-foreground">
                      {d.status}
                      {d.statusReason && <div className="text-muted-foreground">{d.statusReason}</div>}
                    </td>
                    <td className="py-2 space-x-1 space-y-1 whitespace-nowrap">
                      <button type="button" className={buttonClass} disabled={busy} onClick={() => void showChunks(d.id)}>
                        {s.view}
                      </button>
                      {d.status !== 'superseded' && (
                        <>
                          {d.verification !== 'reviewed' && (
                            <button type="button" className={buttonClass} disabled={busy} onClick={() => void simple({ action: 'setVerification', id: d.id, verification: 'reviewed' })}>
                              {s.markReviewed}
                            </button>
                          )}
                          {d.verification !== 'rejected' && (
                            <button type="button" className={buttonClass} disabled={busy} onClick={() => void simple({ action: 'setVerification', id: d.id, verification: 'rejected' })}>
                              {s.reject}
                            </button>
                          )}
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => {
                              if (d.status === 'active') {
                                const reason = window.prompt(s.deactivateReason) ?? '';
                                void simple({ action: 'setStatus', id: d.id, status: 'inactive', reason });
                              } else void simple({ action: 'setStatus', id: d.id, status: 'active' });
                            }}
                          >
                            {d.status === 'active' ? s.deactivate : s.activate}
                          </button>
                          <button type="button" className={buttonClass} disabled={busy} onClick={() => void embed({ action: 'reindex', id: d.id })}>
                            {s.reindex}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {chunks && (
          <div className="mt-3 space-y-2 max-h-96 overflow-y-auto border border-border rounded-lg p-3">
            {chunks.items.map((c) => (
              <div key={c.index}>
                <div className="text-xs font-semibold text-foreground">
                  #{c.index} {c.title} {c.embedded ? '' : `(${s.notEmbedded})`}
                </div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{c.text}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-2">{s.sources}</h3>
        <ul className="text-xs text-muted-foreground space-y-1">
          {(report?.sources ?? []).map((src) => (
            <li key={src.key}>
              <span className="text-foreground font-medium">{src.key}</span>: {src.title} Â· {src.kind} Â· {src.license}
              {src.url && (
                <>
                  {' Â· '}
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    {s.link}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-1">{s.upload}</h3>
        <p className="text-xs text-muted-foreground mb-2">{s.uploadHelp}</p>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
          <div>
            <label className={labelClass} htmlFor="ek-format">
              {s.format}
            </label>
            <select id="ek-format" className={inputClass} value={upload.format} onChange={(e) => setUpload({ ...upload, format: e.target.value })}>
              <option value="markdown">Markdown</option>
              <option value="text">{s.formatText}</option>
              <option value="json">JSON</option>
            </select>
            <label className={`${labelClass} mt-2`} htmlFor="ek-file">
              {s.file}
            </label>
            <input
              id="ek-file"
              type="file"
              accept=".md,.txt,.json"
              className="text-xs text-muted-foreground"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                const format = file.name.endsWith('.json') ? 'json' : file.name.endsWith('.txt') ? 'text' : 'markdown';
                setUpload({ format, text });
              }}
            />
          </div>
          <textarea
            className={`${inputClass} font-mono min-h-40`}
            value={upload.text}
            placeholder={s.uploadPlaceholder}
            onChange={(e) => setUpload({ ...upload, text: e.target.value })}
          />
        </div>
        <button
          type="button"
          className={`${primaryClass} mt-2`}
          disabled={busy || !upload.text.trim()}
          onClick={() => void ingestion({ action: 'upload', format: upload.format, text: upload.text })}
        >
          {s.uploadButton}
        </button>
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-2">{s.test}</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ek-question">
              {s.question}
            </label>
            <input id="ek-question" className={inputClass} value={test.question} placeholder={s.questionPlaceholder} onChange={(e) => setTest({ ...test, question: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ek-car">
              {s.car}
            </label>
            <input id="ek-car" className={inputClass} value={test.car} onChange={(e) => setTest({ ...test, car: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ek-sim">
              {s.simulator}
            </label>
            <select id="ek-sim" className={inputClass} value={test.simulator} onChange={(e) => setTest({ ...test, simulator: e.target.value })}>
              <option value="iracing">iRacing</option>
              <option value="acc">ACC</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4 mt-2">
          <div>
            <label className={labelClass} htmlFor="ek-conditions">
              {s.conditions}
            </label>
            <select id="ek-conditions" className={inputClass} value={test.conditions} onChange={(e) => setTest({ ...test, conditions: e.target.value })}>
              <option value="">{s.conditionsNone}</option>
              <option value="dry">{s.conditionDry}</option>
              <option value="damp">{s.conditionDamp}</option>
              <option value="wet">{s.conditionWet}</option>
              <option value="veryWet">{s.conditionVeryWet}</option>
              <option value="drying">{s.conditionDrying}</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ek-tires">
              {s.tires}
            </label>
            <select id="ek-tires" className={inputClass} value={test.tires} disabled={!test.conditions} onChange={(e) => setTest({ ...test, tires: e.target.value })}>
              <option value="">{s.tiresUnknown}</option>
              <option value="dry">{s.tiresDry}</option>
              <option value="wet">{s.tiresWet}</option>
            </select>
          </div>
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
          <input type="checkbox" checked={test.fixed} onChange={(e) => setTest({ ...test, fixed: e.target.checked })} />
          {s.fixedSetup}
        </label>
        <button type="button" className={`${primaryClass} mt-2`} disabled={busy || !test.question.trim()} onClick={() => void runTest()}>
          {s.runTest}
        </button>
        {testResult && (
          <div className="mt-3 space-y-2 text-xs">
            <p className="text-foreground">
              {fmt(s.testSummary, {
                confidence: testResult.confidence,
                carClass: testResult.carClass,
                excluded: testResult.excluded,
                tokens: testResult.tokens,
                source: testResult.source,
              })}
            </p>
            <p className="text-muted-foreground">
              {s.allowed}: {testResult.allowed.join(', ') || 'â€”'}
            </p>
            <ol className="list-decimal pl-5 space-y-1">
              {testResult.results.map((r) => (
                <li key={r.id} className="text-foreground">
                  {r.title} <span className="text-muted-foreground">({r.score}; {r.reasons.join('; ')}; {r.authority}, {r.verification}; {r.sources.join(', ')})</span>
                </li>
              ))}
            </ol>
            <div className="text-foreground">
              {s.diagnosis}: {testResult.diagnosis.symptom ?? 'â€”'} {testResult.diagnosis.phase ?? ''} Â· {testResult.diagnosis.focus}
              {testResult.diagnosis.conflicts.map((c) => (
                <div key={c} className="text-amber-500">{c}</div>
              ))}
              {testResult.diagnosis.missing.map((m) => (
                <div key={m} className="text-muted-foreground">{m}</div>
              ))}
              <ul className="list-disc pl-5">
                {testResult.diagnosis.hypotheses.map((h) => (
                  <li key={h.cause}>
                    {h.cause} <span className="text-muted-foreground">[{h.kind}; {h.confidence}]</span>
                  </li>
                ))}
              </ul>
              <ul className="list-disc pl-5">
                {testResult.diagnosis.setupChanges.map((c) => (
                  <li key={c.label}>
                    {c.label}: {c.direction}
                  </li>
                ))}
              </ul>
            </div>
            {testResult.weatherFacts.length > 0 && (
              <details>
                <summary className="cursor-pointer text-primary">{s.weatherFacts}</summary>
                <pre className="whitespace-pre-wrap text-muted-foreground mt-1">{testResult.weatherFacts.join('\n')}</pre>
              </details>
            )}
            <details>
              <summary className="cursor-pointer text-primary">{s.context}</summary>
              <pre className="whitespace-pre-wrap text-muted-foreground mt-1">{testResult.context}</pre>
            </details>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-1">{s.liveWeather}</h3>
        <p className="text-xs text-muted-foreground mb-2">{s.liveWeatherHelp}</p>
        {(report?.liveWeather ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.liveWeatherNone}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">{s.driver}</th>
                  <th className="py-1 pr-2">{s.condition}</th>
                  <th className="py-1 pr-2">{s.fitted}</th>
                  <th className="py-1 pr-2">{s.freshness}</th>
                  <th className="py-1">{s.notes}</th>
                </tr>
              </thead>
              <tbody>
                {(report?.liveWeather ?? []).map((w) => (
                  <tr key={w.userId} className="border-t border-border align-top">
                    <td className="py-2 pr-2">
                      <div className="font-medium text-foreground">{w.driver}</div>
                      <div className="text-muted-foreground">{w.track}</div>
                    </td>
                    <td className="py-2 pr-2 text-foreground">
                      {w.condition}
                      <div className="text-muted-foreground">
                        {s.rain}: {w.rain != null ? `${Math.round(w.rain * 100)}% (${w.rainLabel})` : '-'} · {s.wetness}: {w.wetness ?? '-'}
                        {w.declaredWet ? ' · declared wet' : ''}
                        {w.trackTemp != null ? ` · ${w.trackTemp.toFixed(1)} °C` : ''}
                      </div>
                      {w.trend && (
                        <div className="text-muted-foreground">
                          {w.trend.minutes} min: {[w.trend.rain, w.trend.wetness, w.trend.trackTemp].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-foreground">
                      {compoundText(w.tires)}
                      <div className="text-muted-foreground">{w.tires.source}</div>
                      {w.nextPit && (
                        <div className="text-muted-foreground">
                          {s.nextPit}: {compoundText(w.nextPit)}
                        </div>
                      )}
                      {w.available && <div className="text-muted-foreground">{w.available.map((a) => `${a.index} ${a.name}`).join(', ')}</div>}
                    </td>
                    <td className={`py-2 pr-2 ${w.fresh ? 'text-green-500' : 'text-amber-500'}`}>
                      {w.fresh ? s.fresh : s.stale} ({Math.round(w.ageMs / 1000)} s)
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {w.mismatch && <div className="text-amber-500">{w.mismatch}</div>}
                      {w.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                      <div>
                        {s.forecast}: {w.forecast}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-1">{s.knowledgeUses}</h3>
        <p className="text-xs text-muted-foreground mb-2">{s.knowledgeUsesHelp}</p>
        {(report?.knowledgeUses ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.knowledgeUsesNone}</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">{s.when}</th>
                  <th className="py-1 pr-2">{s.agent}</th>
                  <th className="py-1 pr-2">{s.weather}</th>
                  <th className="py-1 pr-2">{s.question}</th>
                  <th className="py-1">{s.documentsUsed}</th>
                </tr>
              </thead>
              <tbody>
                {(report?.knowledgeUses ?? []).map((u, i) => (
                  <tr key={`${u.at}-${i}`} className="border-t border-border align-top">
                    <td className="py-2 pr-2 text-muted-foreground whitespace-nowrap">{new Date(u.at).toLocaleString()}</td>
                    <td className="py-2 pr-2 text-foreground">
                      {u.agent}
                      <div className="text-muted-foreground">
                        {s.model}: {u.model ?? '-'}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-foreground">{u.weather}</td>
                    <td className="py-2 pr-2 text-foreground">
                      {u.question}
                      <div className="text-muted-foreground">
                        {u.car ?? ''} · {u.confidence} · {u.source}
                      </div>
                    </td>
                    <td className="py-2 text-muted-foreground">{u.documents.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-foreground mb-2">{fmt(s.jobs, { failed: failedJobs.length })}</h3>
        <ul className="text-xs space-y-1">
          {(report?.jobs ?? []).map((j) => (
            <li key={j.id} className={j.status === 'failed' ? 'text-red-500' : j.status === 'partial' ? 'text-amber-500' : 'text-muted-foreground'}>
              #{j.id} {j.kind} Â· {j.status} Â· {new Date(j.startedAt).toLocaleString()}
              {j.error && <pre className="whitespace-pre-wrap">{j.error}</pre>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
