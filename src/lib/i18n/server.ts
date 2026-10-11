import { cookies } from 'next/headers';
import { getCurrentUser } from '../session';
import type { User } from '../users';
import { en, type Dictionary } from './dictionaries/en';
import { es } from './dictionaries/es';
import { pt } from './dictionaries/pt';
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_COOKIE, type Language } from './languages';

const dictionaries: Record<Language, Dictionary> = { en, pt, es };

// The language for this request: the signed-in user's Preferred Language, otherwise the visitor's
// cookie (set on the sign-up form, and kept after signing out), otherwise English. Pass the user when
// the caller already has it, to skip looking it up again.
export async function getLanguage(user?: User | null): Promise<Language> {
  const current = user === undefined ? await getCurrentUser() : user;
  if (current) return current.preferredLanguage;
  const cookie = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return isLanguage(cookie) ? cookie : DEFAULT_LANGUAGE;
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
