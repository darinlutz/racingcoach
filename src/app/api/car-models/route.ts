import { NextResponse } from 'next/server';
import { CAR_KEY, normalizeCarKey } from '@/lib/carViews/assetRules';
import { carPathForName } from '@/lib/carModels/carPathByName';
import { readActiveCarModel } from '@/lib/carModels/carModelStore';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// The 3D model a page shows for a car (docs/car-models.md): ?carKey=<iRacing car path> answers { model, resolvedBy },
// the car's active, approved version (how to load and place it, and its author's credit), or { model: null }, when
// the page shows the generic car. A lap with no car path (a dropped Garage 61 file, the Target Lap) may send
// ?carName= instead, which is looked up only by an exact name in IRACING_CARS (carPathByName.ts), never a similar one.
// Signed-in users only; visitors get the generic car. The browser keeps the answer five minutes.
const CACHE = { 'Cache-Control': 'private, max-age=300' };

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: (await apiText(null)).logInAi, code: 'logIn' }, { status: 401 });
  const t = getDictionary(user.preferredLanguage).setups.carModels.errors;
  const params = new URL(request.url).searchParams;
  const byKey = normalizeCarKey(params.get('carKey') ?? '');
  const byName = byKey ? null : carPathForName((params.get('carName') ?? '').slice(0, 200));
  const key = byKey || byName || '';
  if (!CAR_KEY.test(key)) return NextResponse.json({ model: null }, { headers: CACHE });
  try {
    const model = await readActiveCarModel(key);
    return NextResponse.json({ model, resolvedBy: model ? (byKey ? 'carKey' : 'carName') : null }, { headers: CACHE });
  } catch (error) {
    console.error('Car model read error:', error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
