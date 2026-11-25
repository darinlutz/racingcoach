import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { setMemoryConsent } from '@/lib/memory/consent';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures } from '@/lib/siteSettings';

// The Account page's AI Memory switch (src/components/AiMemoryCard.tsx), for the signed-in user only: their consent
// to the Memory Service remembering what they tell the AI (src/lib/memory/consent.ts). Body: { enabled: boolean }.
// Turning it on needs Enable AI Features; turning it off always works, and deletes what was remembered.
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: getDictionary(await getLanguage(null)).aiMemory.errors.logIn }, { status: 401 });
  const t = getDictionary(user.preferredLanguage).aiMemory.errors;
  try {
    const body = await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => ({}));
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: t.failed }, { status: 400 });
    if (body.enabled && !(await getEnableAiFeatures())) {
      return NextResponse.json({ error: t.aiFeaturesDisabled, code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    const result = await setMemoryConsent(user.id, body.enabled, { userId: user.id, system: 'account' });
    return NextResponse.json(result);
  } catch (error) {
    console.error('AI Memory consent error:', error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
