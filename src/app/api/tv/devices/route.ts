import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { listTvSessions } from '@/lib/tvAuth';

// The signed-in user's paired TVs (TV Broadcast Mode, src/lib/tvAuth.ts), for the TV Link page: { devices }
export async function GET() {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').tv;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logIn }, { status: 401 });
    }
    return NextResponse.json({ devices: await listTvSessions(user.id) });
  } catch (error) {
    console.error('TV devices error:', error);
    return NextResponse.json({ error: t.failedDevices }, { status: 500 });
  }
}
