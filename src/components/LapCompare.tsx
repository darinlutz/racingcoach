'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import FocusAreaTabs, { areaDiffText, areaTint, formatAreaSeconds } from '@/components/FocusAreaTabs';
import type { Tab as LapDataTab } from '@/components/LapDataTabs';
import LapDeltaMap, { type DeltaMapArea } from '@/components/LapDeltaMap';
import PedalTraces, { type PedalTraceLap } from '@/components/PedalTraces';
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from '@/components/TelemetryCursor';
import SummaryPanel from '@/components/SummaryPanel';
import ThinkingProgress from '@/components/ThinkingProgress';
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
  type LapSamples,
  sameTrackName,
  type AreaStats,
  type LapFile,
  type Track,
} from '@/lib/lapData';
import { useUnits } from '@/components/UnitsProvider';
import { DISTANCE_UNIT, distanceFromFeet, roundBrakeChange, SPEED_UNIT, speedFromMetersPerSecond, type Units } from '@/lib/units';
import { reportRateLimit } from '@/lib/rateLimitClient';

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

// 1234.5 -> "1,235" (or "1.235" in Portuguese, Spanish and German); the distance is already in the user's units
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

// Compare brakepoint minus Target brakepoint, in feet. Positive = Compare brakes later.
// Uses the rounded feet shown on the line so the numbers add up, wrapped to
// +/- half a lap so an area crossing the start/finish line compares correctly.
function brakeDiffFeet(basePct: number, comparePct: number, lengthFeet: number) {
  const diff = brakeFeet(comparePct, lengthFeet) - brakeFeet(basePct, lengthFeet);
  return diff - Math.round(diff / lengthFeet) * lengthFeet;
}

// One focus area's numbers for both laps; each diff is Compare minus Target. Brakepoints are in the
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

// A speed Diff cell: "+3 mph", or "—" when the laps match, like the table's other empty cells
function formatSpeedDiffCell(diff: number, speed: string) {
  return diff === 0 ? '—' : `${formatSignedDiff(diff)} ${speed}`;
}

// "T 7: Target 8.345 s, Compare 8.465 s (+0.120).  Target brakes (the reference brakepoint) at 65% peak, Compare
// brakes 150 ft later than Target at 68% (3% harder).  Target exit 98 mph, Compare exit 101 mph (+3 mph)."
// In meters and kph for Metric. Only for the summary's AI, so the brakepoints are against the Target lap's, never
// where on the track: it can't repeat a place on the track it never sees (src/lib/trackPositions.ts).
function formatAreaLine(areaName: string, c: AreaComparison, lengthFeet: number | null, units: Units) {
  const speed = SPEED_UNIT[units];
  const noBrake = lengthFeet ? 'no braking' : 'brakepoint unknown (track length unknown)';
  const baseBrake = c.baseBrake === null ? noBrake : 'brakes (the reference brakepoint)';
  const compareBrake =
    c.compareBrake === null
      ? noBrake
      : c.brakeDiff === null
        ? 'brakes (the Target lap did not brake)'
        : c.brakeDiff === 0
          ? 'brakes at the same point as Target'
          : `brakes ${formatBrakeDiff(c.brakeDiff, units)} than Target`;

  return (
    `${areaName}: Target ${c.baseSeconds.toFixed(3)} s, Compare ${c.compareSeconds.toFixed(3)} s (${formatSecondsDiff(c.secondsDiff)}).  ` +
    `Target ${baseBrake} at ${c.basePressure}% peak, ` +
    `Compare ${compareBrake} at ${c.comparePressure}% (${formatPressureDiff(c.pressureDiff)}).  ` +
    `Target entry ${c.baseEntry} ${speed}, Compare entry ${c.compareEntry} ${speed} (${formatSignedDiff(c.entryDiff)} ${speed}).  ` +
    `Target Min speed ${c.baseMin} ${speed}, Compare Min speed ${c.compareMin} ${speed} (${formatSignedDiff(c.minDiff)} ${speed}).  ` +
    `Target exit ${c.baseExit} ${speed}, Compare exit ${c.compareExit} ${speed} (${formatSignedDiff(c.exitDiff)} ${speed}).`
  );
}

// Brakepoints within this many feet (3 m), or peak pressures within this many %, count as the same
const SAME_BRAKE_FEET = 10;
const ADVICE_PRESSURE_PCT = 3;

// Which way the Compare lap should change its braking in an area, decided here rather than by the
// model so "later"/"earlier" and "harder"/"lighter" can't get flipped. Only sent to the summary.
function formatAreaAdvice(areaName: string, c: AreaComparison, units: Units) {
  if (c.secondsDiff <= 0) {
    return `${areaName} advice: the Compare lap was faster here, so it should keep its braking; do not tell it to copy the Target lap.`;
  }
  const changes = [];
  if (c.brakeDiff !== null && Math.abs(c.brakeDiff) >= distanceFromFeet(SAME_BRAKE_FEET, units)) {
    // Compare braked earlier (negative diff) -> brake later, and vice versa
    // Rounded as the coach says it: feet to the nearest 5
    changes.push(
      `brake ${formatDistance(roundBrakeChange(Math.abs(c.brakeDiff), units))} ${DISTANCE_UNIT[units]} ${c.brakeDiff < 0 ? 'LATER' : 'EARLIER'}`
    );
  }
  if (Math.abs(c.pressureDiff) >= ADVICE_PRESSURE_PCT) {
    changes.push(
      `use ${c.pressureDiff < 0 ? 'MORE' : 'LESS'} peak brake pressure (${c.pressureDiff < 0 ? 'harder' : 'lighter'}, ` +
        `about ${c.basePressure}% instead of ${c.comparePressure}%)`
    );
  }
  return changes.length > 0
    ? `${areaName} advice: to match the faster Target lap, the Compare lap should ${changes.join(' and ')}.`
    : `${areaName} advice: braking is about the same on both laps, so the time is in the speeds; do not give braking advice here.`;
}

// How many of the areas where the Compare lap lost the most time the summary must cover
const TOP_LOSSES = 3;

// The areas where the Compare lap lost the most time, most first, ranked here rather than by the model
// so it can't miss the biggest one. Only sent to the summary.
function formatTopLosses(areas: { name: string; secondsDiff: number }[]) {
  const losses = areas
    .filter((area) => area.secondsDiff > 0)
    .sort((a, b) => b.secondsDiff - a.secondsDiff)
    .slice(0, TOP_LOSSES);
  if (losses.length === 0) return 'Biggest losses: none, the Compare lap was as fast or faster in every focus area.';
  return (
    'Biggest losses (most time lost first; the summary must cover these, starting with the first): ' +
    losses.map((area) => `${area.name} ${formatSecondsDiff(area.secondsDiff)} s`).join(', ') +
    '.'
  );
}

// The whole lap's [lat, lon] points for the track map, every few samples (a lap has thousands), or null
// when the lap file has no track positions (Garage 61 exports, or a live lap before its .ibt was read)
function lapPositions({ lats, lons }: LapSamples): [number, number][] | null {
  const step = Math.max(1, Math.floor(lats.length / 1500));
  const points: [number, number][] = [];
  for (let i = 0; i < lats.length; i += step) {
    if (Number.isFinite(lats[i]) && Number.isFinite(lons[i]) && (lats[i] !== 0 || lons[i] !== 0)) points.push([lats[i], lons[i]]);
  }
  return points.length > 10 ? points : null;
}

// A focus area's stretch of a Track Data outline (point i at LapDistPct i / its length), for laps without track
// positions. An area over the start/finish line has an end before its start (or past 1).
function outlineStretch(outline: [number, number][], start: number, end: number): [number, number][] | null {
  const n = outline.length;
  if (n < 2 || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const to = end < start ? end + 1 : end;
  const points: [number, number][] = [];
  for (let i = Math.ceil(start * n); i <= Math.floor(to * n); i++) points.push(outline[((i % n) + n) % n]);
  return points.length > 1 ? points : null;
}

// The track's outline from Track Data (its iRacing outline) by its key, or null without one
async function fetchTrackOutline(trackKey: string): Promise<[number, number][] | null> {
  try {
    const res = await fetch(`/api/live/outline?key=${encodeURIComponent(trackKey)}`);
    if (!res.ok) return null;
    const data: { track: { outline: { kind: string; points: [number, number][] } | null } | null } = await res.json();
    const outline = data.track?.outline;
    return outline?.kind === 'latlon' && outline.points.length > 10 ? outline.points : null;
  } catch {
    return null;
  }
}

// A table row: the comparison, or why there isn't one (in the user's language)
type AreaRow = { name: string; comparison: AreaComparison | null; note: string };

// Diff cell background: green when the Compare lap is better, red when worse.
// A difference of more than 1% of the Target value gets the darker green, and the
// dark red (the fainter red reads darker on the dark page). `diff` is the value
// as shown, so a displayed zero stays uncolored.
function diffBackground(diff: number, base: number, higherIsBetter: boolean) {
  if (diff === 0) return '';
  const bigger = base !== 0 && Math.abs(diff) / Math.abs(base) > 0.01;
  if (diff > 0 === higherIsBetter) return bigger ? 'bg-positive/15' : 'bg-positive/35';
  return bigger ? 'bg-primary/15' : 'bg-primary/35';
}

// Brake Diff text: blue when the Compare lap is more than `threshold` below Target
// (brakes earlier / lighter), red when more than `threshold` above (later / harder),
// green when within `threshold` either way
function brakeDiffText(diff: number | null, threshold: number) {
  if (diff === null) return '';
  if (diff < -threshold) return 'text-sky-400';
  if (diff > threshold) return 'text-primary';
  return 'text-positive';
}

// The selected row's emphasis: a sky blue line along its top and bottom (and the name's left), drawn inside the cells
// so their own colors stay as they are
const SELECTED_ROW_CELL = 'font-bold shadow-[inset_0_2px_0_0_rgb(14_165_233),inset_0_-2px_0_0_rgb(14_165_233)]';
const SELECTED_ROW_NAME =
  'shadow-[inset_0_2px_0_0_rgb(14_165_233),inset_0_-2px_0_0_rgb(14_165_233),inset_3px_0_0_0_rgb(14_165_233)]';

// Focus areas down the left, each named like the focus area tabs with the time the Compare lap lost or gained there
// beside it; Target / Diff for each data point across the top (Max Brake shows Target and Diff; everything else
// shows only its Diff). Clicking an area's row picks it, as the tabs and the map do; the picked one is emphasized.
function AreaTable({
  rows,
  selected,
  selectable,
  onSelect,
}: {
  rows: AreaRow[];
  selected: string | null;
  // The areas with telemetry to show (a row without its comparison can't be picked)
  selectable: string[];
  onSelect: (name: string) => void;
}) {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const speed = SPEED_UNIT[units];
  const t = dictionary.lapCompare;
  const largest = Math.max(...rows.map((row) => Math.abs(row.comparison?.secondsDiff ?? 0)), 0.001);
  const groups = [
    { label: t.groups.brakepoint, columns: ['diff'] },
    { label: t.groups.maxBrake, columns: ['base', 'diff'] },
    { label: t.groups.entrySpeed, columns: ['diff'] },
    { label: t.groups.minSpeed, columns: ['diff'] },
    { label: t.groups.exitSpeed, columns: ['diff'] },
  ] as const;
  const columnCount = groups.reduce((sum, group) => sum + group.columns.length, 0);
  // Sized to its content (not stretched across a wide screen), every value centered in its column
  const cell = 'min-w-[6.5rem] px-5 py-2.5 text-center tabular-nums whitespace-nowrap';
  const groupStart = 'border-l border-border';

  return (
    <div className="w-fit max-w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="text-[1.035rem] text-foreground">
        <thead className="bg-secondary">
          <tr>
            <th rowSpan={2} className="sticky left-0 bg-secondary px-5 py-2.5 text-left align-bottom">
              {t.focusArea}
            </th>
            {groups.map((group) => (
              <th
                key={group.label}
                colSpan={group.columns.length}
                className={`${groupStart} px-5 pt-3 pb-1 text-center whitespace-nowrap`}
              >
                {group.label}
              </th>
            ))}
          </tr>
          <tr className="text-[0.875em] text-muted-foreground">
            {groups.map((group) =>
              group.columns.map((column, i) => (
                <th
                  key={group.label + column}
                  className={`px-5 pt-1 pb-2.5 text-center whitespace-nowrap font-medium ${i === 0 ? groupStart : ''}`}
                >
                  {t[column]}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ name, comparison: c, note }) => {
            const canSelect = !!c && selectable.includes(name);
            const isSelected = canSelect && name === selected;
            const rowCell = isSelected ? SELECTED_ROW_CELL : '';
            const tint = c ? areaTint(c.secondsDiff, largest) : undefined;
            return (
              <tr
                key={name}
                onClick={canSelect ? () => onSelect(name) : undefined}
                className={canSelect ? 'cursor-pointer' : ''}
              >
                {/* Named like the focus area tabs, tinted by the time lost or gained, which is beside the name;
                    the tint is an image over the opaque background, which the sticky cell needs over scrolled cells */}
                <th
                  scope="row"
                  style={tint ? { backgroundImage: `linear-gradient(${tint}, ${tint})` } : undefined}
                  className={`sticky left-0 z-10 px-4 py-2 text-left whitespace-nowrap ${
                    `bg-card ${isSelected ? SELECTED_ROW_NAME : ''}`
                  }`}
                >
                  <button
                    type="button"
                    disabled={!canSelect}
                    aria-pressed={canSelect ? isSelected : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(name);
                    }}
                    className="flex items-baseline gap-2.5 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-default"
                  >
                    <span className="font-display text-[1.35rem] font-bold leading-none">{name}</span>
                    {c && (
                      <span
                        className={`font-display text-sm font-semibold leading-none tabular-nums ${
                          areaDiffText(Math.round(c.secondsDiff * 1000) / 1000)
                        }`}
                      >
                        {formatAreaSeconds(c.secondsDiff, locale)}
                      </span>
                    )}
                  </button>
                </th>
                {!c ? (
                  <td colSpan={columnCount} className={`${groupStart} px-5 py-2.5 text-muted-foreground`}>
                    {note}
                  </td>
                ) : (
                  <>
                    <td
                      className={`${cell} ${groupStart} ${rowCell} ${brakeDiffText(c.brakeDiff, distanceFromFeet(SAME_BRAKE_FEET, units))}`}
                    >
                      {c.brakeDiff === null ? '—' : formatBrakeDiff(c.brakeDiff, units, t, locale)}
                    </td>

                    <td className={`${cell} ${groupStart} ${rowCell}`}>{c.basePressure}%</td>
                    <td className={`${cell} ${rowCell} ${brakeDiffText(c.pressureDiff, 3)}`}>{formatPressureDiff(c.pressureDiff, t)}</td>

                    <td className={`${cell} ${groupStart} ${rowCell} ${diffBackground(c.entryDiff, c.baseEntry, true)}`}>
                      {formatSpeedDiffCell(c.entryDiff, speed)}
                    </td>

                    <td className={`${cell} ${groupStart} ${rowCell} ${diffBackground(c.minDiff, c.baseMin, true)}`}>
                      {formatSpeedDiffCell(c.minDiff, speed)}
                    </td>

                    <td className={`${cell} ${groupStart} ${rowCell} ${diffBackground(c.exitDiff, c.baseExit, true)}`}>
                      {formatSpeedDiffCell(c.exitDiff, speed)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Asks the server for a short coaching summary, a paragraph for each of 3 or 4 focus areas,
// written for the Compare lap. lines are the focus
// areas' driving lines for the coach's analyze_driving_line tool, and areaNames every focus area's name.
async function fetchSummary(comparison: string, track: string, lines: LapDrivingLine[], areaNames: string[], t: Dictionary) {
  try {
    const res = await fetch('/api/lap-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comparison, track, lines, areaNames }),
    });
    const data = await res.json();
    reportRateLimit(res, data);
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

// The top of what's in view on the page: just under the focus areas' header while it's pinned (large screens), else
// the window's top
function viewTopUnder(header: HTMLElement | null): number {
  return header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().bottom : 0;
}

// initialLaps: laps to start with, e.g. two recorded laps sent from Debrief Coach's Compare button. lapSummary: the
// user may ask for the AI summary (canUseLapSummary); otherwise (Bronze members) Provide summary is disabled, and
// hovering it says why. autoAnalyze: press Analyze Laps for the initial laps as soon as the tracks have loaded, with
// Provide summary checked when the user may have it; onAutoAnalyzed is called once it has started
export default function LapCompare({
  initialLaps = null,
  lapSummary = false,
  autoAnalyze = false,
  onAutoAnalyzed,
}: {
  initialLaps?: { base: LapFile; compare: LapFile } | null;
  lapSummary?: boolean;
  autoAnalyze?: boolean;
  onAutoAnalyzed?: () => void;
}) {
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
  // The whole lap's [lat, lon] points for the track map beside the table: the Target lap's, else the Compare lap's
  const [lapOutline, setLapOutline] = useState<[number, number][]>([]);
  // Neither lap has track positions (e.g. ACC laps of a track not placed yet, Garage 61 exports), so lapOutline is
  // the track's outline from Track Data, and each area is cut from it by where it is on the lap
  const [outlineFromTrack, setOutlineFromTrack] = useState(false);
  // Which Analyze Laps is the latest, so a track outline that arrives after another has started is dropped
  const analysisRun = useRef(0);
  // Brake/throttle charts for every measured focus area, in track order; diff is Compare minus Target (s)
  const [traces, setTraces] = useState<
    { name: string; diff: number; base: PedalTraceLap; compare: PedalTraceLap }[]
  >([]);
  const [analyzing, setAnalyzing] = useState(false);
  // Provide summary: off, Analyze Laps still measures every focus area but skips the AI summary
  const [provideSummary, setProvideSummary] = useState(autoAnalyze && lapSummary && initialLaps !== null);
  // The automatic Analyze Laps has run (a ref, so React's development double effects don't run it twice)
  const autoAnalyzed = useRef(false);
  // The focus area whose telemetry is shown, picked across the top
  const [selectedArea, setSelectedArea] = useState('');
  // The data tab under the charts (Balance, Engine, ...), kept when another focus area is picked; the leftmost first
  const [dataTab, setDataTab] = useState<LapDataTab>('slip');
  // The telemetry charts' toolbar, also kept when another focus area is picked
  const [chartSettings, setChartSettings] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  // Where the pinned playback controls go, under the focus areas, and the focus areas' header they're pinned in
  const [playbackSlot, setPlaybackSlot] = useState<HTMLDivElement | null>(null);
  const areaHeaderRef = useRef<HTMLDivElement>(null);
  // The chart wrapper under it, which stays mounted from area to area while the area's charts are remounted
  const areaContentRef = useRef<HTMLDivElement>(null);
  // What the user was looking at when another area was picked: the section ([data-scroll-anchor]) nearest above the
  // top of what's in view and how far from that top it was
  const keptScroll = useRef<{ anchor: string | null; offset: number } | null>(null);

  const selectArea = (name: string) => {
    if (name === selectedTrace?.name) return;
    const content = areaContentRef.current;
    if (content) {
      const top = viewTopUnder(areaHeaderRef.current);
      let anchor: string | null = null;
      let offset = -Infinity;
      for (const el of Array.from(content.querySelectorAll<HTMLElement>('[data-scroll-anchor]'))) {
        const below = el.getBoundingClientRect().top - top;
        if (below <= 1 && below > offset) [anchor, offset] = [el.dataset.scrollAnchor ?? null, below];
      }
      // The new area's charts mount empty and draw over a few frames; holding the old height meanwhile stops the
      // browser pulling the scroll position back towards the top
      content.style.minHeight = `${content.offsetHeight}px`;
      keptScroll.current = { anchor, offset };
    }
    setSelectedArea(name);
  };

  // For a second after the switch, while the new area's charts draw, keep that section where it was; then let the
  // area take its own height. Scrolling by hand ends it at once
  useEffect(() => {
    const content = areaContentRef.current;
    if (!keptScroll.current || !content) return;
    const finish = () => {
      keptScroll.current = null;
      content.style.minHeight = '';
    };
    const settleUntil = performance.now() + 1000;
    let frame = requestAnimationFrame(function follow(now) {
      const kept = keptScroll.current;
      if (!kept) return;
      const el = kept.anchor ? content.querySelector<HTMLElement>(`[data-scroll-anchor="${kept.anchor}"]`) : null;
      if (el) {
        const by = el.getBoundingClientRect().top - viewTopUnder(areaHeaderRef.current) - kept.offset;
        if (Math.abs(by) >= 1) window.scrollBy(0, by);
      }
      if (now < settleUntil) frame = requestAnimationFrame(follow);
      else finish();
    });
    const byHand = () => {
      cancelAnimationFrame(frame);
      finish();
    };
    window.addEventListener('wheel', byHand, { passive: true });
    window.addEventListener('touchmove', byHand, { passive: true });
    // Not finish(): picking another area meanwhile has already set up its own hold, which the next run follows
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', byHand);
      window.removeEventListener('touchmove', byHand);
    };
  }, [selectedArea]);

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

    // The input empties this list as soon as its change handler returns, so it's read before the first await
    const file = fileList[0];
    try {
      const lap = await parseLapFile(file);
      // Select the track matching the uploaded file's track name
      const match = tracks.find((track) => sameTrackName(track.fileName, lap.trackName));
      if (match) setTrackName(match.name);
      setLapError(match ? '' : fmt(dictionary.laps.noSuchTrack, { track: lap.trackName }));
      setLap(lap);
    } catch (err) {
      setLapError(fmt(dictionary.laps.fileError, { name: file.name, error: lapFileErrorText(err, dictionary.laps.errors) }));
    }
  };

  // The focus area where the Compare lap loses the most time
  const worstTraceIndex = traces.reduce((worst, trace, i) => (trace.diff > traces[worst].diff ? i : worst), 0);
  const selectedIndex = Math.max(0, traces.findIndex((trace) => trace.name === selectedArea));
  const selectedTrace = traces[selectedIndex];

  const selectedTrack = tracks.find((track) => track.name === trackName);
  const mismatchedLaps = selectedTrack
    ? [baseLap, compareLap].filter(
        (lap) => lap && !sameTrackName(lap.trackName, selectedTrack.fileName)
      )
    : [];
  // The track shown above the laps: the selected one, when a loaded lap is from it
  const lapsTrack = selectedTrack && mismatchedLaps.length < [baseLap, compareLap].filter(Boolean).length ? selectedTrack : undefined;

  // Each compared focus area's stretch on the track map, from the Target lap's positions there (the Compare
  // lap's when the Target lap has none)
  const deltaMapAreas: DeltaMapArea[] = traces.flatMap((trace) => {
    const comparison = areaRows.find((row) => row.name === trace.name)?.comparison;
    const area = selectedTrack?.areas.find((a) => a.name === trace.name);
    const positions =
      trace.base.trace.positions ??
      trace.compare.trace.positions ??
      (outlineFromTrack && area && area.start !== null && area.end !== null ? outlineStretch(lapOutline, area.start, area.end) : null);
    return comparison && positions
      ? [{ name: trace.name, positions, secondsDiff: comparison.secondsDiff, baseSeconds: comparison.baseSeconds }]
      : [];
  });

  const analyzeLaps = async () => {
    if (!baseLap || !compareLap) return;
    setAnalyzing(true);
    setAnalysis('');
    setAreaRows([]);
    setTraces([]);
    setLapOutline([]);
    setOutlineFromTrack(false);
    const run = ++analysisRun.current;
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
                  lapTime: formatLapTime(baseLap.lapTime),
                  lapSeconds: baseSeconds,
                  trace: baseTrace,
                  summary: pedalSummary(base, selectedTrack.lengthFeet, t, locale, units),
                  samples: baseSamples,
                },
                compare: {
                  title: lapTitle(t.lapTitleCompare, compareLap),
                  lapTime: formatLapTime(compareLap.lapTime),
                  lapSeconds: compareSeconds,
                  trace: compareTrace,
                  summary: pedalSummary(compare, selectedTrack.lengthFeet, t, locale, units),
                  samples: compareSamples,
                },
              });
            }
          } else {
            lines.push(`${area.name}: no data for the ${!base ? 'Target' : 'Compare'} lap`, '');
            rows.push({ name: area.name, comparison: null, note: !base ? t.noDataBase : t.noDataCompare });
          }
        }
        setAreaRows(rows);
        setTraces(areaTraces);
        const lapLine = lapPositions(baseSamples) ?? lapPositions(compareSamples);
        setLapOutline(lapLine ?? []);
        if (!lapLine) {
          // Without the laps' own positions, the map is drawn from the track's iRacing outline
          void fetchTrackOutline(selectedTrack.name).then((outline) => {
            if (!outline || run !== analysisRun.current) return;
            setLapOutline(outline);
            setOutlineFromTrack(true);
          });
        }
        const worst = areaTraces.reduce<(typeof areaTraces)[number] | null>(
          (w, trace) => (!w || trace.diff > w.diff ? trace : w),
          null
        );
        // Start on the area where the Compare lap loses the most time
        setSelectedArea(worst?.name ?? '');
        if (!provideSummary || !lapSummary) return;

        // The table shows right away; the summary follows once the coach has written it
        setAnalysis(t.writing);
        const summary = await fetchSummary(
          [
            lines.join('\n').trim(),
            '',
            formatTopLosses(rows.flatMap((row) => (row.comparison ? [{ name: row.name, secondsDiff: row.comparison.secondsDiff }] : []))),
            '',
            'Braking advice (follow exactly):',
            ...advice,
          ].join('\n'),
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

  // Laps sent from Debrief Coach's Compare buttons are analyzed straight away, once the tracks (and so the laps'
  // focus areas) have loaded
  const analyzeLapsRef = useRef(analyzeLaps);
  analyzeLapsRef.current = analyzeLaps;
  const tracksReady = tracks.length > 0 && trackName !== '';
  useEffect(() => {
    if (!autoAnalyze || autoAnalyzed.current || !tracksReady || !baseLap || !compareLap) return;
    autoAnalyzed.current = true;
    onAutoAnalyzed?.();
    void analyzeLapsRef.current();
  }, [autoAnalyze, tracksReady, baseLap, compareLap, onAutoAnalyzed]);

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {/* The Target and Compare laps set the track; nothing is shown until one is loaded */}
      {(baseLap || compareLap || error) && (
        <div>
          {(baseLap || compareLap) && (
            <div>
              <h2
                className={
                  lapsTrack ? 'inline-block text-2xl font-bold tracking-tight text-foreground' : 'text-xl font-semibold text-muted-foreground'
                }
              >
                {lapsTrack?.fileName ??
                  (tracks.length === 0 ? (error ? dictionary.laps.unavailable : dictionary.common.loading) : dictionary.laps.notInTrackData)}
              </h2>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-primary">{error}</p>}
        </div>
      )}

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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            type="button"
            onClick={() => void analyzeLaps()}
            disabled={!baseLap || !compareLap || analyzing}
            className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? t.analyzing : t.analyze}
          </button>

          {/* Bronze members can't ask for the summary: the box stays off and disabled, and its tooltip says why. The
              title is on the label, as browsers show no tooltip over a disabled input */}
          <label
            title={lapSummary ? undefined : t.provideSummaryBronze}
            className={`flex items-center gap-2 text-sm ${lapSummary ? 'text-foreground' : 'text-muted-foreground cursor-not-allowed'}`}
          >
            <input
              type="checkbox"
              checked={lapSummary && provideSummary}
              onChange={(e) => setProvideSummary(e.target.checked)}
              disabled={analyzing || !lapSummary}
              aria-describedby={lapSummary ? undefined : 'provide-summary-bronze'}
              className="accent-primary disabled:cursor-not-allowed"
            />
            {t.provideSummary}
            {!lapSummary && (
              <span id="provide-summary-bronze" className="sr-only">
                {t.provideSummaryBronze}
              </span>
            )}
          </label>
        </div>

        {/* Every Diff in the grid is the Compare lap minus the Target lap */}
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">{t.diffNote.title}:</span> {t.diffNote.text}
        </p>

        {/* What the Brakepoint and Max Brake diff colors in the grid mean (brakeDiffText) */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <span className="font-semibold text-muted-foreground">{t.brakeKey.title}:</span>
          {(
            [
              ['bg-sky-400', 'text-sky-400', t.brakeKey.light],
              ['bg-primary', 'text-primary', t.brakeKey.hard],
              ['bg-positive', 'text-positive', t.brakeKey.similar],
            ] as const
          ).map(([dot, text, label]) => (
            <span key={label} className={`flex items-center gap-1.5 ${text}`}>
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>

        {/* The table, and beside it on large screens the whole track, as tall as the table, colored by each
            focus area's time (below it on smaller screens) */}
        {areaRows.length > 0 && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <AreaTable
              rows={areaRows}
              selected={selectedTrace?.name ?? null}
              selectable={traces.map((trace) => trace.name)}
              onSelect={selectArea}
            />
            <LapDeltaMap
              className="h-96 lg:h-auto lg:min-w-[18rem] lg:flex-1"
              outline={lapOutline}
              areas={deltaMapAreas}
              selectedArea={selectedTrace?.name ?? selectedArea}
              onSelectArea={selectArea}
              fromTrackOutline={outlineFromTrack}
            />
          </div>
        )}

        {/* Without a summary the panel only shows a message, e.g. no focus areas or an error */}
        {(provideSummary || analysis) && (
          <SummaryPanel
            title={t.summary}
            text={analysis}
            placeholder={!baseLap || !compareLap ? t.summaryPlaceholderNoLaps : t.summaryPlaceholder}
            pending={analyzing && analysis === t.writing}
          >
            <ThinkingProgress active={analyzing && analysis === t.writing} expectedMs={15000} className="mt-3" />
          </SummaryPanel>
        )}

        {traces.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">{t.pedalTraces}</h3>
            <p className="text-xs text-muted-foreground">{t.pedalTracesIntro}</p>
            {/* On large screens the focus areas and playback stick to the top of the window while the page scrolls
                through the area's telemetry under them (below lg the nav bar is the sticky top bar) */}
            <div className="flex flex-col gap-2">
            <div ref={areaHeaderRef} className="space-y-2 lg:sticky lg:top-0 lg:z-30 lg:bg-secondary lg:py-2">              <FocusAreaTabs
                areas={traces.map(({ name, diff }) => ({ name, diff }))}
                selected={selectedTrace.name}
                onSelect={selectArea}
                panelId="lap-compare-area"
              />
              {/* PedalTraces puts the playback controls here (they share its crosshair) */}
              <div ref={setPlaybackSlot} />
            </div>
            <div
              id="lap-compare-area"
              role="tabpanel"
              aria-label={selectedTrace.name}
              className="bg-card border border-border rounded-lg"
            >
              <p className="px-4 pt-3 text-sm">
                <span className="font-semibold text-foreground">{selectedTrace.name}</span>
                <span className="text-muted-foreground">
                  {' • '}
                  {selectedTrace.diff === 0
                    ? t.compareLapSame
                    : fmt(selectedTrace.diff > 0 ? t.compareLapSlower : t.compareLapFaster, {
                        seconds: Math.abs(selectedTrace.diff).toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                      })}
                </span>
                {selectedIndex === worstTraceIndex && selectedTrace.diff > 0 && (
                  <span className="ml-2 px-1.5 rounded text-xs bg-primary/15 text-red-300">{t.mostTimeLost}</span>
                )}
              </p>
              <div ref={areaContentRef} className="p-4">
                <PedalTraces
                  key={selectedTrace.name}
                  id={`pedal-${selectedIndex}`}
                  areaName={selectedTrace.name}
                  lengthFeet={selectedTrack?.lengthFeet ?? null}
                  base={selectedTrace.base}
                  compare={selectedTrace.compare}
                  dataTab={dataTab}
                  onDataTabChange={setDataTab}
                  chartSettings={chartSettings}
                  onChartSettingsChange={setChartSettings}
                  playbackSlot={playbackSlot}
                />
              </div>
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
