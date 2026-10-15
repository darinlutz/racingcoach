import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { readTracks } from '@/lib/tracks';
import { apiText } from '@/lib/i18n/server';

// Track Data's tracks and focus areas, the same for every signed-in user. Read only.
export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInTracks }, { status: 401 });
    }
    // isAdmin shows Track Data's Save Data button (the site owner's SimHub file)
    return NextResponse.json({ tracks: await readTracks(), isAdmin: isAdmin(user.role) });
  } catch (error) {
    console.error('Read tracks error:', error);
    return NextResponse.json({ error: t.failedLoadTracks }, { status: 500 });
  }
}
