// ElevenLabs text to speech: the RaceCoach voice (the In-Car AI Coach's ElevenLabs option and Live Racing's lap time
// announcements, POST /api/live/lap-speech) and the Race Announcers' Lead and Color voices (POST /api/live/announcer).
// Each is a voice set up in the ElevenLabs account (Voice Library, Voice Design or a cloned voice), one per language
// and accent, named by its Voice ID in ELEVENLABS_<LANGUAGE>_<ROLE>_VOICE_ID, e.g.
// ELEVENLABS_ENGLISH_RACECOACH_VOICE_ID or ELEVENLABS_ESPANA_ANNOUNCER_COLOR_VOICE_ID (ENGLISH, PORTUGUESE, LATINO for
// Latin American Spanish, ESPANA for Spain's). ELEVENLABS_MODEL_ID picks the model (ElevenLabs' default,
// eleven_multilingual_v2, without it). The API key is ELEVENLABS_API_KEY, or ELEVEN_LABS_API_KEY.

import type { Language } from './i18n/languages';

const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
// MP3 for the browser; raw PCM (24 kHz, 16-bit, mono) for the In-Car AI Coach, which coachVoice.ts makes a WAV file
const OUTPUT_FORMATS = { mp3: 'mp3_44100_128', pcm: 'pcm_24000' } as const;
const TIMEOUT_MS = 15_000;
// Recent speech, so the same words play again without another call
const CACHE_SIZE = 64;
const cache = new Map<string, Buffer>();

// Who's speaking: the In-Car AI Coach's RaceCoach voice, or one of the Race Announcers
export const ELEVENLABS_ROLES = ['raceCoach', 'leadAnnouncer', 'colorAnnouncer'] as const;
export type ElevenLabsRole = (typeof ELEVENLABS_ROLES)[number];

const ROLE_NAMES: Record<ElevenLabsRole, string> = {
  raceCoach: 'RACECOACH',
  leadAnnouncer: 'ANNOUNCER_LEAD',
  colorAnnouncer: 'ANNOUNCER_COLOR',
};

// The accent Spanish is spoken with (SPANISH_ACCENTS in coachVoice.ts), written out to keep this file's imports light
type Accent = 'latinAmerica' | 'spain';

function languageName(language: Language, spanishAccent: Accent): string {
  if (language === 'es') return spanishAccent === 'spain' ? 'ESPANA' : 'LATINO';
  return language === 'pt' ? 'PORTUGUESE' : 'ENGLISH';
}

const apiKey = () => process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;

// The Voice ID of the role's voice in this language and accent, or null when it isn't set up
export function elevenLabsVoiceId(role: ElevenLabsRole, language: Language, spanishAccent: Accent = 'latinAmerica'): string | null {
  if (!apiKey()) return null;
  return process.env[`ELEVENLABS_${languageName(language, spanishAccent)}_${ROLE_NAMES[role]}_VOICE_ID`]?.trim() || null;
}

export function elevenLabsConfigured(role: ElevenLabsRole, language: Language, spanishAccent: Accent = 'latinAmerica'): boolean {
  return elevenLabsVoiceId(role, language, spanishAccent) !== null;
}

// The text spoken in an ElevenLabs voice (a Voice ID from elevenLabsVoiceId), as an MP3 or raw PCM
export async function elevenLabsSpeech(text: string, voiceId: string, format: keyof typeof OUTPUT_FORMATS = 'mp3'): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY must be set');
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const cacheKey = `${voiceId}\n${model}\n${format}\n${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const response = await fetch(`${API_URL}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMATS[format]}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: format === 'mp3' ? 'audio/mpeg' : '*/*' },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs answered ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  cache.set(cacheKey, audio);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return audio;
}
