import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isIpAddress, resetUsage } from '@/lib/rateLimits';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// Starts a user's or IP address's AI usage count over: POST { userId } or { ipAddress } (src/lib/rateLimits.ts
// resetUsage). Their calls stay in the report. Answers { reset }, how many calls stopped counting.
// Admin role only; anyone else gets a 404.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const target =
      Number.isInteger(body.userId) && body.userId > 0
        ? { userId: body.userId as number }
        : isIpAddress(body.ipAddress)
          ? { ipAddress: (body.ipAddress as string).trim() }
          : null;
    if (!target) {
      return NextResponse.json({ error: t.invalidOverride }, { status: 400 });
    }
    const reset = await resetUsage(target);
    console.log(`AI usage reset for ${'userId' in target ? `user ${target.userId}` : `IP ${target.ipAddress}`} by user ${user.id}`);
    return NextResponse.json({ reset });
  } catch (error) {
    console.error('AI usage reset error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
