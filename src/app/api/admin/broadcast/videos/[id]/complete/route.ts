import { NextResponse } from 'next/server';
import { markUploaded, readVideo } from '@/lib/broadcastVideos';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { processNextVideo } from '@/lib/videoProcessing';

type Params = { params: Promise<{ id: string }> };

// The browser finished uploading a clip's file to object storage: checks it's there and queues it to be checked
// (src/lib/videoProcessing.ts), starting on that straight away rather than at the worker's next round. Admin role only.
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const b = getDictionary(user?.preferredLanguage ?? 'en').admin.broadcast;
  try {
    const { id } = await params;
    if (!user || !isAdmin(user.role) || !/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const result = await markUploaded(Number(id));
    if (result === 'notFound') return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    if (result === 'missing') return NextResponse.json({ error: b.fileNotUploaded, code: 'missing' }, { status: 409 });
    if (result === 'tooLarge') return NextResponse.json({ error: b.fileTooLarge, code: 'tooLarge' }, { status: 413 });
    void processNextVideo().catch((error) => console.error('Broadcast video processing error:', error));
    return NextResponse.json({ video: await readVideo(Number(id)) });
  } catch (error) {
    console.error('Broadcast video complete error:', error);
    return NextResponse.json({ error: b.failedSave }, { status: 500 });
  }
}
