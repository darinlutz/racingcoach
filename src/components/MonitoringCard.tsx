import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import type { ServerErrorRow } from '@/lib/errorMonitor';
import type { SpendToday } from '@/lib/spendMonitor';
import { fmt } from '@/lib/i18n/languages';

// The Admin page's Monitoring section: today's (UTC) spend on paid services against the warning level and the
// ceiling at which they switch off (src/lib/spendMonitor.ts), and the kinds of server error seen in the last week
// (src/lib/errorMonitor.ts), each with how often and when. Rendered on the server; nothing to change here.
export default function MonitoringCard({
  t,
  spend,
  errors,
  locale,
  timeZone,
}: {
  t: Dictionary['admin'];
  spend: SpendToday | null;
  errors: ServerErrorRow[];
  locale: string;
  timeZone: string;
}) {
  const usd = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const share = spend ? Math.min(100, (spend.totalUsd / spend.limits.ceilingUsd) * 100) : 0;
  return (
    <div id="monitoring" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6">
      <h2 className="text-xl font-bold text-foreground">{t.monitorTitle}</h2>

      <div className="space-y-2">
        <h3 className="font-semibold text-foreground">{t.monitorSpendTitle}</h3>
        {spend ? (
          <>
            <p className="text-2xl font-bold text-foreground tabular-nums">{usd(spend.totalUsd)}</p>
            <div
              className="h-2 rounded-full bg-card border border-border overflow-hidden"
              role="meter"
              aria-label={t.monitorSpendTitle}
              aria-valuemin={0}
              aria-valuemax={spend.limits.ceilingUsd}
              aria-valuenow={Math.round(spend.totalUsd * 100) / 100}
            >
              <div className="h-full bg-primary" style={{ width: `${share}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {fmt(t.monitorSpendBreakdown, { ai: usd(spend.aiUsd), tiles: usd(spend.tilesUsd) })}{' '}
              {fmt(t.monitorSpendLimits, { warn: usd(spend.limits.warnUsd), ceiling: usd(spend.limits.ceilingUsd) })}
            </p>
            <p className="text-xs text-muted-foreground">{t.monitorSpendNotCounted}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t.monitorUnavailable}</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-foreground">{t.monitorErrorsTitle}</h3>
        {errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.monitorNoErrors}</p>
        ) : (
          <ul className="divide-y divide-border">
            {errors.map((e) => (
              <li key={`${e.source}|${e.message}`} className="py-2">
                <details>
                  <summary className="cursor-pointer text-sm text-foreground break-words">
                    <span className="font-semibold tabular-nums">{e.count}×</span> {e.message}
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmt(t.monitorErrorSeen, { first: when(e.firstSeen), last: when(e.lastSeen), source: e.source })}
                  </p>
                  {e.detail && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-card p-2 text-xs text-muted-foreground whitespace-pre-wrap">{e.detail}</pre>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
