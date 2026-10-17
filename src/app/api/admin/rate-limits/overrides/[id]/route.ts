import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { deleteOverride, listOverrides } from '@/lib/rateLimits';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// Removes one of the Rate Limiting section's overrides, so the user or IP address has the usual limits again.
// Answers { overrides }. Admin role only; anyone else gets a 404.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const id = Number((await params).id);
    if (!Number.isInteger(id) || !(await deleteOverride(id))) {
      return NextResponse.json({ error: t.invalidOverride }, { status: 404 });
    }
    console.log(`Rate limit override ${id} removed by user ${user.id}`);
    return NextResponse.json({ overrides: await listOverrides() });
  } catch (error) {
    console.error('Rate limit override delete error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
