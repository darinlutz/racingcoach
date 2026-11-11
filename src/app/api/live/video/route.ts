import { NextResponse } from 'next/server';
import { limitReached, recordAttempt, ABUSE_LIMITS } from '@/lib/abuseGuards';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { liveRacingStreams } from '@/lib/liveVideo/broadcastSourceRuntime';
import { getCurrentUser } from '@/lib/session';

// The Live Racing page's OBS streams (docs/live-video.md): for each driver the user may watch on the page who has a
// stream, its status and, while it's live, the playback URL (signed when the input requires it). Never a stream key
// or API token. Statuses come from the server's cache (one Cloudflare request per stream every 10 s, however many
// viewers). Answers { enabled: false } while live video is off. Signed-in users only, the same as the page; rate
// limited per user.
export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    const v = getDictionary(user.preferredLanguage).liveVideo.api;
    const key = `liveVideo:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.liveVideoStreamsPerUser)) return NextResponse.json({ error: v.tooMany }, { status: 429 });
    recordAttempt(key);
    const found = await liveRacingStreams(user);
    if (!found) return NextResponse.json({ enabled: false, streams: [] }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ enabled: true, ...found, serverNow: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Live video streams error:', error);
    return NextResponse.json({ error: t.failedLoadLiveRacing }, { status: 500 });
  }
}
