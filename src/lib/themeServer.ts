import { cookies } from 'next/headers';
import type { User } from './users';
import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from './theme';

// The theme for this request: the signed-in user's, otherwise the visitor's cookie, otherwise Dark Mode
export async function getTheme(user: User | null): Promise<Theme> {
  if (user) return user.theme;
  const cookie = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(cookie) ? cookie : DEFAULT_THEME;
}

// Remembers the theme in the visitor's browser too, so it stays after signing out
export async function setThemeCookie(theme: Theme): Promise<void> {
  (await cookies()).set(THEME_COOKIE, theme, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
