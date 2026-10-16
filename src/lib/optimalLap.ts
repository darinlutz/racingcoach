// The Debrief Coach's theoretical lap (its assemble_optimal_lap tool): the whole lap is split into segments,
// the focus areas and the stretches between them, and the fastest clean run through each segment, from any of
// the laps analysed, is put together into one lap. The browser measures the segments (lapSegmentTimes, sent
// with the session), the server picks the fastest run through each (planOptimalLap), and the browser stitches
// the picked laps' CSV rows into the theoretical lap's CSV (assembleOptimalLapCsv), which can be downloaded
// or set as the Target Lap. No imports beyond types and lapData, as it runs in the browser and on the server.

import type { DebriefSession } from '@/lib/debriefCoach';
import { crossingIndex, type LapSamples, type Track } from '@/lib/lapData';

// One part of the lap, from start to end (fractions of a lap, 0-1, end > start). area is the focus area (or
// areas, where they overlap) it's in, null between areas; next is the focus area that comes after it
export type LapSegment = { start: number; end: number; area: string | null; next: string | null };

export type MeasuredSegment = LapSegment & { times: { lap: string; seconds: number }[] };

export type OptimalLapSegment = LapSegment & {
  lap: string;
  seconds: number;
  // Time the fastest lap lost to this segment's fastest run (0 when the fastest lap is the fastest here)
  gain: number;
};

export type OptimalLap = {
  // The theoretical lap's time (s): the fastest lap's time less what its segments lost to the fastest runs
  lapTime: number;
  bestLap: { id: string; lapTime: number };
  segments: OptimalLapSegment[];
};

// A lap's first sample can sit just past the start/finish line, and its last just short of it
const LINE_TOLERANCE = 0.002;

// Splits the lap at every focus area's start and end
export function trackSegments(track: Track): LapSegment[] {
  const areas = track.areas.flatMap((a) =>
    a.start === null || a.end === null ? [] : [{ name: a.name, start: a.start, end: a.end }]
  );
  if (areas.length === 0) return [];
  const cuts = [...new Set([0, 1, ...areas.flatMap((a) => [a.start, a.end]).filter((p) => p > 0 && p < 1)])].sort(
    (a, b) => a - b
  );
  // An area that crosses the start/finish line (end < start) covers both ends of the lap
  const covers = (a: (typeof areas)[number], pct: number) =>
    a.start <= a.end ? pct >= a.start && pct < a.end : pct >= a.start || pct < a.end;
  // The area starting soonest at or after pct, going round the lap
  const nextArea = (pct: number) =>
    areas.reduce((best, a) => (((a.start - pct + 1) % 1) < ((best.start - pct + 1) % 1) ? a : best)).name;

  return cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1];
    const inside = areas.filter((a) => covers(a, (start + end) / 2)).map((a) => a.name);
    return { start, end, area: inside.length > 0 ? inside.join(' + ') : null, next: nextArea(end) };
  });
}

// Fractional sample index where the lap reaches pct; the lap's own ends count for the start/finish line
function indexAt(pcts: number[], pct: number, from: number) {
  if (pct === 0 && pcts[0] >= 0 && pcts[0] < LINE_TOLERANCE) return 0;
  const index = crossingIndex(pcts, pct, from);
  if (index !== null) return index;
  if (pct === 1 && pcts[pcts.length - 1] > 1 - LINE_TOLERANCE) return pcts.length - 1;
  return null;
}

// Seconds the lap spent in each segment (null where it doesn't cover the segment), timed like areaStats
function segmentSeconds(samples: LapSamples, lapSeconds: number, segments: LapSegment[]) {
  const { pcts } = samples;
  return segments.map(({ start, end }) => {
    const from = indexAt(pcts, start, 0);
    const to = from === null ? null : indexAt(pcts, end, from);
    return from === null || to === null ? null : ((to - from) * lapSeconds) / pcts.length;
  });
}

export function lapSegmentTimes(
  track: Track,
  laps: { id: string; lapSeconds: number; samples: LapSamples }[]
): MeasuredSegment[] {
  const segments = trackSegments(track);
  const measured = laps.map((lap) => segmentSeconds(lap.samples, lap.lapSeconds, segments));
  return segments.map((segment, i) => ({
    ...segment,
    times: laps.flatMap((lap, l) => (measured[l][i] === null ? [] : [{ lap: lap.id, seconds: measured[l][i]! }])),
  }));
}

// "T1" for a focus area, "before T1" for the stretch leading to it
export function segmentName(segment: LapSegment) {
  return segment.area ?? `before ${segment.next ?? 'the line'}`;
}

// The fastest run through every segment, from the given laps (the clean laps; incident laps are left out).
// null when the session has no segments or some segment has no run.
export function planOptimalLap(session: DebriefSession, lapIds: string[]): OptimalLap | null {
  const segments = session.segments ?? [];
  if (segments.length === 0) return null;
  const allowed = new Set(lapIds);

  const fastest = segments.map((segment) =>
    segment.times
      .filter((time) => allowed.has(time.lap))
      .reduce<{ lap: string; seconds: number } | null>((best, time) => (!best || time.seconds < best.seconds ? time : best), null)
  );
  if (fastest.some((run) => run === null)) return null;

  // The fastest lap that covers every segment, to measure the theoretical lap against
  const bestLap = session.laps
    .filter((lap) => allowed.has(lap.id) && segments.every((s) => s.times.some((time) => time.lap === lap.id)))
    .reduce<DebriefSession['laps'][number] | null>((best, lap) => (!best || lap.lapTime < best.lapTime ? lap : best), null);
  if (!bestLap) return null;

  const picked = segments.map((segment, i) => {
    const run = fastest[i]!;
    const own = segment.times.find((time) => time.lap === bestLap.id)!.seconds;
    return { start: segment.start, end: segment.end, area: segment.area, next: segment.next, lap: run.lap, seconds: run.seconds, gain: own - run.seconds };
  });
  return {
    lapTime: bestLap.lapTime - picked.reduce((sum, s) => sum + s.gain, 0),
    bestLap: { id: bestLap.id, lapTime: bestLap.lapTime },
    segments: picked,
  };
}

// Columns rewritten so the stitched rows read as one continuous lap at 60 Hz
const SAMPLE_SECONDS = 1 / 60;

// The CSV of the theoretical lap: each segment's rows from the lap it was picked from, in order, under the first
// picked lap's header (another lap's columns are matched by name, empty when it doesn't have one). Rows are kept
// whole; SessionTime, SessionTick and LapCurrentLapTime count on from the first row and Lap keeps its value, so
// the lap reads as one. csvs holds each picked lap's CSV by lap ID.
export function assembleOptimalLapCsv(plan: OptimalLap, csvs: Map<string, string>): string {
  const parsed = new Map<string, { header: string[]; rows: { cells: string[]; pct: number }[] }>();
  for (const id of new Set(plan.segments.map((s) => s.lap))) {
    const csv = csvs.get(id);
    if (csv === undefined) throw new Error(`Lap ${id} is not loaded`);
    parsed.set(id, parseRows(csv));
  }

  const header = parsed.get(plan.segments[0].lap)!.header;
  const out: string[][] = [];
  plan.segments.forEach((segment, i) => {
    const lap = parsed.get(segment.lap)!;
    const columns = header.map((name) => lap.header.indexOf(name));
    const first = i === 0;
    const last = i === plan.segments.length - 1;
    // The first segment keeps the samples just before the line, the last the first sample of the next lap
    for (const row of lap.rows) {
      if ((first || row.pct >= segment.start) && (last || row.pct < segment.end)) {
        out.push(columns.map((c) => (c < 0 ? '' : (row.cells[c] ?? ''))));
      }
    }
  });

  const column = (name: string) => header.indexOf(name);
  const counters: [number, (base: number, k: number) => string][] = [
    [column('SessionTime'), (base, k) => (base + k * SAMPLE_SECONDS).toFixed(6)],
    [column('LapCurrentLapTime'), (base, k) => (base + k * SAMPLE_SECONDS).toFixed(6)],
    [column('SessionTick'), (base, k) => String(Math.round(base + k))],
    [column('Lap'), (base) => String(base)],
  ];
  for (const [c, value] of counters) {
    const base = c < 0 || out.length === 0 ? NaN : parseFloat(out[0][c]);
    if (Number.isNaN(base)) continue;
    out.forEach((cells, k) => (cells[c] = value(base, k)));
  }

  return [header.join(','), ...out.map((cells) => cells.join(','))].join('\n') + '\n';
}

// A lap CSV's header and rows, each with its unwrapped LapDistPct (as lapSamplesFromText unwraps it)
function parseRows(csv: string) {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(',').map((c) => c.trim());
  const pctColumn = header.indexOf('LapDistPct');
  const rows: { cells: string[]; pct: number }[] = [];
  let offset = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const value = parseFloat(cells[pctColumn]);
    if (Number.isNaN(value)) continue;
    if (rows.length === 0 && value > 0.5) offset = -1; // Lap starts just before the line
    if (rows.length > 0 && value + offset < rows[rows.length - 1].pct - 0.5) offset += 1;
    rows.push({ cells, pct: value + offset });
  }
  return { header, rows };
}
