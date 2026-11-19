import { NextResponse } from 'next/server';
import { ASSET_ACTIONS, type AssetAction } from '@/lib/carViews/assetRules';
import { carViewErrorResponse, carViewsAdmin } from '@/lib/carViews/carViewRoutes';
import { applyCarAssetAction, deleteCarAsset, readCarAsset } from '@/lib/carViews/carViewStore';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf } from '@/lib/setupRoutes';

type Params = { params: Promise<{ id: string }> };

// One version of a car's engineering drawings (docs/car-views.md). GET answers { asset } with its drawings, for the
// Admin page's preview whatever its status. PUT { action: submit | approve | reject | activate | deactivate } moves it
// on (assetRules.ts' checkAction; activating makes it the car's only active version, which is how an older approved
// version is rolled back to). DELETE removes a draft or rejected version. Admin role only; anyone else 404.
export async function GET(_request: Request, { params }: Params) {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  try {
    const asset = id ? await readCarAsset(id) : null;
    if (!asset) return NextResponse.json({ error: session.t.errors.notFound }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (error) {
    return carViewErrorResponse(error, session.t, 'Car drawing read');
  }
}

export async function PUT(request: Request, { params }: Params) {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  const body = await readJsonLimited(request, 1000).catch(() => null);
  const action = body?.action as AssetAction;
  if (!id || !ASSET_ACTIONS.includes(action)) return NextResponse.json({ error: session.t.errors.notFound }, { status: 400 });
  try {
    await applyCarAssetAction(id, action, session.user.id);
    console.log(`Car drawing ${id}: ${action} by user ${session.user.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return carViewErrorResponse(error, session.t, 'Car drawing action');
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await carViewsAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.errors.notFound }, { status: 404 });
  try {
    await deleteCarAsset(id);
    console.log(`Car drawing ${id} deleted by user ${session.user.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return carViewErrorResponse(error, session.t, 'Car drawing delete');
  }
}
