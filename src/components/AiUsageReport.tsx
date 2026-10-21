'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { USAGE_RANGES, type RateLimitOverride, type UsageRange } from '@/lib/rateLimitConfig';
import type { UsageReport, UsageRow } from '@/lib/rateLimits';

// The Rate Limiting section's AI usage report (GET /api/admin/rate-limits/usage): every AI call in a range, by
// user (a visitor who isn't signed in by IP address) or by IP address, with totals, calls and OpenAI tokens by
// feature (src/lib/aiTokenUsage.ts), and each row's usage of the limit that applies to it now. Set Limit opens the section's override form for the row;
// Reset starts its count over (POST /api/admin/rate-limits/reset).

export type LimitTarget = { userId: number } | { ipAddress: string };

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';

export default function AiUsageReport({
  timeZone,
  onSetLimit,
  overridesVersion,
}: {
  timeZone: string;
  onSetLimit: (target: LimitTarget) => void;
  // The section's overrides; the report reloads when they change, for its badges and limits
  overridesVersion: RateLimitOverride[];
}) {
  const { t, fmt, locale, number } = useLanguage();
  const a = t.admin;
  const r = a.rateLimits;
  const [range, setRange] = useState<UsageRange>('day');
  const [by, setBy] = useState<'user' | 'ip'>('user');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Search as the admin types, a moment after they stop
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    // A slower answer for a filter picked earlier mustn't replace the one picked last
    let current = true;
    const params = new URLSearchParams({ range, by, q: query });
    fetch(`/api/admin/rate-limits/usage?${params}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!current) return;
        if (!res.ok) throw new Error(data.error ?? r.failed);
        setReport(data);
        setError('');
      })
      .catch((err) => current && setError(err instanceof Error ? err.message : r.failed))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [range, by, query, reload, overridesVersion, r.failed]);

  // Shows the spinner and asks the effect above for a fresh report
  const load = useCallback(() => {
    setLoading(true);
    setReload((n) => n + 1);
  }, []);

  const nameOf = (row: UsageRow) =>
    row.userId !== null ? (row.userName ?? `#${row.userId}`) : by === 'user' ? `${r.anonymous} · ${row.ipAddress ?? '—'}` : (row.ipAddress ?? '—');
  const targetOf = (row: UsageRow): LimitTarget | null =>
    row.userId !== null ? { userId: row.userId } : row.ipAddress ? { ipAddress: row.ipAddress } : null;

  const reset = async (row: UsageRow) => {
    const target = targetOf(row);
    if (!target || !window.confirm(fmt(r.confirmReset, { target: nameOf(row) }))) return;
    setNotice('');
    try {
      const res = await fetch('/api/admin/rate-limits/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.api.failedSaveSetting);
      setNotice(fmt(r.resetDone, { target: nameOf(row), n: number(data.reset) }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.api.failedSaveSetting);
    }
  };

  const formatTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short', timeStyle: 'short' });
  const featureName = (feature: string) => a.aiFeatures[feature] ?? feature;
  // Token counts get large: 12345678 -> "12M"
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const tokens = (n: number) => compact.format(n);
  const totals = report?.totals;
  const tiles: { label: string; value: string; note?: string }[] = totals
    ? [
        { label: r.calls, value: number(totals.calls) },
        { label: r.weighted, value: number(totals.weighted) },
        { label: r.blocked, value: number(totals.blocked) },
        { label: r.failedCalls, value: number(totals.failed) },
        { label: r.users, value: number(totals.users) },
        { label: r.ips, value: number(totals.ips) },
        {
          label: r.inputTokens,
          value: tokens(totals.inputTokens),
          note: totals.cachedInputTokens > 0 ? fmt(r.cachedTokens, { n: tokens(totals.cachedInputTokens) }) : undefined,
        },
        { label: r.outputTokens, value: tokens(totals.outputTokens) },
      ]
    : [];
  const maxFeature = Math.max(1, ...(report?.features ?? []).map((f) => f.calls + f.blocked));

  return (
    <div className="pt-4 border-t border-border space-y-4">
      <div>
        <h3 className="text-lg font-bold text-foreground mb-1">{r.usageTitle}</h3>
        <p className="text-sm text-muted-foreground">{fmt(r.usageIntro, { timeZone })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end">
        <div>
          <label htmlFor="rl-range" className={labelClass}>{r.range}</label>
          <select id="rl-range" value={range} onChange={(e) => {
              setLoading(true);
              setRange(e.target.value as UsageRange);
            }} className={inputClass}>
            {USAGE_RANGES.map((value) => (
              <option key={value} value={value}>{r.ranges[value]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rl-by" className={labelClass}>{r.view}</label>
          <select id="rl-by" value={by} onChange={(e) => {
              setLoading(true);
              setBy(e.target.value as 'user' | 'ip');
            }} className={inputClass}>
            <option value="user">{r.byUser}</option>
            <option value="ip">{r.byIp}</option>
          </select>
        </div>
        <div>
          <label htmlFor="rl-search" className={labelClass}>{r.search}</label>
          <input id="rl-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={r.searchPlaceholder} className={inputClass} />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50"
        >
          {loading ? r.loading : r.refresh}
        </button>
      </div>

      {error && <p className="p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">{error}</p>}
      {notice && <p role="status" className="p-3 rounded-lg text-sm bg-green-500/15 text-green-400">{notice}</p>}

      {report && (
        <>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="bg-card rounded-xl border border-border px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
                <p className="text-2xl font-bold text-foreground tabular-nums">{tile.value}</p>
                {tile.note && <p className="text-xs text-muted-foreground tabular-nums">{tile.note}</p>}
              </div>
            ))}
          </div>

          {report.features.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">{r.byFeature}</h4>
              <ol className="grid gap-2 sm:grid-cols-2">
                {report.features.map((f) => (
                  <li key={f.feature}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate text-foreground">{featureName(f.feature)}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {number(f.calls)}
                        {f.blocked > 0 && <span className="text-red-400"> · {fmt(r.blockedCount, { n: number(f.blocked) })}</span>}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-secondary flex overflow-hidden">
                      <div className="h-1.5 bg-primary" style={{ width: `${(f.calls / maxFeature) * 100}%` }} />
                      <div className="h-1.5 bg-red-400/70" style={{ width: `${(f.blocked / maxFeature) * 100}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {f.trackedCalls === 0 ? (
                        <p>{r.noTokens}</p>
                      ) : (
                        <>
                          <p>
                            {fmt(r.featureTokens, {
                              input: tokens(f.inputTokens),
                              cached: tokens(f.cachedInputTokens),
                              output: tokens(f.outputTokens),
                            })}
                          </p>
                          {/* Averages over the calls with tokens recorded, so calls from before don't drag them down */}
                          <p>
                            {fmt(r.perCall, {
                              tokens: tokens((f.inputTokens + f.outputTokens) / f.trackedCalls),
                              modelCalls: (f.modelCalls / f.trackedCalls).toLocaleString(locale, { maximumFractionDigits: 1 }),
                            })}
                          </p>
                          {f.models && <p className="truncate">{f.models}</p>}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b border-border">
                  <tr>
                    {[by === 'user' ? a.user : r.ipAddress, by === 'user' ? r.level : r.accountsHeading, r.calls, r.weighted, r.tokens, r.blocked, r.current, r.features, r.lastCall, ''].map(
                      (heading, i) => (
                        <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">{r.noUsage}</td>
                    </tr>
                  )}
                  {report.rows.map((row) => {
                    const target = targetOf(row);
                    const topFeatures = Object.entries(row.features)
                      .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
                      .slice(0, 3);
                    return (
                      <tr key={row.key} className="align-top">
                        <td className="px-3 py-2 max-w-[240px]">
                          <p className="truncate text-foreground" title={row.emailAddress ?? undefined}>
                            {nameOf(row)}
                            {row.override && (
                              <span
                                className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  row.override === 'blocked' ? 'bg-red-500/15 text-red-400' : 'bg-primary/15 text-primary'
                                }`}
                              >
                                {r.overrideBadge[row.override]}
                              </span>
                            )}
                          </p>
                          {row.emailAddress && <p className="truncate text-xs text-muted-foreground">{row.emailAddress}</p>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {by === 'user'
                            ? row.tier
                              ? r.tierNames[row.tier]
                              : '—'
                            : <span title={row.names ?? undefined}>{fmt(r.accounts, { n: number(row.distinct) })}</span>}
                          {by === 'user' && row.userId !== null && row.distinct > 1 && (
                            <p className="text-xs">{fmt(r.fromIps, { n: number(row.distinct) })}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-foreground">{number(row.calls)}</td>
                        <td className="px-3 py-2 tabular-nums text-foreground">{number(row.weighted)}</td>
                        <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                          {row.inputTokens + row.outputTokens === 0
                            ? '—'
                            : fmt(r.tokensInOut, { input: tokens(row.inputTokens), output: tokens(row.outputTokens) })}
                        </td>
                        <td className={`px-3 py-2 tabular-nums ${row.blocked > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                          {number(row.blocked)}
                          {row.failed > 0 && <p className="text-xs text-muted-foreground">{fmt(r.failedCount, { n: number(row.failed) })}</p>}
                        </td>
                        <td className="px-3 py-2 min-w-[150px]">
                          <CurrentUsage row={row} />
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[220px]">
                          {topFeatures.map(([feature, calls]) => (
                            <p key={feature} className="truncate">
                              {featureName(feature)}: {number(calls ?? 0)}
                            </p>
                          ))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">{formatTime.format(new Date(row.lastAt))}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          {target && (
                            <>
                              <button type="button" onClick={() => onSetLimit(target)} className="text-xs text-primary hover:underline mr-3">
                                {r.setLimit}
                              </button>
                              <button type="button" onClick={() => reset(row)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                                {r.reset}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// "12 / 25 per day" with a bar that turns amber near the limit and red at it
function CurrentUsage({ row }: { row: UsageRow }) {
  const { t, fmt, number } = useLanguage();
  const r = t.admin.rateLimits;
  const current = row.current;
  if (!current) return <span className="text-muted-foreground">—</span>;
  if (current.exempt) return <span className="text-xs text-muted-foreground">{r.exempt}</span>;
  if (current.limit === 0 && !current.unlimited) return <span className="text-xs text-red-400">{r.blockedShort}</span>;
  if (current.limit === null) return <span className="text-xs text-green-400">{r.unlimitedShort}</span>;
  const share = current.limit === 0 ? 1 : Math.min(1, current.used / current.limit);
  const color = share >= 1 ? 'bg-red-400' : share >= 0.8 ? 'bg-amber-400' : 'bg-primary';
  return (
    <div>
      <p className="text-xs text-foreground tabular-nums whitespace-nowrap">
        {fmt(r.usedOf, { used: number(current.used), limit: number(current.limit), period: r.periods[current.period] })}
      </p>
      <div className="mt-1 h-1.5 rounded-full bg-secondary">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
