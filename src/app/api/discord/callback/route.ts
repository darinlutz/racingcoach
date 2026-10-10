import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  DISCORD_INVITE_URL,
  DISCORD_STATE_COOKIE,
  DiscordAlreadyLinkedError,
  DiscordBlockedError,
  discordRedirectUri,
  fetchDiscordUser,
  saveDiscordConnection,
} from '@/lib/discord';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Discord sends the user back here after they approve (or cancel) linking their account. Once linked
// they go on to the RacingCoach Discord server's invite; otherwise the result is shown on the account
// page via ?discord=
export async function GET(request: Request) {
  const origin = getSiteOrigin(request);
  const redirect = (url: string) => {
    const response = NextResponse.redirect(url, 303);
    response.cookies.delete({ name: DISCORD_STATE_COOKIE, path: '/api/discord' });
    return response;
  };
  const back = (result: string) => redirect(`${origin}/account?discord=${result}`);

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(`${origin}/login`, 303);
    }

    const params = new URL(request.url).searchParams;
    // e.g. access_denied when they press Cancel on Discord's page
    if (params.get('error')) return back('canceled');

    const code = params.get('code');
    const state = params.get('state');
    const expectedState = (await cookies()).get(DISCORD_STATE_COOKIE)?.value;
    if (!code || !state || !expectedState || !sameState(state, expectedState)) return back('expired');

    const discordUser = await fetchDiscordUser(code, discordRedirectUri(request));
    await saveDiscordConnection(user.id, discordUser);
    return redirect(DISCORD_INVITE_URL);
  } catch (error) {
    if (error instanceof DiscordAlreadyLinkedError) return back('taken');
    if (error instanceof DiscordBlockedError) {
      console.error('Discord callback error:', error.message);
      return back('blocked');
    }
    console.error('Discord callback error:', error);
    return back('error');
  }
}
