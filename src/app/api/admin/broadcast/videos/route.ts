import { NextResponse } from 'next/server';
import { ClipTimesError, createVideo, listLibrary, newVideoSchema, readVideoOptions } from '@/lib/broadcastVideos';
import { hasVideoExtension, MAX_VIDEO_BYTES } from '@/lib/broadcastVideoCategories';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { videoStorageConfigured } from '@/lib/objectStorage';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Admin page's Broadcast Video Library (src/lib/broadcastVideos.ts). GET lists every clip, with the tracks and cars
// to choose from. POST starts an upload: the clip's details as newVideoSchema, answering { video, uploadUrl, contentType },
// a presigned URL the browser PUTs the file to, before POST .../[id]/complete. Admin role only; anyone else gets a 404.

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const [videos, options] = await Promise.all([listLibrary(), readVideoOptions()]);
    return NextResponse.json({ videos, ...options, storageConfigured: videoStorageConfigured() });
  } catch (error) {
    console.error('Broadcast video list error:', error);
    return NextResponse.json({ error: getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast.failedLoad }, { status: 500 });
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
    if (!videoStorageConfigured()) {
      return NextResponse.json({ error: b.storageMissing, code: 'storageMissing' }, { status: 503 });
    }
    const body = await request.json().catch(() => null);
    if (body && typeof body.sizeBytes === 'number' && body.sizeBytes > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: b.fileTooLarge, code: 'tooLarge' }, { status: 413 });
    }
    const parsed = newVideoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: b.invalidDetails }, { status: 400 });
    }
    if (!hasVideoExtension(parsed.data.fileName)) {
      return NextResponse.json({ error: b.unsupportedFile, code: 'unsupported' }, { status: 415 });
    }
    return NextResponse.json(await createVideo(parsed.data, user.id), { status: 201 });
  } catch (error) {
    if (error instanceof ClipTimesError) return NextResponse.json({ error: b.invalidClipTimes }, { status: 400 });
    console.error('Broadcast video create error:', error);
    return NextResponse.json({ error: b.failedSave }, { status: 500 });
  }
}
