import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { User } from '@/lib/users';

// The local AI Admin routes are for the Admin role only; anyone else gets a 404, like the Admin page
export async function localAiAdmin(): Promise<{ user: User; denied: null } | { user: null; denied: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    const t = await apiText(user);
    return { user: null, denied: NextResponse.json({ error: t.adminOnly }, { status: 404 }) };
  }
  return { user, denied: null };
}
