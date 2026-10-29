import { NextResponse } from 'next/server';
import { authenticateCollectorCached } from '@/lib/collectorKeys';
import { clearLiveUpdate, liveUpdateSchema, liveUser, recordLiveUpdate } from '@/lib/liveRacing';
import { hasSavedOutline } from '@/lib/trackOutlines';

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
    const parsed = liveUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid live update' }, { status: 400 });
    }
    const savedOutline = parsed.data.trackKey ? await hasSavedOutline(parsed.data.trackKey) : false;
    return NextResponse.json({ ...recordLiveUpdate(user, parsed.data, savedOutline), savedOutline });
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
