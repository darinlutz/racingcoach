import { NextResponse } from 'next/server';
import { addFriend, deleteFriend, readFriends } from '@/lib/friendsRoster';
import { COUNTRIES } from '@/lib/countries';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

// Each signed-in user has their own friends list.

export async function GET() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInFriends }, { status: 401 });
    }
    const friends = await readFriends(user.id);
    return NextResponse.json({ friends });
  } catch (error) {
    console.error('Read friends error:', error);
    return NextResponse.json({ error: t.failedLoadFriends }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInFriends }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: t.nameRequired }, { status: 400 });
    }
    const country = typeof body.country === 'string' && COUNTRIES.includes(body.country as (typeof COUNTRIES)[number])
      ? body.country
      : '';
    if (!country) {
      return NextResponse.json({ error: t.countryRequired }, { status: 400 });
    }

    const friend = await addFriend(user.id, name, country);
    return NextResponse.json({ friend }, { status: 201 });
  } catch (error) {
    console.error('Add friend error:', error);
    return NextResponse.json({ error: t.failedAddFriend }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: t.logInFriends }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await deleteFriend(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete friend error:', error);
    return NextResponse.json({ error: t.failedDeleteFriend }, { status: 500 });
  }
}
