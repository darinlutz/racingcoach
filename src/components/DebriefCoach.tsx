'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import RecordedLaps from '@/components/RecordedLaps';

import type { Debrief } from '@/lib/debriefCoach';
import { buildDebriefSession, lapId } from '@/lib/debriefSession';
import {
  formatLapTime,
  formatSize,
  lapFileErrorText,
  parseLapFile,
  sameTrackName,
  secondsToLapTime,
  type LapFile,
  type Track,
} from '@/lib/lapData';
import { assembleOptimalLapCsv, type OptimalLap } from '@/lib/optimalLap';
import { uploadTargetLap } from '@/lib/targetLapUpload';

// Stitches the theoretical lap's CSV from the laps its plan picked, named like a lap file
// ("RacingCoach - Driver - Car - Track - 01.17.912 - Optimal.csv") so the Target Lap card and the collector read
// its car, track and time. The driver is "Theoretical" when the parts come from more than one driver's laps.
async function buildOptimalLap(plan: OptimalLap, laps: LapFile[], trackName: string) {
  const picked = [...new Set(plan.segments.map((s) => s.lap))].map((id) => {
    const lap = laps.find((l) => lapId(l) === id);
    if (!lap) throw new Error(`lap [${id}] is not loaded`);
    return { id, lap };
  });
  const csvs = new Map(await Promise.all(picked.map(async ({ id, lap }) => [id, await lap.file.text()] as const)));
  const drivers = new Set(picked.map(({ lap }) => lap.driverName));
  const driver = drivers.size === 1 ? [...drivers][0] : 'Theoretical';
  const name = `RacingCoach - ${driver} - ${picked[0].lap.carName} - ${trackName} - ${secondsToLapTime(plan.lapTime)} - Optimal.csv`;
  const file = new File([assembleOptimalLapCsv(plan, csvs)], name, { type: 'text/csv' });
  return { plan, file, url: URL.createObjectURL(file) };
}

// onCompare: called with two recorded laps (fastest first) when the lap list's Compare button is pressed
export default function DebriefCoach({ onCompare }: { onCompare?: (base: LapFile, compare: LapFile) => void }) {
  const { t, fmt, plural, number } = useLanguage();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [lapFiles, setLapFiles] = useState<LapFile[]>([]);
  // Laps picked from the RacingCoach collector's uploads
  const [recordedLaps, setRecordedLaps] = useState<LapFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  // The coach's theoretical lap (assemble_optimal_lap): its plan, the stitched CSV and a download URL for it
  const [optimal, setOptimal] = useState<{ plan: OptimalLap; file: File; url: string } | null>(null);
  const [optimalError, setOptimalError] = useState('');
  const [settingTarget, setSettingTarget] = useState(false);
  const [targetNotice, setTargetNotice] = useState('');
  const [targetError, setTargetError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The download URL is let go when the lap is replaced or the tab closes
  useEffect(() => () => {
    if (optimal) URL.revokeObjectURL(optimal.url);
  }, [optimal]);

  // Track Data, loaded on open and again after a new Target Lap is set (the focus areas' targets come from it)
  const [targetLapVersion, setTargetLapVersion] = useState(0);
  useEffect(() => {
    fetch('/api/track-names')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t.laps.failedTrackNames);
        setTracks(data.tracks);
      })
      .catch((err: Error) => setError(err.message));
  }, [t, targetLapVersion]);

  const handleFiles = async (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const results = await Promise.allSettled(files.map(parseLapFile));
    const added: LapFile[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else errors.push(fmt(t.laps.fileError, { name: files[index].name, error: lapFileErrorText(result.reason, t.laps.errors) }));
    });

    // Select the track matching the uploaded files' track name
    if (added.length > 0) {
      const uploadedTrack = added[0].trackName;
      const match = tracks.find((track) => sameTrackName(track.fileName, uploadedTrack));
      if (match) setTrackName(match.name);
      else errors.push(fmt(t.laps.noSuchTrack, { track: uploadedTrack }));
    }

    setFileErrors(errors);
    // Skip files that were already added (same unique ID)
    setLapFiles((prev) => [
      ...prev,
      ...added.filter((lap) => !prev.some((p) => p.fileId === lap.fileId)),
    ]);
  };

  // Also selects the picked laps' track, unless the selected track already matches them
  const pickRecordedLaps = useCallback(
    (laps: LapFile[]) => {
      setRecordedLaps(laps);
      const picked = laps[0]?.trackName;
      if (!picked) return;
      setTrackName((current) => {
        const currentTrack = tracks.find((track) => track.name === current);
        if (currentTrack && sameTrackName(currentTrack.fileName, picked)) return current;
        return tracks.find((track) => sameTrackName(track.fileName, picked))?.name ?? current;
      });
    },
    [tracks]
  );

  const removeFile = (fileId: string) => {
    setLapFiles((prev) => prev.filter((lap) => lap.fileId !== fileId));
  };

  const allLaps = [...lapFiles, ...recordedLaps];
  // The track comes from the laps picked or dropped (pickRecordedLaps, handleFiles); none without laps
  const selectedTrack = allLaps.length > 0 ? tracks.find((track) => track.name === trackName) : undefined;
  // Only laps from the selected track can be measured against its focus areas
  const trackLaps = selectedTrack ? allLaps.filter((lap) => sameTrackName(lap.trackName, selectedTrack.fileName)) : [];
  const otherLaps = allLaps.length - trackLaps.length;


  const runDebrief = async () => {
    if (!selectedTrack) return;
    setRunning(true);
    setRunError('');
    setDebrief(null);
    setSteps([]);
    setOptimal(null);
    setOptimalError('');
    setTargetNotice('');
    setTargetError('');
    try {
      const laps = trackLaps;
      const session = await buildDebriefSession(selectedTrack, laps);
      const res = await fetch('/api/debrief-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.debrief.failedRun);
      setDebrief(data.debrief);
      setSteps(data.steps);
      if (data.optimalLap) {
        try {
          setOptimal(await buildOptimalLap(data.optimalLap, laps, selectedTrack.fileName));
        } catch (err) {
          setOptimalError(fmt(t.debrief.optimalFailed, { error: err instanceof Error ? err.message : t.common.unknownError }));
        }
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : t.common.unknownError);
    } finally {
      setRunning(false);
    }
  };

  // Saves the theoretical lap as the user's Target Lap (the Account page's Target Lap card)
  const setOptimalAsTarget = async () => {
    if (!optimal) return;
    setSettingTarget(true);
    setTargetNotice('');
    setTargetError('');
    try {
      await uploadTargetLap(optimal.file, t.api.failedSaveTargetLap);
      setTargetNotice(t.debrief.targetSaved);
      setTargetLapVersion((v) => v + 1);
    } catch (err) {
      setTargetError(fmt(t.debrief.setTargetFailed, { error: err instanceof Error ? err.message : t.common.unknownError }));
    } finally {
      setSettingTarget(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      <div>
        <label htmlFor="debrief-track-name" className="block text-sm font-medium text-foreground mb-2">
          {t.laps.trackName}
        </label>
        {/* Set by the laps picked or dropped below, so it isn't editable */}
        <input
          id="debrief-track-name"
          type="text"
          readOnly
          value={selectedTrack?.fileName ?? ''}
          placeholder={
            tracks.length === 0
              ? error
                ? t.laps.unavailable
                : t.common.loading
              : allLaps.length > 0
                ? t.laps.notInTrackData
                : t.laps.setByLaps
          }
          className={`${inputClass} cursor-default`}
        />
        {error && <p className="mt-2 text-sm text-primary">{error}</p>}
      </div>

      {/* Laps the RacingCoach collector uploaded */}
      <div>
        <p className="block text-sm text-muted-foreground mb-2">{t.debrief.yourRecordedLaps}</p>
        <RecordedLaps
          tracks={tracks}
          onChange={pickRecordedLaps}
          onCompare={onCompare}
          onTargetLapSet={() => setTargetLapVersion((v) => v + 1)}
        />
      </div>

      {/* File upload */}
      <div>
        <label className="block text-sm text-muted-foreground mb-2">{t.debrief.orUpload}</label>
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
            <p className="font-medium text-foreground">{t.laps.dragDrop}</p>
            <p>{t.laps.limitsSession}</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {t.laps.browseFiles}
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
            {plural(otherLaps, t.laps.otherTrackLaps, { track: selectedTrack?.fileName ?? '' })}
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
                  aria-label={fmt(t.laps.removeFile, { name: lap.file.name })}
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
          {running ? t.debrief.running : t.debrief.run}
        </button>

        {runError && (
          <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">
            {fmt(t.debrief.failed, { error: runError })}
          </div>
        )}

        {!debrief && !runError && !running && (
          <p className="text-sm text-muted-foreground">
            {trackLaps.length < 2 ? t.debrief.needLaps : t.debrief.pressRun}
          </p>
        )}

        {debrief && (
          <div className="space-y-4">
            <div className="px-5 py-4 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{t.debrief.fixFirst}</p>
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
                      {fmt(t.debrief.perLap, { seconds: number(fix.timeGainSeconds, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                    </span>
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div>
                      <dt className="inline font-semibold text-foreground">{t.debrief.problem}</dt>
                      <dd className="inline text-foreground">{fix.problem}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-foreground">{t.debrief.fix}</dt>
                      <dd className="inline text-foreground">{fix.fix}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-foreground">{t.debrief.evidence}</dt>
                      <dd className="inline text-muted-foreground">{fix.evidence}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>

            {debrief.keepDoing.length > 0 && (
              <div className="px-5 py-4 bg-card border border-border rounded-lg">
                <h3 className="font-bold text-foreground mb-2">{t.debrief.keepDoing}</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                  {debrief.keepDoing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {optimalError && (
              <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">{optimalError}</div>
            )}

            {optimal && (
              <div className="px-5 py-4 bg-card border border-border rounded-lg space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-bold text-foreground">{t.debrief.optimalTitle}</h3>
                  <span className="shrink-0 text-lg font-semibold text-primary">
                    {formatLapTime(secondsToLapTime(optimal.plan.lapTime))}
                  </span>
                </div>
                <p className="text-sm text-foreground">
                  {fmt(t.debrief.optimalFaster, {
                    seconds: number(optimal.plan.bestLap.lapTime - optimal.plan.lapTime, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                    best: formatLapTime(secondsToLapTime(optimal.plan.bestLap.lapTime)),
                    lap: optimal.plan.bestLap.id,
                  })}
                </p>
                {debrief.optimalLap && <p className="text-sm text-muted-foreground">{debrief.optimalLap}</p>}

                <details className="text-sm text-muted-foreground">
                  <summary className="cursor-pointer">{plural(optimal.plan.segments.length, t.debrief.optimalParts)}</summary>
                  <ol className="mt-2 space-y-1 text-xs">
                    {optimal.plan.segments.map((segment) => (
                      <li key={segment.start} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {segment.area ?? fmt(t.debrief.optimalBefore, { area: segment.next ?? '' })}{' '}
                          <span className="opacity-70">
                            ({number(segment.start * 100, { maximumFractionDigits: 0 })}%-{number(segment.end * 100, { maximumFractionDigits: 0 })}%)
                          </span>
                        </span>
                        <span className="shrink-0 font-mono">
                          [{segment.lap}] {number(segment.seconds, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}s
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={optimal.url}
                    download={optimal.file.name}
                    data-track="download-optimal-lap"
                    className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    {t.debrief.optimalDownload}
                  </a>
                  <button
                    type="button"
                    disabled={settingTarget}
                    onClick={() => void setOptimalAsTarget()}
                    data-track="set-optimal-target"
                    className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {settingTarget ? t.debrief.settingTarget : t.debrief.setAsTarget}
                  </button>
                </div>
                {targetNotice && (
                  <div className="px-4 py-3 rounded-lg border text-sm bg-green-500/10 border-green-500/40 text-green-300">{targetNotice}</div>
                )}
                {targetError && (
                  <div className="px-4 py-3 rounded-lg border text-sm bg-primary/10 border-primary/40 text-red-300">{targetError}</div>
                )}
              </div>
            )}

            {steps.length > 0 && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">{plural(steps.length, t.debrief.stepsChecked)}</summary>
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
