import { NextResponse } from 'next/server';
import { CarSetupImportError } from './carSetupLibrary';
import { authenticateCollector } from './collectorKeys';
import { isAdmin } from './roles';
import { getCurrentUser } from './session';
import { getUserById, type User } from './users';

// What every iRacing Setups library route does first (docs/setups.md's iRacing setup collection). The library is for
// Admins only until the licensing and redistribution of iRacing's setups is decided, checked here on the server for
// every request, whatever the collector's window or the page shows.

// The collector's routes: the upload key's account, which must be an Admin. 401 without a known key; 403 for anyone
// else (the collector shows it), as the key itself is valid
export async function adminCollector(request: Request): Promise<{ user: User; response?: undefined } | { response: NextResponse }> {
  const userId = await authenticateCollector(request);
  if (userId === null) return { response: NextResponse.json({ error: 'Missing or unknown upload key' }, { status: 401 }) };
  const user = await getUserById(userId);
  if (!user || !isAdmin(user.role)) {
    console.warn(`Car setup import refused: user ${userId} isn't an Admin`);
    return { response: NextResponse.json({ error: 'Only Admins can import car setups', code: 'adminOnly' }, { status: 403 }) };
  }
  return { user };
}

// The Setups page's routes: the signed-in Admin, else 404 as the Admin page's routes answer
export async function adminSession(): Promise<{ user: User; response?: undefined } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { user };
}

const STATUS: Record<CarSetupImportError['code'], number> = {
  notConfigured: 503,
  importNotFound: 404,
  importClosed: 409,
  badRequest: 400,
  hashMismatch: 422,
  tooLarge: 413,
  notSto: 422,
  notHtm: 422,
  unresolvedCar: 422,
  storageFailed: 502,
};

// The collector logs and shows these, so they're diagnostics in English, like the collector's activity log
export function carSetupErrorResponse(error: unknown, what: string): NextResponse {
  if (error instanceof CarSetupImportError) {
    console.warn(`${what}: ${error.code}: ${error.message}`);
    return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
  }
  console.error(`${what} error:`, error);
  return NextResponse.json({ error: 'The server couldn’t save the setup', code: 'failed' }, { status: 500 });
}
