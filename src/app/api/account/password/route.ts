import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { createSession, getCurrentUser } from '@/lib/session';
import { updatePassword, verifyUserPassword } from '@/lib/users';

// The Account page's Change Password, for the signed-in user only. Body: { currentPassword, newPassword }.
// updatePassword signs the user out everywhere, so this browser gets a new session to stay signed in.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInChangePassword }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: t.allFieldsRequired }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: t.passwordTooShort }, { status: 400 });
    }
    if (!(await verifyUserPassword(user.id, currentPassword))) {
      return NextResponse.json({ error: t.currentPasswordWrong }, { status: 400 });
    }

    await updatePassword(user.id, newPassword);
    await createSession(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: t.failedChangePassword }, { status: 500 });
  }
}
