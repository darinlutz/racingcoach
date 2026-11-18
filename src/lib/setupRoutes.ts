import { NextResponse } from 'next/server';
import { apiText, getDictionary } from './i18n/server';
import { getCurrentUser } from './session';
import { SetupError } from './setups';
import type { User } from './users';

// What every /api/setups route does first: the signed-in user (401 otherwise) and their language's error messages.
// Setups belong to the signed-in user only; every query in setups.ts filters by their ID.
export type SetupsErrors = ReturnType<typeof getDictionary>['setups']['errors'];

export async function setupsSession(): Promise<{ user: User; t: SetupsErrors; response?: undefined } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: (await apiText(null)).logInAi, code: 'logIn' }, { status: 401 }) };
  return { user, t: getDictionary(user.preferredLanguage).setups.errors };
}

// A positive integer ID from the URL, or null
export function idOf(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

export function setupErrorResponse(error: unknown, t: SetupsErrors, what: string): NextResponse {
  if (error instanceof SetupError) {
    const status = error.code === 'notFound' ? 404 : error.code === 'tooMany' ? 409 : 400;
    return NextResponse.json({ error: t[error.code], code: error.code }, { status });
  }
  console.error(`${what} error:`, error);
  return NextResponse.json({ error: t.failed }, { status: 500 });
}
