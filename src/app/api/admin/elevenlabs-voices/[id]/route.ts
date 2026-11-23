import { NextResponse } from 'next/server';
import { validateVoice } from '@/lib/elevenLabsVoiceRules';
import { elevenLabsVoiceErrorResponse, elevenLabsVoicesAdmin, invalidVoice } from '@/lib/elevenLabsVoiceRoutes';
import { checkVoiceWithElevenLabs, deleteElevenLabsVoice, updateElevenLabsVoice } from '@/lib/elevenLabsVoices';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf } from '@/lib/setupRoutes';

type Params = { params: Promise<{ id: string }> };

// One of the Admin page's ElevenLabs voices (src/lib/elevenLabsVoices.ts). PUT { name, voiceId, role, language,
// enabled, notes } changes it, its Voice ID checked with ElevenLabs as when it was added; DELETE removes it, after which
// that role and language speaks with a Chirp voice until another is added. Admin role only; anyone else 404.
export async function PUT(request: Request, { params }: Params) {
  const session = await elevenLabsVoicesAdmin();
  if (session.response) return session.response;
  const { t, user } = session;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: t.errors.notFound }, { status: 404 });
  const parsed = validateVoice(await readJsonLimited(request, 8000).catch(() => null));
  if (!parsed.ok) return invalidVoice(parsed.problems, t);
  try {
    const elevenLabsName = await checkVoiceWithElevenLabs(parsed.voice.voiceId);
    const voice = await updateElevenLabsVoice(id, parsed.voice, elevenLabsName, user.id);
    console.log(`ElevenLabs voice ${id} (${voice.role}, ${voice.language}) changed by user ${user.id}`);
    return NextResponse.json({ voice });
  } catch (error) {
    return elevenLabsVoiceErrorResponse(error, t, 'ElevenLabs voice change');
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await elevenLabsVoicesAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.errors.notFound }, { status: 404 });
  try {
    await deleteElevenLabsVoice(id);
    console.log(`ElevenLabs voice ${id} deleted by user ${session.user.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return elevenLabsVoiceErrorResponse(error, session.t, 'ElevenLabs voice delete');
  }
}
