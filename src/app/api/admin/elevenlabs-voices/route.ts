import { NextResponse } from 'next/server';
import { validateVoice } from '@/lib/elevenLabsVoiceRules';
import { elevenLabsVoiceErrorResponse, elevenLabsVoicesAdmin, invalidVoice } from '@/lib/elevenLabsVoiceRoutes';
import { checkVoiceWithElevenLabs, createElevenLabsVoice, listElevenLabsVoices } from '@/lib/elevenLabsVoices';
import { readJsonLimited } from '@/lib/requestBody';

// The Admin page's Eleven Labs Voice Management (src/lib/elevenLabsVoices.ts). GET answers { voices, apiKeySet }:
// every voice, enabled or not. POST { name, voiceId, role, language, enabled, notes } adds one: its Voice ID is checked
// with ElevenLabs first when the API key is set (refused when ElevenLabs has no such voice), and a second enabled voice
// for the same role and language is refused (409 slotTaken). Admin role only; anyone else 404.
const apiKeySet = () => !!(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY);

export async function GET() {
  const session = await elevenLabsVoicesAdmin();
  if (session.response) return session.response;
  try {
    return NextResponse.json({ voices: await listElevenLabsVoices(), apiKeySet: apiKeySet() });
  } catch (error) {
    return elevenLabsVoiceErrorResponse(error, session.t, 'ElevenLabs voices list');
  }
}

export async function POST(request: Request) {
  const session = await elevenLabsVoicesAdmin();
  if (session.response) return session.response;
  const { t, user } = session;
  const parsed = validateVoice(await readJsonLimited(request, 8000).catch(() => null));
  if (!parsed.ok) return invalidVoice(parsed.problems, t);
  try {
    const elevenLabsName = await checkVoiceWithElevenLabs(parsed.voice.voiceId);
    const voice = await createElevenLabsVoice(parsed.voice, elevenLabsName, user.id);
    console.log(`ElevenLabs voice ${voice.id} (${voice.role}, ${voice.language}) added by user ${user.id}`);
    return NextResponse.json({ voice }, { status: 201 });
  } catch (error) {
    return elevenLabsVoiceErrorResponse(error, t, 'ElevenLabs voice add');
  }
}
