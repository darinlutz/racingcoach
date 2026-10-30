// Driver Radio: the driver holds iRacing's radio (push to talk) button, or the wheel button picked in the collector,
// and speaks; the collector records the microphone and posts the recording (POST /api/collector/radio), which is
// turned into text here (OpenAI speech to text) and shown on the Live Racing page (src/lib/liveRacing.ts,
// recordDriverRadio) and back in the sim. The page plays each message in the driver's radio voice
// (GET /api/live/radio-speech, radioVoiceId). The Race Engineer (src/lib/raceEngineer.ts) answers what needs an
// answer. The Live Racing page's Hold to Talk sends watchers' spoken messages through the same speech to text.

import { getCoachVoice } from './coachVoice';
import { elevenLabsRadioVoiceId, elevenLabsVoiceId } from './elevenLabs';
import type { Language } from './i18n/languages';
import type { User } from './users';

// The accounts whose radio is said in ELEVENLABS_MY_VOICE_ID, the site owner's own voice; lower case
const MY_VOICE_ACCOUNTS = new Set(['darinlutz@yahoo.com', 'darinlutz648@gmail.com']);

// The ElevenLabs voice a driver's radio is said in: the site owner's own voice for their accounts, and for everyone
// else the RaceCoach voice of their Preferred Language and Spanish accent; null when it isn't set up
export async function radioVoiceId(driver: Pick<User, 'id' | 'emailAddress' | 'preferredLanguage'>): Promise<string | null> {
  if (MY_VOICE_ACCOUNTS.has(driver.emailAddress.trim().toLowerCase())) return elevenLabsRadioVoiceId();
  const { spanishAccent } = await getCoachVoice(driver.id);
  return elevenLabsVoiceId('raceCoach', driver.preferredLanguage, spanishAccent);
}

const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const TIMEOUT_MS = 20_000;

// The collector's recordings: 16 kHz 16-bit mono WAVs of at most 30 s (about 1 MB), with room to spare
export const MAX_RADIO_BYTES = 2 * 1024 * 1024;
export const MAX_RADIO_CHARS = 500;

// Words a driver is likely to say, so the model spells them the racing way
const PROMPT: Record<Language, string> = {
  en: 'A racing driver on the team radio during an iRacing session: box box, pit this lap, copy, understeer, oversteer, tires, fuel, gap, push, yellow flag.',
  pt: 'Um piloto no rádio da equipe durante uma sessão do iRacing: box box, para nesta volta, entendido, saindo de frente, saindo de traseira, pneus, combustível, diferença, bandeira amarela.',
  es: 'Un piloto en la radio del equipo durante una sesión de iRacing: box box, entro en esta vuelta, copiado, subviraje, sobreviraje, neumáticos, combustible, diferencia, bandera amarilla.',
};

export class RadioTranscriptionError extends Error {}

// The words in a WAV recording, in the driver's Preferred Language; empty when nothing was said
export async function transcribeRadio(wav: Buffer, language: Language): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new RadioTranscriptionError('OPENAI_API_KEY is not configured');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'radio.wav');
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', language);
  form.append('prompt', PROMPT[language]);
  form.append('response_format', 'json');
  const response = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new RadioTranscriptionError(`OpenAI answered ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_RADIO_CHARS);
}

// A RIFF WAV file, as the collector sends: checked by its header only
export function looksLikeWav(audio: Buffer): boolean {
  return audio.length > 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
}
