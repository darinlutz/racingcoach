import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { authenticateCollector } from '@/lib/collectorKeys';
import { readJsonLimited } from '@/lib/requestBody';
import { recordCapture, SETUP_LIMITS, SetupError } from '@/lib/setups';
import { extractCarSetupSection } from '@/lib/setupYaml';

// The telemetry collector's capture of the car's setup as iRacing has it loaded (SetupCapture.cs, collectors from
// 1.97.0; docs/setups.md): session info's CarSetup section (the YAML exactly as iRacing wrote it), the setup's name, load
// type and whether it's been changed since it was loaded, iRacing's inspection result (DriverSetupPassedTech) and the
// session's fixed setup flag (WeekendOptions.IsFixedSetup). Sent when any of them changes, so an unchanged setup isn't
// sent again. Authenticated with the upload key as a bearer token, like /api/collector/laps. Answers { setupId,
// revisionId, newRevision, inspection }; the collector only logs it. 400 for a capture it can't read (not retried), 429
// past ABUSE_LIMITS.setupCapturesPerHour and 409 past the setups limit (both retried later).

const captureSchema = z.object({
  simulator: z.literal('iracing').default('iracing'),
  car: z.string().trim().min(1).max(200),
  carKey: z.string().trim().max(100).nullish(),
  track: z.string().trim().max(200).nullish(),
  trackKey: z.string().trim().max(200).nullish(),
  setupName: z.string().trim().max(200).nullish(),
  loadType: z.string().trim().max(50).nullish(),
  modified: z.boolean().nullish(),
  passedTech: z.number().int().min(-1).max(10).nullish(),
  fixedSession: z.boolean().nullish(),
  sessionId: z.number().int().min(0).default(0),
  subSessionId: z.number().int().min(0).default(0),
  observedAt: z.iso.datetime({ offset: true }).optional(),
  yaml: z.string().max(SETUP_LIMITS.yamlChars),
});

export async function POST(request: Request) {
  try {
    const userId = await authenticateCollector(request);
    if (userId === null) return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    const key = `setup-captures:${userId}`;
    if (limitReached(key, ABUSE_LIMITS.setupCapturesPerHour)) {
      return NextResponse.json({ error: 'Too many setup captures; try again later' }, { status: 429, headers: { 'Retry-After': '600' } });
    }
    recordAttempt(key);
    const parsed = captureSchema.safeParse(await readJsonLimited(request, SETUP_LIMITS.yamlChars * 2 + 8192).catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid setup capture' }, { status: 400 });
    const capture = parsed.data;
    // The CarSetup section, whether the collector sent just it or the whole session info
    const yaml = capture.yaml.trimStart().startsWith('CarSetup:') ? capture.yaml : extractCarSetupSection(capture.yaml);
    if (!yaml) return NextResponse.json({ error: 'No CarSetup section' }, { status: 400 });
    // The collector's clock, but never later than now (like a lap's recordedAt)
    const observed = capture.observedAt ? new Date(capture.observedAt) : new Date();
    const result = await recordCapture(userId, {
      simulator: 'iracing',
      car: capture.car,
      carKey: capture.carKey ?? null,
      track: capture.track ?? null,
      trackKey: capture.trackKey ?? null,
      setupName: capture.setupName ?? null,
      loadType: capture.loadType ?? null,
      modified: capture.modified ?? null,
      passedTech: capture.passedTech ?? null,
      fixedSession: capture.fixedSession ?? null,
      sessionId: capture.sessionId,
      subSessionId: capture.subSessionId,
      observedAt: observed.getTime() > Date.now() ? new Date() : observed,
      yaml,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SetupError && error.code === 'tooMany') {
      return NextResponse.json({ error: 'Setup limit reached', code: 'setupLimit' }, { status: 409 });
    }
    console.error('Collector setup capture error:', error);
    return NextResponse.json({ error: 'Failed to save the setup' }, { status: 500 });
  }
}
