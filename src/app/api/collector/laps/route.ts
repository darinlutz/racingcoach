import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import {
  checkLapCsv,
  collectorLapSchema,
  InvalidLapCsvError,
  MAX_UPLOAD_BYTES,
  saveCollectorLap,
} from '@/lib/collectorLaps';

// Lap uploads from the telemetry collector (collector/ in this repo). Not for browsers: the collector
// sends the user's upload key (Account page) as a bearer token, and a multipart/form-data body with
//   lap: the lap's details as JSON (collectorLapSchema)
//   csv: the lap CSV, gzip-compressed
// Answers 201 with the lap's id, or 200 with duplicate: true if that lap was already uploaded.

const UNAUTHORIZED = { error: 'Missing or unknown upload key' };

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
    const csvBytes = checkLapCsv(csvGzip, parsed.data.samples);

    const { id, duplicate } = await saveCollectorLap(userId, parsed.data, csvGzip, csvBytes);
    return NextResponse.json({ success: true, id, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof InvalidLapCsvError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Collector lap upload error:', error);
    return NextResponse.json({ error: 'Failed to save the lap' }, { status: 500 });
  }
}
