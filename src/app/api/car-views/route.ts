import { NextResponse } from 'next/server';
import { CAR_KEY, normalizeCarKey } from '@/lib/carViews/assetRules';
import { readActiveCarAsset } from '@/lib/carViews/carViewStore';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// The engineering car drawings a page shows for a car (docs/car-views.md): ?carKey=<iRacing car path> answers
// { asset }, the car's active version with its views (sanitized again on reading, carViewStore.ts), or null, when the
// page shows the generic car. Matched by the exact car path, never by name. Signed-in users only. The browser keeps
// the answer five minutes; an Admin's change reaches other servers' memory within a minute.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: (await apiText(null)).logInAi, code: 'logIn' }, { status: 401 });
  const t = getDictionary(user.preferredLanguage).setups.carViews.errors;
  const key = normalizeCarKey(new URL(request.url).searchParams.get('carKey') ?? '');
  if (!CAR_KEY.test(key)) return NextResponse.json({ asset: null }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  try {
    const asset = await readActiveCarAsset(key);
    return NextResponse.json({ asset }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (error) {
    console.error('Car drawing read error:', error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
