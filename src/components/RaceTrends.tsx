'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import IncidentsChart from '@/components/IncidentsChart';
import IRatingChart from '@/components/IRatingChart';
import type { Connection } from '@/lib/raceHistory';
import type { IncidentPoint, IRatingSeries, RaceEvent } from '@/lib/raceTrends';

type ChartTab = 'iRating' | 'incidents';

const CHART_TABS: { value: ChartTab; label: string }[] = [
  { value: 'iRating', label: 'iRating Trend' },
  { value: 'incidents', label: 'Incidents' },
];

type SyncState = { running: boolean; loaded: number; total: number; error: string };

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Races come from the user's iRacePlan account: they are loaded into the database the first time and
// only new ones are fetched after that, every time the tab opens
export default function RaceTrends() {
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [sync, setSync] = useState<SyncState>({ running: false, loaded: 0, total: 0, error: '' });
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [running, setRunning] = useState(false);
  const [trend, setTrend] = useState<IRatingSeries[] | null>(null);
  const [incidents, setIncidents] = useState<IncidentPoint[]>([]);
  const [chartTab, setChartTab] = useState<ChartTab>('iRating');
  const [commentary, setCommentary] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const syncing = useRef(false);

  const loadRaces = useCallback(async () => {
    const res = await fetch('/api/race-trends');
    if (res.status === 401) {
      setSignedOut(true);
      return null;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load your races');
    setConnection(data.connection);
    setEvents(data.events);
    return data.connection as Connection | null;
  }, []);

  // Calls the sync endpoint until every completed race is loaded, showing progress as it goes
  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    setSync({ running: true, loaded: 0, total: 0, error: '' });
    try {
      let previousRemaining = Infinity;
      for (;;) {
        const res = await fetch('/api/race-trends/sync', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load your races from iRacePlan');
        setSync({ running: true, loaded: data.loaded, total: data.total, error: '' });
        // Stop when done, or when a batch made no progress (iRacePlan errors are retried next time)
        if (data.remaining === 0 || data.remaining >= previousRemaining) break;
        previousRemaining = data.remaining;
      }
      await loadRaces();
      setSync((s) => ({ ...s, running: false }));
    } catch (err) {
      setSync((s) => ({ ...s, running: false, error: err instanceof Error ? err.message : 'Sync failed' }));
    } finally {
      syncing.current = false;
    }
  }, [loadRaces]);

  useEffect(() => {
    loadRaces()
      .then((conn) => {
        if (conn) void runSync();
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoaded(true));
  }, [loadRaces, runSync]);

  if (signedOut) {
    return (
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 text-slate-600">
        <Link href="/login" className="font-semibold text-powder-600 hover:underline">
          Log in
        </Link>{' '}
        to see your race trends.
      </div>
    );
  }

  const connectIRacePlan = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetch('/api/race-trends/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect iRacePlan');
      setConnection(data.connection);
      setApiKey('');
      void runSync();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect iRacePlan');
    } finally {
      setConnecting(false);
    }
  };

  const disconnectIRacePlan = async () => {
    if (!window.confirm('Disconnect iRacePlan? Races already loaded stay; new races stop loading until you reconnect.')) return;
    const res = await fetch('/api/race-trends/connection', { method: 'DELETE' });
    if (res.ok) setConnection(null);
  };

  const getTrends = async () => {
    setRunning(true);
    setRunError('');
    setTrend(null);
    setIncidents([]);
    setCommentary('');
    setSteps([]);
    try {
      const res = await fetch('/api/race-trends', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get the race trends');
      setTrend(data.trend);
      setIncidents(data.incidents);
      setCommentary(data.commentary);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-white border border-slate-300 rounded-lg text-dark-blue placeholder-slate-400 focus:outline-none focus:border-powder-600 focus:ring-1 focus:ring-powder-500 transition-colors';
  const firstLoad = sync.running && events.length === 0;

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 space-y-6">
      {!loaded ? (
        <p className="text-sm text-slate-500">Loading your races…</p>
      ) : loadError ? (
        <div className="px-4 py-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-900">{loadError}</div>
      ) : connection ? (
        /* iRacePlan connection and sync status */
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-dark-blue">
              Connected to iRacePlan as <span className="font-semibold">{connection.iracingName}</span>
              <span className="text-slate-500">
                {' '}
                • {events.length.toLocaleString('en-US')} {events.length === 1 ? 'race' : 'races'}
                {connection.syncedAt && ` • Last synced ${formatDateTime(connection.syncedAt)}`}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={sync.running}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-dark-blue hover:border-powder-600 hover:text-powder-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sync.running ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                onClick={() => void disconnectIRacePlan()}
                disabled={sync.running}
                className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
          {sync.running && (
            <p className="text-slate-600">
              Loading your races from iRacePlan
              {sync.total > 0 && `… ${sync.loaded.toLocaleString('en-US')} of ${sync.total.toLocaleString('en-US')}`}
              {firstLoad && ' (the first load takes a few minutes; later syncs only fetch new races)'}
            </p>
          )}
          {sync.error && <p className="text-red-700">{sync.error}</p>}
        </div>
      ) : (
        /* Not connected yet */
        <div className="px-5 py-4 bg-white border border-slate-200 rounded-lg space-y-3">
          <div>
            <h3 className="font-bold text-dark-blue">Connect iRacePlan</h3>
            <p className="text-sm text-slate-600">
              Your races load automatically from{' '}
              <a href="https://iraceplan.com" target="_blank" rel="noreferrer" className="text-powder-600 hover:underline">
                iRacePlan
              </a>
              . Create an API key under Settings &gt; API Keys there and paste it here.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apiKey.trim() && void connectIRacePlan()}
              placeholder="iRacePlan API key"
              autoComplete="off"
              aria-label="iRacePlan API key"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void connectIRacePlan()}
              disabled={!apiKey.trim() || connecting}
              className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-powder-500 to-powder-600 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {connectError && <p className="text-sm text-red-700">{connectError}</p>}
          {events.length > 0 && (
            <p className="text-sm text-slate-500">
              {events.length.toLocaleString('en-US')} races from before are still here; reconnect to load new ones.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void getTrends()}
          disabled={events.length === 0 || firstLoad || running}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-powder-500 to-powder-600 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Analyzing your races…' : 'Get Trends'}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-red-50 border-red-200 text-red-900">
            Failed: {runError}
          </div>
        )}

        {!trend && !runError && !running && loaded && (
          <p className="text-sm text-slate-500">
            {events.length > 0
              ? 'Press Get Trends to see your iRating and incidents over time.'
              : connection
                ? 'Your races will appear here once they have loaded.'
                : 'Connect iRacePlan to load your races.'}
          </p>
        )}

        {trend && (
          <div className="space-y-4">
            {/* Chart tabs; the commentary below covers both */}
            <div>
              <div className="flex flex-wrap gap-2 border-b border-slate-200" role="tablist">
                {CHART_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={chartTab === tab.value}
                    onClick={() => setChartTab(tab.value)}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                      chartTab === tab.value
                        ? 'text-powder-600 border-powder-600'
                        : 'text-slate-600 border-transparent hover:text-dark-blue'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="pt-4 space-y-2" role="tabpanel">
                {chartTab === 'iRating' && (
                  <>
                    {trend.length > 0 ? (
                      <IRatingChart trend={trend} />
                    ) : (
                      <p className="text-sm text-slate-600">None of these races have an iRating.</p>
                    )}
                    <p className="text-xs text-slate-500">
                      Each point is your iRating after a race. iRacing keeps a separate iRating for each license
                      category, so each category gets its own line. Unofficial races (such as 13th week events)
                      don&apos;t change iRating, so they show as flat steps.
                    </p>
                  </>
                )}

                {chartTab === 'incidents' && (
                  <>
                    <IncidentsChart points={incidents} />
                    <p className="text-xs text-slate-500">
                      Each dot is the incident points you picked up in one race, rated or not. The line is the average
                      of your last 10 races at that point, which shows the trend better than single races.
                    </p>
                  </>
                )}
              </div>
            </div>

            {commentary && (
              <div className="px-5 py-4 bg-white border border-slate-200 rounded-lg">
                <h3 className="font-bold text-dark-blue mb-2">Commentary</h3>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{commentary}</p>
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-slate-600">
                <summary className="cursor-pointer">What the agent checked ({steps.length} steps)</summary>
                <ol className="mt-2 list-decimal pl-5 space-y-1 font-mono text-xs">
                  {steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
