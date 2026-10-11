'use client';

import { useEffect, useMemo, useState } from 'react';

import type { CollectorLapSummary } from '@/lib/collectorLaps';
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
    const sameAs = [lap.track, lap.car, lap.sessionId, lap.subSessionId, lap.sessionNum].join('|');
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

function toLapFile(lap: CollectorLapSummary, csv: string): LapFile {
  const lapTime = secondsToLapTime(lap.lapTimeSeconds);
  const fileId = `rc${lap.clientLapId.replace(/-/g, '')}`;
  const name = `RacingCoach - ${lap.driver} - ${lap.car} - ${lap.track} - ${lapTime} - ${fileId}.csv`;
  return {
    file: new File([csv], name, { type: 'text/csv' }),
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
// Each lap also has a Target checkbox: Set Target measures the one ticked lap in every focus area of
// its track and saves the brake point, max brake pressure and on-throttle point as the track's targets
// (the Reference Points tab's /api/tracks/reference-points); onTargetsSaved then reloads Track Data.
// A Compare column takes up to two laps; Compare sends them to onCompare, fastest first (the Racing
// page opens them in Lap Compare as the Base and Compare laps).
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

  useEffect(() => {
    fetch('/api/collector/laps')
      .then(async (res) => {
        if (res.status === 401) return setStatus('signed-out');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load your recorded laps');
        setLaps(data.laps);
        setStatus('ready');
      })
      .catch((err: Error) => {
        setError(err.message);
        setStatus('error');
      });
  }, []);

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
        if (!res.ok) throw new Error(`lap ${lap.lapNumber} could not be loaded`);
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
      setError(`${failed.length} ${failed.length === 1 ? 'lap' : 'laps'} could not be loaded. Please try again.`);
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
    if (!res.ok) throw new Error(`lap ${lap.lapNumber} could not be loaded`);
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
      setError(`Compare failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setComparing(false);
    }
  };

  // Sets every focus area's targets on the session's track from the one lap ticked in its Target column
  const setTarget = async (session: Session) => {
    const lap = session.laps.find((l) => targetPicks.has(l.id));
    if (!lap || !window.confirm('Set all target points using this lap?')) return;
    setError('');
    setNotice('');

    const track = tracks.find((t) => sameTrackName(t.fileName, lap.track));
    if (!track) {
      setError(`No track in your Track Data list is named "${lap.track}". Add it in the Track Data tab first.`);
      return;
    }

    setSettingTarget(session.key);
    try {
      const file = await lapFile(lap);

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
      if (areas.length === 0) throw new Error(`none of ${track.fileName}'s focus areas could be measured on this lap`);

      const res = await fetch('/api/tracks/reference-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackKey: track.name, trackName: track.fileName, areas }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save the target points');

      const lapLabel = `lap ${lap.lapNumber} (${formatLapTime(secondsToLapTime(lap.lapTimeSeconds))})`;
      const missing = data.notFound.length > 0 ? ` Not found in Track Data: ${data.notFound.join(', ')}.` : '';
      setNotice(`Target points for ${data.track} set from ${lapLabel} in ${data.saved.length} focus areas.${missing}`);
      onTargetsSaved?.();
    } catch (err) {
      setError(`Set Target failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSettingTarget(null);
    }
  };

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading your recorded laps…</p>;
  }
  if (status === 'signed-out') {
    return (
      <p className="text-sm text-muted-foreground">
        <a href="/login" className="text-primary hover:underline">Log in</a> to use laps recorded by the RacingCoach
        collector.
      </p>
    );
  }
  if (status === 'error') {
    return <p className="text-sm text-primary">{error}</p>;
  }
  if (laps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recorded laps yet. Laps from the RacingCoach collector show up here once they&apos;re uploaded (create an
        upload key on your <a href="/account" className="text-primary hover:underline">Account</a> page).
      </p>
    );
  }

  return (
    <div className="space-y-2">
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
              <span className="font-semibold text-foreground">{first.track}</span>
              <span className="text-muted-foreground"> • {first.car}</span>
              <span className="block text-xs text-muted-foreground">
                {new Date(first.recordedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} •{' '}
                {first.sessionType} • {session.laps.length} {session.laps.length === 1 ? 'lap' : 'laps'} • best{' '}
                {formatLapTime(secondsToLapTime(best))}
                {pickedCount > 0 && <span className="text-primary"> • {pickedCount} selected</span>}
              </span>
            </summary>

            <div className="px-4 pb-3 space-y-2">
              {!inTrackData && (
                <p className="px-3 py-2 rounded-lg border text-xs bg-yellow-500/10 border-yellow-500/40 text-yellow-200">
                  No track in your Track Data list is named &quot;{first.track}&quot;. Add it in the Track Data tab to
                  debrief these laps.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, false)}>
                  Clear
                </button>
                <button
                  type="button"
                  className={smallButtonClass}
                  onClick={() => select(session.laps.filter(isClean), true, session.laps)}
                >
                  Select clean
                </button>
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, true)}>
                  Select all
                </button>
                {/* Only enabled with exactly one lap ticked in this session's Target column */}
                <button
                  type="button"
                  disabled={targetCount !== 1 || settingTarget !== null}
                  onClick={() => void setTarget(session)}
                  className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {settingTarget === session.key ? 'Setting Target…' : 'Set Target'}
                </button>
                {/* Only enabled with exactly two laps ticked in the Compare column */}
                {onCompare && (
                  <button
                    type="button"
                    disabled={comparePicks.length !== 2 || !comparesHere || comparing}
                    onClick={() => void compare()}
                    className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {comparing && comparesHere ? 'Loading…' : 'Compare'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground">
                <span className="w-12 text-center">Debrief</span>
                <span className="w-12 text-center">Target</span>
                {onCompare && <span className="w-12 text-center">Compare</span>}
              </div>
              <ul className="space-y-1">
                {session.laps.map((lap) => (
                  <li key={lap.id} className="flex items-center gap-3 px-2 py-1 rounded hover:bg-secondary text-sm">
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
                        aria-label={`Use lap ${lap.lapNumber} as the target lap`}
                        className="accent-green-600"
                      />
                    </span>
                    {onCompare && (
                      <span className="w-12 flex justify-center">
                        <input
                          type="checkbox"
                          checked={comparePicks.includes(lap.id)}
                          onChange={(e) => toggleCompare(lap, e.target.checked)}
                          aria-label={`Compare lap ${lap.lapNumber}`}
                          className="accent-blue-600"
                        />
                      </span>
                    )}
                    <label htmlFor={`debrief-lap-${lap.id}`} className="flex items-center gap-3 cursor-pointer">
                      <span className="w-14 text-muted-foreground">Lap {lap.lapNumber}</span>
                      <span className={`font-semibold ${lap.lapTimeSeconds === best ? 'text-purple-400' : 'text-foreground'}`}>
                        {formatLapTime(secondsToLapTime(lap.lapTimeSeconds))}
                      </span>
                      <span className="flex flex-wrap gap-1 text-xs">
                        {lap.pitRoad && <span className="px-1.5 rounded bg-secondary text-muted-foreground">pit road</span>}
                        {lap.offTrack && <span className="px-1.5 rounded bg-yellow-500/15 text-yellow-200">off track</span>}
                        {lap.incidents > 0 && (
                          <span className="px-1.5 rounded bg-primary/15 text-red-300">{lap.incidents}x</span>
                        )}
                        {loading.has(lap.id) && <span className="text-muted-foreground">loading…</span>}
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
