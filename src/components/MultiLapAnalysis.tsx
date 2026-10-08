'use client';

import { useEffect, useRef, useState } from 'react';

import {
  areaStats,
  brakeFeet,
  formatLapTime,
  formatSize,
  lapTimeToSeconds,
  MPH_PER_METER_PER_SECOND,
  parseLapFile,
  readLapSamples,
  type AreaStats,
  type LapFile,
  type Track,
} from '@/lib/lapData';
import { isStintExport, parseStintExport, type StintExport } from '@/lib/stintExport';
import WeatherTable from '@/components/WeatherTable';

// Lap position (unwrapped LapDistPct) -> "Brakepoint at 1234 ft. (Brake target = 1200)"
function formatBrakepoint(brakePct: number | null, lengthFeet: number | null, target: number | null) {
  if (brakePct === null) return 'No braking';
  if (!lengthFeet) return 'Brakepoint at n/a (no TrackLengthInFeet)';
  return `Brakepoint at ${brakeFeet(brakePct, lengthFeet)} ft. (Brake target = ${target ?? 'n/a'})`;
}

// Sample standard deviation (n - 1); needs at least two values
function sampleStdDev(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// "avg 1234 ft, std dev 22.0 ft" (or "n/a" with no values); unit includes any leading space
function formatSpread(values: number[], unit: string) {
  if (values.length === 0) return 'n/a';
  const stdDev = sampleStdDev(values);
  return `avg ${mean(values).toFixed(0)}${unit}, std dev ${stdDev === null ? 'n/a' : `${stdDev.toFixed(1)}${unit}`}`;
}

type AreaRun = { lap: LapFile; stats: AreaStats };

// One focus area's lap-to-lap statistics for the multi-lap analysis
function formatAreaStats(name: string, runs: AreaRun[], lengthFeet: number | null, brakeTarget: number | null, pressureTarget: number | null) {
  const times = runs.map((r) => r.stats.seconds);
  const best = Math.min(...times);
  const avg = mean(times);
  const stdDev = sampleStdDev(times);
  const bestLap = runs[times.indexOf(best)].lap;
  const brakepoints = lengthFeet
    ? runs.flatMap((r) => (r.stats.brakePct === null ? [] : [brakeFeet(r.stats.brakePct, lengthFeet)]))
    : [];
  const noBrakeLaps = runs.filter((r) => r.stats.brakePct === null).length;

  return (
    `${name}: ${runs.length} laps, best ${best.toFixed(3)}s [${bestLap.fileId.slice(-4)}], avg ${avg.toFixed(3)}s ` +
    `(avg lost to best ${(avg - best).toFixed(3)}s), worst ${Math.max(...times).toFixed(3)}s, ` +
    `std dev ${stdDev === null ? 'n/a' : `${stdDev.toFixed(3)}s`}. ` +
    `Brakepoint ${formatSpread(brakepoints, ' ft')} (target ${brakeTarget ?? 'n/a'} ft)` +
    `${noBrakeLaps > 0 ? `, no braking on ${noBrakeLaps} laps` : ''}. ` +
    `Max brake ${formatSpread(runs.map((r) => r.stats.maxBrake * 100), '%')} (target ${pressureTarget === null ? 'n/a' : `${pressureTarget}%`}). ` +
    `Min speed ${formatSpread(runs.map((r) => r.stats.minSpeed * MPH_PER_METER_PER_SECOND), ' mph')}. ` +
    `Exit speed ${formatSpread(runs.map((r) => r.stats.exitSpeed * MPH_PER_METER_PER_SECOND), ' mph')}.`
  );
}

// Asks the server for an opportunities and consistency analysis of the laps
async function fetchMultiLapAnalysis(stats: string, track: string) {
  try {
    const res = await fetch('/api/multi-lap-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stats, track }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to analyze the laps');
    return data.summary as string;
  } catch (err) {
    return `Analysis unavailable: ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}

export default function MultiLapAnalysis() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [lapFiles, setLapFiles] = useState<LapFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [weather, setWeather] = useState<StintExport | null>(null);
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

    // A stint export (per-lap weather) can be dropped in along with the lap CSVs
    const files = Array.from(fileList);
    const isExport = await Promise.all(files.map((file) => isStintExport(file).catch(() => false)));
    const lapInputs = files.filter((_, i) => !isExport[i]);
    const exportInputs = files.filter((_, i) => isExport[i]);

    const results = await Promise.allSettled(lapInputs.map(parseLapFile));
    const added: LapFile[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else errors.push(`${lapInputs[index].name}: ${(result.reason as Error).message}`);
    });

    if (exportInputs.length > 1) errors.push('Only 1 stint export can be used at a time; the last one was kept.');
    for (const file of exportInputs) {
      try {
        setWeather(await parseStintExport(file));
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }

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

  const analyzeMultiLap = async () => {
    setAnalyzing(true);
    try {
      const fastest = lapFiles.reduce((best, lap) =>
        lapTimeToSeconds(lap.lapTime) < lapTimeToSeconds(best.lapTime) ? lap : best
      );
      const lines = [
        `CSV files uploaded: ${lapFiles.length}`,
        `Fastest lap: ${formatLapTime(fastest.lapTime)} (${fastest.driverName}, ${fastest.carName}) [${fastest.fileId.slice(-4)}]`,
        '',
      ];

      // Only laps from the selected track can be compared against its areas
      const trackLaps = selectedTrack
        ? lapFiles.filter((lap) => lap.trackName.toLowerCase() === selectedTrack.fileName.toLowerCase())
        : [];

      if (!selectedTrack || selectedTrack.areas.length === 0) {
        lines.push('No focus areas for the selected track.');
      } else if (trackLaps.length === 0) {
        lines.push(`No uploaded laps are from ${selectedTrack.fileName}.`);
      } else {
        const lapSamples = await Promise.all(trackLaps.map((lap) => readLapSamples(lap.file)));
        lines.push(`Fastest time per focus area (${selectedTrack.fileName}):`);
        // Lap-to-lap statistics per focus area, sent for the analysis below the focus areas
        const areaSummaries: { lost: number; text: string }[] = [];

        for (const area of selectedTrack.areas) {
          if (area.start === null || area.end === null) {
            lines.push(`${area.name}: missing start/end in Track Data`, '');
            continue;
          }

          let best: ReturnType<typeof areaStats> = null;
          let bestLap: LapFile | null = null;
          const areaTimes: number[] = [];
          const runs: AreaRun[] = [];
          for (let i = 0; i < trackLaps.length; i++) {
            const stats = areaStats(lapSamples[i], lapTimeToSeconds(trackLaps[i].lapTime), area.start, area.end);
            if (!stats) continue;
            areaTimes.push(stats.seconds);
            runs.push({ lap: trackLaps[i], stats });
            if (!best || stats.seconds < best.seconds) {
              best = stats;
              bestLap = trackLaps[i];
            }
          }

          const range = `${(area.start * 100).toFixed(0)}%-${(area.end * 100).toFixed(0)}%`;
          const stdDev = sampleStdDev(areaTimes);
          lines.push(
            best && bestLap
              ? `${area.name} (${range}): ${best.seconds.toFixed(3)}s, ${formatBrakepoint(best.brakePct, selectedTrack.lengthFeet, area.brakepointTarget)}, Max Brake ${Math.round(best.maxBrake * 100)}% (Max Brake Target = ${area.maxBrakeTarget === null ? 'n/a' : `${area.maxBrakeTarget}%`}) [${bestLap.fileId.slice(-4)}], Stand Dev = ${stdDev === null ? 'n/a' : `${stdDev.toFixed(3)}s`}`
              : `${area.name} (${range}): no data`,
            '' // Blank line between focus areas
          );
          if (best) {
            areaSummaries.push({
              lost: mean(areaTimes) - best.seconds,
              text: formatAreaStats(`${area.name} (${range})`, runs, selectedTrack.lengthFeet, area.brakepointTarget, area.maxBrakeTarget),
            });
          }
        }

        if (trackLaps.length < 2) {
          lines.push('Analysis: upload at least 2 laps from this track to compare them.');
        } else if (areaSummaries.length > 0) {
          const lapTimes = trackLaps.map((lap) => lapTimeToSeconds(lap.lapTime));
          const lapStdDev = sampleStdDev(lapTimes);
          const stats = [
            `Lap times (${lapTimes.length} laps): best ${Math.min(...lapTimes).toFixed(3)}s, avg ${mean(lapTimes).toFixed(3)}s, ` +
              `worst ${Math.max(...lapTimes).toFixed(3)}s, std dev ${lapStdDev === null ? 'n/a' : `${lapStdDev.toFixed(3)}s`}.`,
            '',
            ...areaSummaries.sort((a, b) => b.lost - a.lost).map((a) => a.text),
          ].join('\n');

          // Show the focus areas right away, then add the analysis below them
          setAnalysis(`${lines.join('\n').trimEnd()}\n\nAnalysis: writing…`);
          lines.push('Analysis:', await fetchMultiLapAnalysis(stats, selectedTrack.fileName));
        }
      }

      setAnalysis(lines.join('\n').trimEnd());
    } catch (err) {
      setAnalysis(`Error analyzing laps: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const removeFile = (fileId: string) => {
    setLapFiles((prev) => prev.filter((lap) => lap.fileId !== fileId));
  };

  // Stint export laps whose time matches an uploaded lap CSV (to the millisecond)
  const isUploadedLap = (lapSeconds: number) =>
    lapFiles.some((lap) => Math.abs(lapTimeToSeconds(lap.lapTime) - lapSeconds) < 0.0015);

  const selectedTrack = tracks.find((t) => t.name === trackName);
  const mismatchedLaps = selectedTrack
    ? lapFiles.filter((lap) => lap.trackName.toLowerCase() !== selectedTrack.fileName.toLowerCase())
    : [];

  const inputClass =
    'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      <div>
        <label htmlFor="multi-lap-track-name" className="block text-sm font-medium text-foreground mb-2">
          Track Name
        </label>
        <select
          id="multi-lap-track-name"
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
        <label className="block text-sm text-muted-foreground mb-2">Upload Lap CSVs</label>
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
            <p>Limit 25MB per file • CSV • Lap CSVs and a stint export</p>
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

        {mismatchedLaps.length > 0 && (
          <div className="mt-2 px-4 py-3 rounded-lg border text-sm bg-yellow-500/10 border-yellow-500/40 text-yellow-200">
            {mismatchedLaps.length} uploaded {mismatchedLaps.length === 1 ? 'lap is' : 'laps are'} not from{' '}
            {selectedTrack?.fileName}.
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
                  📄 {lap.driverName} • {lap.carName} • {lap.trackName} •{' '}
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

      {weather && (
        <WeatherTable
          stint={weather}
          onRemove={() => setWeather(null)}
          note={lapFiles.length > 0 ? 'Highlighted laps match an uploaded lap CSV.' : undefined}
          isHighlighted={isUploadedLap}
        />
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void analyzeMultiLap()}
          disabled={lapFiles.length === 0 || analyzing}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? 'Analyzing…' : 'Analyze Multi-Lap'}
        </button>

        <div>
          <label htmlFor="multi-lap-analysis" className="block text-sm font-medium text-foreground mb-2">
            Analysis
          </label>
          <textarea
            id="multi-lap-analysis"
            value={analysis}
            readOnly
            rows={12}
            placeholder={lapFiles.length === 0 ? 'Upload lap CSVs, then press Analyze Multi-Lap.' : 'Press Analyze Multi-Lap.'}
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </div>
      </div>
    </div>
  );
}
