import { NextResponse } from 'next/server';
import { isMembershipLevel } from '@/lib/accountStatus';
import { apiText } from '@/lib/i18n/server';
import { isAdmin, isRole } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { RoleChangeError, setMembershipLevel, setUserRole } from '@/lib/users';

// The Admin page's User Roles section. Body: { userId: number, role?: 'Admin' | 'Coach' | 'User',
// membershipLevel?: 'Bronze' | 'Silver' | 'Gold' }, at least one of role and membershipLevel.
// Admin role only; anyone else gets a 404, like the Admin page.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: t.userNotFound }, { status: 400 });
    }
    const hasRole = body.role !== undefined;
    const hasLevel = body.membershipLevel !== undefined;
    if (!hasRole && !hasLevel) {
      return NextResponse.json({ error: t.nothingToSave }, { status: 400 });
    }
    if (hasRole && !isRole(body.role)) {
      return NextResponse.json({ error: t.invalidRole }, { status: 400 });
    }
    if (hasLevel && !isMembershipLevel(body.membershipLevel)) {
      return NextResponse.json({ error: t.invalidMembershipLevel }, { status: 400 });
    }

    // The role first, so a refused role change saves nothing
    if (hasRole) {
      const changed = await setUserRole(userId, body.role, user.id);
      console.log(`Role change: user ${userId} (${changed.userName}) set to ${changed.role} by user ${user.id}`);
    }
    if (hasLevel) {
      const userName = await setMembershipLevel(userId, body.membershipLevel);
      if (userName === null) return NextResponse.json({ error: t.userNotFound }, { status: 404 });
      console.log(`Membership level change: user ${userId} (${userName}) set to ${body.membershipLevel} by user ${user.id}`);
    }
    return NextResponse.json({ userId, role: hasRole ? body.role : undefined, membershipLevel: hasLevel ? body.membershipLevel : undefined });
  } catch (error) {
    if (error instanceof RoleChangeError) {
      const messages = { 'not-found': t.userNotFound, 'own-role': t.cannotChangeOwnRole, 'last-admin': t.lastAdmin };
      return NextResponse.json({ error: messages[error.reason] }, { status: error.reason === 'not-found' ? 404 : 400 });
    }
    console.error('User change error:', error);
    return NextResponse.json({ error: t.failedSaveRole }, { status: 500 });
  }
}
