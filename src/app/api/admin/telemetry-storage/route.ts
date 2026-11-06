import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { reconcileTelemetryStorage, runTelemetryCleanup } from '@/lib/telemetryCleanup';
import {
  backfillTelemetry,
  purgeLegacyTelemetry,
  PurgeNotConfirmedError,
  rollbackReadsToPostgres,
  startStorageTask,
  stopStorageTask,
  storageTaskStatus,
  switchReadsToObjectStorage,
  vacuumCollectorLaps,
  verifyTelemetryObjects,
} from '@/lib/telemetryMigration';
import { telemetryStore } from '@/lib/telemetryStorage';
import { readTelemetryStorageReport } from '@/lib/telemetryStorageReport';

// The Admin page's Telemetry Storage section (docs/telemetry-storage.md). GET: the report (from Postgres only) and the
// background action running on this server. POST { action, ... }: backfill, verify, cleanup, reconcile and purgeLegacy
// start in the background (409 while another runs) and answer 202; stop asks the running one to stop after its batch;
// switchReads, rollbackReads and vacuum run at once. purgeLegacy needs { confirm: 'PURGE', backupTaken: true }.
// Admin role only; anyone else gets a 404, like the Admin page.

const ACTIONS = ['backfill', 'verify', 'cleanup', 'reconcile', 'purgeLegacy', 'stop', 'switchReads', 'rollbackReads', 'vacuum'] as const;
type Action = (typeof ACTIONS)[number];
const NEEDS_STORE: Action[] = ['backfill', 'verify', 'cleanup', 'reconcile', 'switchReads'];

async function admin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    const t = await apiText(user);
    return { user: null, denied: NextResponse.json({ error: t.adminOnly }, { status: 404 }) };
  }
  return { user, denied: null };
}

export async function GET() {
  const { denied } = await admin();
  if (denied) return denied;
  try {
    return NextResponse.json({ report: await readTelemetryStorageReport(), task: storageTaskStatus() });
  } catch (error) {
    console.error('Telemetry storage report error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to load the telemetry storage report' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, denied } = await admin();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action as Action;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  if (NEEDS_STORE.includes(action) && !telemetryStore()) {
    return NextResponse.json({ error: 'Telemetry object storage is not configured (TELEMETRY_S3_*)' }, { status: 409 });
  }
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const batchSize = number(body?.batchSize);
  const concurrency = number(body?.concurrency);
  const maxBatches = number(body?.maxBatches);

  try {
    switch (action) {
      case 'stop':
        return NextResponse.json({ stopping: stopStorageTask(), task: storageTaskStatus() });
      case 'switchReads':
        return NextResponse.json({ switched: await switchReadsToObjectStorage() });
      case 'rollbackReads':
        return NextResponse.json({ rolledBack: await rollbackReadsToPostgres() });
      case 'vacuum':
        await vacuumCollectorLaps();
        return NextResponse.json({ vacuumed: true });
      case 'purgeLegacy':
        // Checked here too, so a request without the confirmation is refused before anything starts
        if (body?.confirm !== 'PURGE' || body?.backupTaken !== true) {
          return NextResponse.json({ error: 'Type PURGE and confirm a database backup was taken' }, { status: 400 });
        }
        break;
    }
    const startedBy = user!.id;
    const started = startStorageTask(action as 'backfill' | 'verify' | 'cleanup' | 'reconcile' | 'purgeLegacy', (shouldStop) => {
      switch (action) {
        case 'backfill':
          return backfillTelemetry({ batchSize, concurrency, maxBatches, startedBy, shouldStop });
        case 'verify':
          return verifyTelemetryObjects({ batchSize, concurrency, startedBy, shouldStop });
        case 'cleanup':
          return runTelemetryCleanup({ startedBy });
        case 'reconcile':
          return reconcileTelemetryStorage({ startedBy });
        default:
          return purgeLegacyTelemetry({ confirm: String(body?.confirm), backupTaken: body?.backupTaken === true, startedBy });
      }
    });
    if (!started) return NextResponse.json({ error: 'Another telemetry storage action is still running', task: storageTaskStatus() }, { status: 409 });
    return NextResponse.json({ task: storageTaskStatus() }, { status: 202 });
  } catch (error) {
    if (error instanceof PurgeNotConfirmedError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(`Telemetry storage ${action} error:`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: `Failed to run ${action}` }, { status: 500 });
  }
}
