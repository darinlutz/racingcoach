'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { BarList, Box, btn, bytes, Field, input, LineChart, NamespaceSelect, Notice, pct, Section, Stat, useErrorText, useMemApi } from './memoryUi';

// Analytics: growth, retrieval, extraction, providers and quality for a date range and namespace, with a CSV
// export of the daily series. Every figure is from the tables; a rate with nothing to measure is "not measured".

type A = {
  growth: { day: string; created: number; deleted: number; total: number }[];
  byCategory: { name: string; color: string; n: number }[];
  byNamespace: { path: string; n: number }[];
  storage: { memoriesBytes: number; embeddingsBytes: number; vectorIndexBytes: number; schemaBytes: number };
  retrieval: { series: { day: string; requests: number; empty: number; avg_ms: number | null; avg_tokens: number | null; avg_returned: number | null; degraded: number }[]; latency: Record<string, number | null>; mostRetrieved: { id: string; title: string; n: number }[]; neverRetrieved: number };
  extraction: Record<string, number | null> & { acceptanceRate: number | null; duplicateRate: number | null; conflictRate: number | null };
  providers: { jobs: { provider: string; jobs: number; failed: number; avg_ms: number | null }[]; modelUsage: { model: string; local: boolean; calls: number; prompt: number | null; output: number | null; costUsd: number | null }[]; embeddingsGenerated: number };
  quality: { feedback: Record<string, number>; feedbackTotal: number; helpfulRate: number | null; irrelevantRate: number | null; incorrect: number; outdated: number; stale: number; conflicting: number };
  storageEstimate: { measured: boolean; perMemoryBytes: number; perEmbeddingBytes: number; hnswBytesPerVector: number; dimensions: number; estimates: { memories: number; bytes: number }[] };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function MmAnalytics({ openMemory }: { openMemory: (id: string) => void }) {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const a = m.analytics;
  const errorText = useErrorText();
  const [to, setTo] = useState(() => iso(new Date()));
  const [from, setFrom] = useState(() => iso(new Date(new Date().getTime() - 30 * 86_400_000)));
  const [ns, setNs] = useState('');
  const qs = `from=${from}T00:00:00Z&to=${to}T23:59:59Z${ns ? `&namespace=${ns}` : ''}`;
  const { data, error } = useMemApi<A>(`/analytics?${qs}`);
  const preset = (days: number) => {
    setTo(iso(new Date()));
    setFrom(iso(new Date(Date.now() - days * 86_400_000)));
  };
  const b = (v: number) => bytes(v, number) ?? '—';
  const e = data?.extraction;
  const lat = data?.retrieval.latency;
  const ms = (v: number | null | undefined) => (v === null || v === undefined ? null : fmt(m.common.ms, { value: number(v) }));
  return (
    <Section
      title={m.sections.analytics}
      actions={
        <a className={btn} href={`/api/memory/v1/analytics?${qs}&format=csv`} download>
          {a.exportCsv}
        </a>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        {(['7', '30', '90'] as const).map((d) => (
          <button key={d} type="button" className={btn} onClick={() => preset(Number(d))}>{a.days[d]}</button>
        ))}
        <Field label={a.from}><input className={input} type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} /></Field>
        <Field label={a.to}><input className={input} type="date" value={to} onChange={(ev) => setTo(ev.target.value)} /></Field>
        <div className="w-64"><Field label={m.fields.namespace}><NamespaceSelect value={ns} onChange={setNs} allowAll /></Field></div>
      </div>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {data && e && lat && (
        <>
          <h3 className="text-lg font-semibold text-foreground">{a.growth}</h3>
          <div className="grid lg:grid-cols-2 gap-4">
            <Box><LineChart title={a.total} series={[a.total]} points={data.growth.map((g) => ({ x: g.day, values: [g.total] }))} /></Box>
            <Box><LineChart title={a.createdDeleted} series={[a.created, a.deleted]} points={data.growth.map((g) => ({ x: g.day, values: [g.created, g.deleted] }))} /></Box>
            <Box><BarList title={a.byCategory} items={data.byCategory.map((x) => ({ key: x.name, label: x.name, value: x.n, color: x.color }))} /></Box>
            <Box><BarList title={a.byNamespace} items={data.byNamespace.map((x) => ({ key: x.path, label: x.path, value: x.n }))} /></Box>
            <Box title={a.storage}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label={a.storageMemories} value={b(data.storage.memoriesBytes)} />
                <Stat label={a.storageEmbeddings} value={b(data.storage.embeddingsBytes)} />
                <Stat label={a.storageIndex} value={b(data.storage.vectorIndexBytes)} />
                <Stat label={a.storageSchema} value={b(data.storage.schemaBytes)} />
              </div>
            </Box>
            <Box title={a.estimates}>
              <ul className="text-sm space-y-1">
                {data.storageEstimate.estimates.map((x) => <li key={x.memories} className="text-foreground">{fmt(a.estimateRow, { count: number(x.memories), size: b(x.bytes) })}</li>)}
              </ul>
              <p className="text-xs text-muted-foreground">
                {fmt(a.estimateBasis, { basis: data.storageEstimate.measured ? a.measured : a.designFigures, perMemory: b(data.storageEstimate.perMemoryBytes), perEmbedding: b(data.storageEstimate.perEmbeddingBytes), hnsw: b(data.storageEstimate.hnswBytesPerVector), dims: data.storageEstimate.dimensions })}
              </p>
            </Box>
          </div>

          <h3 className="text-lg font-semibold text-foreground">{a.retrieval}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={a.requests} value={number(lat.n ?? 0)} />
            <Stat label={a.successful} value={number(lat.successful ?? 0)} />
            <Stat label={a.empty} value={number(lat.empty ?? 0)} />
            <Stat label={a.latency.p95} value={ms(lat.p95)} />
            <Stat label={a.latency.total} value={ms(lat.total)} />
            <Stat label={a.latency.semantic} value={ms(lat.semantic)} />
            <Stat label={a.latency.keyword} value={ms(lat.keyword)} />
            <Stat label={a.latency.embed} value={ms(lat.embed)} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Box><LineChart title={a.requests} series={[a.requests, a.empty]} points={data.retrieval.series.map((r) => ({ x: r.day, values: [r.requests, r.empty] }))} /></Box>
            <Box><LineChart title={a.avgTokens} series={[a.avgTokens]} points={data.retrieval.series.map((r) => ({ x: r.day, values: [r.avg_tokens] }))} /></Box>
            <Box><LineChart title={a.avgMemories} series={[a.avgMemories]} valueFormat={(v) => number(v, { maximumFractionDigits: 1 })} points={data.retrieval.series.map((r) => ({ x: r.day, values: [r.avg_returned] }))} /></Box>
            <Box>
              <BarList title={a.mostRetrieved} items={data.retrieval.mostRetrieved.map((x) => ({ key: x.id, label: x.title, value: x.n }))} onPick={openMemory} />
              <p className="text-xs text-muted-foreground">{fmt(a.neverRetrieved, { count: data.retrieval.neverRetrieved })}</p>
            </Box>
          </div>

          <h3 className="text-lg font-semibold text-foreground">{a.extraction}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={a.jobs} value={number(e.jobs ?? 0)} />
            <Stat label={a.candidates} value={number(e.candidates ?? 0)} />
            <Stat label={a.approved} value={number(e.approved ?? 0)} />
            <Stat label={a.rejected} value={number(e.rejected ?? 0)} />
            <Stat label={a.merged} value={number(e.merged ?? 0)} />
            <Stat label={a.acceptance} value={pct(e.acceptanceRate, number)} />
            <Stat label={a.duplicateRate} value={pct(e.duplicateRate, number)} />
            <Stat label={a.conflictRate} value={pct(e.conflictRate, number)} />
          </div>
          <Box>
            <BarList
              title={a.confidence}
              items={[
                { key: 'low', label: '< 0.4', value: Number(e.conf_low ?? 0) },
                { key: 'mid', label: '0.4–0.7', value: Number(e.conf_mid ?? 0) },
                { key: 'high', label: '0.7–0.9', value: Number(e.conf_high ?? 0) },
                { key: 'top', label: '≥ 0.9', value: Number(e.conf_top ?? 0) },
              ]}
            />
          </Box>

          <h3 className="text-lg font-semibold text-foreground">{a.providers}</h3>
          <div className="grid lg:grid-cols-2 gap-4">
            <Box>
              <table className="w-full text-sm">
                <tbody>
                  {data.providers.modelUsage.map((u) => (
                    <tr key={`${u.model}:${u.local}`} className="border-t border-border first:border-0">
                      <td className="py-1">{u.model}</td>
                      <td className="py-1 text-muted-foreground">{u.local ? a.local : a.frontier}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(a.calls, { count: u.calls })}</td>
                      <td className="py-1 text-right tabular-nums">{u.local ? '$0' : u.costUsd === null ? a.costUnknown : `$${number(u.costUsd, { maximumFractionDigits: 4 })}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.providers.modelUsage.length && <p className="text-sm text-muted-foreground">{a.noData}</p>}
              <p className="text-xs text-muted-foreground">{fmt(a.embeddingsGenerated, { count: data.providers.embeddingsGenerated })}</p>
            </Box>
            <Box><BarList title={a.jobs} items={data.providers.jobs.map((j) => ({ key: j.provider, label: `${j.provider}${j.failed ? ` (${j.failed} ✕)` : ''}`, value: j.jobs }))} /></Box>
          </div>

          <h3 className="text-lg font-semibold text-foreground">{a.quality}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label={a.helpfulRate} value={pct(data.quality.helpfulRate, number)} hint={!data.quality.feedbackTotal ? a.noFeedback : undefined} />
            <Stat label={a.irrelevantRate} value={pct(data.quality.irrelevantRate, number)} />
            <Stat label={a.incorrect} value={number(data.quality.incorrect)} />
            <Stat label={a.outdated} value={number(data.quality.outdated)} />
            <Stat label={a.stale} value={number(data.quality.stale)} />
            <Stat label={a.conflicting} value={number(data.quality.conflicting)} />
          </div>
        </>
      )}
    </Section>
  );
}
