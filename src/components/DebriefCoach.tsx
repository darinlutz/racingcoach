'use client';

import { useEffect, useRef, useState } from 'react';

import type { Debrief } from '@/lib/debriefCoach';
import { buildDebriefSession, lapId } from '@/lib/debriefSession';
import { formatLapTime, formatSize, parseLapFile, type LapFile, type Track } from '@/lib/lapData';

export default function DebriefCoach() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [lapFiles, setLapFiles] = useState<LapFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/track-names')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load track names');
        setTracks(data.tracks);
        if (data.tracks.length > 0) setTrackName(data.tracks[0].name);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const handleFiles = async (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const results = await Promise.allSettled(files.map(parseLapFile));
    const added: LapFile[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else errors.push(`${files[index].name}: ${(result.reason as Error).message}`);
    });

    // Select the track matching the uploaded files' track name
    if (added.length > 0) {
      const uploadedTrack = added[0].trackName;
      const match = tracks.find((t) => t.fileName.toLowerCase() === uploadedTrack.toLowerCase());
      if (match) setTrackName(match.name);
      else errors.push(`No track in your Track Data list is named "${uploadedTrack}".`);
    }

    setFileErrors(errors);
    // Skip files that were already added (same unique ID)
    setLapFiles((prev) => [
      ...prev,
      ...added.filter((lap) => !prev.some((p) => p.fileId === lap.fileId)),
    ]);
  };

  const removeFile = (fileId: string) => {
    setLapFiles((prev) => prev.filter((lap) => lap.fileId !== fileId));
  };

  const selectedTrack = tracks.find((t) => t.name === trackName);
  // Only laps from the selected track can be measured against its focus areas
  const trackLaps = selectedTrack
    ? lapFiles.filter((lap) => lap.trackName.toLowerCase() === selectedTrack.fileName.toLowerCase())
    : [];
  const otherLaps = lapFiles.length - trackLaps.length;

  const runDebrief = async () => {
    if (!selectedTrack) return;
    setRunning(true);
    setRunError('');
    setDebrief(null);
    setSteps([]);
    try {
      const session = await buildDebriefSession(selectedTrack, trackLaps);
      const res = await fetch('/api/debrief-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run the debrief');
      setDebrief(data.debrief);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      <div>
        <label htmlFor="debrief-track-name" className="block text-sm font-medium text-foreground mb-2">
          Track Name
        </label>
        <select
          id="debrief-track-name"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          disabled={tracks.length === 0}
          className={inputClass}
        >
          {tracks.length === 0 && <option value="">{error ? 'Unavailable' : 'Loading…'}</option>}
          {tracks.map((track) => (
            <option key={track.name} value={track.name}>
              {track.fileName}
            </option>
          ))}
        </select>
        {error && <p className="mt-2 text-sm text-primary">{error}</p>}
      </div>

      {/* File upload */}
      <div>
        <label className="block text-sm text-muted-foreground mb-2">Upload the session&apos;s lap CSVs</label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
            dragging ? 'border-primary bg-accent' : 'border-border bg-card'
          }`}
        >
          <div className="text-sm text-muted-foreground text-center sm:text-left">
            <p className="font-medium text-foreground">Drag and drop files here</p>
            <p>Limit 25MB per file • CSV • At least 2 laps</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            Browse files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="text/csv,.csv"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {fileErrors.length > 0 && (
          <div className="mt-2 px-4 py-3 rounded-lg border text-sm whitespace-pre-wrap bg-primary/10 border-primary/40 text-red-300">
            {fileErrors.join('\n')}
          </div>
        )}

        {otherLaps > 0 && (
          <div className="mt-2 px-4 py-3 rounded-lg border text-sm bg-yellow-500/10 border-yellow-500/40 text-yellow-200">
            {otherLaps} uploaded {otherLaps === 1 ? 'lap is' : 'laps are'} not from {selectedTrack?.fileName} and
            will be left out.
          </div>
        )}

        {lapFiles.length > 0 && (
          <ul className="mt-2 space-y-2">
            {lapFiles.map((lap) => (
              <li
                key={lap.fileId}
                className="flex items-center justify-between px-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground"
              >
                <span className="min-w-0 truncate">
                  📄 <span className="text-muted-foreground">[{lapId(lap)}]</span> {lap.driverName} • {lap.carName} •{' '}
                  <span className="font-semibold">{formatLapTime(lap.lapTime)}</span>{' '}
                  <span className="text-muted-foreground">{formatSize(lap.file.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(lap.fileId)}
                  aria-label={`Remove ${lap.file.name}`}
                  className="ml-3 text-muted-foreground hover:text-primary"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void runDebrief()}
          disabled={trackLaps.length < 2 || !selectedTrack?.areas.length || running}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Coach is reviewing your laps…' : 'Run Debrief'}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            Debrief failed: {runError}
          </div>
        )}

        {!debrief && !runError && !running && (
          <p className="text-sm text-muted-foreground">
            {trackLaps.length < 2
              ? 'Upload at least 2 laps from the selected track, then press Run Debrief.'
              : 'Press Run Debrief to get the things to fix next session.'}
          </p>
        )}

        {debrief && (
          <div className="space-y-4">
            <div className="px-5 py-4 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Fix this first</p>
              <p className="mt-1 text-lg font-semibold">{debrief.headline}</p>
            </div>

            <ol className="space-y-3">
              {debrief.fixes.map((fix, i) => (
                <li key={`${fix.area}-${i}`} className="px-5 py-4 bg-card border border-border rounded-lg">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-bold text-foreground">
                      {i + 1}. {fix.area}
                    </h3>
                    <span className="shrink-0 text-sm font-semibold text-primary">
                      ~{fix.timeGainSeconds.toFixed(2)}s / lap
                    </span>
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div>
                      <dt className="inline font-semibold text-foreground">Problem: </dt>
                      <dd className="inline text-foreground">{fix.problem}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-foreground">Fix: </dt>
                      <dd className="inline text-foreground">{fix.fix}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-foreground">Evidence: </dt>
                      <dd className="inline text-muted-foreground">{fix.evidence}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>

            {debrief.keepDoing.length > 0 && (
              <div className="px-5 py-4 bg-card border border-border rounded-lg">
                <h3 className="font-bold text-foreground mb-2">Keep doing</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                  {debrief.keepDoing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">What the coach checked ({steps.length} steps)</summary>
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
