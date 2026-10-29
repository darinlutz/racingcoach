import { query } from './db';
import { elevenLabsConfigured, elevenLabsSpeech, elevenLabsVoiceId, type ElevenLabsRole } from './elevenLabs';
import { AI_LANGUAGE_NAMES, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { ensureUserSchema } from './users';

// The In-Car AI Coach's voice: Google Cloud Text-to-Speech's Chirp 3 HD voices, in the voice the driver picks on the
// Account page ("Users".coach_voice), spoken by a native voice of their Preferred Language (en-US, pt-BR, and es-US or
// es-ES by the Spanish accent they pick beside it, "Users".coach_spanish_accent). Without GOOGLE_TTS_API_KEY it falls
// back to OpenAI's gpt-4o-mini-tts, told to speak with that accent. The collector gets its speech from
// POST /api/collector/speech; the Account page's Listen button from GET /api/account/coach-voice/sample. The
// ElevenLabs RaceCoach voice of the user's language (ELEVENLABS_COACH_VOICE, src/lib/elevenLabs.ts) is listed first
// and is the default. The Race Announcers (src/lib/raceAnnouncer.ts) pick from the same voices, with their own
// ElevenLabs voices (Lead and Color) first.

// Chirp 3 HD's voices the driver can pick from (Google has 30; these male ones suit a race engineer on the radio),
// each with Google's description of its style. Every voice speaks every language as a native speaker would. Accounts
// that picked a voice no longer listed (e.g. the female ones that used to be) get DEFAULT_COACH_VOICE.
export const COACH_VOICE_DETAILS = {
  Charon: { style: 'informative' },
  Orus: { style: 'firm' },
  Iapetus: { style: 'clear' },
  Algieba: { style: 'smooth' },
  Sadaltager: { style: 'knowledgeable' },
  Puck: { style: 'upbeat' },
  Fenrir: { style: 'excitable' },
} as const;
type ChirpVoice = keyof typeof COACH_VOICE_DETAILS;
// The ElevenLabs voice of the speaker's role in the user's language and accent (src/lib/elevenLabs.ts): for the coach,
// the RaceCoach voice, also Live Racing's Announce lap times voice. The default, and listed first, while that voice is
// set up; without it the coach speaks with DEFAULT_COACH_VOICE instead
export const ELEVENLABS_COACH_VOICE = 'ElevenLabs';
export type CoachVoice = ChirpVoice | typeof ELEVENLABS_COACH_VOICE;
export const COACH_VOICES = [...Object.keys(COACH_VOICE_DETAILS), ELEVENLABS_COACH_VOICE] as CoachVoice[];
// The Chirp voice spoken when the ElevenLabs voice isn't set up for the language
export const DEFAULT_COACH_VOICE: ChirpVoice = 'Charon';

// The voices the Account page offers a role in a language: its ElevenLabs voice first, while it's set up for the
// language and accent (styled by the role, e.g. "ElevenLabs: Lead Announcer"), then the Chirp voices
export function voicesFor(
  role: ElevenLabsRole,
  language: Language,
  spanishAccent: SpanishAccent = DEFAULT_SPANISH_ACCENT
): Record<string, { style: string }> {
  return elevenLabsConfigured(role, language, spanishAccent)
    ? { [ELEVENLABS_COACH_VOICE]: { style: role }, ...COACH_VOICE_DETAILS }
    : COACH_VOICE_DETAILS;
}

export function coachVoicesFor(language: Language, spanishAccent: SpanishAccent = DEFAULT_SPANISH_ACCENT): Record<string, { style: string }> {
  return voicesFor('raceCoach', language, spanishAccent);
}

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

// The fallback: OpenAI's most natural male voice
const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts';
const OPENAI_VOICE = 'cedar';
// All three answer raw PCM: 24 kHz, 16-bit, mono, little-endian
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
  // Accounts that never picked one (or picked a voice no longer offered) get the ElevenLabs voice, which falls back to
  // DEFAULT_COACH_VOICE where it isn't set up
  return {
    voice: isCoachVoice(voice) ? voice : ELEVENLABS_COACH_VOICE,
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

// How time differences are said in each language: under a second in tenths ("two tenths"), else in seconds
const GAP_WORDS: Record<
  Language,
  { tenths: string[]; second: string; seconds: string; underTenth: string; plus: string; minus: string; decimal: string }
> = {
  en: {
    tenths: ['', 'one tenth', 'two tenths', 'three tenths', 'four tenths', 'five tenths', 'six tenths', 'seven tenths', 'eight tenths', 'nine tenths'],
    second: 'second', seconds: 'seconds', underTenth: 'less than a tenth', plus: 'plus', minus: 'minus', decimal: '.',
  },
  pt: {
    tenths: ['', 'um décimo', 'dois décimos', 'três décimos', 'quatro décimos', 'cinco décimos', 'seis décimos', 'sete décimos', 'oito décimos', 'nove décimos'],
    second: 'segundo', seconds: 'segundos', underTenth: 'menos de um décimo', plus: 'mais', minus: 'menos', decimal: ',',
  },
  es: {
    tenths: ['', 'una décima', 'dos décimas', 'tres décimas', 'cuatro décimas', 'cinco décimas', 'seis décimas', 'siete décimas', 'ocho décimas', 'nueve décimas'],
    second: 'segundo', seconds: 'segundos', underTenth: 'menos de una décima', plus: 'más', minus: 'menos', decimal: ',',
  },
};

// One time difference, rounded to the nearest tenth of a second, as it's said: "two tenths", "2.3 seconds"
function spokenGap(sign: string, digits: string, language: Language): string {
  const words = GAP_WORDS[language];
  const tenths = Math.round(Math.abs(Number(digits.replace(',', '.'))) * 10);
  if (tenths === 0) return words.underTenth;
  const signWord = sign === '+' ? `${words.plus} ` : sign ? `${words.minus} ` : '';
  if (tenths < 10) return signWord + words.tenths[tenths];
  const seconds = tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1).replace('.', words.decimal);
  return `${signWord}${seconds} ${tenths === 10 ? words.second : words.seconds}`;
}

// The text with time differences said the way a race engineer says them, rounded to the nearest tenth: "0.213 s
// slower" is "two tenths slower" (rather than "zero point two one three ess"), "2.319 s faster" "2.3 seconds
// faster", and a lap's {delta} in a rule text, "+0.42", "plus four tenths". Lap times (1:50.486) are left alone.
export function spokenTimeGaps(text: string, language: Language = DEFAULT_LANGUAGE): string {
  return text
    .replace(
      /(?<![\w:.,])([+\-−]?)(\d+(?:[.,]\d+)?)\s?(?:s|secs?|seconds?|segundos?)\b(?![.,]?\d)/gi,
      (_, sign: string, digits: string) => spokenGap(sign, digits, language)
    )
    .replace(/(?<![\w:.,])([+\-−])(\d+[.,]\d+)(?![\d.,]|\s?(?:%|°|ft|m\b|mph|kph|km))/g, (_, sign: string, digits: string) =>
      spokenGap(sign, digits, language)
    );
}

// How distance units are said in each language, for one and for more
const UNIT_WORDS: Record<Language, { foot: [string, string]; meter: [string, string] }> = {
  en: { foot: ['foot', 'feet'], meter: ['meter', 'meters'] },
  pt: { foot: ['pé', 'pés'], meter: ['metro', 'metros'] },
  es: { foot: ['pie', 'pies'], meter: ['metro', 'metros'] },
};

// The text with distances' unit abbreviations written out, so the voice says "15 feet" rather than "15 ef tee" and
// "5 meters" rather than "5 em": "ft" and "m" only right after a number, and not "m/s"
export function spokenUnits(text: string, language: Language = DEFAULT_LANGUAGE): string {
  const words = UNIT_WORDS[language];
  const say = (number: string, [one, many]: [string, string]) => `${number} ${number === '1' ? one : many}`;
  return text
    .replace(/(?<![\w.,])(\d+(?:[.,]\d+)?)\s?ft\b/gi, (_, number: string) => say(number, words.foot))
    .replace(/(?<![\w.,])(\d+(?:[.,]\d+)?)\s?m\b(?![/²³])/g, (_, number: string) => say(number, words.meter));
}

// The text spoken in the voice, as a WAV file (PCM with a WAV header, which Windows plays without any codec, and so
// do browsers). The text is already in the driver's language. role picks the ElevenLabs voice (the coach's RaceCoach
// voice, or a Race Announcer's) and how the OpenAI fallback delivers it.
export async function synthesizeSpeech(
  text: string,
  voice: CoachVoice,
  language: Language = DEFAULT_LANGUAGE,
  spanishAccent: SpanishAccent = DEFAULT_SPANISH_ACCENT,
  role: ElevenLabsRole = 'raceCoach'
): Promise<Buffer> {
  // Units after time gaps, which leave "+1.5 ft" alone by its "ft"
  const input = spokenUnits(spokenTimeGaps(spokenTurnNames(text, language), language), language);
  if (voice === ELEVENLABS_COACH_VOICE) {
    const voiceId = elevenLabsVoiceId(role, language, spanishAccent);
    if (voiceId) return wav(await elevenLabsSpeech(input, voiceId, 'pcm'));
    voice = DEFAULT_COACH_VOICE;
  }
  return process.env.GOOGLE_TTS_API_KEY
    ? chirpSpeech(input, voice, chirpLocale(language, spanishAccent))
    : openAiSpeech(input, language, spanishAccent, role);
}

// How the OpenAI fallback speaks each role
const DELIVERY: Record<ElevenLabsRole, string> = {
  raceCoach:
    'You are a race engineer on the team radio talking to a driver at speed: calm, clear, confident and a little brisk.',
  leadAnnouncer:
    'You are the lead (play-by-play) announcer of a televised motor race, calling the action: energetic, ' +
    'quick and rising with the excitement of the moment.',
  colorAnnouncer:
    'You are the color commentator of a televised motor race, a former racing driver adding insight: warm, ' +
    'conversational and knowing.',
};

async function chirpSpeech(text: string, voice: ChirpVoice, locale: string): Promise<Buffer> {
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

// The instructions give it a native accent (Spain's or Latin American for Spanish) and the role's delivery
async function openAiSpeech(
  text: string,
  language: Language,
  spanishAccent: SpanishAccent,
  role: ElevenLabsRole
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
      voice: OPENAI_VOICE,
      input: text,
      response_format: 'pcm',
      instructions:
        `Speak as a native ${nativeSpeaker(language, spanishAccent)} pronouncing everything the way a native speaker ` +
        `would, numbers included (keep track, corner and car names as written). ${DELIVERY[role]}`,
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
