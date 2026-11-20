import { NextResponse } from 'next/server';
import { carModelErrorResponse, carModelsAdmin, modelProblemText } from '@/lib/carModels/carModelRoutes';
import { applyCarModelAction, deleteCarModel, readCarModel, updateCarModel } from '@/lib/carModels/carModelStore';
import { MODEL_ACTIONS, parseModelSettings, type ModelAction } from '@/lib/carModels/modelRules';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf } from '@/lib/setupRoutes';

type Params = { params: Promise<{ id: string }> };

// One version of a car's 3D model (docs/car-models.md). GET answers { model }, for the Admin page's preview whatever
// its status. PUT { action: submit | approve | reject | activate | deactivate } moves it on (modelRules.ts'
// checkModelAction; activating makes it the car's only active version, which is how an older approved version is rolled
// back to), or PUT { settings: { normalization, wheelAnchors, defaultView, carKeys, source, license, attribution, notes } }
// changes an uploaded or rejected one. DELETE removes any version and its file (the active
// one too: the car then shows the generic car). Admin role only;
// anyone else 404.
export async function GET(_request: Request, { params }: Params) {
  const session = await carModelsAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  try {
    const model = id ? await readCarModel(id) : null;
    if (!model) return NextResponse.json({ error: session.t.errors.notFound }, { status: 404 });
    return NextResponse.json({ model });
  } catch (error) {
    return carModelErrorResponse(error, session.t, 'Car model read');
  }
}

export async function PUT(request: Request, { params }: Params) {
  const session = await carModelsAdmin();
  if (session.response) return session.response;
  const { t } = session;
  const id = idOf((await params).id);
  const body = await readJsonLimited(request, 32 * 1024).catch(() => null);
  if (!id || !body) return NextResponse.json({ error: t.errors.notFound }, { status: 400 });
  try {
    if (body.settings !== undefined) {
      const parsed = parseModelSettings(body.settings);
      if (!parsed.ok) return NextResponse.json({ error: t.errors.invalid, problems: parsed.problems.map((p) => modelProblemText(p, t)) }, { status: 400 });
      await updateCarModel(id, parsed.settings, session.user.id);
      console.log(`Car model ${id}: settings changed by user ${session.user.id}`);
      return NextResponse.json({ ok: true });
    }
    const action = body.action as ModelAction;
    if (!MODEL_ACTIONS.includes(action)) return NextResponse.json({ error: t.errors.notFound }, { status: 400 });
    await applyCarModelAction(id, action, session.user.id);
    console.log(`Car model ${id}: ${action} by user ${session.user.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return carModelErrorResponse(error, t, 'Car model action');
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await carModelsAdmin();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.errors.notFound }, { status: 404 });
  try {
    await deleteCarModel(id);
    console.log(`Car model ${id} deleted by user ${session.user.id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return carModelErrorResponse(error, session.t, 'Car model delete');
  }
}
