import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDirectorSettings, readVideoHistory, setDirectorSettings } from '@/lib/broadcastVideos';
import { VIDEO_CATEGORIES } from '@/lib/broadcastVideoCategories';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { directorCommand, directorSessions } from '@/lib/videoDirectorRuntime';

// The Admin page's Broadcast Director section. GET: its settings, the sessions it's running now and the recent clips.
// PUT: saves settings (anything left out keeps its value). POST: a control, { action: play | returnToLive | skip,
// sessionKey, category?, videoId? }, which goes through the same sequence as an automatic clip. Admin role only; anyone
// else gets a 404.

const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('play'),
    sessionKey: z.string().min(1).max(500),
    category: z.enum(VIDEO_CATEGORIES).nullable().optional(),
    videoId: z.number().int().positive().nullable().optional(),
  }),
  z.object({ action: z.literal('returnToLive'), sessionKey: z.string().min(1).max(500) }),
  z.object({ action: z.literal('skip'), sessionKey: z.string().min(1).max(500) }),
]);

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const [settings, history] = await Promise.all([getDirectorSettings(true), readVideoHistory()]);
    return NextResponse.json({ settings, sessions: directorSessions(), history });
  } catch (error) {
    console.error('Broadcast Director read error:', error);
    return NextResponse.json({ error: getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast.failedLoad }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    }
    const settings = await setDirectorSettings(body, user.id);
    console.log(`Site setting: Broadcast Director saved by user ${user.id}`);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Broadcast Director settings error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const b = getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast;
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const parsed = commandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: b.invalidDetails }, { status: 400 });
    }
    const result = await directorCommand(parsed.data);
    console.log(`Broadcast Director: ${parsed.data.action} by user ${user.id}: ${result}`);
    if (result === 'noSession') return NextResponse.json({ error: b.noSession, code: result }, { status: 404 });
    if (result === 'busy') return NextResponse.json({ error: b.directorBusy, code: result }, { status: 409 });
    if (result === 'nothingToSkip') return NextResponse.json({ error: b.nothingToSkip, code: result }, { status: 409 });
    return NextResponse.json({ success: true, sessions: directorSessions() });
  } catch (error) {
    console.error('Broadcast Director command error:', error);
    return NextResponse.json({ error: b.failedSave }, { status: 500 });
  }
}
