'use client';

import { useEffect, useMemo, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import type { CollectorLapSummary, LapOwner } from '@/lib/collectorLaps';
import {
  areaStats,
  brakeFeet,
  formatLapTime,
  readLapSamples,
  sameTrackName,
  secondsToLapTime,
  type LapFile,
  type Track,
} from '@/lib/lapData';
import { uploadTargetLap } from '@/lib/targetLapUpload';

// Laps more than this far apart start a new session in the list (offline sessions have no iRacing IDs)
const SESSION_GAP_MS = 30 * 60 * 1000;

// key is unique per session (for React); sameAs is what laps of one session share
type Session = { key: string; sameAs: string; laps: CollectorLapSummary[] };

// Laps recorded by the RacingCoach collector, grouped into sessions, newest first. Within a session the
// laps are in the order they were driven.
function groupSessions(laps: CollectorLapSummary[]): Session[] {
  const sessions: Session[] = [];
  const oldestFirst = [...laps].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id);
  for (const lap of oldestFirst) {
    // The account keeps two drivers' laps from one session apart when All Drivers is shown, even when they
    // share a name or drove on the same iRacing account
    const sameAs = [lap.userId, lap.track, lap.car, lap.sessionId, lap.subSessionId, lap.sessionNum].join('|');
    const current = sessions.at(-1);
    const previous = current?.laps.at(-1);
    if (
      current &&
      previous &&
      current.sameAs === sameAs &&
      Date.parse(lap.recordedAt) - Date.parse(previous.recordedAt) < SESSION_GAP_MS
    ) {
      current.laps.push(lap);
    } else {
      sessions.push({ key: String(lap.id), sameAs, laps: [lap] });
    }
  }
  return sessions.reverse();
}

// A clean lap: no pit road, no off-track, no incidents
const isClean = (lap: CollectorLapSummary) => !lap.pitRoad && !lap.offTrack && lap.incidents === 0;

const lapFileId = (lap: CollectorLapSummary) => `rc${lap.clientLapId.replace(/-/g, '')}`;

// The lap's file name, for its LapFile and its download
const lapFileName = (lap: CollectorLapSummary) =>
  `RacingCoach - ${lap.driver} - ${lap.car} - ${lap.track} - ${secondsToLapTime(lap.lapTimeSeconds)} - ${lapFileId(lap)}.csv`;

function toLapFile(lap: CollectorLapSummary, csv: string): LapFile {
  const lapTime = secondsToLapTime(lap.lapTimeSeconds);
  const fileId = lapFileId(lap);
  return {
    file: new File([csv], lapFileName(lap), { type: 'text/csv' }),
    driverName: lap.driver,
    carName: lap.car,
    trackName: lap.track,
    lapTime,
    fileId,
  };
}

const smallButtonClass =
  'px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors';

// Lets a signed-in user pick laps the RacingCoach collector uploaded. onChange gets the picked laps
// (once their CSVs have loaded) as LapFiles, the same as dropped lap CSVs.
// Each lap also has a Target checkbox: Set Target saves the one ticked lap as the user's Target Lap
// (/api/account/target-lap, shown on the Account page), then measures it in every focus area of its track
// and saves the brake point, max brake pressure and on-throttle point as the track's targets (the Reference
// Points tab's /api/tracks/reference-points); onTargetsSaved then reloads Track Data.
// A Compare column takes up to two laps; Compare sends them to onCompare, fastest first (the Racing
// page opens them in Lap Compare as the Base and Compare laps).
// Coaches and Admins also get a Driver box listing every account with laps (their own first shown),
// headed by All Drivers; Users only ever see their own laps (the API enforces it).
export default function RecordedLaps({
  tracks,
  onChange,
  onTargetsSaved,
  onCompare,
}: {
  tracks: Track[];
  onChange: (laps: LapFile[]) => void;
  onTargetsSaved?: () => void;
  onCompare?: (base: LapFile, compare: LapFile) => void;
}) {
  const { t: dictionary, fmt, plural, locale } = useLanguage();
  const t = dictionary.recordedLaps;
  const [status, setStatus] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [laps, setLaps] = useState<CollectorLapSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<Record<number, LapFile>>({});
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  // Laps ticked in the Target column, and the session whose Set Target is running
  const [targetPicks, setTargetPicks] = useState<Set<number>>(new Set());
  const [settingTarget, setSettingTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  // Laps ticked in the Compare column, oldest tick first (at most two), and whether Compare is loading them
  const [comparePicks, setComparePicks] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);
  // Coaches and Admins only: the drivers they can pick, whose laps are shown, and which driver is them
  const [drivers, setDrivers] = useState<LapOwner[] | null>(null);
  // null until a driver is picked (the coach's own laps), 'all' for All Drivers
  const [driverId, setDriverId] = useState<number | 'all' | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    // A slower answer for a driver picked earlier mustn't replace the one picked last
    let current = true;
    fetch(driverId === null ? '/api/collector/laps' : `/api/collector/laps?userId=${driverId}`)
      .then(async (res) => {
        if (!current) return;
        if (res.status === 401) return setStatus('signed-out');
        const data = await res.json();
        if (!current) return;
        if (!res.ok) throw new Error(data.error || t.failedLoad);
        setLaps(data.laps);
        if (data.drivers) {
          setDrivers(data.drivers);
          setCurrentUserId(data.currentUserId);
        }
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (!current) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      current = false;
    };
  }, [t, driverId]);

  // Shows another driver's laps, starting over with nothing picked
  const changeDriver = (id: number | 'all') => {
    setSelected(new Set());
    setFiles({});
    setLoading(new Set());
    setTargetPicks(new Set());
    setComparePicks([]);
    setError('');
    setNotice('');
    setStatus('loading');
    setDriverId(id);
  };

  const shownDriverId = driverId ?? currentUserId;
  const driverPicker = drivers && (
    <div className="flex items-center gap-2">
      <label htmlFor="recorded-laps-driver" className="text-sm text-muted-foreground">
        {t.driver}
      </label>
      <select
        id="recorded-laps-driver"
        value={shownDriverId ?? ''}
        onChange={(e) => changeDriver(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
      >
        <option value="all">{t.allDrivers}</option>
        {drivers.map((driver) => {
          const name = driver.userId === currentUserId ? fmt(t.you, { name: driver.userName }) : driver.userName;
          return (
            <option key={driver.userId} value={driver.userId}>
              {fmt(t.driverOption, { name, laps: plural(driver.lapCount, t.lapCount) })}
            </option>
          );
        })}
      </select>
    </div>
  );

  const sessions = useMemo(() => groupSessions(laps), [laps]);

  // Report the picked laps whose CSVs have loaded, in the order they were driven
  useEffect(() => {
    onChange(
      laps
        .filter((lap) => selected.has(lap.id) && files[lap.id])
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id)
        .map((lap) => files[lap.id])
    );
  }, [laps, selected, files, onChange]);

  const loadCsvs = async (toLoad: CollectorLapSummary[]) => {
    const missing = toLoad.filter((lap) => !files[lap.id] && !loading.has(lap.id));
    if (missing.length === 0) return;
    setLoading((prev) => new Set([...prev, ...missing.map((lap) => lap.id)]));
    const results = await Promise.allSettled(
      missing.map(async (lap) => {
        const res = await fetch(`/api/collector/laps/${lap.id}`);
        if (!res.ok) throw new Error(fmt(t.lapCouldNotLoad, { lap: lap.lapNumber }));
        return toLapFile(lap, await res.text());
      })
    );
    const loaded: Record<number, LapFile> = {};
    const failed: number[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') loaded[missing[i].id] = result.value;
      else failed.push(missing[i].id);
    });
    setFiles((prev) => ({ ...prev, ...loaded }));
    setLoading((prev) => new Set([...prev].filter((id) => !missing.some((lap) => lap.id === id))));
    if (failed.length > 0) {
      setSelected((prev) => new Set([...prev].filter((id) => !failed.includes(id))));
      setError(plural(failed.length, t.lapsCouldNotLoad));
    }
  };

  // Ticks (on) or unticks the picked laps. With clearFirst, every lap in clearFirst is unticked before
  // the picked ones are ticked, in one update (Select clean = Clear, then tick the clean laps).
  const select = (picked: CollectorLapSummary[], on: boolean, clearFirst: CollectorLapSummary[] = []) => {
    setError('');
    setSelected((prev) => {
      const next = new Set(prev);
      for (const lap of clearFirst) next.delete(lap.id);
      for (const lap of picked) {
        if (on) next.add(lap.id);
        else next.delete(lap.id);
      }
      return next;
    });
    if (on) void loadCsvs(picked);
  };

  // Only one target lap at a time: ticking one clears every other Target tick (in all sessions)
  const toggleTarget = (lap: CollectorLapSummary, on: boolean) => {
    setTargetPicks(on ? new Set([lap.id]) : new Set());
  };

  // At most two Compare ticks: a third tick unticks the oldest one
  const toggleCompare = (lap: CollectorLapSummary, on: boolean) => {
    setComparePicks((prev) => (on ? [...prev.filter((id) => id !== lap.id), lap.id].slice(-2) : prev.filter((id) => id !== lap.id)));
  };

  // The lap's CSV as a LapFile, from the cache or fetched (and cached)
  const lapFile = async (lap: CollectorLapSummary): Promise<LapFile> => {
    const cached = files[lap.id];
    if (cached) return cached;
    const res = await fetch(`/api/collector/laps/${lap.id}`);
    if (!res.ok) throw new Error(fmt(t.lapCouldNotLoad, { lap: lap.lapNumber }));
    const file = toLapFile(lap, await res.text());
    setFiles((prev) => ({ ...prev, [lap.id]: file }));
    return file;
  };

  // Sends the two Compare laps to Lap Compare: the faster one as the Base lap
  const compare = async () => {
    const picked = laps.filter((lap) => comparePicks.includes(lap.id));
    if (picked.length !== 2 || !onCompare) return;
    const [base, other] = [...picked].sort((a, b) => a.lapTimeSeconds - b.lapTimeSeconds);
    setError('');
    setComparing(true);
    try {
      const [baseFile, otherFile] = await Promise.all([lapFile(base), lapFile(other)]);
      onCompare(baseFile, otherFile);
    } catch (err) {
      setError(fmt(t.compareFailed, { error: err instanceof Error ? err.message : dictionary.common.unknownError }));
      setComparing(false);
    }
  };

  // Saves the one lap ticked in the session's Target column as the user's Target Lap (the Account page's Target
  // Lap card), then sets every focus area's targets on its track from it
  const setTarget = async (session: Session) => {
    const lap = session.laps.find((l) => targetPicks.has(l.id));
    if (!lap || !window.confirm(t.setTargetConfirm)) return;
    setError('');
    setNotice('');

    setSettingTarget(session.key);
    let savedLap = false;
    try {
      const file = await lapFile(lap);
      await uploadTargetLap(file.file, dictionary.api.failedSaveTargetLap);
      savedLap = true;

      const track = tracks.find((candidate) => sameTrackName(candidate.fileName, lap.track));
      if (!track) {
        setNotice(t.targetLapSaved);
        setError(fmt(t.addTrackFirst, { track: lap.track }));
        return;
      }

      // Measured the same way as the Reference Points tab (referenceSession.ts)
      const samples = await readLapSamples(file.file);
      const feet = (pct: number | null) => (pct === null || !track.lengthFeet ? null : brakeFeet(pct, track.lengthFeet));
      const areas = track.areas.flatMap((area) => {
        if (area.start === null || area.end === null) return [];
        const stats = areaStats(samples, lap.lapTimeSeconds, area.start, area.end);
        if (!stats) return [];
        return [
          {
            name: area.name,
            brakePointFeet: feet(stats.brakePct),
            maxBrakePct: stats.maxBrake * 100,
            throttlePointFeet: feet(stats.throttlePct),
          },
        ];
      });
      if (areas.length === 0) throw new Error(fmt(t.noAreasMeasured, { track: track.fileName }));

      const res = await fetch('/api/tracks/reference-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackKey: track.name, trackName: track.fileName, areas }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.failedSaveTargets);

      const lapLabel = fmt(t.lapLabel, { lap: lap.lapNumber, time: formatLapTime(secondsToLapTime(lap.lapTimeSeconds)) });
      const missing = data.notFound.length > 0 ? fmt(t.notFound, { areas: data.notFound.join(', ') }) : '';
      setNotice(`${t.targetLapSaved} ${plural(data.saved.length, t.targetsSet, { track: data.track, lap: lapLabel })}${missing}`);
      onTargetsSaved?.();
    } catch (err) {
      if (savedLap) setNotice(t.targetLapSaved);
      setError(fmt(t.setTargetFailed, { error: err instanceof Error ? err.message : dictionary.common.unknownError }));
    } finally {
      setSettingTarget(null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="space-y-2">
        {driverPicker}
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      </div>
    );
  }
  if (status === 'signed-out') {
    return (
      <p className="text-sm text-muted-foreground">
        <a href="/login" className="text-primary hover:underline">{t.logIn}</a>
        {t.signedOut}
      </p>
    );
  }
  if (status === 'error') {
    return <p className="text-sm text-primary">{error}</p>;
  }
  if (laps.length === 0) {
    return (
      <div className="space-y-2">
        {driverPicker}
        <p className="text-sm text-muted-foreground">
          {t.noneBefore}
          <a href="/account" className="text-primary hover:underline">{t.account}</a>
          {t.noneAfter}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {driverPicker}
      {error && (
        <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">{error}</div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg border text-sm bg-green-500/10 border-green-500/40 text-green-300">
          {notice}
        </div>
      )}
      {sessions.map((session, index) => {
        const first = session.laps[0];
        const best = Math.min(...session.laps.map((lap) => lap.lapTimeSeconds));
        const pickedCount = session.laps.filter((lap) => selected.has(lap.id)).length;
        const targetCount = session.laps.filter((lap) => targetPicks.has(lap.id)).length;
        // Compare can pair laps from different sessions; it's enabled in each session holding one of them
        const comparesHere = session.laps.some((lap) => comparePicks.includes(lap.id));
        const inTrackData = tracks.length === 0 || tracks.some((track) => sameTrackName(track.fileName, first.track));
        return (
          <details key={session.key} open={index === 0} className="bg-card border border-border rounded-lg">
            <summary className="cursor-pointer px-4 py-3 text-sm">
              <span className="font-semibold text-red-500">{first.driver} • </span>
              <span className="font-semibold text-foreground">{first.track}</span>
              <span className="text-muted-foreground"> • {first.car}</span>
              <span className="block text-xs text-muted-foreground">
                {new Date(first.recordedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} •{' '}
                {dictionary.laps.sessionTypes[first.sessionType] ?? first.sessionType} •{' '}
                {plural(session.laps.length, t.lapCount)} • {fmt(t.best, { time: formatLapTime(secondsToLapTime(best)) })}
                {pickedCount > 0 && <span className="text-primary"> • {fmt(t.selectedCount, { n: pickedCount })}</span>}
              </span>
            </summary>

            <div className="px-4 pb-3 space-y-2">
              {!inTrackData && (
                <p className="px-3 py-2 rounded-lg border text-xs bg-yellow-500/10 border-yellow-500/40 text-yellow-200">
                  {fmt(t.notInTrackData, { track: first.track })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, false)}>
                  {t.clear}
                </button>
                <button
                  type="button"
                  className={smallButtonClass}
                  onClick={() => select(session.laps.filter(isClean), true, session.laps)}
                >
                  {t.selectClean}
                </button>
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, true)}>
                  {t.selectAll}
                </button>
                {/* Only enabled with exactly one lap ticked in this session's Target column */}
                <button
                  type="button"
                  disabled={targetCount !== 1 || settingTarget !== null}
                  onClick={() => void setTarget(session)}
                  className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {settingTarget === session.key ? t.settingTarget : t.setTarget}
                </button>
                {/* Only enabled with exactly two laps ticked in the Compare column */}
                {onCompare && (
                  <button
                    type="button"
                    disabled={comparePicks.length !== 2 || !comparesHere || comparing}
                    onClick={() => void compare()}
                    className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {comparing && comparesHere ? t.loadingShort : t.compare}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground">
                <span className="w-5" />
                <span className="w-12 text-center">{t.debriefColumn}</span>
                <span className="w-12 text-center">{t.targetColumn}</span>
                {onCompare && <span className="w-12 text-center">{t.compareColumn}</span>}
              </div>
              <ul className="space-y-1">
                {session.laps.map((lap) => (
                  <li key={lap.id} className="flex items-center gap-3 px-2 py-1 rounded hover:bg-secondary text-sm">
                    {/* Downloads the lap's CSV (the same route that loads it for analysis) */}
                    <a
                      href={`/api/collector/laps/${lap.id}?download=${encodeURIComponent(lapFileName(lap))}`}
                      download={lapFileName(lap)}
                      title={fmt(t.downloadLap, { lap: lap.lapNumber })}
                      aria-label={fmt(t.downloadLap, { lap: lap.lapNumber })}
                      data-track="download-lap"
                      className="w-5 flex justify-center text-muted-foreground hover:text-primary transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M5 21h14" />
                      </svg>
                    </a>
                    <span className="w-12 flex justify-center">
                      <input
                        id={`debrief-lap-${lap.id}`}
                        type="checkbox"
                        checked={selected.has(lap.id)}
                        onChange={(e) => select([lap], e.target.checked)}
                        className="accent-primary"
                      />
                    </span>
                    <span className="w-12 flex justify-center">
                      <input
                        type="checkbox"
                        checked={targetPicks.has(lap.id)}
                        onChange={(e) => toggleTarget(lap, e.target.checked)}
                        aria-label={fmt(t.useAsTarget, { lap: lap.lapNumber })}
                        className="accent-green-600"
                      />
                    </span>
                    {onCompare && (
                      <span className="w-12 flex justify-center">
                        <input
                          type="checkbox"
                          checked={comparePicks.includes(lap.id)}
                          onChange={(e) => toggleCompare(lap, e.target.checked)}
                          aria-label={fmt(t.compareLap, { lap: lap.lapNumber })}
                          className="accent-blue-600"
                        />
                      </span>
                    )}
                    <label htmlFor={`debrief-lap-${lap.id}`} className="flex items-center gap-3 cursor-pointer">
                      <span className="w-14 text-muted-foreground">{fmt(t.lapN, { lap: lap.lapNumber })}</span>
                      <span className={`font-semibold ${lap.lapTimeSeconds === best ? 'text-purple-400' : 'text-foreground'}`}>
                        {formatLapTime(secondsToLapTime(lap.lapTimeSeconds))}
                      </span>
                      <span className="flex flex-wrap gap-1 text-xs">
                        {lap.pitRoad && <span className="px-1.5 rounded bg-secondary text-muted-foreground">{t.pitRoad}</span>}
                        {lap.offTrack && <span className="px-1.5 rounded bg-yellow-500/15 text-yellow-200">{t.offTrack}</span>}
                        {lap.incidents > 0 && (
                          <span className="px-1.5 rounded bg-primary/15 text-red-300">{lap.incidents}x</span>
                        )}
                        {loading.has(lap.id) && <span className="text-muted-foreground">{t.loadingLap}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}
