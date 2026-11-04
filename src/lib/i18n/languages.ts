// The languages the site is translated into. Shared by server and client code: the user's choice is
// racingcoach."Users".preferred_language, or the LANGUAGE_COOKIE for visitors who aren't signed in.

export const LANGUAGES = ['en', 'pt', 'es', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

// Remembers a visitor's choice before they have an account (e.g. on the sign-up form), and after signing out
export const LANGUAGE_COOKIE = 'language';

// Each language in its own words, for the Preferred Language box
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
  de: 'Deutsch',
};

// Number and date formatting: Brazilian Portuguese, Latin American Spanish and Germany's German
export const LANGUAGE_LOCALES: Record<Language, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-419',
  de: 'de-DE',
};

// How the AI features are told which language to answer in
export const AI_LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pt: 'Brazilian Portuguese',
  es: 'Latin American Spanish',
  de: 'German',
};

// The racing terms the coaches' data gives in English, and how to say them, so no English (or half-English
// words like "pickup de gas") gets into an answer in another language
const AI_RACING_TERMS: Record<Exclude<Language, 'en'>, string> = {
  pt:
    'brakepoint = ponto de frenagem, brake pressure = pressão de freio, trail braking = frenagem em degradê, ' +
    'throttle pickup = retomada do acelerador, lift = tirada de pé do acelerador, re-application = nova aplicação ' +
    'do acelerador, coasting = rolar sem pedal, apex = tangência, fastest/slowest lap = volta mais rápida/mais lenta, ' +
    'Target Lap = Volta Alvo, Compare lap = volta comparada',
  es:
    'brakepoint = punto de frenada, brake pressure = presión de freno, trail braking = frenada degresiva, ' +
    'throttle pickup = volver al acelerador, lift = levantar el pie del acelerador, re-application = nueva ' +
    'aplicación del acelerador, coasting = rodar sin pedales, apex = vértice, fastest/slowest lap = vuelta más ' +
    'rápida/más lenta, Target Lap = Vuelta Objetivo, Compare lap = vuelta comparada',
  de:
    'brakepoint = Bremspunkt, brake pressure = Bremsdruck, trail braking = Bremsen in die Kurve hinein, ' +
    'throttle pickup = Gasannahme (zurück aufs Gas), lift = Gas lupfen, ' +
    're-application = erneutes Gasgeben, coasting = Rollen ohne Pedal, apex = Scheitelpunkt, fastest/slowest lap = ' +
    'schnellste/langsamste Runde, Target Lap = Zielrunde, Compare lap = Vergleichsrunde',
};

const AI_LAP_6: Record<Exclude<Language, 'en'>, string> = { pt: 'Volta 6', es: 'Vuelta 6', de: 'Runde 6' };

// Added to the end of an AI feature's system prompt so it answers in the user's language. Names from the
// data are kept as given, because the site matches them (e.g. a debrief fix's focus area) against Track Data.
// The data and tool results are in English, often with phrases the answer must use (e.g. "brake about 10 m
// LATER than your fastest lap"), which a model copies word for word unless told to translate them.
export function aiLanguageRule(language: Language): string {
  if (language === 'en') return '';
  const name = AI_LANGUAGE_NAMES[language];
  return (
    ` Write all of your answer in ${name}, every word of it, but keep focus area, track, car and series ` +
    'names exactly as they appear in the data. The data and tool results are in English: translate everything ' +
    'you take from them into natural ' +
    `${name}, including phrases they tell you to use word for word (keep their direction and number, translate ` +
    'the words) and words written in capitals such as LATER, EARLIER, AFTER, MORE or LESS, which you write in ' +
    'ordinary lower case. Call laps by their number in your language, e.g. "Lap 6" from the data is ' +
    `"${AI_LAP_6[language]}". Never use English words or English words with ` +
    `${name} endings: use the ${name} racing terms (${AI_RACING_TERMS[language]}). When you say how much earlier ` +
    'or later to do something, say it against the same reference the data gives (e.g. than your fastest lap, than ' +
    'the Target Lap) in one clear sentence; never tie the distance to something else, such as the exit of a ' +
    'brakepoint.'
  );
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

// "{n} laps" + { n: 3 } -> "3 laps"
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

// A dictionary entry that depends on a count
export type Plural = { one: string; other: string };

// Picks the singular or plural form for n (and fills in {n}), following the language's plural rules
export function plural(language: Language, n: number, forms: Plural, values: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(LANGUAGE_LOCALES[language]).select(n) === 'one' ? forms.one : forms.other;
  return fmt(form, { n: n.toLocaleString(LANGUAGE_LOCALES[language]), ...values });
}
