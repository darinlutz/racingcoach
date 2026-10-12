import { query } from './db';
import { AI_LANGUAGE_NAMES, DEFAULT_LANGUAGE, type Language } from './i18n/languages';
import { ensureUserSchema } from './users';

// The In-Car AI Coach's voice: OpenAI text-to-speech in the voice the driver picks on the Account page
// ("Users".coach_voice), with a native accent in their Preferred Language. The collector gets its speech from
// POST /api/collector/speech; the Account page's Listen button from GET /api/account/coach-voice/sample.

// OpenAI's built-in voices for gpt-4o-mini-tts; marin and cedar are its most natural
export const COACH_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;
export type CoachVoice = (typeof COACH_VOICES)[number];
export const DEFAULT_COACH_VOICE: CoachVoice = 'marin';

export const MAX_SPEECH_CHARS = 500;

const SPEECH_MODEL = 'gpt-4o-mini-tts';
// OpenAI's raw PCM: 24 kHz, 16-bit, mono, little-endian
const SAMPLE_RATE = 24000;

export function isCoachVoice(value: unknown): value is CoachVoice {
  return typeof value === 'string' && (COACH_VOICES as readonly string[]).includes(value);
}

export async function getCoachVoice(userId: number): Promise<CoachVoice> {
  await ensureUserSchema();
  const rows = await query<{ coach_voice: string }>('SELECT coach_voice FROM racingcoach."Users" WHERE id = $1', [userId]);
  const voice = rows[0]?.coach_voice;
  return isCoachVoice(voice) ? voice : DEFAULT_COACH_VOICE;
}

export async function setCoachVoice(userId: number, voice: CoachVoice): Promise<void> {
  await ensureUserSchema();
  await query('UPDATE racingcoach."Users" SET coach_voice = $1 WHERE id = $2', [voice, userId]);
}

export class SpeechError extends Error {}

// The text spoken in the voice, as a WAV file (PCM wrapped in a WAV header, which Windows plays without any
// codec, and so do browsers). The text is already in the driver's language; the instructions give it a native
// accent and a race engineer's delivery.
export async function synthesizeSpeech(text: string, voice: CoachVoice, language: Language = DEFAULT_LANGUAGE): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SpeechError('OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      voice,
      input: text,
      response_format: 'pcm',
      instructions:
        `Speak as a native ${AI_LANGUAGE_NAMES[language]} speaker, pronouncing everything the way a native speaker ` +
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
