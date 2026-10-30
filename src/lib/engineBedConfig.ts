import type { BroadcastSettings } from './broadcastSettings';

// The engine sound under ElevenLabs speech (src/lib/engineBed.ts): what the server tells a browser to play, and how an
// uploaded file is recognized. No imports but a type, so client components, routes and Node's tests (npm run
// test:engine-bed) use it directly.

// What a page needs to play the engine bed. volume is 0-1, the listener's engine volume times their master volume
export type EngineBedConfig = {
  enabled: boolean;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  url: string;
};

// The sound every account starts with, always there, whether object storage is set up or not
export const BUILT_IN_ENGINE_AUDIO_URL = '/assets/sounds/GT3EngineNoise.mp3';
export const MAX_ENGINE_AUDIO_BYTES = 20 * 1024 * 1024;
export const ENGINE_AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav' } as const;
export type EngineAudioType = keyof typeof ENGINE_AUDIO_TYPES;

// Speech routes that answer audio say who voiced it with this header, as only ElevenLabs speech gets the engine bed;
// routes that answer JSON say so with each line's elevenLabs
export const SPEECH_PROVIDER_HEADER = 'X-Speech-Provider';
export const ELEVENLABS_PROVIDER = 'elevenlabs';

export const engineAudioUrl = (assetId: number | null): string => (assetId === null ? BUILT_IN_ENGINE_AUDIO_URL : `/api/engine-audio/${assetId}`);

// The listener's preferences as a page plays them. assetId null is the built-in sound
export function engineBedConfig(settings: BroadcastSettings, assetId: number | null = settings.engineAsset): EngineBedConfig {
  return {
    enabled: settings.engineEnabled,
    volume: Math.round(settings.engineVolume * settings.masterVolume) / 10_000,
    fadeInMs: settings.engineFadeInMs,
    fadeOutMs: settings.engineFadeOutMs,
    url: engineAudioUrl(assetId),
  };
}

// An upload's type from its first bytes, as neither its name nor the browser's word can be trusted; null when it's
// neither an MP3 nor a WAV
export function sniffEngineAudio(bytes: Uint8Array): EngineAudioType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (bytes.length >= 3 && ascii(0, 3) === 'ID3') return 'audio/mpeg';
  // An MPEG audio frame's sync bits, and a layer that isn't the reserved one
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'audio/mpeg';
  return null;
}
