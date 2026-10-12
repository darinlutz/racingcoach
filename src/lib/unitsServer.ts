import { cookies } from 'next/headers';
import { getCurrentUser } from './session';
import type { User } from './users';
import { DEFAULT_UNITS, isUnits, UNITS_COOKIE, type Units } from './units';

// The units for this request: the signed-in user's Preferred Units, otherwise the visitor's cookie, otherwise
// Standard. Pass the user when the caller already has it, to skip looking it up again.
export async function getUnits(user?: User | null): Promise<Units> {
  const current = user === undefined ? await getCurrentUser() : user;
  if (current) return current.units;
  const cookie = (await cookies()).get(UNITS_COOKIE)?.value;
  return isUnits(cookie) ? cookie : DEFAULT_UNITS;
}

// Remembers the units in the visitor's browser too, so they stay after signing out
export async function setUnitsCookie(units: Units): Promise<void> {
  (await cookies()).set(UNITS_COOKIE, units, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
