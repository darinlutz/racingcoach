'use client';

import { BrainCircuit, ClipboardList, Download, GitCompare, History, RotateCcw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { InspectionBadge, Notice, Panel } from '@/components/SetupBadges';
import type { RevisionChoice } from '@/components/SetupRevisionPicker';
import { jsonInit, setupsRequest, type HistoryEntry, type RevisionDetail, type SetupSummary } from '@/lib/setupClient';

// History: a timeline of everything that happened to the user's setups (imports, captures, changes, the Setup
// Engineer's proposals and the driver's decisions, change sheets, inspections), with Open, Compare with the latest,
// Restore as new revision and the change sheet for each revision. Nothing is ever overwritten
export default function SetupHistory({
  setups,
  actions,
}: {
  setups: SetupSummary[];
  actions: { openSetup: (id: number) => void; compare: (a: RevisionChoice, b: RevisionChoice) => void; reload: () => Promise<void> };
}) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups;
  const h = s.history;
  const [setupId, setSetupId] = useState<number | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await setupsRequest<{ history: HistoryEntry[] }>(`/api/setups/history${setupId ? `?setup=${setupId}` : ''}`);
    setEntries(res.ok ? res.data.history : []);
  }, [setupId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the history when the setup filter changes
    void load();
  }, [load]);

  const restore = async (revisionId: number) => {
    const res = await setupsRequest<{ revision: RevisionDetail }>(`/api/setups/revisions/${revisionId}`, jsonInit('POST', { action: 'restore' }));
    setMessage(res.ok ? fmt(h.restored, { number: res.data.revision.number }) : res.error || s.errors.failed);
    await Promise.all([load(), actions.reload()]);
  };
  const latestOf = (id: number): RevisionChoice => {
    const x = setups.find((y) => y.id === id);
    return x?.latestRevisionId ? { setupId: id, revisionId: x.latestRevisionId } : null;
  };
  const small = 'inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs font-semibold hover:border-primary';

  return (
    <div className="space-y-5">
      <Panel
        title={h.title}
        actions={
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={setupId ?? ''}
            aria-label={h.filter}
            onChange={(e) => setSetupId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{h.allSetups}</option>
            {setups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        }
      >
        {message && (
          <div className="mb-3">
            <Notice tone="ok">{message}</Notice>
          </div>
        )}
        {!entries ? (
          <p className="text-muted-foreground">{s.common.loading}</p>
        ) : entries.length === 0 ? (
          <Notice>{h.none}</Notice>
        ) : (
          <ol className="relative ml-3 border-l border-border">
            {entries.map((entry, n) => {
              const Icon =
                entry.type === 'inspection' ? ShieldCheck : entry.type === 'proposal' ? BrainCircuit : entry.type === 'changeSheet' ? ClipboardList : History;
              return (
                <li key={`${entry.type}-${n}`} className="mb-4 ml-5">
                  <span className="absolute -left-3 flex size-6 items-center justify-center rounded-full border border-border bg-card">
                    <Icon className="size-3.5 text-primary" aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">
                      {entry.type === 'revision' &&
                        fmt(h.revision, { kind: s.revisionKinds[entry.revision.kind], setup: entry.setupName, number: entry.revision.number })}
                      {entry.type === 'inspection' && fmt(h.inspection, { result: s.inspection[entry.inspection.result], setup: entry.setupName ?? entry.inspection.simSetupName ?? '' })}
                      {entry.type === 'proposal' && fmt(h.proposal, { setup: entry.setupName })}
                      {entry.type === 'changeSheet' && fmt(h.changeSheet, { setup: entry.setupName, number: entry.revision.number })}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      <LocalTime iso={entry.at} format="dateTime" />
                    </span>
                  </div>

                  {entry.type === 'revision' && (
                    <>
                      <div className="text-xs text-muted-foreground">
                        {s.authors[entry.revision.author]} · {entry.revision.observedInIracing ? h.observedInIracing : h.notObserved}
                        {entry.revision.summary && ` · ${entry.revision.summary}`}
                      </div>
                      {entry.revision.changed.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {entry.revision.changed.slice(0, 8).map((c) => (
                            <li key={c.path} className="font-mono text-foreground">
                              {c.path}: <span className="text-muted-foreground">{c.from}</span> → <span className="text-primary">{c.to}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" className={small} onClick={() => actions.openSetup(entry.setupId)}>
                          {h.openRevision}
                        </button>
                        {latestOf(entry.setupId)?.revisionId !== entry.revision.id && (
                          <>
                            <button type="button" className={small} onClick={() => actions.compare({ setupId: entry.setupId, revisionId: entry.revision.id }, latestOf(entry.setupId))}>
                              <GitCompare className="size-3" aria-hidden />
                              {h.compareWith}
                            </button>
                            <button type="button" className={small} onClick={() => void restore(entry.revision.id)}>
                              <RotateCcw className="size-3" aria-hidden />
                              {h.restore}
                            </button>
                          </>
                        )}
                        {entry.revision.changed.length > 0 && entry.revision.kind !== 'capture' && (
                          <a className={small} href={`/api/setups/revisions/${entry.revision.id}/change-sheet`} title={h.changeSheetHelp} onClick={() => setTimeout(() => void load(), 1500)}>
                            <Download className="size-3" aria-hidden />
                            {h.changeSheetButton}
                          </a>
                        )}
                      </div>
                    </>
                  )}
                  {entry.type === 'inspection' && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <InspectionBadge result={entry.inspection.result} />
                      {entry.inspection.car} · {entry.inspection.track}
                    </div>
                  )}
                  {entry.type === 'proposal' && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      “{entry.proposal.question}” ·{' '}
                      {entry.proposal.decidedAt
                        ? `${plural(entry.proposal.changes.filter((c) => c.status === 'accepted').length, h.proposalAccepted, { count: entry.proposal.changes.filter((c) => c.status === 'accepted').length })}, ${plural(entry.proposal.changes.filter((c) => c.status === 'rejected').length, h.proposalRejected, { count: entry.proposal.changes.filter((c) => c.status === 'rejected').length })}`
                        : h.proposalPending}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{h.changeSheetHelp}</p>
      </Panel>
    </div>
  );
}
