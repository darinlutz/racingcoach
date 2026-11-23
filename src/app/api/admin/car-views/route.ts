import { NextResponse } from 'next/server';
import { readCars } from '@/lib/carData';
import { validateDraft } from '@/lib/carViews/assetRules';
import { carViewErrorResponse, carViewsAdmin, draftProblemText } from '@/lib/carViews/carViewRoutes';
import { createCarAssetDraft, listCarAssets } from '@/lib/carViews/carViewStore';
import { readJsonLimited } from '@/lib/requestBody';

// Five views of up to 400 KB each, their anchors and the provenance text
const MAX_BODY = 2_500_000;

// The Admin page's Engineering Car Drawings (docs/car-views.md). GET answers { cars, assets }: Car Data's cars and
// every version of every car's drawings (no markup). POST { carId, sharedCarIds?, carKeys, views: { <view>: { svg, anchors,
// hasWheels } }, sources, license, notes } saves a new draft version, every view sanitized and its anchors checked
// first (assetRules.ts), and answers { id, version }, or 400 with every problem in words. Admin role only; anyone else 404.
export async function GET() {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  try {
    const [cars, assets] = await Promise.all([readCars(), listCarAssets()]);
    return NextResponse.json({ cars: cars.map((c) => ({ id: c.id, name: c.name })), assets });
  } catch (error) {
    return carViewErrorResponse(error, session.t, 'Car drawings list');
  }
}

export async function POST(request: Request) {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  const { t, user } = session;
  try {
    const body = await readJsonLimited(request, MAX_BODY).catch(() => null);
    const result = validateDraft(body);
    if (!result.ok) {
      return NextResponse.json({ error: t.errors.invalid, problems: result.problems.map((p) => draftProblemText(p, t)) }, { status: 400 });
    }
    const { id, version } = await createCarAssetDraft(result.draft, user.id);
    console.log(`Car drawing draft ${id} (v${version}) for car ${result.draft.carId} saved by user ${user.id}`);
    return NextResponse.json({ id, version }, { status: 201 });
  } catch (error) {
    return carViewErrorResponse(error, t, 'Car drawing save');
  }
}
