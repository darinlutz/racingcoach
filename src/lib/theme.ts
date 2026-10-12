// The site's color themes. Shared by server and client code: the user's choice is
// racingcoach."Users".theme, or the THEME_COOKIE for visitors who aren't signed in. The root layout puts it
// on <html data-theme>, and globals.css switches the colors on it.

export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';

// Remembers the theme in the browser too, so it stays after signing out
export const THEME_COOKIE = 'theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
