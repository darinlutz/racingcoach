import { NextResponse } from 'next/server';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { setEnableAiFeatures, setShowPricing, setShowProDriverLesson } from '@/lib/siteSettings';

// The Admin page's Site Settings section. Body: { showPricing?: boolean, showProDriverLesson?: boolean,
// enableAiFeatures?: boolean }, at least one.
// Admin role only; anyone else gets a 404, like the Admin page.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { showPricing, showProDriverLesson, enableAiFeatures } = body;
    const isSwitch = (value: unknown) => value === undefined || typeof value === 'boolean';
    if (
      !isSwitch(showPricing) ||
      !isSwitch(showProDriverLesson) ||
      !isSwitch(enableAiFeatures) ||
      (showPricing === undefined && showProDriverLesson === undefined && enableAiFeatures === undefined)
    ) {
      return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    }

    if (typeof showPricing === 'boolean') {
      await setShowPricing(showPricing, user.id);
      console.log(`Site setting: show_pricing set to ${showPricing} by user ${user.id}`);
    }
    if (typeof showProDriverLesson === 'boolean') {
      await setShowProDriverLesson(showProDriverLesson, user.id);
      console.log(`Site setting: show_pro_driver_lesson set to ${showProDriverLesson} by user ${user.id}`);
    }
    if (typeof enableAiFeatures === 'boolean') {
      await setEnableAiFeatures(enableAiFeatures, user.id);
      console.log(`Site setting: enable_ai_features set to ${enableAiFeatures} by user ${user.id}`);
    }
    return NextResponse.json({ showPricing, showProDriverLesson, enableAiFeatures });
  } catch (error) {
    console.error('Site setting error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
