'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { OwnAiUsage } from '@/lib/rateLimits';

// The Account page's My AI Usage: the user's AI calls in the last 24 hours and the last 7 days (readOwnAiUsage),
// counted like the Admin page's usage report
export default function MyAiUsageCard({ day, week }: { day: OwnAiUsage; week: OwnAiUsage }) {
  const { t, number } = useLanguage();
  const u = t.aiUsage;
  const measures: { label: string; value: (usage: OwnAiUsage) => number }[] = [
    { label: u.calls, value: (usage) => usage.calls },
    { label: u.weighted, value: (usage) => usage.weighted },
    { label: u.inputTokens, value: (usage) => usage.inputTokens },
    { label: u.outputTokens, value: (usage) => usage.outputTokens },
    { label: u.blocked, value: (usage) => usage.blocked },
  ];

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">{u.title}</h2>
      <p className="text-sm text-muted-foreground mb-3">{u.intro}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2 text-left font-medium" />
            <th className="py-2 pl-4 text-right font-medium">{u.last24Hours}</th>
            <th className="py-2 pl-4 text-right font-medium">{u.last7Days}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {measures.map((m) => (
            <tr key={m.label}>
              <td className="py-2 text-muted-foreground">{m.label}</td>
              <td className="py-2 pl-4 text-right tabular-nums text-foreground font-medium">{number(m.value(day))}</td>
              <td className="py-2 pl-4 text-right tabular-nums text-foreground font-medium">{number(m.value(week))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
