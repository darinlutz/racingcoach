import { query } from './db';
import { DEFAULT_SIMULATOR } from './simulators';
import { alignmentCurrent, fitWorldAlignment, outlineLapPcts, worldToLatLon, type WorldAlignment } from './worldAlignment';

// Track positions for laps of a simulator that only gives its own world coordinates (ACC): the lap CSV's WorldX,
// WorldY and WorldZ columns (LapCsvFormat.cs) become Lat, Lon and Alt as the lap is read, so Lap Compare's driving
// lines, line difference, 3D view and track map, and the coaches' driving line tools, work as they do for iRacing.
//
// Its LapDistPct becomes iRacing's too (outlineLapPcts): the simulator counts the lap from its own timing line along
// its own spline, so focus areas, which are iRacing's shares of the lap, would otherwise start and end somewhere else
// on its laps than on iRacing's. Each sample is found on the mapped track's iRacing outline instead, so an ACC lap and
// an iRacing lap are cut at the same places. ACC laps from before world coordinates (adapter 3 and older) are moved by
// the track's start line offset alone, once the track has an alignment.
//
// Where the simulator's world lies on the earth is fitted once per simulator track (worldAlignment.ts), from the first
// clean lap read after it's mapped to a Track Data track that has an iRacing outline, and kept on its
// "SimulatorTracks" row; mapping it to another track, or the outline being learned again, fits it again. Without a
// mapping, an outline or a good fit the lap is read as it was stored, with no positions. The stored CSV is never
// changed: Download My Data has the simulator's own coordinates and lap positions, not these.

// The lap's simulator and track, and whether it's clean enough to fit from (no pit road or off-track)
export type WorldLapSource = { simulator: string; nativeTrackKey: string | null; clean: boolean };

type Placement = { alignment: WorldAlignment; outline: [number, number][] };

const CACHE_MS = 60_000;
// A fit that failed isn't tried again on every read of the track's laps
const FAILED_RETRY_MS = 10 * 60_000;
const cache = new Map<string, { placement: Placement | null; until: number }>();
const cacheKey = (simulator: string, nativeKey: string) => `${simulator}:${nativeKey.toLowerCase()}`;

// After a mapping changes (simulatorMappings.ts), so the next read doesn't use the old track's fit
export function forgetWorldAlignment(simulator: string, nativeKey: string): void {
  cache.delete(cacheKey(simulator, nativeKey));
}

type Columns = { x: number; y: number; z: number; pct: number; lat: number; lon: number; alt: number };

function headerOf(headerLine: string): string[] {
  return headerLine.split(',').map((c) => c.trim());
}

function columnsOf(header: string[]): Columns | null {
  const at = (name: string) => header.indexOf(name);
  const columns = { x: at('WorldX'), y: at('WorldY'), z: at('WorldZ'), pct: at('LapDistPct'), lat: at('Lat'), lon: at('Lon'), alt: at('Alt') };
  return Object.values(columns).every((i) => i >= 0) ? columns : null;
}

const cell = (cells: string[], i: number) => {
  const text = (cells[i] ?? '').trim();
  return text === '' ? NaN : Number(text);
};

// The alignment for this simulator track and the outline it was fitted to, fitting one from `fitFrom` (a lap with
// world coordinates) when there's none for its current outline and the lap is clean; null when there can't be one
async function placementFor(
  source: WorldLapSource & { nativeTrackKey: string },
  fitFrom: { lines: string[]; columns: Columns } | null
): Promise<Placement | null> {
  const key = cacheKey(source.simulator, source.nativeTrackKey);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.placement;

  const [row] = await query<{ id: number; world_alignment: unknown; track_key: string | null; track_outline: { kind?: string; points?: [number, number][] } | null }>(
    `SELECT st.id, st.world_alignment, t.track_key, t.track_outline
     FROM racingcoach."SimulatorTracks" st JOIN racingcoach."Tracks" t ON t.id = st.track_id
     WHERE st.simulator = $1 AND lower(st.native_key) = lower($2)`,
    [source.simulator, source.nativeTrackKey]
  );
  const outline = row?.track_outline?.kind === 'latlon' ? row.track_outline.points ?? null : null;
  if (!row?.track_key || !outline) {
    cache.set(key, { placement: null, until: Date.now() + CACHE_MS });
    return null;
  }
  if (alignmentCurrent(row.world_alignment, row.track_key, outline)) {
    const placement = { alignment: row.world_alignment, outline };
    cache.set(key, { placement, until: Date.now() + CACHE_MS });
    return placement;
  }
  // Only a clean lap with world coordinates teaches it; a lap that isn't is read as stored until one does
  if (!source.clean || !fitFrom) return null;

  const { lines, columns } = fitFrom;
  const rows = lines.slice(1).map((line) => line.split(','));
  const fit = fitWorldAlignment(
    { pcts: rows.map((c) => cell(c, columns.pct)), xs: rows.map((c) => cell(c, columns.x)), zs: rows.map((c) => cell(c, columns.z)) },
    outline,
    row.track_key
  );
  if (!fit.ok) {
    console.warn(
      `World alignment not fitted: ${source.simulator} ${source.nativeTrackKey} on ${row.track_key} (${fit.reason}` +
        (fit.rmsMeters !== undefined ? `, rms ${fit.rmsMeters.toFixed(1)} m` : '') + ')'
    );
    cache.set(key, { placement: null, until: Date.now() + FAILED_RETRY_MS });
    return null;
  }
  // Two first reads at once both fit; the first saved is the one every lap uses
  await query(
    `UPDATE racingcoach."SimulatorTracks" SET world_alignment = $2
     WHERE id = $1 AND (world_alignment IS NULL OR world_alignment->>'trackKey' IS DISTINCT FROM $3
                        OR world_alignment->>'outlineHash' IS DISTINCT FROM $4)`,
    [row.id, JSON.stringify(fit.alignment), fit.alignment.trackKey, fit.alignment.outlineHash]
  );
  const [saved] = await query<{ world_alignment: unknown }>(
    'SELECT world_alignment FROM racingcoach."SimulatorTracks" WHERE id = $1',
    [row.id]
  );
  const alignment = alignmentCurrent(saved?.world_alignment, row.track_key, outline) ? saved.world_alignment : fit.alignment;
  console.log(
    `World alignment fitted: ${source.simulator} ${source.nativeTrackKey} on ${row.track_key} ` +
      `(rms ${alignment.rmsMeters} m, start line ${(alignment.startOffset * 100).toFixed(1)}% of the lap from iRacing's)`
  );
  const placement = { alignment, outline };
  cache.set(key, { placement, until: Date.now() + CACHE_MS });
  return placement;
}

// The lap CSV with Lat, Lon and Alt filled in from its world coordinates and LapDistPct made iRacing's, or as it is:
// an iRacing lap, one with positions already, or a track that can't be placed. Never throws, so a read can't fail here.
export async function withWorldPositions(csv: string, source: WorldLapSource): Promise<string> {
  if (source.simulator === DEFAULT_SIMULATOR || !source.nativeTrackKey) return csv;
  try {
    const newline = csv.includes('\r\n') ? '\r\n' : '\n';
    const lines = csv.split(/\r?\n/);
    const header = headerOf(lines[0] ?? '');
    const pctColumn = header.indexOf('LapDistPct');
    if (pctColumn < 0) return csv;
    const columns = columnsOf(header);
    const first = (lines[1] ?? '').split(',');
    // Positions already there: the lap was placed some other way, so it's left as it is
    if (columns && Number.isFinite(cell(first, columns.lat))) return csv;
    const withWorld = !!columns && Number.isFinite(cell(first, columns.x));

    const placement = await placementFor(
      { ...source, nativeTrackKey: source.nativeTrackKey },
      withWorld ? { lines, columns: columns! } : null
    );
    if (!placement) return csv;
    const { alignment, outline } = placement;

    const rows = lines.map((line, i) => (i === 0 || line === '' ? null : line.split(',')));
    const cellsOf = (column: number) => rows.map((cells) => (cells && column >= 0 ? cell(cells, column) : NaN));
    const pcts = outlineLapPcts(alignment, outline, {
      pcts: cellsOf(pctColumn),
      xs: withWorld ? cellsOf(columns!.x) : [],
      zs: withWorld ? cellsOf(columns!.z) : [],
    });
    for (let i = 1; i < lines.length; i++) {
      const cells = rows[i];
      if (!cells) continue;
      if (Number.isFinite(pcts[i])) cells[pctColumn] = pcts[i].toFixed(6);
      if (withWorld) {
        const [x, y, z] = [cell(cells, columns!.x), cell(cells, columns!.y), cell(cells, columns!.z)];
        if (Number.isFinite(x) && Number.isFinite(z)) {
          const [lat, lon] = worldToLatLon(alignment, x, z);
          cells[columns!.lat] = lat.toFixed(8);
          cells[columns!.lon] = lon.toFixed(8);
          // Meters above the simulator's own origin, not sea level: the 3D view only uses a lap's climbs and drops
          if (Number.isFinite(y)) cells[columns!.alt] = y.toFixed(3);
        }
      }
      lines[i] = cells.join(',');
    }
    return lines.join(newline);
  } catch (error) {
    console.error('World positions error:', error);
    return csv;
  }
}
