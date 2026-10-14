'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import PedalTraces, { type PedalTraceLap } from '@/components/PedalTraces';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import { measureDrivingLine, type LapDrivingLine } from '@/lib/lapDrivingLine';
import {
  areaStats,
  areaTrace,
  brakeFeet,
  formatLapTime,
  formatSize,
  lapFileErrorText,
  lapTimeToSeconds,
  parseLapFile,
  readLapSamples,
  sameTrackName,
  type AreaStats,
  type LapFile,
  type Track,
} from '@/lib/lapData';
import { useUnits } from '@/components/UnitsProvider';
import { DISTANCE_UNIT, distanceFromFeet, SPEED_UNIT, speedFromMetersPerSecond, type Units } from '@/lib/units';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

type Words = Dictionary['lapCompare'];

// The comparison lines and braking advice are only read by the summary's AI, which is told the
// user's language separately, so they're always written in English
const ENGLISH_DIFF_WORDS = {
  same: 'same',
  distanceLater: '{n} {unit} later',
  distanceEarlier: '{n} {unit} earlier',
  pctHarder: '{n}% harder',
  pctLighter: '{n}% lighter',
};
type DiffWords = typeof ENGLISH_DIFF_WORDS;

// 1234.5 -> "1,235" (or "1.235" in Portuguese and Spanish); the distance is already in the user's units
function formatDistance(distance: number, locale = 'en-US') {
  return Math.round(distance).toLocaleString(locale);
}

// One lap through one focus area in words, the text version of its pedal trace chart
function pedalSummary(stats: AreaStats, lengthFeet: number | null, t: Words, locale: string, units: Units) {
  const where = (pct: number) =>
    lengthFeet
      ? fmt(t.distanceWhere, {
          n: formatDistance(distanceFromFeet(brakeFeet(pct, lengthFeet), units), locale),
          unit: DISTANCE_UNIT[units],
        })
      : fmt(t.pctOfLap, { n: ((((pct % 1) + 1) % 1) * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  const braking =
    stats.brakePct === null ? t.noBraking : fmt(t.brakesAt, { where: where(stats.brakePct), max: Math.round(stats.maxBrake * 100) });
  const throttle = stats.throttlePct === null ? t.noThrottle : fmt(t.throttleAt, { where: where(stats.throttlePct) });
  return `${braking}, ${throttle}.`;
}

// 0.12 -> "+0.120", -0.05 -> "-0.050"
function formatSecondsDiff(diff: number, locale = 'en-US') {
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false })}`;
}

// Compare brakepoint minus Base brakepoint, in feet. Positive = Compare brakes later.
// Uses the rounded feet shown on the line so the numbers add up, wrapped to
// +/- half a lap so an area crossing the start/finish line compares correctly.
function brakeDiffFeet(basePct: number, comparePct: number, lengthFeet: number) {
  const diff = brakeFeet(comparePct, lengthFeet) - brakeFeet(basePct, lengthFeet);
  return diff - Math.round(diff / lengthFeet) * lengthFeet;
}

// One focus area's numbers for both laps; each diff is Compare minus Base. Brakepoints are in the
// user's units (feet or meters) and speeds too (mph or kph).
// Brakepoints are null when that lap didn't brake (or the track has no length).
type AreaComparison = {
  baseSeconds: number;
  compareSeconds: number;
  secondsDiff: number;
  baseBrake: number | null;
  compareBrake: number | null;
  brakeDiff: number | null; // Positive = Compare brakes later
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
function compareArea(base: AreaStats, compare: AreaStats, lengthFeet: number | null, units: Units): AreaComparison {
  const toDistance = (brakePct: number | null) =>
    brakePct === null || !lengthFeet ? null : distanceFromFeet(brakeFeet(brakePct, lengthFeet), units);
  const toSpeed = (metersPerSecond: number) => Math.round(speedFromMetersPerSecond(metersPerSecond, units));

  const basePressure = Math.round(base.maxBrake * 100);
  const comparePressure = Math.round(compare.maxBrake * 100);
  const baseEntry = toSpeed(base.entrySpeed);
  const compareEntry = toSpeed(compare.entrySpeed);
  const baseMin = toSpeed(base.minSpeed);
  const compareMin = toSpeed(compare.minSpeed);
  const baseExit = toSpeed(base.exitSpeed);
  const compareExit = toSpeed(compare.exitSpeed);

  return {
    baseSeconds: base.seconds,
    compareSeconds: compare.seconds,
    secondsDiff: compare.seconds - base.seconds,
    baseBrake: toDistance(base.brakePct),
    compareBrake: toDistance(compare.brakePct),
    brakeDiff:
      base.brakePct !== null && compare.brakePct !== null && lengthFeet
        ? Math.round(distanceFromFeet(brakeDiffFeet(base.brakePct, compare.brakePct, lengthFeet), units))
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

// 150 -> "150 ft later" (or "150 m later"), 0 -> "same"
function formatBrakeDiff(diff: number, units: Units, words: DiffWords = ENGLISH_DIFF_WORDS, locale = 'en-US') {
  return diff === 0
    ? words.same
    : fmt(diff > 0 ? words.distanceLater : words.distanceEarlier, {
        n: formatDistance(Math.abs(diff), locale),
        unit: DISTANCE_UNIT[units],
      });
}

// 3 -> "3% harder", 0 -> "same"
function formatPressureDiff(diff: number, words: DiffWords = ENGLISH_DIFF_WORDS) {
  return diff === 0 ? words.same : fmt(diff > 0 ? words.pctHarder : words.pctLighter, { n: Math.abs(diff) });
}

// 3 -> "+3", -2 -> "-2"
function formatSignedDiff(diff: number) {
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff)}`;
}

// "T 7: Base 8.345 s, Compare 8.465 s (+0.120).  Base brake 4,345 ft at 65%, Compare brake
// 4,495 ft (150 ft later) at 68% (3% harder).  Base exit 98 mph, Compare exit 101 mph (+3 mph)."
// In meters and kph for Metric.
function formatAreaLine(areaName: string, c: AreaComparison, lengthFeet: number | null, units: Units) {
  const unit = DISTANCE_UNIT[units];
  const speed = SPEED_UNIT[units];
  const brakeAt = (distance: number | null) => {
    if (distance !== null) return `${formatDistance(distance)} ${unit}`;
    return lengthFeet ? 'no braking' : `n/a ${unit} (no TrackLengthInFeet)`;
  };
  const brakepointDiff = c.brakeDiff === null ? '' : ` (${formatBrakeDiff(c.brakeDiff, units)})`;

  return (
    `${areaName}: Base ${c.baseSeconds.toFixed(3)} s, Compare ${c.compareSeconds.toFixed(3)} s (${formatSecondsDiff(c.secondsDiff)}).  ` +
    `Base brake ${brakeAt(c.baseBrake)} at ${c.basePressure}%, ` +
    `Compare brake ${brakeAt(c.compareBrake)}${brakepointDiff} at ${c.comparePressure}% (${formatPressureDiff(c.pressureDiff)}).  ` +
    `Base entry ${c.baseEntry} ${speed}, Compare entry ${c.compareEntry} ${speed} (${formatSignedDiff(c.entryDiff)} ${speed}).  ` +
    `Base Min speed ${c.baseMin} ${speed}, Compare Min speed ${c.compareMin} ${speed} (${formatSignedDiff(c.minDiff)} ${speed}).  ` +
    `Base exit ${c.baseExit} ${speed}, Compare exit ${c.compareExit} ${speed} (${formatSignedDiff(c.exitDiff)} ${speed}).`
  );
}

// Brakepoints within this many feet (3 m), or peak pressures within this many %, count as the same
const SAME_BRAKE_FEET = 10;
const ADVICE_PRESSURE_PCT = 3;

// Which way the Compare lap should change its braking in an area, decided here rather than by the
// model so "later"/"earlier" and "harder"/"lighter" can't get flipped. Only sent to the summary.
function formatAreaAdvice(areaName: string, c: AreaComparison, units: Units) {
  if (c.secondsDiff <= 0) {
    return `${areaName} advice: the Compare lap was faster here, so it should keep its braking; do not tell it to copy the Base lap.`;
  }
  const changes = [];
  if (c.brakeDiff !== null && Math.abs(c.brakeDiff) >= distanceFromFeet(SAME_BRAKE_FEET, units)) {
    // Compare braked earlier (negative diff) -> brake later, and vice versa
    changes.push(
      `brake ${formatDistance(Math.abs(c.brakeDiff))} ${DISTANCE_UNIT[units]} ${c.brakeDiff < 0 ? 'LATER' : 'EARLIER'}`
    );
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

// A table row: the comparison, or why there isn't one (in the user's language)
type AreaRow = { name: string; comparison: AreaComparison | null; note: string };

// Diff cell background: green when the Compare lap is better, red when worse.
// A difference of more than 1% of the Base value gets the stronger green, and the
// dark red (the fainter red reads darker on the dark page). `diff` is the value
// as shown, so a displayed zero stays uncolored.
function diffBackground(diff: number, base: number, higherIsBetter: boolean) {
  if (diff === 0) return '';
  const bigger = base !== 0 && Math.abs(diff) / Math.abs(base) > 0.01;
  if (diff > 0 === higherIsBetter) return bigger ? 'bg-positive/35' : 'bg-positive/15';
  return bigger ? 'bg-primary/15' : 'bg-primary/35';
}

// Brake Diff text: blue when the Compare lap is more than `threshold` below Base
// (brakes earlier / lighter), red when more than `threshold` above (later / harder),
// green when within `threshold` either way
function brakeDiffText(diff: number | null, threshold: number) {
  if (diff === null) return '';
  if (diff < -threshold) return 'text-sky-400';
  if (diff > threshold) return 'text-primary';
  return 'text-positive';
}

// Focus areas down the left, Base / Compare / Diff for each data point across the top
// (Max Brake shows Base and Diff; everything else shows only its Diff)
function AreaTable({ rows }: { rows: AreaRow[] }) {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const speed = SPEED_UNIT[units];
  const t = dictionary.lapCompare;
  const groups = [
    { label: t.groups.time, columns: ['diff'] },
    { label: t.groups.brakepoint, columns: ['diff'] },
    { label: t.groups.maxBrake, columns: ['base', 'diff'] },
    { label: t.groups.entrySpeed, columns: ['diff'] },
    { label: t.groups.minSpeed, columns: ['diff'] },
    { label: t.groups.exitSpeed, columns: ['diff'] },
  ] as const;
  const columnCount = groups.reduce((sum, group) => sum + group.columns.length, 0);
  const cell = 'px-3 py-2 text-right whitespace-nowrap';
  const groupStart = 'border-l border-border';

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-sm text-foreground">
        <thead className="bg-secondary">
          <tr>
            <th rowSpan={2} className="sticky left-0 bg-secondary px-3 py-2 text-left align-bottom">
              {t.focusArea}
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
          <tr className="text-xs text-muted-foreground">
            {groups.map((group) =>
              group.columns.map((column, i) => (
                <th
                  key={group.label + column}
                  className={`px-3 py-2 whitespace-nowrap font-medium ${column === 'diff' ? 'text-center' : 'text-right'} ${
                    i === 0 ? groupStart : ''
                  }`}
                >
                  {t[column]}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ name, comparison: c, note }) => (
            <tr key={name}>
              <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-semibold whitespace-nowrap">
                {name}
              </th>
              {!c ? (
                <td colSpan={columnCount} className={`${groupStart} px-3 py-2 text-muted-foreground`}>
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
                    {formatSecondsDiff(c.secondsDiff, locale)} s
                  </td>

                  <td className={`${cell} ${groupStart} ${brakeDiffText(c.brakeDiff, distanceFromFeet(SAME_BRAKE_FEET, units))}`}>
                    {c.brakeDiff === null ? '—' : formatBrakeDiff(c.brakeDiff, units, t, locale)}
                  </td>

                  <td className={`${cell} ${groupStart}`}>{c.basePressure}%</td>
                  <td className={`${cell} ${brakeDiffText(c.pressureDiff, 3)}`}>{formatPressureDiff(c.pressureDiff, t)}</td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.entryDiff, c.baseEntry, true)}`}>
                    {formatSignedDiff(c.entryDiff)} {speed}
                  </td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.minDiff, c.baseMin, true)}`}>
                    {formatSignedDiff(c.minDiff)} {speed}
                  </td>

                  <td className={`${cell} ${groupStart} ${diffBackground(c.exitDiff, c.baseExit, true)}`}>
                    {formatSignedDiff(c.exitDiff)} {speed}
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

// Asks the server for a 6-7 sentence coaching summary written for the Compare lap. lines are the focus
// areas' driving lines for the coach's analyze_driving_line tool, and areaNames every focus area's name.
async function fetchSummary(comparison: string, track: string, lines: LapDrivingLine[], areaNames: string[], t: Dictionary) {
  try {
    const res = await fetch('/api/lap-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comparison, track, lines, areaNames }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t.lapCompare.failedSummary);
    return data.summary as string;
  } catch (err) {
    return fmt(t.lapCompare.summaryUnavailable, { error: err instanceof Error ? err.message : t.common.unknownError });
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
  const { t, fmt: format } = useLanguage();
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-2">
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
          dragging ? 'border-primary bg-accent' : 'border-border bg-card'
        }`}
      >
        <div className="text-sm text-muted-foreground text-center sm:text-left">
          <p className="font-medium text-foreground">{prompt}</p>
          <p>{t.lapCompare.dropOne}</p>
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
        <div className="mt-2 px-4 py-3 rounded-lg border text-sm whitespace-pre-wrap bg-primary/10 border-primary/40 text-red-300">
          {error}
        </div>
      )}

      {lap && (
        <div className="mt-2 flex items-center justify-between px-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground">
          <span className="min-w-0 truncate">
            📄 {lap.driverName} • {lap.carName} • {lap.trackName} •{' '}
            <span className="font-semibold">{formatLapTime(lap.lapTime)}</span>{' '}
            <span className="text-muted-foreground">{formatSize(lap.file.size)}</span>
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={format(t.laps.removeFile, { name: lap.file.name })}
            className="ml-3 text-muted-foreground hover:text-primary"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// initialLaps: laps to start with, e.g. two recorded laps sent from Debrief Coach's Compare button
export default function LapCompare({ initialLaps = null }: { initialLaps?: { base: LapFile; compare: LapFile } | null }) {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.lapCompare;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackName, setTrackName] = useState('');
  const [error, setError] = useState('');
  const [baseLap, setBaseLap] = useState<LapFile | null>(initialLaps?.base ?? null);
  const [compareLap, setCompareLap] = useState<LapFile | null>(initialLaps?.compare ?? null);
  const [baseError, setBaseError] = useState('');
  const [compareError, setCompareError] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);
  // Brake/throttle charts for every measured focus area, in track order; diff is Compare minus Base (s)
  const [traces, setTraces] = useState<
    { name: string; diff: number; base: PedalTraceLap; compare: PedalTraceLap }[]
  >([]);
  const [analyzing, setAnalyzing] = useState(false);

  // Starts on the initial laps' track when there are any, otherwise the first track
  const initialTrack = initialLaps?.base.trackName;
  useEffect(() => {
    fetch('/api/track-names')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || dictionary.laps.failedTrackNames);
        const tracks: Track[] = data.tracks;
        setTracks(tracks);
        const match = initialTrack ? tracks.find((track) => sameTrackName(track.fileName, initialTrack)) : undefined;
        if (match) setTrackName(match.name);
        else if (tracks.length > 0) setTrackName(tracks[0].name);
      })
      .catch((err: Error) => setError(err.message));
  }, [initialTrack, dictionary]);

  // Validates a drop/browse into one uploader and stores the lap if it's good
  const handleFiles = async (
    fileList: FileList | null | undefined,
    setLap: (lap: LapFile) => void,
    setLapError: (message: string) => void
  ) => {
    if (!fileList || fileList.length === 0) return;
    if (fileList.length > 1) {
      setLapError(fmt(t.onlyOne, { n: fileList.length }));
      return;
    }

    try {
      const lap = await parseLapFile(fileList[0]);
      // Select the track matching the uploaded file's track name
      const match = tracks.find((track) => sameTrackName(track.fileName, lap.trackName));
      if (match) setTrackName(match.name);
      setLapError(match ? '' : fmt(dictionary.laps.noSuchTrack, { track: lap.trackName }));
      setLap(lap);
    } catch (err) {
      setLapError(fmt(dictionary.laps.fileError, { name: fileList[0].name, error: lapFileErrorText(err, dictionary.laps.errors) }));
    }
  };

  // The focus area where the Compare lap loses the most time; its pedal traces start open
  const worstTraceIndex = traces.reduce((worst, trace, i) => (trace.diff > traces[worst].diff ? i : worst), 0);

  const selectedTrack = tracks.find((track) => track.name === trackName);
  const mismatchedLaps = selectedTrack
    ? [baseLap, compareLap].filter(
        (lap) => lap && !sameTrackName(lap.trackName, selectedTrack.fileName)
      )
    : [];

  const analyzeLaps = async () => {
    if (!baseLap || !compareLap) return;
    setAnalyzing(true);
    setAreaRows([]);
    setTraces([]);
    try {
      const baseSeconds = lapTimeToSeconds(baseLap.lapTime);
      const compareSeconds = lapTimeToSeconds(compareLap.lapTime);
      // One line per focus area: what the summary is written from
      const lines: string[] = [];

      // Only the coach's summary is shown (the focus areas are in the table); the lines below are what
      // the summary is written from
      if (!selectedTrack || selectedTrack.areas.length === 0) {
        setAnalysis(t.noFocusAreas);
      } else if (mismatchedLaps.length > 0) {
        setAnalysis(fmt(t.bothFrom, { track: selectedTrack.fileName }));
      } else {
        const [baseSamples, compareSamples] = await Promise.all([
          readLapSamples(baseLap.file),
          readLapSamples(compareLap.file),
        ]);
        const rows: AreaRow[] = [];
        const advice: string[] = [];
        const areaTraces: typeof traces = [];
        const drivingLines: LapDrivingLine[] = [];
        const lapTitle = (title: string, lap: LapFile) => fmt(title, { time: formatLapTime(lap.lapTime) });

        // Each focus area gets a line (plus a blank line after it) and a table row
        for (const area of selectedTrack.areas) {
          if (area.start === null || area.end === null) {
            lines.push(`${area.name}: missing start/end in Track Data`, '');
            rows.push({ name: area.name, comparison: null, note: t.missingStartEnd });
            continue;
          }
          const base = areaStats(baseSamples, baseSeconds, area.start, area.end);
          const compare = areaStats(compareSamples, compareSeconds, area.start, area.end);
          if (base && compare) {
            const comparison = compareArea(base, compare, selectedTrack.lengthFeet, units);
            lines.push(formatAreaLine(area.name, comparison, selectedTrack.lengthFeet, units), '');
            rows.push({ name: area.name, comparison, note: '' });
            advice.push(formatAreaAdvice(area.name, comparison, units));
            const baseTrace = areaTrace(baseSamples, baseSeconds, area.start, area.end);
            const compareTrace = areaTrace(compareSamples, compareSeconds, area.start, area.end);
            if (baseTrace && compareTrace) {
              const line = measureDrivingLine(area.name, comparison.secondsDiff, baseTrace, compareTrace);
              if (line) drivingLines.push(line);
              areaTraces.push({
                name: area.name,
                diff: comparison.secondsDiff,
                base: {
                  title: lapTitle(t.lapTitleBase, baseLap),
                  trace: baseTrace,
                  summary: pedalSummary(base, selectedTrack.lengthFeet, t, locale, units),
                },
                compare: {
                  title: lapTitle(t.lapTitleCompare, compareLap),
                  trace: compareTrace,
                  summary: pedalSummary(compare, selectedTrack.lengthFeet, t, locale, units),
                },
              });
            }
          } else {
            lines.push(`${area.name}: no data for the ${!base ? 'Base' : 'Compare'} lap`, '');
            rows.push({ name: area.name, comparison: null, note: !base ? t.noDataBase : t.noDataCompare });
          }
        }
        setAreaRows(rows);
        setTraces(areaTraces);

        // The table shows right away; the summary follows once the coach has written it
        setAnalysis(t.writing);
        const summary = await fetchSummary(
          [lines.join('\n').trim(), '', 'Braking advice (follow exactly):', ...advice].join('\n'),
          selectedTrack.fileName,
          drivingLines,
          selectedTrack.areas.map((a) => a.name),
          dictionary
        );
        setAnalysis(summary.trim());
      }
    } catch (err) {
      setAnalysis(fmt(t.errorAnalyzing, { error: err instanceof Error ? err.message : dictionary.common.unknownError }));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      <div>
        <label htmlFor="compare-track-name" className="block text-sm font-medium text-foreground mb-2">
          {dictionary.laps.trackName}
        </label>
        <select
          id="compare-track-name"
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

      <LapUploader
        id="base-lap-file"
        title={t.baseLap}
        prompt={t.uploadBase}
        lap={baseLap}
        error={baseError}
        onFiles={(files) => void handleFiles(files, setBaseLap, setBaseError)}
        onRemove={() => setBaseLap(null)}
      />

      <LapUploader
        id="compare-lap-file"
        title={t.compareLap}
        prompt={t.uploadCompare}
        lap={compareLap}
        error={compareError}
        onFiles={(files) => void handleFiles(files, setCompareLap, setCompareError)}
        onRemove={() => setCompareLap(null)}
      />

      {mismatchedLaps.length > 0 && (
        <div className="px-4 py-3 rounded-lg border text-sm bg-yellow-500/10 border-yellow-500/40 text-yellow-200">
          {fmt(mismatchedLaps.length === 1 ? t.oneNotFrom : t.bothNotFrom, { track: selectedTrack?.fileName ?? '' })}
        </div>
      )}

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => void analyzeLaps()}
          disabled={!baseLap || !compareLap || analyzing}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? t.analyzing : t.analyze}
        </button>

        {areaRows.length > 0 && <AreaTable rows={areaRows} />}

        <div>
          <label htmlFor="lap-compare-analysis" className="block text-sm font-medium text-foreground mb-2">
            {t.summary}
          </label>
          <textarea
            id="lap-compare-analysis"
            value={analysis}
            readOnly
            rows={12}
            placeholder={!baseLap || !compareLap ? t.summaryPlaceholderNoLaps : t.summaryPlaceholder}
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </div>

        {traces.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">{t.pedalTraces}</h3>
            <p className="text-xs text-muted-foreground">{t.pedalTracesIntro}</p>
            {traces.map((area, index) => {
              const isWorst = index === worstTraceIndex && area.diff > 0;
              return (
                <details key={area.name} open={isWorst} className="bg-card border border-border rounded-lg">
                  <summary className="cursor-pointer px-4 py-3 text-sm">
                    <span className="font-semibold text-foreground">{area.name}</span>
                    <span className="text-muted-foreground">
                      {' • '}
                      {area.diff === 0
                        ? t.compareLapSame
                        : fmt(area.diff > 0 ? t.compareLapSlower : t.compareLapFaster, {
                            seconds: Math.abs(area.diff).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                          })}
                    </span>
                    {isWorst && (
                      <span className="ml-2 px-1.5 rounded text-xs bg-primary/15 text-red-300">{t.mostTimeLost}</span>
                    )}
                  </summary>
                  <div className="px-4 pb-4">
                    <PedalTraces
                      id={`pedal-${index}`}
                      lengthFeet={selectedTrack?.lengthFeet ?? null}
                      base={area.base}
                      compare={area.compare}
                    />
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
