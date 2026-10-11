'use client';

import { useEffect, useMemo, useState } from 'react';

import type { CollectorLapSummary } from '@/lib/collectorLaps';
import { formatLapTime, sameTrackName, secondsToLapTime, type LapFile, type Track } from '@/lib/lapData';

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
export default function RecordedLaps({ tracks, onChange }: { tracks: Track[]; onChange: (laps: LapFile[]) => void }) {
  const [status, setStatus] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [laps, setLaps] = useState<CollectorLapSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<Record<number, LapFile>>({});
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');

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

  const select = (picked: CollectorLapSummary[], on: boolean) => {
    setError('');
    setSelected((prev) => {
      const next = new Set(prev);
      for (const lap of picked) {
        if (on) next.add(lap.id);
        else next.delete(lap.id);
      }
      return next;
    });
    if (on) void loadCsvs(picked);
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
      {sessions.map((session, index) => {
        const first = session.laps[0];
        const best = Math.min(...session.laps.map((lap) => lap.lapTimeSeconds));
        const pickedCount = session.laps.filter((lap) => selected.has(lap.id)).length;
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
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps.filter(isClean), true)}>
                  Select clean laps
                </button>
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, true)}>
                  Select all
                </button>
                <button type="button" className={smallButtonClass} onClick={() => select(session.laps, false)}>
                  Clear
                </button>
              </div>
              <ul className="space-y-1">
                {session.laps.map((lap) => (
                  <li key={lap.id}>
                    <label className="flex items-center gap-3 px-2 py-1 rounded hover:bg-secondary cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(lap.id)}
                        onChange={(e) => select([lap], e.target.checked)}
                        className="accent-primary"
                      />
                      <span className="w-14 text-muted-foreground">Lap {lap.lapNumber}</span>
                      <span className={`font-semibold ${lap.lapTimeSeconds === best ? 'text-primary' : 'text-foreground'}`}>
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
