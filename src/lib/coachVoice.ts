import { query } from './db';
import { AI_LANGUAGE_NAMES, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { ensureUserSchema } from './users';

// The In-Car AI Coach's voice: Google Cloud Text-to-Speech's Chirp 3 HD voices, in the voice the driver picks on the
// Account page ("Users".coach_voice), spoken by a native voice of their Preferred Language (en-US, pt-BR, and es-US or
// es-ES by the Spanish accent they pick beside it, "Users".coach_spanish_accent). Without GOOGLE_TTS_API_KEY it falls
// back to OpenAI's gpt-4o-mini-tts, told to speak with that accent. The collector gets its speech from
// POST /api/collector/speech; the Account page's Listen button from GET /api/account/coach-voice/sample.

// Chirp 3 HD's voices the driver can pick from (Google has 30; these suit a race engineer on the radio), each with
// Google's description of its style. Every voice speaks every language as a native speaker would.
export const COACH_VOICE_DETAILS = {
  Charon: { gender: 'male', style: 'informative' },
  Orus: { gender: 'male', style: 'firm' },
  Iapetus: { gender: 'male', style: 'clear' },
  Algieba: { gender: 'male', style: 'smooth' },
  Sadaltager: { gender: 'male', style: 'knowledgeable' },
  Puck: { gender: 'male', style: 'upbeat' },
  Fenrir: { gender: 'male', style: 'excitable' },
  Kore: { gender: 'female', style: 'firm' },
  Despina: { gender: 'female', style: 'smooth' },
  Sulafat: { gender: 'female', style: 'warm' },
  Gacrux: { gender: 'female', style: 'mature' },
  Zephyr: { gender: 'female', style: 'bright' },
  Aoede: { gender: 'female', style: 'breezy' },
  Leda: { gender: 'female', style: 'youthful' },
} as const;
export type CoachVoice = keyof typeof COACH_VOICE_DETAILS;
export const COACH_VOICES = Object.keys(COACH_VOICE_DETAILS) as CoachVoice[];
// Older accounts' OpenAI voice names aren't Chirp voices, so they get this one
export const DEFAULT_COACH_VOICE: CoachVoice = 'Charon';

// Spanish is spoken with a Latin American accent (the default, like the site's Spanish) or Spain's
export const SPANISH_ACCENTS = ['latinAmerica', 'spain'] as const;
export type SpanishAccent = (typeof SPANISH_ACCENTS)[number];
export const DEFAULT_SPANISH_ACCENT: SpanishAccent = 'latinAmerica';

export const MAX_SPEECH_CHARS = 500;

// Chirp 3 HD has no Portugal Portuguese, so Portuguese is Brazil's, like the site's
function chirpLocale(language: Language, spanishAccent: SpanishAccent) {
  if (language === 'es') return spanishAccent === 'spain' ? 'es-ES' : 'es-US';
  if (language === 'pt') return 'pt-BR';
  return 'en-US';
}

// The fallback: OpenAI's most natural voices, by the picked voice's gender
const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts';
const OPENAI_VOICES = { male: 'cedar', female: 'marin' } as const;
// Both answer raw PCM: 24 kHz, 16-bit, mono, little-endian
const SAMPLE_RATE = 24000;

export function isCoachVoice(value: unknown): value is CoachVoice {
  return typeof value === 'string' && (COACH_VOICES as string[]).includes(value);
}

export function isSpanishAccent(value: unknown): value is SpanishAccent {
  return typeof value === 'string' && (SPANISH_ACCENTS as readonly string[]).includes(value);
}

export type CoachVoiceSettings = { voice: CoachVoice; spanishAccent: SpanishAccent };

export async function getCoachVoice(userId: number): Promise<CoachVoiceSettings> {
  await ensureUserSchema();
  const rows = await query<{ coach_voice: string; coach_spanish_accent: string }>(
    'SELECT coach_voice, coach_spanish_accent FROM racingcoach."Users" WHERE id = $1',
    [userId]
  );
  const { coach_voice: voice, coach_spanish_accent: accent } = rows[0] ?? {};
  return {
    voice: isCoachVoice(voice) ? voice : DEFAULT_COACH_VOICE,
    spanishAccent: isSpanishAccent(accent) ? accent : DEFAULT_SPANISH_ACCENT,
  };
}

export async function setSpanishAccent(userId: number, accent: SpanishAccent): Promise<void> {
  await ensureUserSchema();
  await query('UPDATE racingcoach."Users" SET coach_spanish_accent = $1 WHERE id = $2', [accent, userId]);
}

// Who the voice speaks as: a native speaker of the language, with Spain's accent for Spanish when picked
function nativeSpeaker(language: Language, spanishAccent: SpanishAccent) {
  if (language === 'es' && spanishAccent === 'spain') {
    return (
      'Spanish speaker from Spain, with a Castilian (Peninsular) Spanish accent: distinción (z, and c before e or i, ' +
      'said as "th"), Spain\'s intonation and rhythm, never a Latin American accent,'
    );
  }
  return `${AI_LANGUAGE_NAMES[language]} speaker,`;
}

export async function setCoachVoice(userId: number, voice: CoachVoice): Promise<void> {
  await ensureUserSchema();
  await query('UPDATE racingcoach."Users" SET coach_voice = $1 WHERE id = $2', [voice, userId]);
}

export class SpeechError extends Error {}

// How turn numbers are said in each language: "T1" is "Turn 1", "T7-8" (two corners in a row) "Turn 7 and 8" and
// "T8-11" "Turns 8 through 11"
const TURN_WORDS: Record<Language, { one: string; many: string; and: string; through: string }> = {
  en: { one: 'Turn', many: 'Turns', and: 'and', through: 'through' },
  pt: { one: 'Curva', many: 'Curvas', and: 'e', through: 'a' },
  es: { one: 'Curva', many: 'Curvas', and: 'y', through: 'a' },
};

// The text with turn abbreviations (T1, T7-8, T8-T11) written out, so the voice says "Turn 1" rather than "T one"
export function spokenTurnNames(text: string, language: Language = DEFAULT_LANGUAGE): string {
  const words = TURN_WORDS[language];
  return text
    .replace(/\bT(\d+)\s*[-–—]\s*T?(\d+)\b/g, (_, from: string, to: string) =>
      Number(to) === Number(from) + 1
        ? `${words.one} ${from} ${words.and} ${to}`
        : `${words.many} ${from} ${words.through} ${to}`
    )
    .replace(/\bT(\d+)\b/g, `${words.one} $1`);
}

// The text spoken in the voice, as a WAV file (PCM with a WAV header, which Windows plays without any codec, and so
// do browsers). The text is already in the driver's language.
export async function synthesizeSpeech(
  text: string,
  voice: CoachVoice,
  language: Language = DEFAULT_LANGUAGE,
  spanishAccent: SpanishAccent = DEFAULT_SPANISH_ACCENT
): Promise<Buffer> {
  const input = spokenTurnNames(text, language);
  return process.env.GOOGLE_TTS_API_KEY
    ? chirpSpeech(input, voice, chirpLocale(language, spanishAccent))
    : openAiSpeech(input, voice, language, spanishAccent);
}

async function chirpSpeech(text: string, voice: CoachVoice, locale: string): Promise<Buffer> {
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': process.env.GOOGLE_TTS_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: locale, name: `${locale}-Chirp3-HD-${voice}` },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SpeechError(`Google speech failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
  }
  const { audioContent } = (await response.json()) as { audioContent?: string };
  if (!audioContent) {
    throw new SpeechError('Google speech answered no audio');
  }
  // LINEAR16 normally comes with its WAV header already
  const audio = Buffer.from(audioContent, 'base64');
  return audio.subarray(0, 4).toString('ascii') === 'RIFF' ? audio : wav(audio);
}

// The instructions give it a native accent (Spain's or Latin American for Spanish) and a race engineer's delivery
async function openAiSpeech(
  text: string,
  voice: CoachVoice,
  language: Language,
  spanishAccent: SpanishAccent
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SpeechError('Neither GOOGLE_TTS_API_KEY nor OPENAI_API_KEY is configured');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_SPEECH_MODEL,
      voice: OPENAI_VOICES[COACH_VOICE_DETAILS[voice].gender],
      input: text,
      response_format: 'pcm',
      instructions:
        `Speak as a native ${nativeSpeaker(language, spanishAccent)} pronouncing everything the way a native speaker ` +
        'would, numbers included (keep track, corner and car names as written). You are a race engineer on the ' +
        'team radio talking to a driver at speed: calm, clear, confident and a little brisk.',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SpeechError(`OpenAI speech failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
  }
  return wav(Buffer.from(await response.arrayBuffer()));
}

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
