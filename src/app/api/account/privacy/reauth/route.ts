import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { quietly, sendReauthCode } from '@/lib/privacyEmail';
import { createReauthCode, isRecentlyReauthenticated, reauthenticateWithCode, reauthenticateWithPassword } from '@/lib/reauth';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { getCurrentUser } from '@/lib/session';

// Privacy & Data Rights' "Confirm it's you" (src/lib/reauth.ts), for the signed-in user only.
//   GET   { confirmed }: whether this sign-in confirmed it within the last 10 minutes
//   POST  { password } or { code } confirms it; { sendCode: true } emails a code to an account without a password
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ confirmed: false }, { status: 401 });
  return NextResponse.json({ confirmed: await isRecentlyReauthenticated(user), hasPassword: user.hasPassword });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').privacyRights;
  try {
    if (!user) return NextResponse.json({ error: t.errors.logIn }, { status: 401 });
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    if (body.sendCode === true) {
      const code = await createReauthCode(user);
      if (!code) return NextResponse.json({ error: t.reauth.tooMany }, { status: 429 });
      await quietly(sendReauthCode(user.emailAddress, code), 'reauth code');
      return NextResponse.json({ sent: true });
    }
    const result =
      typeof body.password === 'string' && body.password
        ? await reauthenticateWithPassword(user, body.password)
        : typeof body.code === 'string'
          ? await reauthenticateWithCode(user, body.code.trim())
          : 'wrong';
    if (result === 'ok') return NextResponse.json({ confirmed: true });
    return NextResponse.json({ error: t.reauth[result] }, { status: result === 'tooMany' ? 429 : 403 });
  } catch (error) {
    console.error('Privacy reauth error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.errors.failed }, { status: 500 });
  }
}
