import { NextResponse } from 'next/server';
import { authenticateCollectorCached } from '@/lib/collectorKeys';
import { readVoiceMessage } from '@/lib/liveRacing';

// A watcher's voice message to the driver (the Live Racing page's Hold to Talk, POST /api/live/voice-message), as the
// WAV they recorded, for the collector to play in the car; the answer to its live update names it (messages'
// audioId). Authenticated with the upload key as a bearer token; only the driver it was sent to gets it. 404 once
// it's gone (a minute after it was sent).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await authenticateCollectorCached(request);
    if (userId === null) {
      return NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 });
    }
    const wav = readVoiceMessage(userId, (await params).id);
    if (!wav) {
      return NextResponse.json({ error: 'No such voice message' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Collector voice message error:', error);
    return NextResponse.json({ error: 'Failed to read the voice message' }, { status: 500 });
  }
}
