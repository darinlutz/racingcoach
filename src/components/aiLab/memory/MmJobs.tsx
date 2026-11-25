'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, danger, Field, input, memApi, Notice, Pill, primary, Section, useErrorText, useMemApi, when } from './memoryUi';

// Jobs and Synchronization: the durable job list, the Mem0 outbox, and the controls (run, retry, cancel, pause and
// resume extraction, sync, reconcile, cleanup, rebuild the index, embedding migration and switch)

type Jobs = {
  jobs: { id: string; type: string; status: string; attempts: number; max_attempts: number; progress: number; provider: string | null; error: string | null; dead_letter: boolean; createdAt: string; finishedAt: string | null; runAfter: string | null; result: unknown }[];
  counts: Record<string, number>;
  outbox: { pending: number; failed: number; done: number };
  extractionPaused: boolean;
  migration: { target?: string; provider?: string; embedded?: number; total?: number; switchedAt?: string } | null;
  coverage: { total: number; embedded: number };
  indexes: { name: string }[];
  lastCleanup: { at: string; expired: number; purged: number } | null;
};

export default function MmJobs() {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  const j = m.jobs;
  const errorText = useErrorText();
  const [status, setStatus] = useState('');
  const { data, reload } = useMemApi<Jobs>(`/jobs${status ? `?status=${status}` : ''}`);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [target, setTarget] = useState('qwen3-embedding:0.6b');
  const [open, setOpen] = useState<string | null>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setMessage(null);
    try {
      const r = await memApi<{ result: unknown }>('/jobs', { body: { action, ...extra } });
      setMessage({ tone: 'ok', text: JSON.stringify(r.result) });
      await reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  };
  const mig = data?.migration;
  return (
    <Section title={m.sections.jobs} intro={j.intro} actions={<button type="button" className={btn} onClick={() => void reload()}>{m.common.refresh}</button>}>
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => void act('runNow')}>{j.runNow}</button>
            <button type="button" className={btn} onClick={() => void act(data.extractionPaused ? 'resumeExtraction' : 'pauseExtraction')}>{data.extractionPaused ? j.resume : j.pause}</button>
            <button type="button" className={btn} onClick={() => void act('sync')}>{j.sync}</button>
            <button type="button" className={btn} onClick={() => void act('reconcile')}>{j.reconcile}</button>
            <button type="button" className={btn} onClick={() => void act('cleanup')}>{j.cleanup}</button>
            <button type="button" className={btn} onClick={() => void act('rebuildIndex')}>{j.rebuildIndex}</button>
            <button type="button" className={btn} onClick={() => window.confirm(m.common.confirm) && void act('reembedAll')}>{j.reembedAll}</button>
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <Box title={m.fields.status}>
              <div className="flex flex-wrap gap-1">{Object.entries(data.counts).map(([k, v]) => <Pill key={k}>{(j.statuses as Record<string, string>)[k] ?? k}: {v}</Pill>)}</div>
              <p className="text-sm text-foreground">{fmt(j.outbox, data.outbox)}</p>
              {data.lastCleanup && <p className="text-xs text-muted-foreground">{fmt(j.lastCleanup, { time: when(data.lastCleanup.at) ?? '', expired: data.lastCleanup.expired, purged: data.lastCleanup.purged })}</p>}
            </Box>
            <Box title={j.migration} className="lg:col-span-2">
              {mig?.target && <p className="text-sm text-foreground">{fmt(j.migrationState, { model: mig.target, embedded: mig.embedded ?? 0, total: mig.total ?? 0 })}</p>}
              <div className="flex flex-wrap items-end gap-2">
                <Field label={j.migrationModel}><input className={input} value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
                <button type="button" className={btn} onClick={() => void act('startMigration', { model: target, provider: 'ollama' })}>{j.startMigration}</button>
                <button type="button" className={primary} disabled={!mig?.target || (mig.embedded ?? 0) < (mig.total ?? 1)} onClick={() => void act('switchModel', { model: mig?.target, provider: mig?.provider })}>{fmt(j.switchModel, { model: mig?.target ?? target })}</button>
              </div>
              <p className="text-xs text-muted-foreground">{m.providers.embeddingChange}</p>
            </Box>
          </div>
          <div className="flex items-center gap-2">
            <select className={`${input} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={j.status}>
              <option value="">{m.common.all}</option>
              {Object.entries(j.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-3">{j.type}</th>
                  <th className="text-left py-2 px-3">{j.status}</th>
                  <th className="text-right py-2 px-3">{j.attempts}</th>
                  <th className="text-right py-2 px-3">{j.progress}</th>
                  <th className="text-left py-2 px-3">{m.fields.provider}</th>
                  <th className="text-left py-2 px-3">{j.created}</th>
                  <th className="text-left py-2 px-3">{j.finished}</th>
                  <th className="text-left py-2 px-3">{j.error}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((x) => (
                  <tr key={x.id} className="border-t border-border align-top">
                    <td className="py-2 px-3"><button type="button" className="hover:underline" onClick={() => setOpen(open === x.id ? null : x.id)}>{x.type}</button>{open === x.id && <pre className="text-xs mt-1 max-w-md whitespace-pre-wrap text-muted-foreground">{x.id}{'\n'}{JSON.stringify(x.result, null, 2)}</pre>}</td>
                    <td className="py-2 px-3"><Pill>{(j.statuses as Record<string, string>)[x.status] ?? x.status}</Pill>{x.dead_letter && <span className="block text-xs text-red-500">{j.deadLetter}</span>}{x.status === 'Deferred' && <span className="block text-xs text-muted-foreground">{j.runAfter}: {when(x.runAfter)}</span>}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{x.attempts}/{x.max_attempts}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{Math.round(x.progress * 100)}%</td>
                    <td className="py-2 px-3 text-xs">{x.provider ?? '—'}</td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{when(x.createdAt)}</td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{when(x.finishedAt) ?? '—'}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-xs break-words">{x.error}</td>
                    <td className="py-2 px-3 whitespace-nowrap space-x-1">
                      {['Failed', 'Deferred', 'Cancelled'].includes(x.status) && <button type="button" className={btn} onClick={() => void act('retry', { id: x.id })}>{j.retry}</button>}
                      {['Pending', 'Deferred', 'Failed'].includes(x.status) && <button type="button" className={danger} onClick={() => void act('cancel', { id: x.id })}>{j.cancel}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.jobs.length && <p className="text-sm text-muted-foreground text-center py-6">{j.empty}</p>}
          </div>
        </>
      )}
    </Section>
  );
}
