import { NextResponse } from 'next/server';
import { ClipTimesError, deleteVideo, updateVideo, videoDetailsSchema } from '@/lib/broadcastVideos';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

// One clip in the Broadcast Video Library: PATCH changes any of its details, including enabled, DELETE removes it and its
// file. Admin role only; anyone else gets a 404.

export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const b = getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast;
  try {
    const { id } = await params;
    if (!user || !isAdmin(user.role) || !/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const parsed = videoDetailsSchema.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: b.invalidDetails }, { status: 400 });
    }
    const video = await updateVideo(Number(id), parsed.data);
    if (!video) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    return NextResponse.json({ video });
  } catch (error) {
    if (error instanceof ClipTimesError) return NextResponse.json({ error: b.invalidClipTimes }, { status: 400 });
    console.error('Broadcast video update error:', error);
    return NextResponse.json({ error: b.failedSave }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const b = getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast;
  try {
    const { id } = await params;
    if (!user || !isAdmin(user.role) || !/^\d{1,9}$/.test(id) || !(await deleteVideo(Number(id)))) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Broadcast video delete error:', error);
    return NextResponse.json({ error: b.failedSave }, { status: 500 });
  }
}
