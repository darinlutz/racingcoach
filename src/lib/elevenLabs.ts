// ElevenLabs text to speech: the RaceCoach voice (the In-Car AI Coach's ElevenLabs option and Live Racing's lap time
// announcements, POST /api/live/lap-speech) and the Race Announcers' Lead and Color voices (POST /api/live/announcer).
// Each is a voice set up in the ElevenLabs account (Voice Library, Voice Design or a cloned voice), one per language
// and accent, named by its Voice ID in ELEVENLABS_<LANGUAGE>_<ROLE>_VOICE_ID, e.g.
// ELEVENLABS_ENGLISH_RACECOACH_VOICE_ID or ELEVENLABS_ESPANA_ANNOUNCER_COLOR_VOICE_ID (ENGLISH, PORTUGUESE, GERMAN, LATINO for
// Latin American Spanish, ESPANA for Spain's). ELEVENLABS_MY_VOICE_ID is the site owner's own Driver Radio voice, the
// same in every language (GET /api/live/radio-speech); other drivers' radio is in their RaceCoach voice. ELEVENLABS_MODEL_ID picks the model (ElevenLabs' default,
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
  if (language === 'de') return 'GERMAN';
  return language === 'pt' ? 'PORTUGUESE' : 'ENGLISH';
}

const apiKey = () => process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;

// The Voice ID of the role's voice in this language and accent, or null when it isn't set up
export function elevenLabsVoiceId(role: ElevenLabsRole, language: Language, spanishAccent: Accent = 'latinAmerica'): string | null {
  if (!apiKey()) return null;
  return process.env[`ELEVENLABS_${languageName(language, spanishAccent)}_${ROLE_NAMES[role]}_VOICE_ID`]?.trim() || null;
}

// The site owner's own Driver Radio voice (src/lib/driverRadio.ts, only for their accounts): one voice for every
// language, ELEVENLABS_MY_VOICE_ID, or null
export function elevenLabsRadioVoiceId(): string | null {
  if (!apiKey()) return null;
  return process.env.ELEVENLABS_MY_VOICE_ID?.trim() || null;
}

export function elevenLabsConfigured(role: ElevenLabsRole, language: Language, spanishAccent: Accent = 'latinAmerica'): boolean {
  return elevenLabsVoiceId(role, language, spanishAccent) !== null;
}

type VoiceSettings = { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean; speed: number };
const FALLBACK_SETTINGS: VoiceSettings = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
// Each voice's own settings, as saved in the ElevenLabs account, fetched once per server start
const voiceSettings = new Map<string, Promise<VoiceSettings>>();

function savedSettings(voiceId: string, key: string): Promise<VoiceSettings> {
  let settings = voiceSettings.get(voiceId);
  if (!settings) {
    settings = fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}/settings`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(5000),
    })
      .then(async (r) => (r.ok ? { ...FALLBACK_SETTINGS, ...((await r.json()) as Partial<VoiceSettings>) } : FALLBACK_SETTINGS))
      .catch(() => FALLBACK_SETTINGS);
    voiceSettings.set(voiceId, settings);
  }
  return settings;
}

// How a Race Announcer's line is delivered at each intensity (1 calm to 5 race-deciding), relative to the voice's own
// settings so it stays the same voice: less stability and more style are more expressive, and the pace picks up
const INTENSITY_DELIVERY: Record<number, { stability: number; style: number; speed: number }> = {
  1: { stability: 0.1, style: 0, speed: 0.98 },
  2: { stability: 0, style: 0.1, speed: 1 },
  3: { stability: -0.1, style: 0.25, speed: 1.04 },
  4: { stability: -0.2, style: 0.4, speed: 1.08 },
  5: { stability: -0.28, style: 0.55, speed: 1.12 },
};
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// Eleven v3 takes audio tags in the text and only three stabilities (0 creative, 0.5 natural, 1 robust); the v2 and
// flash models take the voice settings above
async function delivery(text: string, voiceId: string, key: string, model: string, intensity: number) {
  const level = clamp(Math.round(intensity), 1, 5);
  const saved = await savedSettings(voiceId, key);
  if (model.startsWith('eleven_v3')) {
    return { text: level >= 4 ? `[excited] ${text}` : text, settings: { ...saved, stability: level >= 4 ? 0 : 0.5 } };
  }
  const d = INTENSITY_DELIVERY[level];
  return {
    text,
    settings: {
      ...saved,
      stability: clamp(saved.stability + d.stability, 0.15, 0.9),
      style: clamp((saved.style ?? 0) + d.style, 0, 1),
      speed: clamp((saved.speed ?? 1) * d.speed, 0.7, 1.2),
    },
  };
}

// Characters sent to ElevenLabs since the server started (cache hits not counted), for the broadcast's cost metrics
let charactersSent = 0;
export const elevenLabsCharacters = () => charactersSent;

// The text spoken in an ElevenLabs voice (a Voice ID from elevenLabsVoiceId), as an MP3 or raw PCM. intensity (1-5)
// delivers a Race Announcer's line more calmly or more excitedly; without it the voice's own settings are used.
export async function elevenLabsSpeech(
  text: string,
  voiceId: string,
  format: keyof typeof OUTPUT_FORMATS = 'mp3',
  intensity: number | null = null
): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY must be set');
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const cacheKey = `${voiceId}\n${model}\n${format}\n${intensity ?? ''}\n${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const spoken = intensity != null ? await delivery(text, voiceId, key, model, intensity) : { text, settings: null };
  charactersSent += spoken.text.length;
  const response = await fetch(`${API_URL}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMATS[format]}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: format === 'mp3' ? 'audio/mpeg' : '*/*' },
    body: JSON.stringify({ text: spoken.text, model_id: model, ...(spoken.settings ? { voice_settings: spoken.settings } : {}) }),
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
