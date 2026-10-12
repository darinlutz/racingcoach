'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import IncidentsChart from '@/components/IncidentsChart';
import { useLanguage } from '@/components/LanguageProvider';
import IRatingChart from '@/components/IRatingChart';
import PositionsChart from '@/components/PositionsChart';
import { DEFAULT_RACE_RANGE } from '@/components/RaceRangePicker';
import type { Connection } from '@/lib/raceHistory';
import type { IncidentPoint, IRatingSeries, RaceEvent } from '@/lib/raceTrends';

type ChartTab = 'iRating' | 'incidents' | 'positions';

const CHART_TABS: ChartTab[] = ['iRating', 'incidents', 'positions'];

type SyncState = { running: boolean; loaded: number; total: number; error: string };

const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Races come from the user's iRacePlan account: they are loaded into the database the first time and
// only new ones are fetched after that, every time the tab opens
export default function RaceTrends() {
  const { t: dictionary, fmt, plural, locale, number } = useLanguage();
  const t = dictionary.raceTrends;
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [sync, setSync] = useState<SyncState>({ running: false, loaded: 0, total: 0, error: '' });
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  // Shows the key field while connected, to swap in a different iRacePlan API key
  const [changingKey, setChangingKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [trend, setTrend] = useState<IRatingSeries[] | null>(null);
  const [incidents, setIncidents] = useState<IncidentPoint[]>([]);
  const [chartTab, setChartTab] = useState<ChartTab>('iRating');
  // Shared by every chart tab, so switching tabs keeps the same races in view
  const [range, setRange] = useState(DEFAULT_RACE_RANGE);
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
    if (!res.ok) throw new Error(data.error || t.failedLoad);
    setConnection(data.connection);
    setEvents(data.events);
    return data.connection as Connection | null;
  }, [t]);

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
        if (!res.ok) throw new Error(data.error || t.failedSync);
        setSync({ running: true, loaded: data.loaded, total: data.total, error: '' });
        // Stop when done, or when a batch made no progress (iRacePlan errors are retried next time)
        if (data.remaining === 0 || data.remaining >= previousRemaining) break;
        previousRemaining = data.remaining;
      }
      await loadRaces();
      setSync((s) => ({ ...s, running: false }));
    } catch (err) {
      setSync((s) => ({ ...s, running: false, error: err instanceof Error ? err.message : t.syncFailed }));
    } finally {
      syncing.current = false;
    }
  }, [loadRaces, t]);

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
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t.logIn}
        </Link>
        {t.signedOut}
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
      if (!res.ok) throw new Error(data.error || t.failedConnect);
      setConnection(data.connection);
      setApiKey('');
      setChangingKey(false);
      // A key for a different iRacing profile cleared the old races on the server
      await loadRaces();
      void runSync();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : t.failedConnect);
    } finally {
      setConnecting(false);
    }
  };

  const disconnectIRacePlan = async () => {
    if (!window.confirm(t.disconnectConfirm)) return;
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
      if (!res.ok) throw new Error(data.error || t.failedTrends);
      setTrend(data.trend);
      setIncidents(data.incidents);
      setCommentary(data.commentary);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : dictionary.common.unknownError);
    } finally {
      setRunning(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
  const firstLoad = sync.running && events.length === 0;

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {!loaded ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : loadError ? (
        <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">{loadError}</div>
      ) : connection ? (
        /* iRacePlan connection and sync status */
        <div className="px-4 py-3 bg-card border border-border rounded-lg text-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-foreground">
              {t.connectedAs}<span className="font-semibold">{connection.iracingName}</span>
              <span className="text-muted-foreground">
                {' • '}
                {plural(events.length, t.raceCount)}
                {connection.syncedAt && fmt(t.lastSynced, { date: formatDateTime(connection.syncedAt, locale) })}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setChangingKey((open) => !open);
                  setApiKey('');
                  setConnectError('');
                }}
                disabled={sync.running}
                className="px-3 py-1.5 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.changeKey}
              </button>
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={sync.running}
                className="px-3 py-1.5 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sync.running ? t.syncing : t.syncNow}
              </button>
              <button
                type="button"
                onClick={() => void disconnectIRacePlan()}
                disabled={sync.running}
                className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-primary disabled:opacity-50"
              >
                {t.disconnect}
              </button>
            </div>
          </div>
          {sync.running && (
            <p className="text-muted-foreground">
              {t.loadingFromIRacePlan}
              {sync.total > 0 && fmt(t.progress, { loaded: number(sync.loaded), total: number(sync.total) })}
              {firstLoad && t.firstLoad}
            </p>
          )}
          {sync.error && <p className="text-red-300">{sync.error}</p>}
          {changingKey && (
            <div className="pt-2 space-y-2">
              <p className="text-muted-foreground">{t.changeKeyHint}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && apiKey.trim() && !connecting && void connectIRacePlan()}
                  placeholder={t.apiKeyPlaceholder}
                  autoComplete="off"
                  aria-label={t.apiKeyPlaceholder}
                  autoFocus
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => void connectIRacePlan()}
                  disabled={!apiKey.trim() || connecting}
                  className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {connecting ? dictionary.common.saving : dictionary.common.save}
                </button>
                <button
                  type="button"
                  onClick={() => setChangingKey(false)}
                  disabled={connecting}
                  className="px-4 py-3 font-semibold text-muted-foreground hover:text-primary disabled:opacity-50 flex-shrink-0"
                >
                  {dictionary.common.cancel}
                </button>
              </div>
              {connectError && <p className="text-red-300">{connectError}</p>}
            </div>
          )}
        </div>
      ) : (
        /* Not connected yet */
        <div className="px-5 py-4 bg-card border border-border rounded-lg space-y-3">
          <div>
            <h3 className="font-bold text-foreground">{t.connectTitle}</h3>
            <p className="text-sm text-muted-foreground">
              {t.connectBefore}
              <a href="https://iraceplan.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                iRacePlan
              </a>
              {t.connectAfter}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apiKey.trim() && void connectIRacePlan()}
              placeholder={t.apiKeyPlaceholder}
              autoComplete="off"
              aria-label={t.apiKeyPlaceholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void connectIRacePlan()}
              disabled={!apiKey.trim() || connecting}
              className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {connecting ? t.connecting : t.connect}
            </button>
          </div>
          {connectError && <p className="text-sm text-red-300">{connectError}</p>}
          {events.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {plural(events.length, t.racesFromBefore)}
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void getTrends()}
          disabled={events.length === 0 || firstLoad || running}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? t.analyzing : t.getTrends}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            {fmt(dictionary.common.failed, { error: runError })}
          </div>
        )}

        {!trend && !runError && !running && loaded && (
          <p className="text-sm text-muted-foreground">
            {events.length > 0 ? t.pressGetTrends : connection ? t.racesWillAppear : t.connectToLoad}
          </p>
        )}

        {trend && (
          <div className="space-y-4">
            {/* Chart tabs; the commentary below covers both */}
            <div>
              <div className="flex flex-wrap gap-2 border-b border-border" role="tablist">
                {CHART_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={chartTab === tab}
                    onClick={() => setChartTab(tab)}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                      chartTab === tab
                        ? 'text-primary border-primary'
                        : 'text-muted-foreground border-transparent hover:text-foreground'
                    }`}
                  >
                    {t.chartTabs[tab]}
                  </button>
                ))}
              </div>

              <div className="pt-4 space-y-2" role="tabpanel">
                {chartTab === 'iRating' && (
                  <>
                    {trend.length > 0 ? (
                      <IRatingChart trend={trend} range={range} onRangeChange={setRange} />
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.noIRating}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t.iRatingNote}
                    </p>
                  </>
                )}

                {chartTab === 'positions' && (
                  <>
                    <PositionsChart events={events} range={range} onRangeChange={setRange} />
                    <p className="text-xs text-muted-foreground">
                      {t.positionsNote}
                    </p>
                  </>
                )}

                {chartTab === 'incidents' && (
                  <>
                    <IncidentsChart points={incidents} range={range} onRangeChange={setRange} />
                    <p className="text-xs text-muted-foreground">
                      {t.incidentsNote}
                    </p>
                  </>
                )}
              </div>
            </div>

            {commentary && (
              <div className="px-5 py-4 bg-card border border-border rounded-lg">
                <h3 className="font-bold text-foreground mb-2">{t.commentary}</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap">{commentary}</p>
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">{plural(steps.length, t.stepsChecked)}</summary>
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
