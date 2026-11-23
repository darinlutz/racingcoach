// The ElevenLabs voices' rules (the Admin page's Eleven Labs Voice Management; src/lib/elevenLabsVoices.ts keeps them
// in racingcoach."ElevenLabsVoices"). Pure, no I/O, so the Admin page and the voice pickers can use it too.
//
// Each voice fills one slot: a role (the In-Car AI Coach's Race Coach, the Race Announcers' Lead and Color, or the site
// owner's own Driver Radio voice) in one language (Spanish twice, by its accent; the owner's radio voice is the same in
// every language). One enabled voice per slot; a disabled one is kept for later and never spoken.

export const ELEVENLABS_VOICE_ROLES = ['raceCoach', 'leadAnnouncer', 'colorAnnouncer', 'ownerRadio'] as const;
export type ElevenLabsVoiceRole = (typeof ELEVENLABS_VOICE_ROLES)[number];

// A slot's language: the site's languages, Spanish by its accent, or every language (the owner's radio voice only)
export const ELEVENLABS_VOICE_LANGUAGES = ['en', 'pt', 'de', 'fr', 'it', 'es-latam', 'es-es', 'all'] as const;
export type ElevenLabsVoiceLanguage = (typeof ELEVENLABS_VOICE_LANGUAGES)[number];

export const VOICE_LIMITS = { name: 100, notes: 1000 } as const;

// ElevenLabs' Voice IDs are 20 letters and digits; a little either way is allowed
export const VOICE_ID = /^[A-Za-z0-9]{10,64}$/;

// The slot of a site language and Spanish accent ('latinAmerica' or 'spain')
export function voiceLanguageOf(language: string, spanishAccent: string): ElevenLabsVoiceLanguage {
  if (language === 'es') return spanishAccent === 'spain' ? 'es-es' : 'es-latam';
  return (ELEVENLABS_VOICE_LANGUAGES as readonly string[]).includes(language) ? (language as ElevenLabsVoiceLanguage) : 'en';
}

export const slotKey = (role: ElevenLabsVoiceRole, language: ElevenLabsVoiceLanguage) => `${role}:${language}`;

export type VoiceInput = {
  name: string;
  voiceId: string;
  role: ElevenLabsVoiceRole;
  language: ElevenLabsVoiceLanguage;
  enabled: boolean;
  notes: string;
};
export type VoiceProblem = 'name' | 'voiceId' | 'role' | 'language' | 'notes';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// An Admin's voice, checked whole. The owner's radio voice is for every language, and every other role for one
export function validateVoice(raw: unknown): { ok: true; voice: VoiceInput } | { ok: false; problems: VoiceProblem[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: VoiceProblem[] = [];
  const name = text(r.name);
  if (!name || name.length > VOICE_LIMITS.name) problems.push('name');
  const voiceId = text(r.voiceId);
  if (!VOICE_ID.test(voiceId)) problems.push('voiceId');
  const role = r.role as ElevenLabsVoiceRole;
  if (!ELEVENLABS_VOICE_ROLES.includes(role)) problems.push('role');
  const language = (role === 'ownerRadio' ? 'all' : r.language) as ElevenLabsVoiceLanguage;
  if (!ELEVENLABS_VOICE_LANGUAGES.includes(language) || (role !== 'ownerRadio' && language === 'all')) problems.push('language');
  const notes = text(r.notes);
  if (notes.length > VOICE_LIMITS.notes) problems.push('notes');
  if (problems.length) return { ok: false, problems };
  return { ok: true, voice: { name, voiceId, role, language, enabled: r.enabled !== false, notes } };
}

// The environment variables the voices used to be set in (ELEVENLABS_<LANGUAGE>_<ROLE>_VOICE_ID and
// ELEVENLABS_MY_VOICE_ID), for the one-time import into the table
const ENV_LANGUAGES: Record<Exclude<ElevenLabsVoiceLanguage, 'all'>, string> = {
  en: 'ENGLISH',
  pt: 'PORTUGUESE',
  de: 'GERMAN',
  fr: 'FRENCH',
  it: 'ITALIAN',
  'es-latam': 'LATINO',
  'es-es': 'ESPANA',
};
const ENV_ROLES: Record<Exclude<ElevenLabsVoiceRole, 'ownerRadio'>, string> = {
  raceCoach: 'RACECOACH',
  leadAnnouncer: 'ANNOUNCER_LEAD',
  colorAnnouncer: 'ANNOUNCER_COLOR',
};
// English names for the Admin page, as the import names them (the Admin can rename them)
const ADMIN_LANGUAGE_NAMES: Record<ElevenLabsVoiceLanguage, string> = {
  en: 'English',
  pt: 'Portuguese',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  'es-latam': 'Latin American Spanish',
  'es-es': 'Spain Spanish',
  all: 'All languages',
};
const ADMIN_ROLE_NAMES: Record<ElevenLabsVoiceRole, string> = {
  raceCoach: 'Race Coach',
  leadAnnouncer: 'Lead Announcer',
  colorAnnouncer: 'Color Announcer',
  ownerRadio: 'Owner Driver Radio',
};

export function voicesFromEnv(env: Record<string, string | undefined>): VoiceInput[] {
  const voices: VoiceInput[] = [];
  for (const [language, envLanguage] of Object.entries(ENV_LANGUAGES) as [Exclude<ElevenLabsVoiceLanguage, 'all'>, string][]) {
    for (const [role, envRole] of Object.entries(ENV_ROLES) as [Exclude<ElevenLabsVoiceRole, 'ownerRadio'>, string][]) {
      const voiceId = env[`ELEVENLABS_${envLanguage}_${envRole}_VOICE_ID`]?.trim();
      if (voiceId && VOICE_ID.test(voiceId)) {
        voices.push({ name: `${ADMIN_LANGUAGE_NAMES[language]} ${ADMIN_ROLE_NAMES[role]}`, voiceId, role, language, enabled: true, notes: '' });
      }
    }
  }
  const mine = env.ELEVENLABS_MY_VOICE_ID?.trim();
  if (mine && VOICE_ID.test(mine)) voices.push({ name: ADMIN_ROLE_NAMES.ownerRadio, voiceId: mine, role: 'ownerRadio', language: 'all', enabled: true, notes: '' });
  return voices;
}

// The name a user sees for an ElevenLabs voice in the voice pickers, in their language, e.g. "Eleven Labs German Race
// Coach": the dictionary's inCarCoach.elevenLabsVoiceName with the voice's language and role filled in
export type VoiceNameText = {
  elevenLabsVoiceName: string;
  elevenLabsVoiceLanguages: Record<ElevenLabsVoiceLanguage, string>;
  elevenLabsVoiceRoles: Record<ElevenLabsVoiceRole, string>;
};

export function elevenLabsVoiceLabel(t: VoiceNameText, language: string, role: string): string {
  const lang = t.elevenLabsVoiceLanguages[language as ElevenLabsVoiceLanguage] ?? language;
  const who = t.elevenLabsVoiceRoles[role as ElevenLabsVoiceRole] ?? role;
  return t.elevenLabsVoiceName.replace('{language}', lang).replace('{role}', who);
}
