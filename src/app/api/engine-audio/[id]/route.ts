import { NextResponse } from 'next/server';
import { readEngineAudioFile } from '@/lib/engineAudioAssets';
import { videoStorageConfigured } from '@/lib/objectStorage';
import { getCurrentUser } from '@/lib/session';
import { getTvSession } from '@/lib/tvAuth';

type Params = { params: Promise<{ id: string }> };

// An uploaded engine sound's file, for a signed-in user's page or a paired TV. Sent from here rather than redirected to
// object storage like the broadcast clips: Web Audio has to fetch it, and a fetch that followed a redirect there would
// need a CORS rule for reads on the bucket. The file never changes under its id, so browsers keep it.
export async function GET(_request: Request, { params }: Params) {
  try {
    const allowed = (await getCurrentUser()) || (await getTvSession());
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id) || !videoStorageConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const file = await readEngineAudioFile(Number(id));
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    console.error('Engine sound file error:', error);
    return NextResponse.json({ error: 'Failed to load the engine sound' }, { status: 500 });
  }
}
