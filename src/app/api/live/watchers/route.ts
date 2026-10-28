import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { addWatcher, readSharedWithMe, readWatchers, removeWatcher } from '@/lib/liveRacing';
import { getCurrentUser } from '@/lib/session';

// The Live Racing page's Who Can Watch Me (src/lib/liveRacing.ts): the accounts the signed-in user lets watch them
// live (watchers), and the drivers who let the user watch them (sharedWithMe).

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const [watchers, sharedWithMe] = await Promise.all([readWatchers(user.id), readSharedWithMe(user.id)]);
    return NextResponse.json({ watchers, sharedWithMe });
  } catch (error) {
    console.error('Read live watchers error:', error);
    return NextResponse.json({ error: t.failedLoadLiveRacing }, { status: 500 });
  }
}

// { emailAddress }: lets the account with that email address watch the user
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const emailAddress = typeof body.emailAddress === 'string' ? body.emailAddress.trim() : '';
    if (!emailAddress) {
      return NextResponse.json({ error: t.emailRequired }, { status: 400 });
    }
    if (emailAddress.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return NextResponse.json({ error: t.invalidEmail }, { status: 400 });
    }
    const result = await addWatcher(user.id, emailAddress);
    if (result.status === 'notFound') {
      return NextResponse.json({ error: t.liveWatcherNotFound }, { status: 404 });
    }
    if (result.status === 'self') {
      return NextResponse.json({ error: t.liveWatcherSelf }, { status: 400 });
    }
    return NextResponse.json({ watcher: result.watcher, already: result.status === 'already' });
  } catch (error) {
    console.error('Add live watcher error:', error);
    return NextResponse.json({ error: t.failedSaveLiveWatchers }, { status: 500 });
  }
}

// { watcherId }: stops that account watching the user
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const watcherId = Number(body.watcherId);
    if (!Number.isInteger(watcherId) || watcherId <= 0) {
      return NextResponse.json({ error: 'watcherId is required' }, { status: 400 });
    }
    await removeWatcher(user.id, watcherId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove live watcher error:', error);
    return NextResponse.json({ error: t.failedSaveLiveWatchers }, { status: 500 });
  }
}
