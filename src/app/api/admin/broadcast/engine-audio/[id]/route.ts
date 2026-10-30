import { NextResponse } from 'next/server';
import { deleteEngineAudioAsset } from '@/lib/engineAudioAssets';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

// Removes one of the Admin page's Engine Sounds; listeners who picked it get the built-in sound. Admin role only.
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id) || !(await deleteEngineAudioAsset(Number(id)))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Engine sound delete error:', error);
    return NextResponse.json({ error: getDictionary(user?.preferredLanguage ?? 'en').admin.engineAudio.failedSave }, { status: 500 });
  }
}
