'use client';

import { useEffect, useRef, useState } from 'react';

import { lapId } from '@/lib/debriefSession';
import { formatLapTime, formatSize, parseLapFile, type LapFile, type Track } from '@/lib/lapData';
import type { ReferenceRow } from '@/lib/referencePoints';
import { buildReferenceSession } from '@/lib/referenceSession';

const cell = (value: number | null) => (value === null ? '—' : value.toLocaleString('en-US'));

// A measured value with the file's target beside it
function Measured({ value, target }: { value: number | null; target: number | null }) {
  return (
    <>
      <span className="font-semibold text-foreground">{cell(value)}</span>
      <span className="ml-2 text-xs text-muted-foreground">(target {cell(target)})</span>
    </>
  );
}

export default function ReferencePoints() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [lapFiles, setLapFiles] = useState<LapFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ReferenceRow[] | null>(null);
  // The track the grid was measured on, which stays put if another track is picked afterwards
  const [rowsTrack, setRowsTrack] = useState<Track | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [commentary, setCommentary] = useState('');
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
      else errors.push(`No track in your Track Management list is named "${uploadedTrack}".`);
    }

    setFileErrors(errors);
    // Skip files that were already added (same unique ID)
    setLapFiles((prev) => [...prev, ...added.filter((lap) => !prev.some((p) => p.fileId === lap.fileId))]);
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

  const getReferencePoints = async () => {
    if (!selectedTrack) return;
    setRunning(true);
    setRunError('');
    setRows(null);
    setSaveResult(null);
    setCommentary('');
    setSteps([]);
    try {
      const session = await buildReferenceSession(selectedTrack, trackLaps);
      const res = await fetch('/api/reference-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get the reference points');
      setRows(data.rows);
      setRowsTrack(selectedTrack);
      setCommentary(data.commentary);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setRunning(false);
    }
  };

  // Overwrites the focus area targets on the user's saved track with the measured points
  const saveReferencePoints = async () => {
    if (!rows || !rowsTrack) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/tracks/reference-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackKey: rowsTrack.name,
          trackName: rowsTrack.fileName,
          areas: rows.map((row) => ({
            name: row.area,
            brakePointFeet: row.brakeFeet,
            maxBrakePct: row.maxBrakePct,
            throttlePointFeet: row.throttleFeet,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save the reference points');
      const saved: string[] = data.saved;
      const notFound: string[] = data.notFound;
      // The saved points are now the targets: show them in the grid and use them in the next run
      const isSaved = (area: string) => saved.some((name) => name.toLowerCase() === area.toLowerCase());
      setRows((prev) =>
        prev?.map((row) =>
          isSaved(row.area)
            ? {
                ...row,
                brakeTargetFeet: row.brakeFeet ?? row.brakeTargetFeet,
                maxBrakeTargetPct: row.maxBrakePct === null ? row.maxBrakeTargetPct : Math.min(100, row.maxBrakePct),
                throttleTargetFeet: row.throttleFeet ?? row.throttleTargetFeet,
              }
            : row
        ) ?? prev
      );
      void fetch('/api/track-names')
        .then((r) => (r.ok ? r.json() : null))
        .then((fresh) => fresh && setTracks(fresh.tracks));
      setSaveResult({
        ok: true,
        text:
          `Saved ${saved.length} focus ${saved.length === 1 ? 'area' : 'areas'} to ${data.track}.` +
          (notFound.length > 0 ? ` Not saved (no focus area with that name on your track): ${notFound.join(', ')}.` : ''),
      });
    } catch (err) {
      setSaveResult({ ok: false, text: err instanceof Error ? err.message : 'Failed to save the reference points' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      <div>
        <label htmlFor="reference-track-name" className="block text-sm font-medium text-foreground mb-2">
          Track Name
        </label>
        <select
          id="reference-track-name"
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
        <label className="block text-sm text-muted-foreground mb-2">Upload your lap CSVs</label>
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
            <p>Limit 25MB per file • CSV • Multiple files</p>
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
            {otherLaps} uploaded {otherLaps === 1 ? 'lap is' : 'laps are'} not from {selectedTrack?.fileName} and will
            be left out.
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
          onClick={() => void getReferencePoints()}
          disabled={trackLaps.length < 1 || !selectedTrack?.areas.length || running}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Analyzing your laps…' : 'Get Reference Points'}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            Failed: {runError}
          </div>
        )}

        {!rows && !runError && !running && (
          <p className="text-sm text-muted-foreground">
            {trackLaps.length < 1
              ? 'Upload at least 1 lap from the selected track, then press Get Reference Points.'
              : 'Press Get Reference Points to see the brake and throttle points for each focus area.'}
          </p>
        )}

        {rows && (
          <div className="space-y-4">
            <div className="overflow-x-auto bg-card border border-border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary text-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Focus Area
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      Brake Point (feet)
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      Max Brake Pressure (%)
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      On Throttle Point (feet)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-foreground">
                  {rows.map((row) => (
                    <tr key={row.area}>
                      <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                        {row.area}
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <Measured value={row.brakeFeet} target={row.brakeTargetFeet} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <Measured value={row.maxBrakePct} target={row.maxBrakeTargetPct} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <Measured value={row.throttleFeet} target={row.throttleTargetFeet} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Each point is the average of your fastest third of runs through the area (at least one), measured in feet
              from the start/finish line. Laps over 110% of the median lap time are left out as incident laps. The target is the
              focus area&apos;s value in Track Management. A dash means no braking or throttle point was found in that area, or
              no target is set (a target of 0 counts as not set).
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveReferencePoints()}
                disabled={rows.length === 0 || saving}
                className="px-4 py-2 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save Reference Points'}
              </button>
              <p className="text-xs text-muted-foreground">
                Overwrites the brake point, max brake pressure and on-throttle point of each focus area on your saved
                track. A dash keeps the saved value.
              </p>
            </div>
            {saveResult && (
              <div
                className={`px-4 py-3 rounded-lg border text-sm ${
                  saveResult.ok ? 'bg-positive/10 border-positive/40 text-positive' : 'bg-primary/10 border-primary/40 text-red-300'
                }`}
              >
                {saveResult.text}
              </div>
            )}

            {commentary && (
              <div className="px-5 py-4 bg-card border border-border rounded-lg">
                <h3 className="font-bold text-foreground mb-2">Commentary</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap">{commentary}</p>
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-muted-foreground">
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
