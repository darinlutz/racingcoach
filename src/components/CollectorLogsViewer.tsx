'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { CollectorLogsView } from '@/lib/collectorLogs';

// The Admin page's Collector Logs section: every user's telemetry collector activity log (racingcoach."CollectorLogs",
// sent by LogUploader.cs), filtered by user and run (one start of the collector), with the problems the log review
// agent found (src/lib/collectorLogReview.ts). Loads from GET /api/admin/collector-logs. The filters are kept in
// the URL as logUser and logRun, so the review agent's emails can link straight to a run.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';

export default function CollectorLogsViewer({
  initialUser,
  initialRun,
  timeZone,
  locale,
}: {
  initialUser: string | null;
  initialRun: string | null;
  timeZone: string;
  locale: string;
}) {
  const { t, fmt } = useLanguage();
  const a = t.admin;
  const [userId, setUserId] = useState(initialUser ?? '');
  const [runId, setRunId] = useState(initialRun ?? '');
  const [view, setView] = useState<CollectorLogsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'medium' });
  const time = (iso: string) => formatTime.format(new Date(iso));

  // Loads again whenever the filter changes or Refresh is pressed (reload)
  const [reload, setReload] = useState(0);
  useEffect(() => {
    // A slower answer for a filter picked earlier mustn't replace the one picked last
    let current = true;
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (runId) params.set('runId', runId);
    fetch(`/api/admin/collector-logs?${params}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!current) return;
        if (res.ok) setView(data as CollectorLogsView);
        else setError(data.error ?? a.collectorLogsFailed);
      })
      .catch(() => current && setError(a.collectorLogsFailed))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [userId, runId, reload, a.collectorLogsFailed]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setReload((n) => n + 1);
  };
  // A new filter: kept in the URL without reloading the page, so the view can be bookmarked or linked to
  const select = (user: string, run: string) => {
    setUserId(user);
    setRunId(run);
    const url = new URL(window.location.href);
    for (const [key, value] of [['logUser', user], ['logRun', run]]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, '', url);
    setLoading(true);
    setError(null);
  };

  const runs = view?.runs ?? [];
  const run = runs.find((r) => r.runId === runId);

  return (
    <div id="collector-logs" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4 scroll-mt-24">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">{a.collectorLogsTitle}</h2>
        <p className="text-sm text-muted-foreground">{fmt(a.collectorLogsIntro, { timeZone })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <div>
          <label htmlFor="log-user" className={labelClass}>{a.user}</label>
          <select
            id="log-user"
            value={userId}
            onChange={(e) => select(e.target.value, '')}
            className={inputClass}
          >
            <option value="">{a.collectorLogsAllUsers}</option>
            {view?.users.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.userName} ({u.emailAddress})
              </option>
            ))}
            {/* A user from a link, before the list has loaded or after their logs were deleted */}
            {userId && view && !view.users.some((u) => String(u.id) === userId) && <option value={userId}>#{userId}</option>}
          </select>
        </div>
        <div>
          <label htmlFor="log-run" className={labelClass}>{a.collectorLogsRun}</label>
          <select id="log-run" value={runId} onChange={(e) => select(userId, e.target.value)} className={inputClass}>
            <option value="">{a.collectorLogsLatest}</option>
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {[
                  time(r.startedAt),
                  userId ? null : r.userName,
                  r.version ? `v${r.version}` : null,
                  fmt(a.collectorLogsLines, { lines: r.lines.toLocaleString(locale) }),
                  r.errors > 0 ? fmt(a.collectorLogsErrors, { errors: r.errors.toLocaleString(locale) }) : null,
                  r.problems > 0 ? `⚠ ${fmt(a.collectorLogsProblemCount, { problems: r.problems })}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
            {runId && view && !run && <option value={runId}>{runId.slice(0, 8)}</option>}
          </select>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-60"
        >
          {loading ? a.collectorLogsLoading : a.collectorLogsRefresh}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {view && view.reviews.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">{a.collectorLogsProblems}</h3>
          {view.reviews.map((review) => (
            <div key={review.id} className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 space-y-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-foreground">{review.title}</p>
                <p className="text-xs text-muted-foreground">
                  {time(review.reviewedAt)} · #{review.fromSeq}–{review.toSeq} ·{' '}
                  {review.emailedAt ? fmt(a.collectorLogsEmailed, { time: time(review.emailedAt) }) : a.collectorLogsNotEmailed}
                  {!runId && (
                    <>
                      {' · '}
                      <button type="button" onClick={() => select(userId, review.runId)} className="underline hover:text-primary">
                        {a.collectorLogsOpenRun}
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{a.collectorLogsWhat}</p>
                <p className="text-foreground whitespace-pre-wrap">{review.explanation}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{a.collectorLogsFix}</p>
                <p className="text-foreground whitespace-pre-wrap">{review.fix}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {view && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {view.truncated && (
            <p className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
              {fmt(a.collectorLogsTruncated, { max: (runId ? 5000 : 500).toLocaleString(locale) })}
            </p>
          )}
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-xs font-mono">
              <tbody className="divide-y divide-border">
                {view.lines.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground font-sans text-sm">{a.collectorLogsNone}</td>
                  </tr>
                )}
                {view.lines.map((line) => (
                  <tr key={line.id} className={`align-top ${line.isError ? 'bg-red-500/10' : ''}`}>
                    <td className="px-3 py-1 whitespace-nowrap text-muted-foreground tabular-nums">{time(line.loggedAt)}</td>
                    {!userId && (
                      <td className="px-3 py-1 whitespace-nowrap">
                        <button type="button" onClick={() => select(String(line.userId), runId)} className="hover:text-primary" title={a.onlyUser}>
                          {line.userName}
                        </button>
                      </td>
                    )}
                    {!runId && (
                      <td className="px-3 py-1 whitespace-nowrap">
                        <button type="button" onClick={() => select(userId, line.runId)} className="hover:text-primary text-muted-foreground" title={a.collectorLogsOpenRun}>
                          {line.runId.slice(0, 8)}
                        </button>
                      </td>
                    )}
                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground tabular-nums">#{line.seq}</td>
                    <td className={`px-3 py-1 whitespace-pre-wrap break-words ${line.isError ? 'text-red-500' : 'text-foreground'}`}>
                      {line.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
