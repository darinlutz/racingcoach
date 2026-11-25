'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { MmSection } from './MemoryManager';
import { BarList, Box, btn, Dot, LineChart, Notice, pct, Section, Stat, useErrorText, useMemApi, when, useReference } from './memoryUi';

// Overview: the cards, service health and the last 30 days, all from real tables (null is "not measured", never 0)

type Overview = {
  counts: Record<string, number>;
  extractionSuccessRate: number | null;
  averageRetrievalMs: number | null;
  embeddings: { model: string; total: number; embedded: number; stale: number; dimensions: number | null; pgvector: string | null; indexes: { name: string; bytes: number }[] };
  services: {
    postgres: { ok: boolean };
    pgvector: { ok: boolean };
    ollama: { ok: boolean; version: string | null; error: string | null; breaker: { open: boolean } };
    mem0: { ok: boolean | null; detail: string | null; version?: string | null; breaker?: { open: boolean } };
    jobs: { waiting: number; failed: number; lastCompletedAt: string | null };
  };
  enabled: boolean;
};

type Analytics = {
  growth: { day: string; created: number; deleted: number; total: number }[];
  byCategory: { name: string; color: string; n: number }[];
  byNamespace: { path: string; n: number }[];
  retrieval: { series: { day: string; requests: number; avg_ms: number | null }[]; mostRetrieved: { id: string; title: string; n: number }[] };
  extraction: { acceptanceRate: number | null };
  providers: { modelUsage: { model: string; local: boolean; calls: number; costUsd: number | null }[] };
};

export default function MmOverview({ go }: { go: (s: MmSection, id?: string) => void }) {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const o = m.overview;
  const errorText = useErrorText();
  const { data, error, reload, loading } = useMemApi<Overview>('/overview');
  const { data: a } = useMemApi<Analytics>('/analytics');
  useReference();
  const c = data?.counts;
  const s = data?.services;
  const local = a?.providers.modelUsage.filter((u) => u.local).reduce((n, u) => n + u.calls, 0) ?? 0;
  const frontier = a?.providers.modelUsage.filter((u) => !u.local).reduce((n, u) => n + u.calls, 0) ?? 0;
  const cost = a?.providers.modelUsage.some((u) => !u.local && u.costUsd === null) ? null : (a?.providers.modelUsage.reduce((n, u) => n + (u.costUsd ?? 0), 0) ?? null);
  return (
    <Section title={m.sections.overview} intro={m.intro} actions={<button type="button" className={btn} onClick={() => void reload()} disabled={loading}>{m.common.refresh}</button>}>
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {data && !data.enabled && <Notice tone="warn">{o.disabledNotice}</Notice>}
      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label={o.total} value={number(c.total)} />
          <Stat label={o.active} value={number(c.active)} />
          <Stat label={o.pinned} value={number(c.pinned)} />
          <Stat label={o.locked} value={number(c.locked)} />
          <button type="button" className="text-left" onClick={() => go('approvals')}>
            <Stat label={o.pending} value={number(c.pending)} tone={c.pending ? 'warn' : undefined} />
          </button>
          <button type="button" className="text-left" onClick={() => go('conflicts')}>
            <Stat label={o.conflicts} value={number(c.conflicts)} tone={c.conflicts ? 'warn' : undefined} />
          </button>
          <Stat label={o.expiring} value={number(c.expiring)} />
          <Stat label={o.archived} value={number(c.archived)} />
          <Stat label={o.createdToday} value={number(c.created_today)} />
          <Stat label={o.retrievedToday} value={number(c.retrievedToday)} hint={fmt(o.retrievalsToday, { count: number(c.retrievalsToday) })} />
          <Stat label={o.extractionSuccess} value={pct(data.extractionSuccessRate, number)} />
          <Stat label={o.avgLatency} value={data.averageRetrievalMs === null ? null : fmt(m.common.ms, { value: number(data.averageRetrievalMs) })} />
        </div>
      )}
      {data && s && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Box title={o.services}>
            <ul className="space-y-2 text-sm">
              <li><Dot ok={s.postgres.ok} label={o.postgres} /></li>
              <li><Dot ok={s.pgvector.ok} label={`${o.pgvector}${data.embeddings.pgvector ? ` ${data.embeddings.pgvector}` : ''}`} /></li>
              <li>
                <Dot ok={s.ollama.ok} label={`${o.ollama}${s.ollama.version ? ` ${s.ollama.version}` : ''}`} />
                {s.ollama.breaker.open && <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">{o.circuitOpen}</span>}
                {!s.ollama.ok && s.ollama.error && <span className="block text-xs text-muted-foreground">{s.ollama.error}</span>}
              </li>
              <li>
                <Dot ok={s.mem0.ok} label={`${o.mem0}${s.mem0.version ? ` ${s.mem0.version}` : ''}`} />
                {s.mem0.ok === null && <span className="ml-2 text-xs text-muted-foreground">{m.common.notSelected}</span>}
                {s.mem0.ok === false && s.mem0.detail && <span className="block text-xs text-muted-foreground">{s.mem0.detail}</span>}
              </li>
              <li>
                <Dot ok={s.jobs.failed === 0} label={o.jobs} /> <span className="text-xs text-muted-foreground">{fmt(o.jobsDetail, { waiting: s.jobs.waiting, failed: s.jobs.failed })}</span>
                {s.jobs.lastCompletedAt && <span className="block text-xs text-muted-foreground">{fmt(o.lastJob, { time: when(s.jobs.lastCompletedAt) ?? '' })}</span>}
              </li>
            </ul>
          </Box>
          <Box title={o.embeddingIndex}>
            <p className="text-sm text-foreground">{fmt(o.embeddingCoverage, { embedded: number(data.embeddings.embedded), total: number(data.embeddings.total), model: data.embeddings.model })}</p>
            <div className="h-2 rounded bg-border/40">
              <div className="h-2 rounded bg-primary" style={{ width: `${data.embeddings.total ? (data.embeddings.embedded / data.embeddings.total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {!data.services.pgvector.ok ? o.noPgvector : data.embeddings.indexes.length ? data.embeddings.indexes.map((i) => fmt(o.hnsw, { name: i.name })).join(' · ') : o.noIndex}
            </p>
          </Box>
        </div>
      )}
      {a && (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground">{o.charts}</h3>
          <div className="grid lg:grid-cols-2 gap-4">
            <Box><LineChart title={m.analytics.growth} series={[m.analytics.total]} points={a.growth.map((g) => ({ x: g.day, values: [g.total] }))} /></Box>
            <Box><LineChart title={m.analytics.createdDeleted} series={[m.analytics.created, m.analytics.deleted]} points={a.growth.map((g) => ({ x: g.day, values: [g.created, g.deleted] }))} /></Box>
            <Box><LineChart title={m.analytics.requests} series={[m.analytics.requests]} points={a.retrieval.series.map((r) => ({ x: r.day, values: [r.requests] }))} /></Box>
            <Box><LineChart title={m.analytics.latencyTitle} series={[m.analytics.latency.total]} valueFormat={(v) => `${number(v)} ms`} points={a.retrieval.series.map((r) => ({ x: r.day, values: [r.avg_ms] }))} /></Box>
            <Box><BarList title={m.analytics.byCategory} items={a.byCategory.map((x) => ({ key: x.name, label: x.name, value: x.n, color: x.color }))} /></Box>
            <Box><BarList title={m.analytics.byNamespace} items={a.byNamespace.map((x) => ({ key: x.path, label: x.path, value: x.n }))} /></Box>
            <Box><BarList title={m.analytics.mostRetrieved} items={a.retrieval.mostRetrieved.map((x) => ({ key: x.id, label: x.title, value: x.n }))} onPick={(id) => go('library', id)} /></Box>
            <Box title={m.analytics.providers}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label={m.analytics.local} value={number(local)} />
                <Stat label={m.analytics.frontier} value={number(frontier)} />
                <Stat label={m.analytics.acceptance} value={pct(a.extraction.acceptanceRate, number)} />
                <Stat label={m.analytics.cost} value={cost === null ? null : `$${number(cost, { maximumFractionDigits: 4 })}`} hint={cost === null ? m.analytics.costUnknown : undefined} />
              </div>
            </Box>
          </div>
          <button type="button" className="text-sm text-primary underline" onClick={() => go('analytics')}>{o.openAnalytics}</button>
        </>
      )}
    </Section>
  );
}
