import { NextResponse } from 'next/server';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { looksLikeJpeg, MAX_PROFILE_PICTURE_BYTES } from '@/lib/profilePictureRules';
import { readProfilePicture, removeProfilePicture, saveProfilePicture } from '@/lib/profilePictures';
import { readFormDataLimited } from '@/lib/requestBody';
import { getCurrentUser } from '@/lib/session';

// The signed-in user's own picture on My Dashboard (src/lib/profilePictures.ts). It takes no user ID: nobody else's
// can be asked for.
//   GET     the picture, as a JPEG
//   PUT     multipart form with `file` = the JPEG the page scaled; answers { version }
//   DELETE  removes it, back to the red helmet

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInProfile }, { status: 401 });
    }
    const image = await readProfilePicture(user.id);
    if (!image) {
      return NextResponse.json({ error: t.noProfilePicture }, { status: 404 });
    }
    return new Response(new Uint8Array(image), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Profile picture read error:', error);
    return NextResponse.json({ error: t.failedLoadProfilePicture }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const p = getDictionary(user?.preferredLanguage ?? 'en').myDashboard.picture;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInProfile }, { status: 401 });
    }
    const form = await readFormDataLimited(request, MAX_PROFILE_PICTURE_BYTES + 64 * 1024).catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: p.unreadable }, { status: 400 });
    }
    if (file.size > MAX_PROFILE_PICTURE_BYTES) {
      return NextResponse.json({ error: p.tooLarge }, { status: 413 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!looksLikeJpeg(bytes)) {
      return NextResponse.json({ error: p.unreadable }, { status: 415 });
    }
    return NextResponse.json({ version: await saveProfilePicture(user.id, bytes) });
  } catch (error) {
    console.error('Profile picture save error:', error);
    return NextResponse.json({ error: p.failedSave }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const p = getDictionary(user?.preferredLanguage ?? 'en').myDashboard.picture;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInProfile }, { status: 401 });
    }
    await removeProfilePicture(user.id);
    return NextResponse.json({ version: null });
  } catch (error) {
    console.error('Profile picture remove error:', error);
    return NextResponse.json({ error: p.failedRemove }, { status: 500 });
  }
}
