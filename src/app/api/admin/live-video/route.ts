import { NextResponse } from 'next/server';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { liveVideoSessions, tvReports } from '@/lib/liveVideo/broadcastSourceRuntime';
import { cachedHealth, playbackFor, streamHealth, streamSetup } from '@/lib/liveVideo/cloudflareStream';
import { MAX_LIVE_STREAMS } from '@/lib/liveVideo/streamRules';
import { getLiveVideoSettings, listStreams, setLiveVideoSettings } from '@/lib/liveVideoDb';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Admin page's Live Video & Broadcast Control (docs/live-video.md). GET: the settings, what's set up in the
// environment (never the values), each stream with its health, the race sessions TVs are watching with their OBS
// stream, and the TVs' latest player reports. PUT: saves settings (anything left out keeps its value). Admin role
// only; anyone else gets a 404.

async function overview() {
  const [settings, streams] = await Promise.all([getLiveVideoSettings(true), listStreams()]);
  const setup = streamSetup();
  const withHealth = await Promise.all(
    streams.map(async (s) => {
      const health = setup.playback || setup.api ? await streamHealth(s.inputId).catch(() => cachedHealth(s.inputId)) : null;
      // The calibration's preview: the same playback URL a viewer gets, only while it's live
      return { ...s, health, preview: health?.status === 'LIVE' ? playbackFor(s.inputId, health, s.requireSigned) : null };
    })
  );
  return { settings, setup, maxStreams: MAX_LIVE_STREAMS, streams: withHealth, sessions: liveVideoSessions(), reports: tvReports(), serverNow: Date.now() };
}

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    return NextResponse.json(await overview(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Live video admin read error:', error);
    return NextResponse.json({ error: getDictionary(user?.preferredLanguage ?? 'en').liveVideo.api.failedLoad }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    const settings = await setLiveVideoSettings(body, user.id);
    console.log(`Site setting: live video saved by user ${user.id} (enabled ${settings.enabled})`);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Live video settings error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
