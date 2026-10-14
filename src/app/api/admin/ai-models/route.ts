import { NextResponse } from 'next/server';
import { isAiFeature, isAiModel, setAiModel } from '@/lib/aiModels';
import { apiText } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Admin page's AI Model Control section. Body: { feature, model } (src/lib/aiModels.ts).
// Admin role only; anyone else gets a 404, like the Admin page.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isAiFeature(body.feature) || !isAiModel(body.model)) {
      return NextResponse.json({ error: t.failedSaveSetting }, { status: 400 });
    }

    await setAiModel(body.feature, body.model, user.id);
    console.log(`Site setting: AI model for ${body.feature} set to ${body.model} by user ${user.id}`);
    return NextResponse.json({ feature: body.feature, model: body.model });
  } catch (error) {
    console.error('AI model setting error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
