// The languages the site is translated into. Shared by server and client code: the user's choice is
// racingcoach."Users".preferred_language, or the LANGUAGE_COOKIE for visitors who aren't signed in.

export const LANGUAGES = ['en', 'pt', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

// Remembers a visitor's choice before they have an account (e.g. on the sign-up form), and after signing out
export const LANGUAGE_COOKIE = 'language';

// Each language in its own words, for the Preferred Language box
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
};

// Number and date formatting: Brazilian Portuguese and Latin American Spanish
export const LANGUAGE_LOCALES: Record<Language, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-419',
};

// How the AI features are told which language to answer in
export const AI_LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pt: 'Brazilian Portuguese',
  es: 'Latin American Spanish',
};

// Added to the end of an AI feature's system prompt so it answers in the user's language. Names from the
// data are kept as given, because the site matches them (e.g. a debrief fix's focus area) against Track Data.
export function aiLanguageRule(language: Language): string {
  if (language === 'en') return '';
  return (
    ` Write all of your answer in ${AI_LANGUAGE_NAMES[language]}, but keep focus area, track, car and series ` +
    'names exactly as they appear in the data.'
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
