import { NextResponse } from 'next/server';
import { createCollectorKey, deleteCollectorKey } from '@/lib/collectorKeys';
import { getCurrentUser } from '@/lib/session';
import { apiText } from '@/lib/i18n/server';

const NOT_SIGNED_IN = { error: 'Log in to manage your upload key' };

// Creates the signed-in user's upload key for the telemetry collector, replacing any earlier one.
// The key is in this response only; afterwards just its first characters are kept.
export async function POST() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    const { key, info } = await createCollectorKey(user.id);
    return NextResponse.json({ key, info });
  } catch (error) {
    console.error('Collector key create error:', error);
    return NextResponse.json({ error: t.failedCreateKey }, { status: 500 });
  }
}

// Revokes the key; laps already uploaded stay
export async function DELETE() {
  const t = await apiText();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    }
    await deleteCollectorKey(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Collector key delete error:', error);
    return NextResponse.json({ error: t.failedRevokeKey }, { status: 500 });
  }
}
