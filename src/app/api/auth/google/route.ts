import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  GOOGLE_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  googleAuthorizeUrl,
  googleConfig,
  googleRedirectUri,
  newPkceVerifier,
  type GoogleState,
} from '@/lib/googleAuth';
import { DEFAULT_LANGUAGE, isLanguage } from '@/lib/i18n/languages';
import { isCurrentPolicyVersions } from '@/lib/policyVersions';
import { cleanPromoCode } from '@/lib/promoCode';
import { safeReturnTo } from '@/lib/returnTo';
import { getSiteOrigin } from '@/lib/siteOrigin';

// Starts Sign in with Google from the Log In page (?mode=login) or the Create an Account page (?mode=signup, with
// the form's language, promoCode and the terms and privacy versions it showed). ?next= is where to go afterwards.
// Sends the visitor to Google with a one-time state value that /api/auth/google/callback checks.
export async function GET(request: Request) {
  const origin = getSiteOrigin(request);
  const params = new URL(request.url).searchParams;
  const mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  const next = safeReturnTo(params.get('next'));
  const back = (result: string) => {
    const url = new URL(`${origin}/${mode}`);
    url.searchParams.set('google', result);
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url, 303);
  };

  try {
    const config = googleConfig();
    if (!config) {
      console.error('Google sign-in error: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set');
      return back('unavailable');
    }

    const acceptedPolicies = { terms: params.get('terms'), privacy: params.get('privacy') };
    if (mode === 'signup' && !isCurrentPolicyVersions(acceptedPolicies)) return back('policiesChanged');

    const language = params.get('language');
    const state: GoogleState = {
      state: randomBytes(24).toString('hex'),
      verifier: newPkceVerifier(),
      mode,
      next,
      language: isLanguage(language) ? language : DEFAULT_LANGUAGE,
      promoCode: cleanPromoCode(params.get('promoCode')),
      acceptedPolicies: mode === 'signup' && isCurrentPolicyVersions(acceptedPolicies) ? acceptedPolicies : null,
    };

    const response = NextResponse.redirect(
      googleAuthorizeUrl(config.clientId, googleRedirectUri(request), state.state, state.verifier),
      303
    );
    response.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify(state), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: GOOGLE_COOKIE_PATH,
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error('Google sign-in error:', error);
    return back('error');
  }
}
