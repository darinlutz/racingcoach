// ElevenLabs text to speech, for Live Racing's lap time announcements (POST /api/live/lap-speech). The voice is the
// one set up in the ElevenLabs account (Voice Library, Voice Design or a cloned voice), named by its Voice ID in
// ELEVENLABS_VOICE_ID; ELEVENLABS_MODEL_ID picks the model (ElevenLabs' default, eleven_multilingual_v2, without it).
// The API key is ELEVENLABS_API_KEY, or ELEVEN_LABS_API_KEY.

const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
// MP3 for the browser; raw PCM (24 kHz, 16-bit, mono) for the In-Car AI Coach, which coachVoice.ts makes a WAV file
const OUTPUT_FORMATS = { mp3: 'mp3_44100_128', pcm: 'pcm_24000' } as const;
const TIMEOUT_MS = 15_000;
// Recent speech, so the same words play again without another call
const CACHE_SIZE = 64;
const cache = new Map<string, Buffer>();

const apiKey = () => process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;

export function elevenLabsConfigured(): boolean {
  return !!apiKey() && !!process.env.ELEVENLABS_VOICE_ID;
}

// The text spoken in the ElevenLabs voice, as an MP3 or raw PCM
export async function elevenLabsSpeech(text: string, format: keyof typeof OUTPUT_FORMATS = 'mp3'): Promise<Buffer> {
  const key = apiKey();
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voiceId) throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set');
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
