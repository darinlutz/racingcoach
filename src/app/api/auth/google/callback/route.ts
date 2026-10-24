import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  fetchGoogleProfile,
  GOOGLE_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  GoogleEmailUnverifiedError,
  googleRedirectUri,
  signInWithGoogle,
  type GoogleState,
} from '@/lib/googleAuth';
import { setLanguageCookie } from '@/lib/i18n/server';
import { notifyOwner } from '@/lib/ownerNotifications';
import { safeReturnTo } from '@/lib/returnTo';
import { createSession } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readState(value: string | undefined): GoogleState | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value) as GoogleState;
    return typeof state.state === 'string' && typeof state.verifier === 'string' ? state : null;
  } catch {
    return null;
  }
}

// Google sends the visitor back here after they pick an account (or cancel). They're signed in to the account
// for that Google account and sent on to ?next=; from the Create an Account page an account is made when there's
// none. Otherwise they go back to the page they started on, with the result in ?google=
export async function GET(request: Request) {
  const origin = getSiteOrigin(request);
  const saved = readState((await cookies()).get(GOOGLE_STATE_COOKIE)?.value);
  const mode = saved?.mode === 'signup' ? 'signup' : 'login';
  const next = safeReturnTo(saved?.next);

  const redirect = (url: string | URL) => {
    const response = NextResponse.redirect(url, 303);
    response.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: GOOGLE_COOKIE_PATH });
    return response;
  };
  const back = (result: string, page: 'login' | 'signup' = mode) => {
    const url = new URL(`${origin}/${page}`);
    url.searchParams.set('google', result);
    if (next !== '/') url.searchParams.set('next', next);
    return redirect(url);
  };

  try {
    const params = new URL(request.url).searchParams;
    // e.g. access_denied when they cancel on Google's page
    if (params.get('error')) return back('canceled');

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !saved || !sameState(state, saved.state)) return back('expired');

    const profile = await fetchGoogleProfile(code, googleRedirectUri(request), saved.verifier);
    const signup =
      saved.mode === 'signup' && saved.acceptedPolicies
        ? { language: saved.language, promoCode: saved.promoCode, acceptedPolicies: saved.acceptedPolicies }
        : null;
    const result = await signInWithGoogle(profile, signup);
    // Logging in with a Google account that has no RacingCoach account: making one needs the Create an Account
    // page, which shows the Terms of Service and Privacy Policy
    if (!result) return back('noAccount', 'signup');

    await createSession(result.user.id);
    await setLanguageCookie(result.user.preferredLanguage);
    if (result.created) await notifyOwner('signup', result.user.emailAddress);
    return redirect(`${origin}${next}`);
  } catch (error) {
    if (error instanceof GoogleEmailUnverifiedError) return back('unverified');
    console.error('Google sign-in callback error:', error);
    return back('error');
  }
}
