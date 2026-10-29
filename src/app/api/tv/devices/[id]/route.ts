import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { revokeTvSession } from '@/lib/tvAuth';

type Params = { params: Promise<{ id: string }> };

// Unpairs one of the signed-in user's TVs (src/lib/tvAuth.ts): its TV session ends at once, and the TV goes back to
// its pairing screen within seconds
export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').tv;
  try {
    if (!user) {
      return NextResponse.json({ error: t.logIn }, { status: 401 });
    }
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id) || !(await revokeTvSession(user.id, Number(id)))) {
      return NextResponse.json({ error: t.deviceNotFound }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('TV revoke error:', error);
    return NextResponse.json({ error: t.failedDevices }, { status: 500 });
  }
}
