import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import {
  checkLapCsv,
  collectorLapSchema,
  InvalidLapCsvError,
  listCollectorLaps,
  MAX_UPLOAD_BYTES,
  saveCollectorLap,
} from '@/lib/collectorLaps';
import { getCurrentUser } from '@/lib/session';

const UNAUTHORIZED = { error: 'Missing or unknown upload key' };

// The signed-in user's uploaded laps (details only, newest first), for the Racing page.
// Uses the browser's sign-in, unlike POST.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Log in to see your recorded laps' }, { status: 401 });
    }
    return NextResponse.json({ laps: await listCollectorLaps(user.id) });
  } catch (error) {
    console.error('Collector lap list error:', error);
    return NextResponse.json({ error: 'Failed to load your recorded laps' }, { status: 500 });
  }
}

// Lap uploads from the telemetry collector (collector/ in this repo). Not for browsers: the collector
// sends the user's upload key (Account page) as a bearer token, and a multipart/form-data body with
//   lap: the lap's details as JSON (collectorLapSchema)
//   csv: the lap CSV, gzip-compressed
// Answers 201 with the lap's id, or 200 with duplicate: true if that lap was already uploaded (and
// replaced: true if this copy's track positions replaced a stored copy without them).
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    // Leave room for the lap JSON and multipart boundaries around the CSV
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'Upload is too large' }, { status: 413 });
    }

    const form = await request.formData().catch(() => null);
    const lapField = form?.get('lap');
    const csvField = form?.get('csv');
    if (typeof lapField !== 'string' || !(csvField instanceof File)) {
      return NextResponse.json({ error: 'Expected multipart/form-data with lap and csv fields' }, { status: 400 });
    }
    if (csvField.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'csv is too large' }, { status: 413 });
    }

    let lapJson: unknown;
    try {
      lapJson = JSON.parse(lapField);
    } catch {
      return NextResponse.json({ error: 'lap must be JSON' }, { status: 400 });
    }
    const parsed = collectorLapSchema.safeParse(lapJson);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
      return NextResponse.json({ error: `Invalid lap details: ${fields.join(', ')}` }, { status: 400 });
    }

    const csvGzip = Buffer.from(await csvField.arrayBuffer());
    const { csvBytes, hasPosition } = checkLapCsv(csvGzip, parsed.data.samples);

    const { id, duplicate, replaced } = await saveCollectorLap(userId, parsed.data, csvGzip, csvBytes, hasPosition);
    return NextResponse.json({ success: true, id, duplicate, replaced }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof InvalidLapCsvError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Collector lap upload error:', error);
    return NextResponse.json({ error: 'Failed to save the lap' }, { status: 500 });
  }
}
