'use client';

import { useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import { lapId } from '@/lib/debriefSession';
import { formatLapTime, formatSize, lapFileErrorText, parseLapFile, type LapFile, type Track } from '@/lib/lapData';
import type { ReferenceRow } from '@/lib/referencePoints';
import { buildReferenceSession } from '@/lib/referenceSession';

// A measured value with the file's target beside it
function Measured({ value, target }: { value: number | null; target: number | null }) {
  const { t, fmt, locale } = useLanguage();
  const cell = (n: number | null) => (n === null ? '—' : n.toLocaleString(locale));
  return (
    <>
      <span className="font-semibold text-foreground">{cell(value)}</span>
      <span className="ml-2 text-xs text-muted-foreground">{fmt(t.referencePoints.target, { value: cell(target) })}</span>
    </>
  );
}

export default function ReferencePoints() {
  const { t: dictionary, fmt, plural } = useLanguage();
  const t = dictionary.referencePoints;
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
        if (!res.ok) throw new Error(data.error || dictionary.laps.failedTrackNames);
        setTracks(data.tracks);
        if (data.tracks.length > 0) setTrackName(data.tracks[0].name);
      })
      .catch((err: Error) => setError(err.message));
  }, [dictionary]);

  const handleFiles = async (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const results = await Promise.allSettled(files.map(parseLapFile));
    const added: LapFile[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else errors.push(fmt(dictionary.laps.fileError, { name: files[index].name, error: lapFileErrorText(result.reason, dictionary.laps.errors) }));
    });

    // Select the track matching the uploaded files' track name
    if (added.length > 0) {
      const uploadedTrack = added[0].trackName;
      const match = tracks.find((track) => track.fileName.toLowerCase() === uploadedTrack.toLowerCase());
      if (match) setTrackName(match.name);
      else errors.push(fmt(dictionary.laps.noSuchTrack, { track: uploadedTrack }));
    }

    setFileErrors(errors);
    // Skip files that were already added (same unique ID)
    setLapFiles((prev) => [...prev, ...added.filter((lap) => !prev.some((p) => p.fileId === lap.fileId))]);
  };

  const removeFile = (fileId: string) => {
    setLapFiles((prev) => prev.filter((lap) => lap.fileId !== fileId));
  };

  const selectedTrack = tracks.find((track) => track.name === trackName);
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
      if (!res.ok) throw new Error(data.error || t.failedGet);
      setRows(data.rows);
      setRowsTrack(selectedTrack);
      setCommentary(data.commentary);
      setSteps(data.steps);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : dictionary.common.unknownError);
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
      if (!res.ok) throw new Error(data.error || t.failedSave);
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
          plural(saved.length, t.saved, { track: data.track }) +
          (notFound.length > 0 ? fmt(t.notSaved, { areas: notFound.join(', ') }) : ''),
      });
    } catch (err) {
      setSaveResult({ ok: false, text: err instanceof Error ? err.message : t.failedSave });
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
          {dictionary.laps.trackName}
        </label>
        <select
          id="reference-track-name"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          disabled={tracks.length === 0}
          className={inputClass}
        >
          {tracks.length === 0 && <option value="">{error ? dictionary.laps.unavailable : dictionary.common.loading}</option>}
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
        <label className="block text-sm text-muted-foreground mb-2">{t.uploadLaps}</label>
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
            <p className="font-medium text-foreground">{dictionary.laps.dragDrop}</p>
            <p>{t.limits}</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {dictionary.laps.browseFiles}
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
            {plural(otherLaps, t.otherLaps, { track: selectedTrack?.fileName ?? '' })}
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
                  aria-label={fmt(dictionary.laps.removeFile, { name: lap.file.name })}
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
          {running ? t.running : t.get}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            {fmt(dictionary.common.failed, { error: runError })}
          </div>
        )}

        {!rows && !runError && !running && (
          <p className="text-sm text-muted-foreground">
            {trackLaps.length < 1 ? t.needLap : t.pressGet}
          </p>
        )}

        {rows && (
          <div className="space-y-4">
            <div className="overflow-x-auto bg-card border border-border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary text-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t.focusArea}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      {t.brakePoint}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      {t.maxBrake}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      {t.throttlePoint}
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
              {t.note}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveReferencePoints()}
                disabled={rows.length === 0 || saving}
                className="px-4 py-2 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t.saving : t.save}
              </button>
              <p className="text-xs text-muted-foreground">
                {t.saveNote}
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
