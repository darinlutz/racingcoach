import { NextResponse } from 'next/server';
import { deleteDiscordConnection } from '@/lib/discord';
import { getCurrentUser } from '@/lib/session';
import { getSiteOrigin } from '@/lib/siteOrigin';

// Unlinks the signed-in user's Discord account (the account page's Disconnect button)
export async function POST(request: Request) {
  const origin = getSiteOrigin(request);
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.redirect(`${origin}/login`, 303);
    }
    await deleteDiscordConnection(user.id);
    return NextResponse.redirect(`${origin}/account?discord=disconnected`, 303);
  } catch (error) {
    console.error('Discord disconnect error:', error);
    return NextResponse.redirect(`${origin}/account?discord=error`, 303);
  }
}
