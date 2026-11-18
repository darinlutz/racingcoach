'use client';

import { BrainCircuit, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { InspectionBadge, Notice, Panel } from '@/components/SetupBadges';
import { setupsRequest, type InspectionRecord, type SetupDetailResponse, type SetupSummary } from '@/lib/setupClient';

// Inspection: iRacing's own inspection result (DriverSetupPassedTech, as the collector saw it) for each setup loaded in
// iRacing, and RacingCoach's Preliminary Validation of a setup's values, which is never an inspection pass
export default function SetupInspectionTab({
  setups,
  onOpen,
  onAskEngineer,
  canUseEngineer,
}: {
  setups: SetupSummary[];
  onOpen: (setupId: number) => void;
  onAskEngineer: (setupId: number) => void;
  canUseEngineer: boolean;
}) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups;
  const i = s.inspectionTab;
  const [records, setRecords] = useState<InspectionRecord[] | null>(null);
  const [setupId, setSetupId] = useState<number | null>(setups.find((x) => x.latestRevisionId)?.id ?? null);
  const [detail, setDetail] = useState<SetupDetailResponse | null>(null);

  useEffect(() => {
    void setupsRequest<{ inspections: InspectionRecord[] }>('/api/setups/inspections').then((res) => setRecords(res.ok ? res.data.inspections : []));
  }, []);
  useEffect(() => {
    if (!setupId) return;
    let live = true;
    void setupsRequest<SetupDetailResponse>(`/api/setups/${setupId}`).then((res) => {
      if (live && res.ok) setDetail(res.data);
    });
    return () => {
      live = false;
    };
  }, [setupId]);

  const latest = records?.[0] ?? null;
  const validation = detail && detail.setup.id === setupId ? detail.validation : null;

  return (
    <div className="space-y-5">
      <Panel title={i.title}>
        <p className="mb-4 text-sm text-muted-foreground">{i.intro}</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{i.current}</div>
          <InspectionBadge result={latest?.result ?? 'notChecked'} className="text-sm" />
          {latest && (
            <span className="text-sm text-muted-foreground">
              {latest.setupName ?? latest.simSetupName} · {latest.car} · {latest.track} · <LocalTime iso={latest.lastObservedAt} format="relative" />
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {s.common.source}: {i.sourceIracing}. {i.noReasons}
        </p>
        {latest?.result === 'failed' && canUseEngineer && latest.setupId && (
          <button
            type="button"
            onClick={() => onAskEngineer(latest.setupId!)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:border-primary"
          >
            <BrainCircuit className="size-4" aria-hidden />
            {i.askEngineer}
          </button>
        )}
      </Panel>

      <Panel>
        {!records ? (
          <p className="text-muted-foreground">{s.common.loading}</p>
        ) : records.length === 0 ? (
          <Notice>{i.none}</Notice>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">{s.library.columns.inspection}</th>
                  <th className="px-3 py-2">{s.common.setup}</th>
                  <th className="px-3 py-2">{s.common.car}</th>
                  <th className="px-3 py-2">{s.common.track}</th>
                  <th className="px-3 py-2">{s.history.title}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <InspectionBadge result={r.result} />
                    </td>
                    <td className="px-3 py-2">
                      {r.setupId ? (
                        <button type="button" className="text-left text-primary hover:underline" onClick={() => onOpen(r.setupId!)}>
                          {r.setupName ?? r.simSetupName}
                        </button>
                      ) : (
                        (r.simSetupName ?? s.common.unknown)
                      )}
                      {r.revisionNumber && <span className="ml-1 text-xs text-muted-foreground">{fmt(s.common.revisionShort, { number: r.revisionNumber })}</span>}
                      {r.matchedRevisionNumber && <div className="text-xs text-good-text">{fmt(i.matched, { number: r.matchedRevisionNumber })}</div>}
                    </td>
                    <td className="px-3 py-2">{r.car ?? s.common.unknown}</td>
                    <td className="px-3 py-2">{r.track ?? s.common.unknown}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <div>
                        {i.observed.split('{time}')[0]}
                        <LocalTime iso={r.observedAt} format="dateTime" />
                      </div>
                      {r.lastObservedAt !== r.observedAt && (
                        <div>
                          {i.lastObserved.split('{time}')[0]}
                          <LocalTime iso={r.lastObservedAt} format="relative" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={i.preliminary}>
        <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {i.preliminaryHelp}
        </p>
        <select
          className="mb-3 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={setupId ?? ''}
          aria-label={s.common.setup}
          onChange={(e) => setSetupId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{s.common.selectSetup}</option>
          {setups.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {validation &&
          (validation.knownValues === 0 ? (
            <Notice>{i.preliminaryNoValues}</Notice>
          ) : validation.noRulesForCar ? (
            <Notice>{i.preliminaryNoRules}</Notice>
          ) : (
            <div>
              <div className="text-sm font-semibold">{plural(validation.findings.length, i.preliminaryFindings, { count: validation.findings.length })}</div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {validation.findings.map((f, n) => (
                  <li key={n} className={f.severity === 'error' ? 'text-bad-text' : 'text-foreground'}>
                    {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </Panel>
    </div>
  );
}
