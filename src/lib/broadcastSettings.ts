// Each user's Race Broadcast preferences (racingcoach."Users".broadcast_settings, JSONB), set in the Account page's
// Race Announcers card (src/components/BroadcastSettings.tsx) and followed by the Commentary Director
// (src/lib/broadcastDirector.ts) on the Live Racing page and TV Broadcast Mode. No imports, so the client component
// and Node's tests (npm run test:broadcast) use it directly.

// Off: no commentary. Quiet: critical moments and the user's major ones. Standard: balanced. Full Broadcast: TV-style
// coverage, with regular analysis and summaries
export const BROADCAST_MODES = ['off', 'quiet', 'standard', 'full'] as const;
// How much of the discretionary commentary follows the user's own race
export const COVERAGE_FOCUSES = ['balanced', 'user', 'maxUser'] as const;
// How long the announcers wait between discretionary lines, independent of the mode's content
export const COMMENTARY_FREQUENCIES = ['low', 'normal', 'high'] as const;
export const INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;

export type BroadcastMode = (typeof BROADCAST_MODES)[number];
export type CoverageFocus = (typeof COVERAGE_FOCUSES)[number];
export type CommentaryFrequency = (typeof COMMENTARY_FREQUENCIES)[number];
export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

export type BroadcastSettings = {
  mode: BroadcastMode;
  focus: CoverageFocus;
  // Caps how excited the voices sound; never stops an important event from being called
  maxIntensity: IntensityLevel;
  frequency: CommentaryFrequency;
  // 0-100, applied by the page or TV as each line plays
  masterVolume: number;
  leadVolume: number;
  colorVolume: number;
  // Off, other drivers are called by car number or position (the user is still named)
  announceNames: boolean;
  statistics: boolean;
  strategy: boolean;
  preRace: boolean;
  postRace: boolean;
};

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettings = {
  mode: 'full',
  focus: 'user',
  maxIntensity: 5,
  frequency: 'normal',
  masterVolume: 100,
  leadVolume: 100,
  colorVolume: 100,
  announceNames: true,
  statistics: true,
  strategy: true,
  preRace: true,
  postRace: true,
};

const BOOLEAN_KEYS = ['announceNames', 'statistics', 'strategy', 'preRace', 'postRace'] as const;
const VOLUME_KEYS = ['masterVolume', 'leadVolume', 'colorVolume'] as const;

const oneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const volume = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(Math.max(value, 0), 100)) : null;

// The changes in patch that are valid, or null when any isn't (unknown keys are ignored)
export function broadcastSettingsPatch(patch: unknown): Partial<BroadcastSettings> | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const p = patch as Record<string, unknown>;
  const out: Partial<BroadcastSettings> = {};
  if (p.mode !== undefined) {
    if (!oneOf(BROADCAST_MODES, p.mode)) return null;
    out.mode = p.mode;
  }
  if (p.focus !== undefined) {
    if (!oneOf(COVERAGE_FOCUSES, p.focus)) return null;
    out.focus = p.focus;
  }
  if (p.frequency !== undefined) {
    if (!oneOf(COMMENTARY_FREQUENCIES, p.frequency)) return null;
    out.frequency = p.frequency;
  }
  if (p.maxIntensity !== undefined) {
    if (!oneOf(INTENSITY_LEVELS, p.maxIntensity)) return null;
    out.maxIntensity = p.maxIntensity;
  }
  for (const key of VOLUME_KEYS) {
    if (p[key] === undefined) continue;
    const v = volume(p[key]);
    if (v === null) return null;
    out[key] = v;
  }
  for (const key of BOOLEAN_KEYS) {
    if (p[key] === undefined) continue;
    if (typeof p[key] !== 'boolean') return null;
    out[key] = p[key] as boolean;
  }
  return out;
}

// Stored settings with the defaults for anything missing or no longer valid
export function parseBroadcastSettings(stored: unknown): BroadcastSettings {
  const settings = { ...DEFAULT_BROADCAST_SETTINGS };
  if (!stored || typeof stored !== 'object') return settings;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const valid = broadcastSettingsPatch({ [key]: value });
    if (valid) Object.assign(settings, valid);
  }
  return settings;
}

// How loud a line of this announcer plays, 0-1
export function lineVolume(settings: BroadcastSettings, speaker: 'lead' | 'color'): number {
  const voice = speaker === 'lead' ? settings.leadVolume : settings.colorVolume;
  return Math.round(settings.masterVolume * voice) / 10_000;
}
