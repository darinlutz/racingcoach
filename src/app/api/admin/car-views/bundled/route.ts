import { NextResponse } from 'next/server';
import { readCars } from '@/lib/carData';
import { validateDraft } from '@/lib/carViews/assetRules';
import { bundledDraftInput, listBundledDrawings, nameKey } from '@/lib/carViews/bundledDrawings';
import { carViewErrorResponse, carViewsAdmin, draftProblemText } from '@/lib/carViews/carViewRoutes';
import { createCarAssetDraft } from '@/lib/carViews/carViewStore';
import { readJsonLimited } from '@/lib/requestBody';

// The engineering car drawings kept in the repository (data/car-drawings/, docs/car-views.md). GET answers
// { drawings }, each set with the Car Data car it's suggested for (by name, for the Admin to confirm). POST { id,
// carId, carKeys? } imports one as a new draft version of that car, through the same checks as an upload. Admin role
// only; anyone else 404.
export async function GET() {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  try {
    const [drawings, cars] = await Promise.all([listBundledDrawings(), readCars()]);
    return NextResponse.json({
      drawings: drawings.map((d) => ({ ...d, suggestedCarId: cars.find((c) => nameKey(c.name) === nameKey(d.carName))?.id ?? null })),
    });
  } catch (error) {
    return carViewErrorResponse(error, session.t, 'Bundled car drawings list');
  }
}

export async function POST(request: Request) {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  const { t, user } = session;
  try {
    const body = await readJsonLimited(request, 2000).catch(() => null);
    const carId = Number(body?.carId);
    const carKeys = Array.isArray(body?.carKeys) ? body.carKeys.filter((k: unknown): k is string => typeof k === 'string') : undefined;
    const input = typeof body?.id === 'string' && Number.isInteger(carId) && carId > 0 ? await bundledDraftInput(body.id, carId, carKeys) : null;
    if (!input) return NextResponse.json({ error: t.errors.notFound }, { status: 404 });
    const result = validateDraft(input);
    if (!result.ok) {
      return NextResponse.json({ error: t.errors.invalid, problems: result.problems.map((p) => draftProblemText(p, t)) }, { status: 400 });
    }
    const { id, version } = await createCarAssetDraft(result.draft, user.id);
    console.log(`Car drawings ${body.id} imported as draft ${id} (v${version}) for car ${carId} by user ${user.id}`);
    return NextResponse.json({ id, version }, { status: 201 });
  } catch (error) {
    return carViewErrorResponse(error, t, 'Bundled car drawings import');
  }
}
