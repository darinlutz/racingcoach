import { NextResponse } from 'next/server';
import { getTvSession } from '@/lib/tvAuth';
import { readDirectorAudio } from '@/lib/videoDirectorRuntime';

type Params = { params: Promise<{ id: string }> };

// An announcer line of a clip's sequence (src/lib/videoDirectorRuntime.ts), as an MP3, for a paired TV. The ID comes with
// the TV's picture of the race, and the audio is only kept while the sequence is under way.
export async function GET(request: Request, { params }: Params) {
  const session = await getTvSession();
  if (!session) return NextResponse.json({ error: 'Not paired', code: 'notPaired' }, { status: 401 });
  const { id } = await params;
  const audio = readDirectorAudio(id);
  if (!audio) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' } });
}
