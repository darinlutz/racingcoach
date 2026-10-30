import { NextResponse } from 'next/server';
import { readVideoStorageKey } from '@/lib/broadcastVideos';
import { presignVideoPlayback, videoStorageConfigured } from '@/lib/objectStorage';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getTvSession } from '@/lib/tvAuth';

type Params = { params: Promise<{ id: string }> };

// A broadcast clip's file, for the Admin page's preview and paired TVs: checks who's asking, then sends the player on to
// object storage with a short-lived signed URL, so video never passes through the web server and the URL in the page
// stays good. Range requests go with the redirect.
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    const allowed = (user && isAdmin(user.role)) || (await getTvSession());
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!/^\d{1,9}$/.test(id) || !videoStorageConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const key = await readVideoStorageKey(Number(id));
    if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new Response(null, { status: 302, headers: { Location: await presignVideoPlayback(key), 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Broadcast video media error:', error);
    return NextResponse.json({ error: 'Failed to load the video' }, { status: 500 });
  }
}
