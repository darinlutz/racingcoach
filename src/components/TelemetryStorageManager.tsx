'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { StorageTaskStatus } from '@/lib/telemetryMigration';
import type { TelemetryStorageReport } from '@/lib/telemetryStorageReport';

// The Admin page's Telemetry Storage section (docs/telemetry-storage.md): where lap CSVs are kept, the migration's
// progress through its phases (copy, verify, switch reads, purge the PostgreSQL copies), the deletion queue, the runs,
// 30 days of request counts, the database's size and the estimated R2 cost, with the controls for each phase. Long
// actions run on the server in the background; the section polls while one runs.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
const dangerClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50';
const POLL_MS = 3000;

type Action =
  | 'backfill'
  | 'verify'
  | 'cleanup'
  | 'reconcile'
  | 'purgeLegacy'
  | 'stop'
  | 'switchReads'
  | 'rollbackReads'
  | 'vacuum'
  | 'expertLapsToR2'
  | 'expertLapsToPostgres';

export default function TelemetryStorageManager({ timeZone }: { timeZone: string }) {
  const { t, fmt, locale, number } = useLanguage();
  const s = t.admin.telemetryStorage;
  const [report, setReport] = useState<TelemetryStorageReport | null>(null);
  const [task, setTask] = useState<StorageTaskStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [batchSize, setBatchSize] = useState('25');
  const [concurrency, setConcurrency] = useState('4');
  const [maxBatches, setMaxBatches] = useState('');
  const [purgeWord, setPurgeWord] = useState('');
  const [backupTaken, setBackupTaken] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/telemetry-storage', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setReport(data.report);
      setTask(data.task);
    } catch {
      setMessage(s.loadFailed);
    }
  }, [s.loadFailed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the section opens
    void load();
  }, [load]);

  // Poll while an action runs, and once more when it ends
  useEffect(() => {
    if (!task?.running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [task?.running, load]);

  const run = async (action: Action, extra: Record<string, unknown> = {}) => {
    if (action === 'switchReads' && !window.confirm(s.switchConfirm)) return;
    if (action === 'rollbackReads' && !window.confirm(s.rollbackConfirm)) return;
    if (action === 'expertLapsToPostgres' && !window.confirm(s.expertLapsToPostgresConfirm)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/telemetry-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(fmt(s.actionFailed, { error: data.error ?? response.status }));
      } else if (action === 'switchReads') {
        setMessage(fmt(s.switchedResult, { count: data.switched }));
      } else if (action === 'rollbackReads') {
        setMessage(fmt(s.rolledBackResult, { count: data.rolledBack }));
      } else if (action === 'expertLapsToR2' || action === 'expertLapsToPostgres') {
        const moved = data.expertLaps;
        setMessage(
          fmt(s.expertLapsResult, { moved: moved?.moved ?? 0, failed: moved?.failed ?? 0 }) +
            (moved?.errors?.length ? ` ${moved.errors.map((e: { id: number; error: string }) => `#${e.id}: ${e.error}`).join('; ')}` : '')
        );
      } else if (action === 'vacuum') {
        setMessage(s.vacuumed);
      } else if (action === 'purgeLegacy') {
        setPurgeWord('');
        setBackupTaken(false);
      }
      if (data.task) setTask(data.task);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const batchOptions = () => ({
    batchSize: Number(batchSize) || undefined,
    concurrency: Number(concurrency) || undefined,
    maxBatches: maxBatches.trim() ? Number(maxBatches) : undefined,
  });

  const bytes = (n: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${number(value, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
  };
  const formatTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const running = task?.running ?? false;
  const kindName = (kind: string | null) => (kind ? (s.kinds as Record<string, string>)[kind] ?? kind : '');

  const taskLine = !task?.kind
    ? null
    : task.running
      ? fmt(task.stopping ? s.taskStopping : s.taskRunning, { kind: kindName(task.kind) })
      : task.error
        ? fmt(s.taskFailed, { kind: kindName(task.kind), error: task.error })
        : fmt(s.taskDone, { kind: kindName(task.kind) });

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-foreground">{s.title}</h2>
          <p className="text-sm text-muted-foreground">{s.intro}</p>
        </div>
        <button type="button" className={buttonClass} onClick={() => void load()} disabled={busy}>
          {s.refresh}
        </button>
      </div>

      {report && (
        <>
          <p className={`text-sm ${report.configured ? 'text-muted-foreground' : 'text-yellow-500'}`}>
            {report.configured ? (report.mode === 'r2' ? fmt(s.modeR2, { bucket: report.bucket ?? '' }) : s.modePostgres) : s.notConfigured}
          </p>

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label={s.objects} value={number(report.objects.count)} />
            <Stat label={s.objectBytes} value={bytes(report.objects.bytes)} />
            <Stat label={s.originalBytes} value={bytes(report.objects.csvBytes)} />
            <Stat label={s.estimatedCost} value={money.format(report.estimatedMonthlyCost)} />
            <Stat label={s.postgresDb} value={bytes(report.postgres.databaseBytes)} />
            <Stat label={s.postgresLaps} value={bytes(report.postgres.collectorLapsBytes)} />
            <Stat label={s.inlineBytes} value={bytes(report.postgres.inlineBytes)} />
            <Stat label={s.reclaimable} value={bytes(report.postgres.reclaimableBytes)} />
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-2">{s.progressTitle}</h3>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label={s.totalLaps} value={number(report.migration.totalLaps)} />
              <Stat label={s.inlineRemaining} value={number(report.migration.inlineRemaining)} />
              <Stat label={s.copied} value={number(report.migration.copied)} />
              <Stat label={s.verified} value={number(report.migration.verified)} />
              <Stat label={s.switched} value={number(report.migration.switched)} />
              <Stat label={s.legacyKept} value={number(report.migration.legacyKept)} />
              <Stat label={s.missing} value={number(report.migration.missing)} />
              <Stat label={s.failing} value={number(report.migration.failing)} />
            </div>
          </div>
        </>
      )}

      {/* Actions, in the order of the phases */}
      <div className="space-y-3">
        <h3 className="font-semibold text-foreground">{s.actionsTitle}</h3>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <div>
            <label htmlFor="ts-batch" className={labelClass}>{s.batchSize}</label>
            <input id="ts-batch" type="number" min={1} max={500} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="ts-concurrency" className={labelClass}>{s.concurrency}</label>
            <input id="ts-concurrency" type="number" min={1} max={16} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="ts-batches" className={labelClass}>{s.maxBatches}</label>
            <input id="ts-batches" type="number" min={1} value={maxBatches} onChange={(e) => setMaxBatches(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryClass} disabled={busy || running} onClick={() => void run('backfill', batchOptions())}>
            {s.backfill}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('verify', batchOptions())}>
            {s.verify}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('switchReads')}>
            {s.switchReads}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('rollbackReads')}>
            {s.rollbackReads}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('cleanup')}>
            {s.cleanup}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('reconcile')}>
            {s.reconcile}
          </button>
          {running && (
            <button type="button" className={buttonClass} disabled={busy || task?.stopping} onClick={() => void run('stop')}>
              {s.stop}
            </button>
          )}
        </div>
        {report && (
          <div className="space-y-2 pt-2">
            <h3 className="font-semibold text-foreground">{s.expertLapsTitle}</h3>
            <div className="grid gap-3 grid-cols-2">
              <Stat label={s.expertLapsInline} value={`${number(report.expertLaps.inline)} (${bytes(report.expertLaps.inlineBytes)})`} />
              <Stat label={s.expertLapsStored} value={`${number(report.expertLaps.stored)} (${bytes(report.expertLaps.storedBytes)})`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={busy || running || report.expertLaps.inline === 0} onClick={() => void run('expertLapsToR2')}>
                {s.expertLapsToR2}
              </button>
              <button type="button" className={buttonClass} disabled={busy || running || report.expertLaps.stored === 0} onClick={() => void run('expertLapsToPostgres')}>
                {s.expertLapsToPostgres}
              </button>
            </div>
          </div>
        )}
        {taskLine && <p className={`text-sm ${task?.error ? 'text-red-500' : 'text-muted-foreground'}`}>{taskLine}</p>}
        {message && <p className="text-sm text-foreground">{message}</p>}
      </div>

      {report && (
        <>
          <Table
            title={s.simulatorsTitle}
            head={[s.simulator, s.laps, s.objects, s.objectBytes, s.inPostgres]}
            rows={report.bySimulator.map((row) => [row.simulator, number(row.laps), number(row.objects), bytes(row.objectBytes), bytes(row.inlineBytes)])}
            none={s.none}
          />
          <Table
            title={s.usersTitle}
            head={[s.user, s.objects, s.objectBytes, s.inlineLaps]}
            rows={report.topUsers.map((row) => [`${row.userName} (#${row.userId})`, number(row.objects), bytes(row.objectBytes), number(row.inlineLaps)])}
            none={s.none}
          />
          <div>
            <h3 className="font-semibold text-foreground mb-2">{s.cleanupTitle}</h3>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label={s.queued} value={number(report.cleanup.queued)} />
              <Stat label={s.due} value={number(report.cleanup.due)} />
              <Stat label={s.failingDeletions} value={number(report.cleanup.failing)} />
              <Stat label={s.oldest} value={report.cleanup.oldest ? formatTime.format(new Date(report.cleanup.oldest)) : '-'} />
            </div>
          </div>
          {(report.migration.errors.length > 0 || report.cleanup.errors.length > 0) && (
            <div>
              <h3 className="font-semibold text-foreground mb-2">{s.errorsTitle}</h3>
              <ul className="text-sm text-red-500 space-y-1 break-all">
                {report.migration.errors.map((error) => (
                  <li key={`lap-${error.id}`}>
                    #{error.id} ({error.attempts}): {error.error}
                  </li>
                ))}
                {report.cleanup.errors.map((error) => (
                  <li key={`key-${error.key}`}>
                    {error.key} ({error.attempts}): {error.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Table
            title={s.runsTitle}
            head={[s.started, s.kind, s.processed, s.succeeded, s.failed, s.bytes, s.status]}
            rows={report.runs.map((run) => [
              formatTime.format(new Date(run.startedAt)),
              kindName(run.kind),
              number(run.processed),
              number(run.succeeded),
              number(run.failed),
              bytes(run.bytes),
              run.error ? fmt(s.failedWith, { error: run.error }) : run.finishedAt ? s.ok : s.running,
            ])}
            none={s.none}
          />
          <Table
            title={s.countersTitle}
            head={[s.metric, s.count, s.bytes]}
            rows={report.counters.map((row) => [row.metric, number(row.count), bytes(row.bytes)])}
            none={s.none}
          />
        </>
      )}

      {/* Phase E: never automatic, and only with the typed word and a backup */}
      <div className="rounded-lg border border-red-500/50 p-4 space-y-3">
        <h3 className="font-semibold text-foreground">{s.purgeTitle}</h3>
        <p className="text-sm text-muted-foreground">{s.purgeIntro}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ts-purge" className={labelClass}>{s.purgeType}</label>
            <input id="ts-purge" value={purgeWord} onChange={(e) => setPurgeWord(e.target.value)} className={inputClass} autoComplete="off" />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground sm:mt-5">
            <input type="checkbox" checked={backupTaken} onChange={(e) => setBackupTaken(e.target.checked)} />
            {s.purgeBackup}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={dangerClass}
            disabled={busy || running || purgeWord !== 'PURGE' || !backupTaken}
            onClick={() => void run('purgeLegacy', { confirm: purgeWord, backupTaken })}
          >
            {s.purge}
          </button>
          <button type="button" className={buttonClass} disabled={busy || running} onClick={() => void run('vacuum')}>
            {s.vacuum}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Table({ title, head, rows, none }: { title: string; head: string[]; rows: string[][]; none: string }) {
  return (
    <div>
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                {head.map((cell) => (
                  <th key={cell} className="py-1 pr-4 font-medium whitespace-nowrap">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-foreground">
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
