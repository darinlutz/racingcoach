import { NextResponse } from 'next/server';
import { resetPasswordWithToken } from '@/lib/passwordReset';
import { apiText } from '@/lib/i18n/server';

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!token || !password) {
      return NextResponse.json({ error: t.allFieldsRequired }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: t.passwordTooShort }, { status: 400 });
    }

    const ok = await resetPasswordWithToken(token, password);
    if (!ok) {
      return NextResponse.json(
        { error: t.resetInvalid },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: t.failedReset }, { status: 500 });
  }
}
