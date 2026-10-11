import { NextResponse } from 'next/server';
import { createSession } from '@/lib/session';
import { authenticateUser } from '@/lib/users';
import { apiText } from '@/lib/i18n/server';

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const body = await request.json().catch(() => ({}));
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!emailAddress || !password) {
      return NextResponse.json({ error: t.emailPasswordRequired }, { status: 400 });
    }

    const user = await authenticateUser(emailAddress, password);
    if (!user) {
      return NextResponse.json({ error: t.invalidLogin }, { status: 401 });
    }

    await createSession(user.id);
    return NextResponse.json({ user: { userName: user.userName } });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: t.failedLogIn }, { status: 500 });
  }
}
