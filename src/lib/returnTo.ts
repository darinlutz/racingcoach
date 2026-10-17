// Where to send someone after they log in or sign up: the page they were trying to reach, carried as ?next=
// on /login and /signup. Only paths on this site are allowed, so a crafted link can't bounce someone elsewhere.

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

// /login or /signup, remembering the page to come back to (none for the home page)
export function withReturnTo(authPath: '/login' | '/signup', returnTo: string): string {
  const next = safeReturnTo(returnTo);
  return next === '/' ? authPath : `${authPath}?next=${encodeURIComponent(next)}`;
}
