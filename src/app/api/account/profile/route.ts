import { NextResponse } from 'next/server';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_USER_NAME_LENGTH, setUserName } from '@/lib/users';

// Privacy & Data Rights' Correct My Information (GDPR Article 16): PUT { userName } corrects the signed-in account's
// name. Other fields are corrected in My Settings, or by a rectification request an Admin handles.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').privacyRights.errors;
  try {
    if (!user) return NextResponse.json({ error: t.logIn }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
    if (!userName || userName.length > MAX_USER_NAME_LENGTH) {
      return NextResponse.json({ error: fmt(t.invalidName, { max: MAX_USER_NAME_LENGTH }) }, { status: 400 });
    }
    await setUserName(user.id, userName);
    return NextResponse.json({ userName });
  } catch (error) {
    console.error('Name update error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
