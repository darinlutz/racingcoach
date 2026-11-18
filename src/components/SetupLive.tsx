'use client';

import { CircleDot, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { InspectionBadge, Notice, Panel } from '@/components/SetupBadges';
import SetupParameterTable from '@/components/SetupParameterTable';
import { setupsRequest, type CollectorStatus, type RevisionDetail } from '@/lib/setupClient';

type LiveResponse = { capture: RevisionDetail | null; collector: CollectorStatus };

// Live Setup: what the collector last saw iRacing load, refreshed every 15 s while the tab is open (the collector sends
// the setup whenever it changes, so there's nothing to fetch from iRacing here)
export default function SetupLive({ onOpen, onChanged }: { onOpen: (setupId: number) => void; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const s = t.setups;
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const res = await setupsRequest<LiveResponse>('/api/setups/live');
    setBusy(false);
    if (res.ok) {
      setError(false);
      setData((before) => {
        // A new capture: the library's counts changed too
        if (before && res.data.capture && before.capture?.id !== res.data.capture.id) void onChanged();
        return res.data;
      });
    } else setError(true);
  }, [onChanged]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the capture, then polls
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) return error ? <Notice tone="error">{s.errors.load}</Notice> : <p className="text-muted-foreground">{s.common.loading}</p>;
  const capture = data.capture;
  const live = data.collector.live;
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-5">
      <Panel
        title={s.live.title}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:border-primary disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {s.common.refresh}
          </button>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">{s.live.intro}</p>
        <div className={`mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${live ? 'bg-secondary text-good-text' : 'bg-secondary text-muted-foreground'}`}>
          <CircleDot className={`size-4 ${live ? 'animate-pulse' : ''}`} aria-hidden />
          {live ? s.overview.collectorLive : s.overview.collectorIdle}
        </div>
        {!capture ? (
          <Notice>{s.live.none}</Notice>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {fact(s.common.car, capture.setup.car ?? s.common.unknown)}
              {fact(s.common.track, capture.setup.track ?? s.common.unknown)}
              {fact(
                s.live.setupName,
                <button type="button" className="text-left text-primary hover:underline" onClick={() => onOpen(capture.setupId)}>
                  {capture.simSetupName ?? capture.setup.name}
                </button>
              )}
              {fact(s.overview.modified, capture.simModified == null ? s.common.notAvailable : capture.simModified ? s.overview.modifiedYes : s.overview.modifiedNo)}
              {fact(s.live.loadType, capture.simLoadType ?? s.common.notAvailable)}
              {fact(s.live.fixedSession, capture.fixedSession == null ? s.common.notAvailable : capture.fixedSession ? s.live.fixedYes : s.live.fixedNo)}
              {fact(s.overview.latestInspection, <InspectionBadge result={capture.setup.inspection} />)}
              {fact(s.overview.lastSync, capture.lastSeenAt ? <LocalTime iso={capture.lastSeenAt} format="dateTime" /> : s.common.notAvailable)}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {capture.capturedAt && (
                <>
                  {s.live.firstSeen.split('{time}')[0]}
                  <LocalTime iso={capture.capturedAt} format="dateTime" />
                  {s.live.firstSeen.split('{time}')[1] ?? ''} ·{' '}
                </>
              )}
              {s.live.autoRefresh}
            </p>
          </>
        )}
      </Panel>
      {capture && capture.parameters.length > 0 && (
        <Panel>
          <SetupParameterTable parameters={capture.parameters} sourceLabel={s.live.sourceSdk} />
        </Panel>
      )}
    </div>
  );
}
