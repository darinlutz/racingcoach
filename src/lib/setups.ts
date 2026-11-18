import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from './db';
import { compareSetups } from './setupCompare';
import { applyChanges, type AppliedChange, type SetupProposal } from './setupChanges';
import { inspectionResult, type InspectionResult } from './setupInspection';
import { parseCarSetupYaml, SETUP_YAML_PARSER_VERSION, type SetupParameter } from './setupYaml';
import { readStoFile, type StoInfo } from './stoFile';
import { ensureUserSchema } from './users';

// The Setups page's data (docs/setups.md; tables in setupSchema.ts). Every read and write takes the signed-in user's
// ID and filters by it in SQL, so nobody reaches another user's setups, whatever ID they send.
//
// A setup is identified by its file name and car: the collector's capture of what iRacing loaded (DriverSetupName,
// e.g. "fixed.sto") goes to the user's setup of that file name and car, so an uploaded .sto (whose values are
// encrypted, stoFile.ts) gets its values once iRacing has loaded it. Each capture whose adjustable values differ from
// the last makes a new revision; the same values seen again only refresh its readings (pressures after a run, tread)
// and when it was last seen. Revisions are never changed otherwise, and nothing ever overwrites an original: changes
// make new revisions.

export const SETUP_LIMITS = {
  setupsPerUser: 300,
  // Captures kept per setup; the oldest beyond it are removed (the others, and every non-capture revision, are kept)
  capturesPerSetup: 100,
  revisionsPerSetup: 400,
  yamlChars: 64 * 1024,
  notesChars: 4000,
  nameChars: 120,
};

export type SetupSource = 'sdk' | 'sto' | 'generated' | 'imported';
export type ParseStatus = 'decoded' | 'partial' | 'unsupported' | 'failed' | 'none';
export type RevisionKind = 'capture' | 'import' | 'manual' | 'engineer' | 'restore' | 'duplicate';

export class SetupError extends Error {
  constructor(public code: 'notFound' | 'tooMany' | 'badChange' | 'noValues' | 'incompatible', message: string = code) {
    super(message);
  }
}

export type SetupSummary = {
  id: number;
  name: string;
  car: string | null;
  carKey: string | null;
  track: string | null;
  source: SetupSource;
  fileName: string | null;
  notes: string;
  hasFile: boolean;
  parseStatus: ParseStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  revisions: number;
  latestRevisionId: number | null;
  latestRevisionNumber: number | null;
  valueCount: number;
  inspection: InspectionResult | 'notChecked';
  inspectionAt: string | null;
};

export type RevisionSummary = {
  id: number;
  setupId: number;
  number: number;
  parentId: number | null;
  kind: RevisionKind;
  author: 'collector' | 'user' | 'setupEngineer';
  summary: string;
  changed: AppliedChange[];
  simSetupName: string | null;
  simLoadType: string | null;
  simModified: boolean | null;
  fixedSession: boolean | null;
  updateCount: number | null;
  capturedAt: string | null;
  lastSeenAt: string | null;
  changeSheetAt: string | null;
  observedInIracing: boolean;
  createdAt: string;
};

export type RevisionDetail = RevisionSummary & { parameters: SetupParameter[]; setup: SetupSummary };

export type SetupDetail = SetupSummary & {
  stoInfo: Omit<StoInfo, 'notes'> | null;
  stoNotes: string | null;
  revisionList: RevisionSummary[];
  latest: RevisionDetail | null;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

const SUMMARY_SQL = `
  SELECT s.id, s.name, s.car, s.car_key, s.track, s.source, s.file_name, s.notes, s.sto_file IS NOT NULL AS has_file,
         s.parse_status, s.archived_at, s.created_at, s.updated_at,
         (SELECT count(*) FROM racingcoach."SetupRevisions" r WHERE r.setup_id = s.id)::int AS revisions,
         latest.id AS latest_revision_id, latest.revision_number AS latest_revision_number,
         (SELECT count(*) FROM racingcoach."SetupValues" v WHERE v.revision_id = latest.id)::int AS value_count,
         insp.result AS inspection, insp.last_observed_at AS inspection_at
  FROM racingcoach."Setups" s
  LEFT JOIN LATERAL (
    SELECT id, revision_number FROM racingcoach."SetupRevisions" r WHERE r.setup_id = s.id ORDER BY revision_number DESC LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT result, last_observed_at FROM racingcoach."SetupInspections" i WHERE i.setup_id = s.id ORDER BY last_observed_at DESC LIMIT 1
  ) insp ON true`;

function summaryOf(row: Record<string, unknown>): SetupSummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    car: (row.car as string) ?? null,
    carKey: (row.car_key as string) ?? null,
    track: (row.track as string) ?? null,
    source: row.source as SetupSource,
    fileName: (row.file_name as string) ?? null,
    notes: String(row.notes ?? ''),
    hasFile: !!row.has_file,
    parseStatus: row.parse_status as ParseStatus,
    archived: !!row.archived_at,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    revisions: Number(row.revisions ?? 0),
    latestRevisionId: row.latest_revision_id == null ? null : Number(row.latest_revision_id),
    latestRevisionNumber: row.latest_revision_number == null ? null : Number(row.latest_revision_number),
    valueCount: Number(row.value_count ?? 0),
    inspection: (row.inspection as InspectionResult) ?? 'notChecked',
    inspectionAt: iso(row.inspection_at),
  };
}

const REVISION_COLUMNS = `r.id, r.setup_id, r.revision_number, r.parent_revision_id, r.kind, r.author, r.change_summary, r.changed,
  r.sim_setup_name, r.sim_load_type, r.sim_modified, r.fixed_session, r.update_count, r.captured_at, r.last_seen_at,
  r.change_sheet_at, r.validation, r.created_at`;

function revisionOf(row: Record<string, unknown>): RevisionSummary {
  return {
    id: Number(row.id),
    setupId: Number(row.setup_id),
    number: Number(row.revision_number),
    parentId: row.parent_revision_id == null ? null : Number(row.parent_revision_id),
    kind: row.kind as RevisionKind,
    author: row.author as RevisionSummary['author'],
    summary: String(row.change_summary ?? ''),
    changed: (row.changed as AppliedChange[]) ?? [],
    simSetupName: (row.sim_setup_name as string) ?? null,
    simLoadType: (row.sim_load_type as string) ?? null,
    simModified: (row.sim_modified as boolean) ?? null,
    fixedSession: (row.fixed_session as boolean) ?? null,
    updateCount: row.update_count == null ? null : Number(row.update_count),
    capturedAt: iso(row.captured_at),
    lastSeenAt: iso(row.last_seen_at),
    changeSheetAt: iso(row.change_sheet_at),
    observedInIracing: row.kind === 'capture' || row.validation === 'observed',
    createdAt: iso(row.created_at)!,
  };
}

function parameterOf(row: Record<string, unknown>): SetupParameter {
  return {
    path: String(row.path),
    section: String(row.section),
    group: (row.grp as string) ?? null,
    key: String(row.key),
    raw: String(row.raw),
    value: row.value == null ? null : Number(row.value),
    unit: (row.unit as string) ?? null,
    values: ((row.value_list as number[]) ?? []).map(Number),
    decimals: Number(row.decimals ?? 0),
    category: row.category as SetupParameter['category'],
    kind: row.kind as SetupParameter['kind'],
    inCar: !!row.in_car,
  };
}

// The adjustable values' fingerprint: the same setup loaded in iRacing again has the same one, whatever its readings
export function settingsHash(parameters: SetupParameter[]): string {
  const lines = parameters
    .filter((p) => p.kind === 'setting')
    .map((p) => `${p.path}=${p.value != null ? String(p.value) : p.raw.trim().toLowerCase()}`)
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

type Queryable = Pick<PoolClient, 'query'>;
// Rows from the pool (query) or from a transaction's client (rowsOf(client))
type Run = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
const rowsOf =
  (db: Queryable): Run =>
  async (sql, params) =>
    (await db.query(sql, params)).rows;

async function readParameters(db: Queryable | Run, revisionId: number): Promise<SetupParameter[]> {
  const run = typeof db === 'function' ? db : rowsOf(db);
  const rows = await run(`SELECT * FROM racingcoach."SetupValues" WHERE revision_id = $1 ORDER BY ord`, [revisionId]);
  return rows.map(parameterOf);
}

async function insertValues(db: Queryable, userId: number, revisionId: number, parameters: SetupParameter[]): Promise<void> {
  if (!parameters.length) return;
  await db.query(
    `INSERT INTO racingcoach."SetupValues"
       (revision_id, user_id, path, section, grp, key, category, raw, value, unit, value_list, decimals, kind, in_car, ord)
     SELECT $1, $2, p->>'path', p->>'section', p->>'group', p->>'key', p->>'category', p->>'raw', (p->>'value')::float8,
            p->>'unit', ARRAY(SELECT jsonb_array_elements_text(p->'values')::float8), (p->>'decimals')::int, p->>'kind',
            (p->>'inCar')::boolean, (ord - 1)::int
     FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(p, ord)`,
    [revisionId, userId, JSON.stringify(parameters)]
  );
}

type NewRevision = {
  setupId: number;
  parentId: number | null;
  kind: RevisionKind;
  author: RevisionSummary['author'];
  summary: string;
  changed: AppliedChange[];
  parameters: SetupParameter[];
  yaml?: string | null;
  capture?: CaptureInput | null;
};

async function insertRevision(db: Queryable, userId: number, input: NewRevision): Promise<number> {
  const { rows: counts } = await db.query(
    `SELECT count(*)::int AS n, COALESCE(max(revision_number), 0)::int AS top FROM racingcoach."SetupRevisions" WHERE setup_id = $1`,
    [input.setupId]
  );
  if (counts[0].n >= SETUP_LIMITS.revisionsPerSetup) throw new SetupError('tooMany');
  const c = input.capture;
  const { rows } = await db.query(
    `INSERT INTO racingcoach."SetupRevisions"
       (setup_id, user_id, revision_number, parent_revision_id, kind, author, change_summary, changed, yaml, settings_sha256,
        update_count, sim_setup_name, sim_load_type, sim_modified, fixed_session, session_id, subsession_id, captured_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
     RETURNING id`,
    [
      input.setupId,
      userId,
      counts[0].top + 1,
      input.parentId,
      input.kind,
      input.author,
      input.summary.slice(0, 500),
      JSON.stringify(input.changed),
      input.yaml ?? null,
      input.parameters.length ? settingsHash(input.parameters) : null,
      c ? parseCarSetupYaml(input.yaml ?? '').updateCount : null,
      c?.setupName ?? null,
      c?.loadType ?? null,
      c?.modified ?? null,
      c?.fixedSession ?? null,
      c?.sessionId || null,
      c?.subSessionId || null,
      c ? c.observedAt : null,
    ]
  );
  const id = Number(rows[0].id);
  await insertValues(db, userId, id, input.parameters);
  return id;
}

// The changes from one list of values to the next, as AppliedChange (settings only: readings change by themselves)
function diffSettings(before: SetupParameter[], after: SetupParameter[]): AppliedChange[] {
  const result = compareSetups({ car: 'x', carKey: null, parameters: before }, { car: 'x', carKey: null, parameters: after });
  return result.rows
    .filter((r) => r.kind === 'setting' && r.status !== 'same')
    .map((r) => ({ path: r.path, from: r.baseline ?? '', to: r.comparison ?? '' }));
}

const lock = (db: Queryable, userId: number) => db.query(`SELECT pg_advisory_xact_lock(hashtext('setups:' || $1::text))`, [userId]);

async function countSetups(db: Queryable, userId: number): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM racingcoach."Setups" WHERE user_id = $1`, [userId]);
  return rows[0].n;
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

export async function listSetups(userId: number): Promise<SetupSummary[]> {
  await ensureUserSchema();
  const rows = await query(`${SUMMARY_SQL} WHERE s.user_id = $1 ORDER BY s.updated_at DESC LIMIT 500`, [userId]);
  return rows.map(summaryOf);
}

async function readSummary(run: Run, userId: number, setupId: number): Promise<SetupSummary | null> {
  const rows = await run(`${SUMMARY_SQL} WHERE s.user_id = $1 AND s.id = $2`, [userId, setupId]);
  return rows[0] ? summaryOf(rows[0]) : null;
}

export async function readRevision(userId: number, revisionId: number): Promise<RevisionDetail | null> {
  await ensureUserSchema();
  const [row] = await query(`SELECT ${REVISION_COLUMNS} FROM racingcoach."SetupRevisions" r WHERE r.user_id = $1 AND r.id = $2`, [userId, revisionId]);
  if (!row) return null;
  const [setup, parameters] = await Promise.all([readSummary(query, userId, Number(row.setup_id)), readParameters(query, revisionId)]);
  if (!setup) return null;
  return { ...revisionOf(row), parameters, setup };
}

export async function readSetup(userId: number, setupId: number): Promise<SetupDetail | null> {
  await ensureUserSchema();
  const [row] = await query(`SELECT sto_info FROM racingcoach."Setups" WHERE user_id = $1 AND id = $2`, [userId, setupId]);
  if (!row) return null;
  const summary = await readSummary(query, userId, setupId);
  if (!summary) return null;
  const revisions = (
    await query(`SELECT ${REVISION_COLUMNS} FROM racingcoach."SetupRevisions" r WHERE r.user_id = $1 AND r.setup_id = $2 ORDER BY r.revision_number DESC`, [
      userId,
      setupId,
    ])
  ).map(revisionOf);
  const latest = summary.latestRevisionId ? await readRevision(userId, summary.latestRevisionId) : null;
  const info = row.sto_info as StoInfo | null;
  const { notes, ...stoInfo } = info ?? ({} as StoInfo);
  return { ...summary, stoInfo: info ? stoInfo : null, stoNotes: info ? (notes ?? null) : null, revisionList: revisions, latest };
}

export async function readStoBytes(userId: number, setupId: number): Promise<{ fileName: string; bytes: Buffer } | null> {
  await ensureUserSchema();
  const [row] = await query(`SELECT file_name, name, sto_file FROM racingcoach."Setups" WHERE user_id = $1 AND id = $2 AND sto_file IS NOT NULL`, [
    userId,
    setupId,
  ]);
  return row ? { fileName: String(row.file_name ?? `${row.name}.sto`), bytes: row.sto_file as Buffer } : null;
}

// The newest capture: what the collector last saw iRacing load, for the Live Setup tab and the Overview
export async function readLatestCapture(userId: number): Promise<RevisionDetail | null> {
  await ensureUserSchema();
  const [row] = await query(
    `SELECT id FROM racingcoach."SetupRevisions" WHERE user_id = $1 AND kind = 'capture' ORDER BY last_seen_at DESC NULLS LAST, id DESC LIMIT 1`,
    [userId]
  );
  return row ? readRevision(userId, Number(row.id)) : null;
}

export type LinkedLaps = {
  clientLapIds: string[];
  laps: number;
  cleanLaps: number;
  bestSeconds: number | null;
  averageCleanSeconds: number | null;
};

// The laps driven on a captured revision: the same account, car and iRacing subsession, completed while iRacing showed
// that setup loaded (from its first capture to its last, plus two minutes for the lap in progress). Only a capture can
// be linked so: another revision was never seen in iRacing until a capture shows its values (then that capture has
// the laps). Expired laps are left out, like every lap read (Lap Telemetry Retention)
export async function readLinkedLaps(userId: number, revisionId: number): Promise<LinkedLaps | null> {
  await ensureUserSchema();
  const [revision] = await query(
    `SELECT r.kind, r.subsession_id, r.captured_at, r.last_seen_at, s.car, s.car_key
     FROM racingcoach."SetupRevisions" r JOIN racingcoach."Setups" s ON s.id = r.setup_id
     WHERE r.user_id = $1 AND r.id = $2`,
    [userId, revisionId]
  );
  if (!revision || revision.kind !== 'capture' || !revision.subsession_id || !revision.captured_at) return null;
  const rows = await query(
    `SELECT client_lap_id, lap_time_seconds, pit_road, off_track, incidents FROM racingcoach."CollectorLaps"
     WHERE user_id = $1 AND expires_at > now() AND iracing_subsession_id = $2
       AND (lower(car_key) = lower($3::text) OR (car_key IS NULL AND lower(car) = lower($4::text)))
       AND completed_at >= $5 AND completed_at <= $6::timestamptz + interval '2 minutes'
     ORDER BY completed_at LIMIT 60`,
    [userId, revision.subsession_id, revision.car_key, revision.car, revision.captured_at, revision.last_seen_at ?? revision.captured_at]
  );
  const times = rows.map((r) => Number(r.lap_time_seconds)).filter((t) => t > 0);
  const clean = rows.filter((r) => !r.pit_road && !r.off_track && !Number(r.incidents)).map((r) => Number(r.lap_time_seconds)).filter((t) => t > 0);
  return {
    clientLapIds: rows.map((r) => String(r.client_lap_id)),
    laps: rows.length,
    cleanLaps: clean.length,
    bestSeconds: times.length ? Math.min(...times) : null,
    averageCleanSeconds: clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null,
  };
}

export type SetupOverview = {
  setups: number;
  archived: number;
  revisions: number;
  latestCapture: RevisionSummary | null;
  latestCaptureSetup: Pick<SetupSummary, 'id' | 'name' | 'car' | 'track'> | null;
  latestInspection: InspectionRecord | null;
  recentChanges: (RevisionSummary & { setupName: string })[];
  // The loaded setup's headline settings (GLANCE_KEYS), for the Overview's Setup at a glance
  glance: SetupParameter[];
};

// What a race engineer looks at first, by key; whichever of them the car has, in this order
const GLANCE_KEYS = [/BrakePressureBias|BrakeBias/i, /^Abs/i, /^Tc/i, /WingAngle|WingSetting/i, /Arb|AntiRoll/i, /StartingPressure|ColdPressure/i, /^RideHeight$/i, /FuelLevel/i, /DiffPreload|Preload/i];

export async function readOverview(userId: number): Promise<SetupOverview> {
  await ensureUserSchema();
  const [counts] = await query(
    `SELECT (SELECT count(*) FROM racingcoach."Setups" WHERE user_id = $1 AND archived_at IS NULL)::int AS setups,
            (SELECT count(*) FROM racingcoach."Setups" WHERE user_id = $1 AND archived_at IS NOT NULL)::int AS archived,
            (SELECT count(*) FROM racingcoach."SetupRevisions" WHERE user_id = $1)::int AS revisions`,
    [userId]
  );
  const [capture] = await query(
    `SELECT ${REVISION_COLUMNS}, s.name AS setup_name, s.car, s.track FROM racingcoach."SetupRevisions" r
     JOIN racingcoach."Setups" s ON s.id = r.setup_id
     WHERE r.user_id = $1 AND r.kind = 'capture' ORDER BY r.last_seen_at DESC NULLS LAST, r.id DESC LIMIT 1`,
    [userId]
  );
  const recent = await query(
    `SELECT ${REVISION_COLUMNS}, s.name AS setup_name FROM racingcoach."SetupRevisions" r
     JOIN racingcoach."Setups" s ON s.id = r.setup_id
     WHERE r.user_id = $1 AND (r.kind <> 'capture' OR jsonb_array_length(r.changed) > 0)
     ORDER BY r.created_at DESC LIMIT 6`,
    [userId]
  );
  const inspections = await readInspections(userId, 1);
  const parameters = capture ? await readParameters(query, Number(capture.id)) : [];
  const glance = GLANCE_KEYS.flatMap((pattern) => parameters.filter((p) => p.kind === 'setting' && p.value != null && pattern.test(p.key))).filter(
    (p, i, all) => all.findIndex((q) => q.path === p.path) === i
  );
  return {
    glance: glance.slice(0, 16),
    setups: counts.setups,
    archived: counts.archived,
    revisions: counts.revisions,
    latestCapture: capture ? revisionOf(capture) : null,
    latestCaptureSetup: capture ? { id: Number(capture.setup_id), name: String(capture.setup_name), car: capture.car ?? null, track: capture.track ?? null } : null,
    latestInspection: inspections[0] ?? null,
    recentChanges: recent.map((row) => ({ ...revisionOf(row), setupName: String(row.setup_name) })),
  };
}

export type InspectionRecord = {
  id: number;
  setupId: number | null;
  setupName: string | null;
  revisionId: number | null;
  revisionNumber: number | null;
  matchedRevisionId: number | null;
  matchedRevisionNumber: number | null;
  result: InspectionResult;
  simSetupName: string | null;
  car: string | null;
  track: string | null;
  subSessionId: number | null;
  observedAt: string;
  lastObservedAt: string;
};

export async function readInspections(userId: number, limit = 100): Promise<InspectionRecord[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT i.*, s.name AS setup_name, r.revision_number, m.revision_number AS matched_revision_number
     FROM racingcoach."SetupInspections" i
     LEFT JOIN racingcoach."Setups" s ON s.id = i.setup_id
     LEFT JOIN racingcoach."SetupRevisions" r ON r.id = i.revision_id
     LEFT JOIN racingcoach."SetupRevisions" m ON m.id = i.matched_revision_id
     WHERE i.user_id = $1 ORDER BY i.last_observed_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    setupId: row.setup_id == null ? null : Number(row.setup_id),
    setupName: row.setup_name ?? null,
    revisionId: row.revision_id == null ? null : Number(row.revision_id),
    revisionNumber: row.revision_number == null ? null : Number(row.revision_number),
    matchedRevisionId: row.matched_revision_id == null ? null : Number(row.matched_revision_id),
    matchedRevisionNumber: row.matched_revision_number == null ? null : Number(row.matched_revision_number),
    result: row.result as InspectionResult,
    simSetupName: row.sim_setup_name ?? null,
    car: row.car ?? null,
    track: row.track ?? null,
    subSessionId: row.subsession_id == null ? null : Number(row.subsession_id),
    observedAt: iso(row.observed_at)!,
    lastObservedAt: iso(row.last_observed_at)!,
  }));
}

export type HistoryEntry =
  | { type: 'revision'; at: string; setupId: number; setupName: string; revision: RevisionSummary }
  | { type: 'inspection'; at: string; setupId: number | null; setupName: string | null; inspection: InspectionRecord }
  | { type: 'proposal'; at: string; setupId: number; setupName: string; proposal: ProposalSummary }
  | { type: 'changeSheet'; at: string; setupId: number; setupName: string; revision: RevisionSummary };

export async function readHistory(userId: number, setupId: number | null): Promise<HistoryEntry[]> {
  await ensureUserSchema();
  const filter = setupId ? 'AND s.id = $2' : '';
  const params = setupId ? [userId, setupId] : [userId];
  const [revisions, proposals, inspections] = await Promise.all([
    query(
      `SELECT ${REVISION_COLUMNS}, s.name AS setup_name FROM racingcoach."SetupRevisions" r JOIN racingcoach."Setups" s ON s.id = r.setup_id
       WHERE r.user_id = $1 ${filter} ORDER BY r.created_at DESC LIMIT 300`,
      params
    ),
    query(
      `SELECT p.id, p.setup_id, p.revision_id, p.question, p.answer, p.changes, p.resulting_revision_id, p.created_at, p.decided_at,
              s.name AS setup_name FROM racingcoach."SetupProposals" p JOIN racingcoach."Setups" s ON s.id = p.setup_id
       WHERE p.user_id = $1 ${filter} ORDER BY p.created_at DESC LIMIT 100`,
      params
    ),
    readInspections(userId, 200),
  ]);
  const entries: HistoryEntry[] = [];
  for (const row of revisions) {
    const revision = revisionOf(row);
    entries.push({ type: 'revision', at: revision.createdAt, setupId: revision.setupId, setupName: String(row.setup_name), revision });
    if (revision.changeSheetAt) entries.push({ type: 'changeSheet', at: revision.changeSheetAt, setupId: revision.setupId, setupName: String(row.setup_name), revision });
  }
  for (const row of proposals) {
    const proposal = proposalOf(row);
    entries.push({ type: 'proposal', at: proposal.decidedAt ?? proposal.createdAt, setupId: proposal.setupId, setupName: String(row.setup_name), proposal });
  }
  for (const inspection of inspections) {
    if (setupId && inspection.setupId !== setupId) continue;
    entries.push({ type: 'inspection', at: inspection.observedAt, setupId: inspection.setupId, setupName: inspection.setupName, inspection });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 400);
}

// ---------------------------------------------------------------------------------------------------------------
// The library

export async function createStoSetup(
  userId: number,
  input: { fileName: string; bytes: Buffer; car?: string | null; carKey?: string | null; track?: string | null }
): Promise<{ setupId: number; duplicate: boolean; info: StoInfo }> {
  await ensureUserSchema();
  const info = readStoFile(new Uint8Array(input.bytes));
  const sha = createHash('sha256').update(input.bytes).digest('hex');
  const status: ParseStatus = info.status;
  return transaction(async (client) => {
    await lock(client, userId);
    const { rows: same } = await client.query(`SELECT id FROM racingcoach."Setups" WHERE user_id = $1 AND sto_sha256 = $2 LIMIT 1`, [userId, sha]);
    if (same[0]) return { setupId: Number(same[0].id), duplicate: true, info };
    // A setup the collector already saw iRacing load under this file name (and car, when one is given) gets the file
    const { rows: seen } = await client.query(
      `SELECT id FROM racingcoach."Setups"
       WHERE user_id = $1 AND source = 'sdk' AND sto_file IS NULL AND lower(file_name) = lower($2)
         AND ($3::text IS NULL OR lower(car) = lower($3) OR lower(car_key) = lower($4::text))
       ORDER BY updated_at DESC`,
      [userId, input.fileName, input.car ?? null, input.carKey ?? null]
    );
    const values = [input.bytes, sha, input.bytes.length, JSON.stringify(info), status, info.parserVersion];
    if (seen.length === 1) {
      await client.query(
        `UPDATE racingcoach."Setups" SET sto_file = $3, sto_sha256 = $4, sto_bytes = $5, sto_info = $6, parse_status = $7,
           parser_version = $8, source = 'sto', updated_at = now()
         WHERE user_id = $1 AND id = $2`,
        [userId, seen[0].id, ...values]
      );
      return { setupId: Number(seen[0].id), duplicate: false, info };
    }
    if ((await countSetups(client, userId)) >= SETUP_LIMITS.setupsPerUser) throw new SetupError('tooMany');
    const { rows } = await client.query(
      `INSERT INTO racingcoach."Setups" (user_id, name, car, car_key, track, source, file_name, sto_file, sto_sha256, sto_bytes, sto_info,
         parse_status, parser_version)
       VALUES ($1, $2, $3, $4, $5, 'sto', $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [userId, input.fileName.replace(/\.sto$/i, '').slice(0, SETUP_LIMITS.nameChars), input.car ?? null, input.carKey ?? null, input.track ?? null, input.fileName, ...values]
    );
    return { setupId: Number(rows[0].id), duplicate: false, info };
  });
}

export async function updateSetup(
  userId: number,
  setupId: number,
  changes: { name?: string; notes?: string; car?: string | null; track?: string | null; archived?: boolean }
): Promise<boolean> {
  await ensureUserSchema();
  const sets: string[] = [];
  const params: unknown[] = [userId, setupId];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (changes.name !== undefined) set('name', changes.name);
  if (changes.notes !== undefined) set('notes', changes.notes);
  if (changes.car !== undefined) {
    set('car', changes.car);
    // A car typed by hand isn't iRacing's key; the next capture of this setup sets it again
    sets.push('car_key = NULL');
  }
  if (changes.track !== undefined) set('track', changes.track);
  if (changes.archived !== undefined) sets.push(changes.archived ? 'archived_at = COALESCE(archived_at, now())' : 'archived_at = NULL');
  if (!sets.length) return true;
  const rows = await query(
    `UPDATE racingcoach."Setups" SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING id`,
    params
  );
  return rows.length > 0;
}

export async function deleteSetup(userId: number, setupId: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query(`DELETE FROM racingcoach."Setups" WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, setupId]);
  return rows.length > 0;
}

export async function duplicateSetup(userId: number, setupId: number, name: string): Promise<number> {
  await ensureUserSchema();
  return transaction(async (client) => {
    await lock(client, userId);
    if ((await countSetups(client, userId)) >= SETUP_LIMITS.setupsPerUser) throw new SetupError('tooMany');
    const { rows } = await client.query(
      `INSERT INTO racingcoach."Setups" (user_id, simulator, name, car, car_key, track, track_key, source, file_name, notes, sto_file,
         sto_sha256, sto_bytes, sto_info, parse_status, parser_version)
       SELECT user_id, simulator, $3, car, car_key, track, track_key, 'generated', NULL, notes, sto_file, NULL, sto_bytes, sto_info,
              parse_status, parser_version
       FROM racingcoach."Setups" WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, setupId, name.slice(0, SETUP_LIMITS.nameChars)]
    );
    if (!rows[0]) throw new SetupError('notFound');
    const copyId = Number(rows[0].id);
    const { rows: latest } = await client.query(
      `SELECT id, revision_number, yaml FROM racingcoach."SetupRevisions" WHERE setup_id = $1 ORDER BY revision_number DESC LIMIT 1`,
      [setupId]
    );
    if (latest[0]) {
      const parameters = await readParameters(client, Number(latest[0].id));
      await insertRevision(client, userId, {
        setupId: copyId,
        parentId: Number(latest[0].id),
        kind: 'duplicate',
        author: 'user',
        summary: '',
        changed: [],
        parameters,
        yaml: latest[0].yaml,
      });
    }
    return copyId;
  });
}

// A new revision of a setup from changes to one of its revisions (by hand, or the Setup Engineer's approved ones)
export async function createRevisionFromChanges(
  userId: number,
  baseRevisionId: number,
  changes: { path: string; value: number }[],
  meta: { kind: 'manual' | 'engineer'; author: 'user' | 'setupEngineer'; summary: string }
): Promise<{ revisionId: number; changed: AppliedChange[] }> {
  await ensureUserSchema();
  return transaction(async (client) => {
    await lock(client, userId);
    const { rows } = await client.query(`SELECT id, setup_id FROM racingcoach."SetupRevisions" WHERE user_id = $1 AND id = $2`, [userId, baseRevisionId]);
    if (!rows[0]) throw new SetupError('notFound');
    const parameters = await readParameters(client, baseRevisionId);
    if (!parameters.length) throw new SetupError('noValues');
    const applied = applyChanges(parameters, changes);
    if ('error' in applied) throw new SetupError('badChange', `${applied.error}: ${applied.path}`);
    if (!applied.changed.length) throw new SetupError('badChange', 'nothing changed');
    const revisionId = await insertRevision(client, userId, {
      setupId: Number(rows[0].setup_id),
      parentId: baseRevisionId,
      kind: meta.kind,
      author: meta.author,
      summary: meta.summary,
      changed: applied.changed,
      parameters: applied.parameters,
    });
    await client.query(`UPDATE racingcoach."Setups" SET updated_at = now() WHERE id = $1`, [rows[0].setup_id]);
    return { revisionId, changed: applied.changed };
  });
}

// Any revision brought back as the newest one (the one restored stays as it was)
export async function restoreRevision(userId: number, revisionId: number): Promise<number> {
  await ensureUserSchema();
  return transaction(async (client) => {
    await lock(client, userId);
    const { rows } = await client.query(
      `SELECT id, setup_id, revision_number, yaml FROM racingcoach."SetupRevisions" WHERE user_id = $1 AND id = $2`,
      [userId, revisionId]
    );
    if (!rows[0]) throw new SetupError('notFound');
    const parameters = await readParameters(client, revisionId);
    const { rows: latest } = await client.query(
      `SELECT id FROM racingcoach."SetupRevisions" WHERE setup_id = $1 ORDER BY revision_number DESC LIMIT 1`,
      [rows[0].setup_id]
    );
    const current = latest[0] ? await readParameters(client, Number(latest[0].id)) : [];
    const id = await insertRevision(client, userId, {
      setupId: Number(rows[0].setup_id),
      parentId: revisionId,
      kind: 'restore',
      author: 'user',
      summary: '',
      changed: diffSettings(current, parameters),
      parameters,
      yaml: rows[0].yaml,
    });
    await client.query(`UPDATE racingcoach."Setups" SET updated_at = now() WHERE id = $1`, [rows[0].setup_id]);
    return id;
  });
}

export async function markChangeSheet(userId: number, revisionId: number): Promise<void> {
  await query(`UPDATE racingcoach."SetupRevisions" SET change_sheet_at = now() WHERE user_id = $1 AND id = $2`, [userId, revisionId]);
}

// ---------------------------------------------------------------------------------------------------------------
// The collector's captures (POST /api/collector/setup)

export type CaptureInput = {
  simulator: 'iracing';
  car: string;
  carKey: string | null;
  track: string | null;
  trackKey: string | null;
  setupName: string | null;
  loadType: string | null;
  modified: boolean | null;
  passedTech: number | null;
  fixedSession: boolean | null;
  sessionId: number;
  subSessionId: number;
  observedAt: Date;
  yaml: string;
};

export type CaptureResult = { setupId: number; revisionId: number | null; newRevision: boolean; inspection: InspectionResult };

export async function recordCapture(userId: number, capture: CaptureInput): Promise<CaptureResult> {
  await ensureUserSchema();
  const parsed = parseCarSetupYaml(capture.yaml);
  const result = inspectionResult(capture.passedTech);
  const fileName = capture.setupName?.trim() || null;
  return transaction(async (client) => {
    await lock(client, userId);
    // The setup: the user's of this file name and car (an uploaded .sto first), else a new one
    const { rows: found } = await client.query(
      `SELECT id, car, track FROM racingcoach."Setups"
       WHERE user_id = $1 AND source IN ('sdk', 'sto') AND archived_at IS NULL
         AND lower(COALESCE(file_name, '')) = lower(COALESCE($2::text, ''))
         AND (lower(car_key) = lower($3::text) OR (car_key IS NULL AND (car IS NULL OR lower(car) = lower($4))))
       ORDER BY (sto_file IS NOT NULL) DESC, updated_at DESC LIMIT 1`,
      [userId, fileName, capture.carKey, capture.car]
    );
    let setupId: number;
    if (found[0]) {
      setupId = Number(found[0].id);
      await client.query(
        `UPDATE racingcoach."Setups" SET car = COALESCE(car, $2), car_key = COALESCE(car_key, $3), track = COALESCE(track, $4),
           track_key = COALESCE(track_key, $5), updated_at = now() WHERE id = $1`,
        [setupId, capture.car, capture.carKey, capture.track, capture.trackKey]
      );
    } else {
      if ((await countSetups(client, userId)) >= SETUP_LIMITS.setupsPerUser) throw new SetupError('tooMany');
      const { rows } = await client.query(
        `INSERT INTO racingcoach."Setups" (user_id, name, car, car_key, track, track_key, source, file_name, parse_status, parser_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'sdk', $7, 'none', $8) RETURNING id`,
        [
          userId,
          (fileName?.replace(/\.sto$/i, '') || capture.car).slice(0, SETUP_LIMITS.nameChars),
          capture.car,
          capture.carKey,
          capture.track,
          capture.trackKey,
          fileName,
          SETUP_YAML_PARSER_VERSION,
        ]
      );
      setupId = Number(rows[0].id);
    }

    // The revision: the latest capture again when its adjustable values are the same, else a new one
    let revisionId: number | null = null;
    let newRevision = false;
    if (parsed.parameters.length) {
      const hash = settingsHash(parsed.parameters);
      const { rows: latest } = await client.query(
        `SELECT id, kind, settings_sha256 FROM racingcoach."SetupRevisions" WHERE setup_id = $1 ORDER BY revision_number DESC LIMIT 1`,
        [setupId]
      );
      if (latest[0] && latest[0].kind === 'capture' && latest[0].settings_sha256 === hash) {
        revisionId = Number(latest[0].id);
        // The same setup: only iRacing's readings (pressures after a run, tread) and when it was seen are new
        await client.query(
          `UPDATE racingcoach."SetupRevisions" SET yaml = $2, update_count = $3, sim_modified = $4, fixed_session = $5,
             sim_load_type = $6, last_seen_at = $7 WHERE id = $1`,
          [revisionId, capture.yaml, parsed.updateCount, capture.modified, capture.fixedSession, capture.loadType, capture.observedAt]
        );
        await client.query(`DELETE FROM racingcoach."SetupValues" WHERE revision_id = $1`, [revisionId]);
        await insertValues(client, userId, revisionId, parsed.parameters);
      } else {
        const before = latest[0] ? await readParameters(client, Number(latest[0].id)) : [];
        revisionId = await insertRevision(client, userId, {
          setupId,
          parentId: latest[0] ? Number(latest[0].id) : null,
          kind: 'capture',
          author: 'collector',
          summary: '',
          changed: latest[0] ? diffSettings(before, parsed.parameters) : [],
          parameters: parsed.parameters,
          yaml: capture.yaml,
          capture,
        });
        newRevision = true;
        // Only so many captures are kept per setup: the oldest beyond it go (never the newest, nor other revisions)
        await client.query(
          `DELETE FROM racingcoach."SetupRevisions" WHERE id IN (
             SELECT id FROM racingcoach."SetupRevisions" WHERE setup_id = $1 AND kind = 'capture'
             ORDER BY revision_number DESC OFFSET $2)`,
          [setupId, SETUP_LIMITS.capturesPerSetup]
        );
      }
    }

    // A revision made here whose adjustable values iRacing now shows exactly: the driver loaded it, so it's observed
    let matched: number | null = null;
    if (parsed.parameters.length) {
      const { rows } = await client.query(
        `UPDATE racingcoach."SetupRevisions" r SET validation = 'observed'
         FROM racingcoach."Setups" s
         WHERE r.setup_id = s.id AND r.user_id = $1 AND r.kind IN ('manual', 'engineer', 'restore', 'duplicate')
           AND r.settings_sha256 = $2 AND (lower(s.car_key) = lower($3::text) OR lower(s.car) = lower($4))
         RETURNING r.id, r.created_at`,
        [userId, settingsHash(parsed.parameters), capture.carKey, capture.car]
      );
      matched = rows.length ? Number([...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0].id) : null;
    }

    // iRacing's inspection result: a new record when it changes (or the session does), else the last one seen again
    const { rows: last } = await client.query(
      `SELECT id, result, subsession_id, revision_id FROM racingcoach."SetupInspections" WHERE setup_id = $1 ORDER BY last_observed_at DESC LIMIT 1`,
      [setupId]
    );
    const subSession = capture.subSessionId || null;
    const lastRevision = last[0]?.revision_id == null ? null : Number(last[0].revision_id);
    if (last[0] && last[0].result === result && (last[0].subsession_id ?? null) === subSession && lastRevision === revisionId) {
      await client.query(`UPDATE racingcoach."SetupInspections" SET last_observed_at = $2, matched_revision_id = COALESCE($3, matched_revision_id) WHERE id = $1`, [
        last[0].id,
        capture.observedAt,
        matched,
      ]);
    } else {
      await client.query(
        `INSERT INTO racingcoach."SetupInspections" (user_id, setup_id, revision_id, matched_revision_id, result, passed_tech, sim_setup_name,
           car, track, session_id, subsession_id, observed_at, last_observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [userId, setupId, revisionId, matched, result, capture.passedTech, fileName, capture.car, capture.track, capture.sessionId || null, subSession, capture.observedAt]
      );
    }
    return { setupId, revisionId, newRevision, inspection: result };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The Setup Engineer's proposals

export type ProposalChange = SetupProposal & { status: 'pending' | 'accepted' | 'rejected' };
export type EngineerAnswer = { summary: string; findings: string[]; hypotheses: string[]; recommendations: string[] };

export type ProposalSummary = {
  id: number;
  setupId: number;
  revisionId: number | null;
  question: string;
  answer: EngineerAnswer;
  changes: ProposalChange[];
  resultingRevisionId: number | null;
  createdAt: string;
  decidedAt: string | null;
};

function proposalOf(row: Record<string, unknown>): ProposalSummary {
  return {
    id: Number(row.id),
    setupId: Number(row.setup_id),
    revisionId: row.revision_id == null ? null : Number(row.revision_id),
    question: String(row.question),
    answer: row.answer as EngineerAnswer,
    changes: (row.changes as ProposalChange[]) ?? [],
    resultingRevisionId: row.resulting_revision_id == null ? null : Number(row.resulting_revision_id),
    createdAt: iso(row.created_at)!,
    decidedAt: iso(row.decided_at),
  };
}

export async function saveProposal(
  userId: number,
  input: { setupId: number; revisionId: number; compareRevisionId: number | null; question: string; answer: EngineerAnswer; changes: SetupProposal[] }
): Promise<ProposalSummary> {
  await ensureUserSchema();
  const [row] = await query(
    `INSERT INTO racingcoach."SetupProposals" (user_id, setup_id, revision_id, compare_revision_id, question, answer, changes)
     SELECT $1, $2, $3, $4, $5, $6, $7 WHERE EXISTS (SELECT 1 FROM racingcoach."Setups" WHERE user_id = $1 AND id = $2)
     RETURNING *`,
    [
      userId,
      input.setupId,
      input.revisionId,
      input.compareRevisionId,
      input.question.slice(0, 2000),
      JSON.stringify(input.answer),
      JSON.stringify(input.changes.map((c) => ({ ...c, status: 'pending' }))),
    ]
  );
  if (!row) throw new SetupError('notFound');
  return proposalOf(row);
}

export async function readProposals(userId: number, setupId: number): Promise<ProposalSummary[]> {
  await ensureUserSchema();
  const rows = await query(`SELECT * FROM racingcoach."SetupProposals" WHERE user_id = $1 AND setup_id = $2 ORDER BY created_at DESC LIMIT 20`, [
    userId,
    setupId,
  ]);
  return rows.map(proposalOf);
}

// The driver's decision on each proposed change; the accepted ones make one new revision from the revision the engineer
// looked at. Decided once: a proposal already decided answers its earlier result
export async function decideProposal(
  userId: number,
  proposalId: number,
  accepted: string[]
): Promise<{ proposal: ProposalSummary; revisionId: number | null }> {
  await ensureUserSchema();
  const [row] = await query(`SELECT * FROM racingcoach."SetupProposals" WHERE user_id = $1 AND id = $2`, [userId, proposalId]);
  if (!row) throw new SetupError('notFound');
  const proposal = proposalOf(row);
  if (proposal.decidedAt) return { proposal, revisionId: proposal.resultingRevisionId };
  const take = new Set(accepted);
  const changes = proposal.changes.map((c) => ({ ...c, status: take.has(c.path) ? ('accepted' as const) : ('rejected' as const) }));
  const chosen = changes.filter((c) => c.status === 'accepted');
  let revisionId: number | null = null;
  if (chosen.length && proposal.revisionId) {
    const made = await createRevisionFromChanges(
      userId,
      proposal.revisionId,
      chosen.map((c) => ({ path: c.path, value: c.proposedValue })),
      { kind: 'engineer', author: 'setupEngineer', summary: proposal.question.slice(0, 200) }
    );
    revisionId = made.revisionId;
  }
  const [updated] = await query(
    `UPDATE racingcoach."SetupProposals" SET changes = $3, resulting_revision_id = $4, decided_at = now()
     WHERE user_id = $1 AND id = $2 AND decided_at IS NULL RETURNING *`,
    [userId, proposalId, JSON.stringify(changes), revisionId]
  );
  return { proposal: updated ? proposalOf(updated) : proposal, revisionId };
}
