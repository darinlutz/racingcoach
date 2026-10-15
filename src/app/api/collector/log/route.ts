import { NextResponse } from 'next/server';
import { authenticateCollector } from '@/lib/collectorKeys';
import { scheduleCollectorLogReview } from '@/lib/collectorLogReview';
import { collectorLogBatchSchema, MAX_LOG_LINES, saveCollectorLog } from '@/lib/collectorLogs';

// The telemetry collector's activity log (LogUploader.cs), stored in racingcoach."CollectorLogs". Authenticated
// with the upload key as a bearer token, like /api/collector/laps.
// Body: { runId, version, lines: [{ seq, at, message, isError }] } (at most MAX_LOG_LINES lines; at is ISO 8601
// with the PC's UTC offset). Answers { saved }. A batch with lines that look like trouble gets the log review
// agent (src/lib/collectorLogReview.ts) a minute and a half later.
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const parsed = collectorLogBatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Expected { runId, version, lines: [{ seq, at, message, isError }] } with 1 to ${MAX_LOG_LINES} lines` },
        { status: 400 }
      );
    }
    await saveCollectorLog(userId, parsed.data);
    scheduleCollectorLogReview(userId, parsed.data.runId, parsed.data.lines);
    return NextResponse.json({ saved: parsed.data.lines.length });
  } catch (error) {
    console.error('Collector log error:', error);
    return NextResponse.json({ error: 'Failed to save the log' }, { status: 500 });
  }
}
