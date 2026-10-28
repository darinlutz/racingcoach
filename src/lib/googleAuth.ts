import { createHash, randomBytes } from 'node:crypto';
import { isUniqueViolation, query } from './db';
import type { Language } from './i18n/languages';
import type { PolicyVersions } from './policyVersions';
import { getPublicSiteUrl } from './siteOrigin';
import { createUser, ensureUserSchema, getUserById, getUserByEmail, type User } from './users';

// Sign in with Google, with Google's OpenID Connect authorization code flow
// (https://developers.google.com/identity/openid-connect/openid-connect). The openid, email and profile scopes
// only reveal who they are; no Google tokens are kept. racingcoach."GoogleConnections" ties a Google account (sub)
// to a RacingCoach account, so changing the email on either side doesn't lose the link.

// Holds the OAuth2 state, PKCE verifier and what to do afterwards between /api/auth/google and its callback
export const GOOGLE_STATE_COOKIE = 'google_oauth_state';
export const GOOGLE_COOKIE_PATH = '/api/auth/google';

const MAX_NAME_LENGTH = 100;

export type GoogleMode = 'login' | 'signup';

// What /api/auth/google remembers for the callback. Signing up carries what the Create an Account form had:
// its Preferred Language, promo code and the policy versions it showed.
export type GoogleState = {
  state: string;
  verifier: string;
  mode: GoogleMode;
  next: string;
  language: Language;
  promoCode: string | null;
  acceptedPolicies: PolicyVersions | null;
};

export type GoogleProfile = { sub: string; email: string; name: string };

export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Hidden while Google verifies the OAuth app; set to true to show the Log in / Sign up with Google
// buttons again (they also need GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
const SHOW_GOOGLE_SIGN_IN = false;

export function googleSignInEnabled(): boolean {
  return SHOW_GOOGLE_SIGN_IN && googleConfig() !== null;
}

// Must match an Authorized redirect URI on the Google Cloud OAuth client exactly
export function googleRedirectUri(request: Request): string {
  return `${getPublicSiteUrl(request)}/api/auth/google/callback`;
}

export function newPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function googleAuthorizeUrl(clientId: string, redirectUri: string, state: string, verifier: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Trades the authorization code for the user's Google profile. The ID token comes straight from Google's token
// endpoint over TLS, so its claims are checked rather than its signature (OpenID Connect Core 3.1.3.7).
export async function fetchGoogleProfile(code: string, redirectUri: string, verifier: string): Promise<GoogleProfile> {
  const config = googleConfig();
  if (!config) throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  const payload = idToken?.split('.')[1];
  if (!payload) throw new Error('Google sent no ID token');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;

  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new Error(`Unexpected ID token issuer ${String(claims.iss)}`);
  }
  if (claims.aud !== config.clientId) throw new Error('ID token is for another client');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('ID token has expired');
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new Error('ID token has no sub or email');
  if (claims.email_verified !== true) throw new GoogleEmailUnverifiedError();

  const email = claims.email.trim().toLowerCase();
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0];
  return { sub: claims.sub, email, name: name.slice(0, MAX_NAME_LENGTH) };
}

export class GoogleEmailUnverifiedError extends Error {
  constructor() {
    super('The Google account’s email address is not verified');
  }
}

async function saveGoogleConnection(userId: number, profile: GoogleProfile): Promise<void> {
  try {
    await query(
      `INSERT INTO racingcoach."GoogleConnections" (user_id, google_sub, google_email) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET google_sub = EXCLUDED.google_sub, google_email = EXCLUDED.google_email,
         connected_at = now()`,
      [userId, profile.sub, profile.email]
    );
  } catch (error) {
    // Another account already has this Google account (e.g. two callbacks at once); signing in still works by sub
    if (!isUniqueViolation(error)) throw error;
  }
}

// The account for a Google sign-in: the one linked to this Google account, else the one with its (verified)
// email address, which is then linked to it. With `signup`, an account is made when there's neither, with no
// password of its own until Forgot Password sets one. Null when there's no account and no `signup`.
export async function signInWithGoogle(
  profile: GoogleProfile,
  signup: { language: Language; promoCode: string | null; acceptedPolicies: PolicyVersions } | null
): Promise<{ user: User; created: boolean } | null> {
  await ensureUserSchema();
  const [linked] = await query('SELECT user_id FROM racingcoach."GoogleConnections" WHERE google_sub = $1', [profile.sub]);
  if (linked) {
    const user = await getUserById(Number(linked.user_id));
    if (user) return { user, created: false };
  }

  const existing = await getUserByEmail(profile.email);
  if (existing) {
    await saveGoogleConnection(existing.id, profile);
    return { user: existing, created: false };
  }
  if (!signup) return null;

  const user = await createUser({
    userName: profile.name,
    emailAddress: profile.email,
    password: null,
    preferredLanguage: signup.language,
    promoCode: signup.promoCode,
    acceptedPolicies: signup.acceptedPolicies,
  });
  await saveGoogleConnection(user.id, profile);
  return { user, created: true };
}
