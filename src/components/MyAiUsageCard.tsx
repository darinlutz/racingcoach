'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';
import type { OwnAiLimits, OwnAiUsage } from '@/lib/rateLimits';

// The Account page's My AI Usage: the user's AI calls in the last 24 hours and the last 7 days (readOwnAiUsage),
// counted like the Admin page's usage report, and the limits on them (readOwnAiLimits): the level's limit in
// weighted calls on the Weighted calls row, its limit on calls in any minute on the AI calls row
export default function MyAiUsageCard({ day, week, limits }: { day: OwnAiUsage; week: OwnAiUsage; limits: OwnAiLimits }) {
  const { t, number } = useLanguage();
  const u = t.aiUsage;
  const limitText = (limit: number | null) => (limit === null ? u.unlimited : number(limit));
  const measures: { label: string; value: (usage: OwnAiUsage) => number; limit?: string; perMinute?: string }[] = [
    { label: u.calls, value: (usage) => usage.calls, perMinute: limitText(limits.perMinute) },
    { label: u.weighted, value: (usage) => usage.weighted, limit: limitText(limits.limit) },
    { label: u.inputTokens, value: (usage) => usage.inputTokens },
    { label: u.outputTokens, value: (usage) => usage.outputTokens },
    { label: u.blocked, value: (usage) => usage.blocked },
  ];
  const limitCell = (text: string | undefined) => (
    <td className="py-2 pl-4 text-right tabular-nums text-foreground font-medium">
      {text ?? <span className="text-muted-foreground">—</span>}
    </td>
  );

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">{u.title}</h2>
      <p className="text-sm text-muted-foreground mb-3">{u.intro}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2 text-left font-medium" />
              <th className="py-2 pl-4 text-right font-medium">{u.last24Hours}</th>
              <th className="py-2 pl-4 text-right font-medium">{u.last7Days}</th>
              <th className="py-2 pl-4 text-right font-medium">{fmt(u.limitHeader[limits.period], { level: limits.level })}</th>
              <th className="py-2 pl-4 text-right font-medium">{fmt(u.perMinuteHeader, { level: limits.level })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {measures.map((m) => (
              <tr key={m.label}>
                <td className="py-2 text-muted-foreground">{m.label}</td>
                <td className="py-2 pl-4 text-right tabular-nums text-foreground font-medium">{number(m.value(day))}</td>
                <td className="py-2 pl-4 text-right tabular-nums text-foreground font-medium">{number(m.value(week))}</td>
                {limitCell(m.limit)}
                {limitCell(m.perMinute)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
