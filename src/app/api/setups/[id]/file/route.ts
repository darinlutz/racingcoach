import { NextResponse } from 'next/server';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readStoBytes } from '@/lib/setups';

// The original .sto file of one of the signed-in user's setups, byte for byte as it was uploaded
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const file = await readStoBytes(session.user.id, id);
    if (!file) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup file download');
  }
}
