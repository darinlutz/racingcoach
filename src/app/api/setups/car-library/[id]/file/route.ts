import { NextResponse } from 'next/server';
import { readCarSetupFile } from '@/lib/carSetupLibrary';
import { adminSession } from '@/lib/carSetupRoutes';
import { idOf } from '@/lib/setupRoutes';

// An imported iRacing setup's original file, byte for byte (?kind=sto, the default, or htm), streamed through the
// server after the Admin check and checked against the hash it was imported with; the bucket is never exposed. The .htm
// is sent as a download too, never as a page, so nothing in it can run on the site. Admins only, 404 otherwise.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminSession();
  if (admin.response) return admin.response;
  const id = idOf((await params).id);
  const kind = new URL(request.url).searchParams.get('kind') === 'htm' ? 'htm' : 'sto';
  try {
    const file = id ? await readCarSetupFile(id, kind) : null;
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Content-Length': String(file.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    console.error('Car setup file download error:', error);
    return NextResponse.json({ error: 'Failed to download the file' }, { status: 500 });
  }
}
