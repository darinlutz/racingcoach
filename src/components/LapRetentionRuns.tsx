import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import type { LapRetentionRun } from '@/lib/lapRetention';

// The Admin page's Lap Telemetry Retention section: whether the hourly cleanup (src/lib/lapRetention.ts) deletes or
// only counts, and its latest runs, so a failing or stalled cleanup shows up
export default function LapRetentionRuns({
  t,
  runs,
  dryRun,
  locale,
  timeZone,
}: {
  t: Dictionary['admin']['lapRetention'];
  runs: LapRetentionRun[];
  dryRun: boolean;
  locale: string;
  timeZone: string;
}) {
  const formatTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-3">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t.title}</h2>
        <p className="text-sm text-muted-foreground">{t.intro}</p>
      </div>
      <p className={`text-sm ${dryRun ? 'text-yellow-300' : 'text-muted-foreground'}`}>{dryRun ? t.dryRunMode : t.deleteMode}</p>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium">{t.started}</th>
                <th className="py-1 pr-4 font-medium">{t.mode}</th>
                <th className="py-1 pr-4 font-medium">{t.membershipsEnded}</th>
                <th className="py-1 pr-4 font-medium">{t.laps}</th>
                <th className="py-1 pr-4 font-medium">{t.debriefs}</th>
                <th className="py-1 font-medium">{t.status}</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-border">
                  <td className="py-1 pr-4 whitespace-nowrap">{formatTime.format(new Date(run.startedAt))}</td>
                  <td className="py-1 pr-4">{run.dryRun ? t.dryRun : t.delete}</td>
                  <td className="py-1 pr-4">{run.membershipsEnded}</td>
                  <td className="py-1 pr-4">
                    {run.lapsDeleted} / {run.lapsDue}
                  </td>
                  <td className="py-1 pr-4">
                    {run.debriefsDeleted} / {run.debriefsDue}
                  </td>
                  <td className={`py-1 ${run.error ? 'text-red-400' : ''}`}>
                    {run.error ? fmt(t.failed, { error: run.error }) : run.finishedAt ? t.ok : t.running}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
