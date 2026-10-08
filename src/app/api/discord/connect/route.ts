import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { DISCORD_STATE_COOKIE, discordAuthorizeUrl, discordConfig, discordRedirectUri } from '@/lib/discord';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';

// Starts linking the signed-in user's Discord account: sends them to Discord to approve, with a
// one-time state value that /api/discord/callback checks
export async function GET(request: Request) {
  const origin = getSiteOrigin(request);
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(`${origin}/login`, 303);
    }
    const config = discordConfig();
    if (!config) {
      console.error('Discord connect error: DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is not set');
      return NextResponse.redirect(`${origin}/account?discord=unavailable`, 303);
    }

    const state = randomBytes(24).toString('hex');
    const response = NextResponse.redirect(discordAuthorizeUrl(config.clientId, discordRedirectUri(request), state), 303);
    response.cookies.set(DISCORD_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/discord',
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error('Discord connect error:', error);
    return NextResponse.redirect(`${origin}/account?discord=error`, 303);
  }
}
