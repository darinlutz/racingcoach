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

const inputClass =
  'w-full px-4 py-3 bg-white border border-slate-300 rounded-lg text-dark-blue focus:outline-none focus:border-powder-600 focus:ring-1 focus:ring-powder-500 transition-colors';

// 1234.5 -> "1,235"
function formatFeet(feet: number) {
  return Math.round(feet).toLocaleString('en-US');
}

// 0.12 -> "+0.120", -0.05 -> "-0.050"
function formatSecondsDiff(diff: number) {
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(3)}`;
}

// Compare brakepoint minus Base brakepoint, in feet. Positive = Compare brakes later.
// Uses the rounded feet shown on the line so the numbers add up, wrapped to
// +/- half a lap so an area crossing the start/finish line compares correctly.
function brakeDiffFeet(basePct: number, comparePct: number, lengthFeet: number) {
  const diff = brakeFeet(comparePct, lengthFeet) - brakeFeet(basePct, lengthFeet);
  return diff - Math.round(diff / lengthFeet) * lengthFeet;
}

// One focus area's numbers for both laps; each diff is Compare minus Base.
// Brakepoints are null when that lap didn't brake (or the track has no length).
type AreaComparison = {
  baseSeconds: number;
  compareSeconds: number;
  secondsDiff: number;
  baseBrakeFeet: number | null;
  compareBrakeFeet: number | null;
  brakeFeetDiff: number | null; // Positive = Compare brakes later
  basePressure: number;
  comparePressure: number;
  pressureDiff: number;
  baseEntry: number;
  compareEntry: number;
  entryDiff: number;
  baseMin: number;
  compareMin: number;
  minDiff: number;
  baseExit: number;
  compareExit: number;
  exitDiff: number;
};

// Rounds everything to what's shown, so the diffs always add up
function compareArea(base: AreaStats, compare: AreaStats, lengthFeet: number | null): AreaComparison {
  const toFeet = (brakePct: number | null) =>
    brakePct === null || !lengthFeet ? null : brakeFeet(brakePct, lengthFeet);
  const toMph = (metersPerSecond: number) => Math.round(metersPerSecond * MPH_PER_METER_PER_SECOND);

  const basePressure = Math.round(base.maxBrake * 100);
  const comparePressure = Math.round(compare.maxBrake * 100);
  const baseEntry = toMph(base.entrySpeed);
  const compareEntry = toMph(compare.entrySpeed);
  const baseMin = toMph(base.minSpeed);
  const compareMin = toMph(compare.minSpeed);
  const baseExit = toMph(base.exitSpeed);
  const compareExit = toMph(compare.exitSpeed);

  return {
    baseSeconds: base.seconds,
    compareSeconds: compare.seconds,
    secondsDiff: compare.seconds - base.seconds,
    baseBrakeFeet: toFeet(base.brakePct),
    compareBrakeFeet: toFeet(compare.brakePct),
    brakeFeetDiff:
      base.brakePct !== null && compare.brakePct !== null && lengthFeet
        ? Math.round(brakeDiffFeet(base.brakePct, compare.brakePct, lengthFeet))
        : null,
    basePressure,
    comparePressure,
    pressureDiff: comparePressure - basePressure,
    baseEntry,
    compareEntry,
    entryDiff: compareEntry - baseEntry,
    baseMin,
    compareMin,
    minDiff: compareMin - baseMin,
    baseExit,
    compareExit,
    exitDiff: compareExit - baseExit,
  };
}

// 150 -> "150 ft later", 0 -> "same"
function formatBrakeDiff(diff: number) {
  return diff === 0 ? 'same' : `${formatFeet(Math.abs(diff))} ft ${diff > 0 ? 'later' : 'earlier'}`;
}

// 3 -> "3% harder", 0 -> "same"
function formatPressureDiff(diff: number) {
  return diff === 0 ? 'same' : `${Math.abs(diff)}% ${diff > 0 ? 'harder' : 'lighter'}`;
}

// 3 -> "+3", -2 -> "-2"
function formatSignedDiff(diff: number) {
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff)}`;
}

// "T 7: Base 8.345 s, Compare 8.465 s (+0.120).  Base brake 4,345 ft at 65%, Compare brake
// 4,495 ft (150 ft later) at 68% (3% harder).  Base exit 98 mph, Compare exit 101 mph (+3 mph)."
function formatAreaLine(areaName: string, c: AreaComparison, lengthFeet: number | null) {
  const brakeAt = (feet: number | null) => {
    if (feet !== null) return `${formatFeet(feet)} ft`;
    return lengthFeet ? 'no braking' : 'n/a ft (no TrackLengthInFeet)';
  };
  const brakepointDiff = c.brakeFeetDiff === null ? '' : ` (${formatBrakeDiff(c.brakeFeetDiff)})`;

  return (
    `${areaName}: Base ${c.baseSeconds.toFixed(3)} s, Compare ${c.compareSeconds.toFixed(3)} s (${formatSecondsDiff(c.secondsDiff)}).  ` +
    `Base brake ${brakeAt(c.baseBrakeFeet)} at ${c.basePressure}%, ` +
    `Compare brake ${brakeAt(c.compareBrakeFeet)}${brakepointDiff} at ${c.comparePressure}% (${formatPressureDiff(c.pressureDiff)}).  ` +
    `Base entry ${c.baseEntry} mph, Compare entry ${c.compareEntry} mph (${formatSignedDiff(c.entryDiff)} mph).  ` +
    `Base Min speed ${c.baseMin} mph, Compare Min speed ${c.compareMin} mph (${formatSignedDiff(c.minDiff)} mph).  ` +
    `Base exit ${c.baseExit} mph, Compare exit ${c.compareExit} mph (${formatSignedDiff(c.exitDiff)} mph).`
  );
}

// Brakepoints within this many feet, or peak pressures within this many %, count as the same
const ADVICE_BRAKE_FEET = 10;
const ADVICE_PRESSURE_PCT = 3;

// Which way the Compare lap should change its braking in an area, decided here rather than by the
// model so "later"/"earlier" and "harder"/"lighter" can't get flipped. Only sent to the summary.
function formatAreaAdvice(areaName: string, c: AreaComparison) {
  if (c.secondsDiff <= 0) {
    return `${areaName} advice: the Compare lap was faster here, so it should keep its braking; do not tell it to copy the Base lap.`;
  }
  const changes = [];
  if (c.brakeFeetDiff !== null && Math.abs(c.brakeFeetDiff) >= ADVICE_BRAKE_FEET) {
    // Compare braked earlier (negative diff) -> brake later, and vice versa
    changes.push(`brake ${formatFeet(Math.abs(c.brakeFeetDiff))} ft ${c.brakeFeetDiff < 0 ? 'LATER' : 'EARLIER'}`);
  }
  if (Math.abs(c.pressureDiff) >= ADVICE_PRESSURE_PCT) {
    changes.push(
      `use ${c.pressureDiff < 0 ? 'MORE' : 'LESS'} peak brake pressure (${c.pressureDiff < 0 ? 'harder' : 'lighter'}, ` +
        `about ${c.basePressure}% instead of ${c.comparePressure}%)`
    );
  }
  return changes.length > 0
    ? `${areaName} advice: to match the faster Base lap, the Compare lap should ${changes.join(' and ')}.`
    : `${areaName} advice: braking is about the same on both laps, so the time is in the speeds; do not give braking advice here.`;
}

// A table row: the comparison, or why there isn't one
type AreaRow = { name: string; comparison: AreaComparison | null; note: string };

// Diff cell background: green when the Compare lap is better, red when worse,
// darker when the difference is more than 1% of the Base value. `diff` is the
// value as shown, so a displayed zero stays uncolored.
function diffBackground(diff: number, base: number, higherIsBetter: boolean) {
  if (diff === 0) return '';
  const bigger = base !== 0 && Math.abs(diff) / Math.abs(base) > 0.01;
  if (diff > 0 === higherIsBetter) return bigger ? 'bg-green-300' : 'bg-green-100';
  return bigger ? 'bg-red-300' : 'bg-red-100';
}

// Brake Diff text: blue when the Compare lap is more than `threshold` below Base
// (brakes earlier / lighter), red when more than `threshold` above (later / harder),
// green when within `threshold` either way
function brakeDiffText(diff: number | null, threshold: number) {
  if (diff === null) return '';
  if (diff < -threshold) return 'text-blue-600';
  if (diff > threshold) return 'text-red-600';
  return 'text-green-600';
}

// Focus areas down the left, Base / Compare / Diff for each data point across the top
// (Max Brake shows Base and Diff; everything else shows only its Diff)
function AreaTable({ rows }: { rows: AreaRow[] }) {
  const groups = [
    { label: 'Time', columns: ['Diff'] },
    { label: 'Brakepoint', columns: ['Diff'] },
    { label: 'Max Brake', columns: ['Base', 'Diff'] },
    { label: 'Entry Speed', columns: ['Diff'] },
    { label: 'Min Speed', columns: ['Diff'] },
    { label: 'Exit Speed', columns: ['Diff'] },
  ];
  const columnCount = groups.reduce((sum, group) => sum + group.columns.length, 0);
  const cell = 'px-3 py-2 text-right whitespace-nowrap';
  const groupStart = 'border-l border-slate-200';

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm text-dark-blue">
        <thead className="bg-slate-100">
          <tr>
            <th rowSpan={2} className="sticky left-0 bg-slate-100 px-3 py-2 text-left align-bottom">
              Focus Area
            </th>
            {groups.map((group) => (
              <th
                key={group.label}
                colSpan={group.columns.length}
                className={`${groupStart} px-3 py-2 text-center whitespace-nowrap`}
              >
                {group.label}
              </th>
            ))}
          </tr>
          <tr className="text-xs text-slate-600">
            {groups.map((group) =>
              group.columns.map((label, i) => (
                <th
                  key={group.label + label}
                  className={`px-3 py-2 whitespace-nowrap font-medium ${label === 'Diff' ? 'text-center' : 'text-right'} ${
                    i === 0 ? groupStart : ''
                  }`}
                >
                  {label}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map(({ name, comparison: c, note }) => (
            <tr key={name}>
              <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-semibold whitespace-nowrap">
                {name}
              </th>
              {!c ? (
                <td colSpan={columnCount} className={`${groupStart} px-3 py-2 text-slate-500`}>
                  {note}
                </td>
              ) : (
                <>
                  <td
                    className={`${cell} ${groupStart} ${diffBackground(
                      Math.round(c.secondsDiff * 1000) / 1000,
                      c.baseSeconds,
                      false
                    )}`}
                  >
                    {formatSecondsDiff(c.secondsDiff)} s
                  </td>

                  <td className={`${cell} ${groupStart} ${brakeDiffText(c.brakeFeetDiff, 10)}`}>
                    {c.brakeFeetDiff === null ? '—' : formatBrakeDiff(c.brakeFeetDiff)}
                  </td>

                  <td className={`${cell} ${groupStart}`}>{c.basePressure}%</td>
                  <td className={`${cell} ${brakeDiffText(c.pressureDiff, 3)}`}>{formatPressureDiff(c.pressureDiff)}</td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.entryDiff, c.baseEntry, true)}`}>
                    {formatSignedDiff(c.entryDiff)} mph
                  </td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.minDiff, c.baseMin, true)}`}>
                    {formatSignedDiff(c.minDiff)} mph
                  </td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.exitDiff, c.baseExit, true)}`}>
                    {formatSignedDiff(c.exitDiff)} mph
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Asks the server for a 6-7 sentence coaching summary written for the Compare lap
async function fetchSummary(comparison: string, track: string) {
  try {
    const res = await fetch('/api/lap-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comparison, track }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to summarize the laps');
    return data.summary as string;
  } catch (err) {
    return `Summary unavailable: ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}

type LapUploaderProps = {
  id: string;
  title: string;
  prompt: string;
  lap: LapFile | null;
  error: string;
  onFiles: (files: FileList | null | undefined) => void;
  onRemove: () => void;
};

// Drop zone that holds a single lap CSV
function LapUploader({ id, title, prompt, lap, error, onFiles, onRemove }: LapUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-dark-blue mb-2">
        {title}
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
          dragging ? 'border-powder-500 bg-powder-50' : 'border-slate-300 bg-white'
        }`}
      >
        <div className="text-sm text-slate-600 text-center sm:text-left">
          <p className="font-medium text-dark-blue">{prompt}</p>
          <p>Drag and drop 1 file here • Limit 25MB • CSV</p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg text-dark-blue hover:border-powder-600 hover:text-powder-600 transition-colors"
        >
          Browse files
        </button>
        <input
          ref={fileInputRef}
          id={id}
          type="file"
          accept="text/csv,.csv"
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="mt-2 px-4 py-3 rounded-lg border text-sm whitespace-pre-wrap bg-red-50 border-red-200 text-red-900">
          {error}
        </div>
      )}

      {lap && (
        <div className="mt-2 flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-dark-blue">
          <span className="min-w-0 truncate">
            📄 {lap.driverName} • {lap.carName} • {lap.trackName} •{' '}
            <span className="font-semibold">{formatLapTime(lap.lapTime)}</span>{' '}
            <span className="text-slate-500">{formatSize(lap.file.size)}</span>
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${lap.file.name}`}
            className="ml-3 text-slate-500 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default function LapCompare() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [baseLap, setBaseLap] = useState<LapFile | null>(null);
  const [compareLap, setCompareLap] = useState<LapFile | null>(null);
  const [baseError, setBaseError] = useState('');
  const [compareError, setCompareError] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

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

  // Validates a drop/browse into one uploader and stores the lap if it's good
  const handleFiles = async (
    fileList: FileList | null | undefined,
    setLap: (lap: LapFile) => void,
    setLapError: (message: string) => void
  ) => {
    if (!fileList || fileList.length === 0) return;
    if (fileList.length > 1) {
      setLapError(`Only 1 CSV file can be uploaded here (${fileList.length} were selected).`);
      return;
    }

    try {
      const lap = await parseLapFile(fileList[0]);
      // Select the track matching the uploaded file's track name
      const match = tracks.find((t) => t.fileName.toLowerCase() === lap.trackName.toLowerCase());
      if (match) setTrackName(match.name);
      setLapError(
        match ? '' : `No track in your Track Management list is named "${lap.trackName}".`
      );
      setLap(lap);
    } catch (err) {
      setLapError(`${fileList[0].name}: ${(err as Error).message}`);
    }
  };

  const selectedTrack = tracks.find((t) => t.name === trackName);
  const mismatchedLaps = selectedTrack
    ? [baseLap, compareLap].filter(
        (lap) => lap && lap.trackName.toLowerCase() !== selectedTrack.fileName.toLowerCase()
      )
    : [];

  const analyzeLaps = async () => {
    if (!baseLap || !compareLap) return;
    setAnalyzing(true);
    setAreaRows([]);
    try {
      const baseSeconds = lapTimeToSeconds(baseLap.lapTime);
      const compareSeconds = lapTimeToSeconds(compareLap.lapTime);
      const lines = [
        `Base lap: ${formatLapTime(baseLap.lapTime)} (${baseLap.driverName}, ${baseLap.carName})`,
        `Compare lap: ${formatLapTime(compareLap.lapTime)} (${compareLap.driverName}, ${compareLap.carName}) (${formatSecondsDiff(
          compareSeconds - baseSeconds
        )})`,
        '',
      ];

      if (!selectedTrack || selectedTrack.areas.length === 0) {
        lines.push('No focus areas for the selected track.');
      } else if (mismatchedLaps.length > 0) {
        lines.push(`Both laps must be from ${selectedTrack.fileName}.`);
      } else {
        const [baseSamples, compareSamples] = await Promise.all([
          readLapSamples(baseLap.file),
          readLapSamples(compareLap.file),
        ]);
        lines.push(`Focus areas (${selectedTrack.fileName}):`, '');
        const areasStart = lines.length;
        const rows: AreaRow[] = [];
        const advice: string[] = [];

        // Each focus area gets a line (plus a blank line after it) and a table row
        for (const area of selectedTrack.areas) {
          if (area.start === null || area.end === null) {
            const note = 'missing start/end in Track Management';
            lines.push(`${area.name}: ${note}`, '');
            rows.push({ name: area.name, comparison: null, note });
            continue;
          }
          const base = areaStats(baseSamples, baseSeconds, area.start, area.end);
          const compare = areaStats(compareSamples, compareSeconds, area.start, area.end);
          if (base && compare) {
            const comparison = compareArea(base, compare, selectedTrack.lengthFeet);
            lines.push(formatAreaLine(area.name, comparison, selectedTrack.lengthFeet), '');
            rows.push({ name: area.name, comparison, note: '' });
            advice.push(formatAreaAdvice(area.name, comparison));
          } else {
            const note = `no data for the ${!base ? 'Base' : 'Compare'} lap`;
            lines.push(`${area.name}: ${note}`, '');
            rows.push({ name: area.name, comparison: null, note });
          }
        }
        setAreaRows(rows);

        // Show the focus areas right away, then add the coaching summary below them
        setAnalysis(`${lines.join('\n').trimEnd()}\n\nSummary: writing…`);
        const summary = await fetchSummary(
          [lines.slice(areasStart).join('\n').trim(), '', 'Braking advice (follow exactly):', ...advice].join('\n'),
          selectedTrack.fileName
        );
        lines.push('Summary:', summary);
      }

      setAnalysis(lines.join('\n').trimEnd());
    } catch (err) {
      setAnalysis(`Error analyzing laps: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 space-y-6">
      <div>
        <label htmlFor="compare-track-name" className="block text-sm font-medium text-dark-blue mb-2">
          Track Name
        </label>
        <select
          id="compare-track-name"
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
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <LapUploader
        id="base-lap-file"
        title="Base Lap"
        prompt="Upload a Base lap CSV file"
        lap={baseLap}
        error={baseError}
        onFiles={(files) => void handleFiles(files, setBaseLap, setBaseError)}
        onRemove={() => setBaseLap(null)}
      />

      <LapUploader
        id="compare-lap-file"
        title="Compare Lap"
        prompt="Upload a Compare lap CSV file"
        lap={compareLap}
        error={compareError}
        onFiles={(files) => void handleFiles(files, setCompareLap, setCompareError)}
        onRemove={() => setCompareLap(null)}
      />

      {mismatchedLaps.length > 0 && (
        <div className="px-4 py-3 rounded-lg border text-sm bg-yellow-50 border-yellow-200 text-yellow-900">
          {mismatchedLaps.length === 1 ? 'One uploaded lap is' : 'Both uploaded laps are'} not from{' '}
          {selectedTrack?.fileName}.
        </div>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void analyzeLaps()}
          disabled={!baseLap || !compareLap || analyzing}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-powder-500 to-powder-600 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? 'Analyzing…' : 'Analyze Laps'}
        </button>

        {areaRows.length > 0 && <AreaTable rows={areaRows} />}

        <div>
          <label htmlFor="lap-compare-analysis" className="block text-sm font-medium text-dark-blue mb-2">
            Analysis
          </label>
          <textarea
            id="lap-compare-analysis"
            value={analysis}
            readOnly
            rows={12}
            placeholder={
              !baseLap || !compareLap ? 'Upload a Base lap and a Compare lap, then press Analyze Laps.' : 'Press Analyze Laps.'
            }
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </div>
      </div>
    </div>
  );
}
