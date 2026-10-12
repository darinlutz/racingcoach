import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { setShowPricing } from '@/lib/siteSettings';

// The Admin page's Site Settings section. Body: { showPricing: boolean }.
// Admin role only; anyone else gets a 404, like the Admin page.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body.showPricing !== 'boolean') {
      return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    }

    await setShowPricing(body.showPricing, user.id);
    console.log(`Site setting: show_pricing set to ${body.showPricing} by user ${user.id}`);
    return NextResponse.json({ showPricing: body.showPricing });
  } catch (error) {
    console.error('Site setting error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
