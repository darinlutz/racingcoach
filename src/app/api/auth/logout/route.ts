import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

export async function POST() {
  const t = await apiText();
  try {
    await deleteSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: t.failedLogOut }, { status: 500 });
  }
}
