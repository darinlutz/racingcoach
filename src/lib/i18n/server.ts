import { cookies, headers } from 'next/headers';
import { getCurrentUser } from '../session';
import type { User } from '../users';
import { de } from './dictionaries/de';
import { en, type Dictionary } from './dictionaries/en';
import { es } from './dictionaries/es';
import { pt } from './dictionaries/pt';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_COOKIE, type Language } from './languages';

const dictionaries: Record<Language, Dictionary> = { en, pt, es, de };

// The browser's language: Spanish, Portuguese or German (any region, e.g. es-MX, pt-BR, de-AT) when that's the visitor's
// first choice in Accept-Language, otherwise English
async function browserLanguage(): Promise<Language> {
  const header = (await headers()).get('accept-language') ?? '';
  const first = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { code: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((entry) => entry.code && entry.code !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q)[0]?.code;
  return first === 'es' || first === 'pt' || first === 'de' ? first : DEFAULT_LANGUAGE;
}

// The language for this request: the signed-in user's Preferred Language, otherwise the visitor's
// cookie (set on the sign-up form, and kept after signing out), otherwise the browser's language
// (Spanish, Portuguese or German, else English). Pass the user when the caller already has it, to skip looking
// it up again.
export async function getLanguage(user?: User | null): Promise<Language> {
  const current = user === undefined ? await getCurrentUser() : user;
  if (current) return current.preferredLanguage;
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return isLanguage(cookie) ? cookie : browserLanguage();
}

export function getDictionary(language: Language): Dictionary {
  return dictionaries[language];
}

// The API routes' error messages in the request's language. Reads the language cookie (set at sign-up,
// login and whenever the Preferred Language changes) so most requests don't look the user up again.
export async function apiText(user?: User | null): Promise<Dictionary['api']> {
  if (user) return getDictionary(user.preferredLanguage).api;
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return getDictionary(isLanguage(cookie) ? cookie : await getLanguage()).api;
}

// Remembers the language in the visitor's browser too, so it stays after signing out
export async function setLanguageCookie(language: Language): Promise<void> {
  (await cookies()).set(LANGUAGE_COOKIE, language, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
