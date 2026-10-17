import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { getRateLimitSettings, parseRateLimitSettings, setRateLimitSettings } from '@/lib/rateLimits';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Admin page's Rate Limiting settings (src/lib/rateLimits.ts). Body: the RateLimitSettings to save; anything
// left out keeps its saved value. Answers { settings }, as saved. Admin role only; anyone else gets a 404.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    }
    const settings = parseRateLimitSettings(body, await getRateLimitSettings());
    await setRateLimitSettings(settings, user.id);
    console.log(`Site setting: rate limits saved by user ${user.id} (${settings.enabled ? 'on' : 'off'})`);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Rate limit settings error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
