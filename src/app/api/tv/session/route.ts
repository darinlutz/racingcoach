import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { endTvSession, getTvSession } from '@/lib/tvAuth';

// The TV's own session (TV Broadcast Mode, src/lib/tvAuth.ts):
//   GET     whether this TV is paired: { paired, userName } (401 when it isn't, or was unpaired)
//   DELETE  the TV unpairs itself
export async function GET() {
  const session = await getTvSession();
  if (!session) {
    const t = getDictionary(await getLanguage(null)).tv;
    return NextResponse.json({ error: t.notPaired, code: 'notPaired' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ paired: true, userName: session.user.userName }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE() {
  try {
    await endTvSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('TV unpair error:', error);
    return NextResponse.json({ error: 'Failed to unpair' }, { status: 500 });
  }
}
