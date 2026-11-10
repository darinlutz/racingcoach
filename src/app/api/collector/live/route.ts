import { NextResponse } from 'next/server';
import { authenticateCollectorCached } from '@/lib/collectorKeys';
import { clearLiveUpdate, liveUpdateSchema, liveUser, recordLiveUpdate } from '@/lib/liveRacing';
import { readJsonLimited } from '@/lib/requestBody';
import { hasSavedOutline } from '@/lib/trackOutlines';
import { getDictionary } from '@/lib/i18n/server';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/languages';
import { canUseInCarCoach } from '@/lib/roles';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// Enable AI Features, read at most once a minute, as live updates come twice a second
let aiFeatures: { on: boolean; until: number } | null = null;
async function aiFeaturesOn(): Promise<boolean> {
  if (aiFeatures && aiFeatures.until > Date.now()) return aiFeatures.on;
  const on = await getEnableAiFeatures().catch(() => false);
  aiFeatures = { on, until: Date.now() + 60_000 };
  return on;
}

// The telemetry collector's live position for Live Racing (src/lib/liveRacing.ts), twice a second while the driver
// is in the car and every few seconds otherwise. Authenticated with the upload key as a bearer token, like
// /api/collector/laps. Answers { watchers, needsOutline, needsField, savedOutline, messages, announcerSpeakingMs }:
// watchers' messages to say, how long to hold the In-Car AI Coach while the driver's own Race Announcers speak, how
// many others are watching,
// whether to send the collector's approximate outline of the track with the next update (the track has none saved,
// and it hasn't been sent), whether to send the field's car details with it (this server doesn't have them), and
// whether the track has a saved outline (GET /api/collector/track-outline gives it).
export async function POST(request: Request) {
  try {
    const userId = await authenticateCollectorCached(request);
    const user = userId === null ? null : await liveUser(userId);
    if (!user) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const parsed = liveUpdateSchema.safeParse(await readJsonLimited(request, 2 * 1024 * 1024).catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid live update' }, { status: 400 });
    }
    const savedOutline = parsed.data.trackKey ? await hasSavedOutline(parsed.data.trackKey) : false;
    // The In-Car AI Coach's weather alerts (src/lib/engineering/weatherAlerts.ts), for the drivers who have the coach
    const alertTexts =
      canUseInCarCoach(user) && (await aiFeaturesOn()) ? getDictionary(user.preferredLanguage ?? DEFAULT_LANGUAGE).coachSpeech.weather : null;
    return NextResponse.json({ ...recordLiveUpdate(user, parsed.data, savedOutline, alertTexts), savedOutline });
  } catch (error) {
    console.error('Collector live update error:', error);
    return NextResponse.json({ error: 'Failed to record the live update' }, { status: 500 });
  }
}

// The collector closed, or iRacing did: the driver leaves Live Racing at once instead of after a few seconds
export async function DELETE(request: Request) {
  try {
    const userId = await authenticateCollectorCached(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    clearLiveUpdate(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Collector live clear error:', error);
    return NextResponse.json({ error: 'Failed to clear the live update' }, { status: 500 });
  }
}
