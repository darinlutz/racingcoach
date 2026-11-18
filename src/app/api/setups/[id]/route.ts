import { NextResponse } from 'next/server';
import { readJsonLimited } from '@/lib/requestBody';
import { preliminaryValidation } from '@/lib/setupInspection';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { deleteSetup, readProposals, readSetup, SETUP_LIMITS, updateSetup } from '@/lib/setups';

// One of the signed-in user's setups. GET: its details, revisions, latest values, RacingCoach's preliminary
// validation (never an inspection pass, setupInspection.ts) and the Setup Engineer's analyses of it. PATCH { name?,
// notes?, car?, track?, archived? }. DELETE: the setup and all its revisions.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const setup = await readSetup(session.user.id, id);
    if (!setup) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    const proposals = await readProposals(session.user.id, id);
    const validation = preliminaryValidation(setup.carKey, setup.latest?.parameters ?? []);
    return NextResponse.json({ setup, proposals, validation });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup details');
  }
}

const textField = (value: unknown, max: number): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

export async function PATCH(request: Request, { params }: Params) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const body = await readJsonLimited(request, 16 * 1024).catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: session.t.invalid }, { status: 400 });
    const name = textField(body.name, SETUP_LIMITS.nameChars);
    if (body.name !== undefined && !name) return NextResponse.json({ error: session.t.invalid }, { status: 400 });
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, SETUP_LIMITS.notesChars) : undefined;
    const ok = await updateSetup(session.user.id, id, {
      name: name ?? undefined,
      notes,
      car: textField(body.car, 200),
      track: textField(body.track, 200),
      archived: typeof body.archived === 'boolean' ? body.archived : undefined,
    });
    if (!ok) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup update');
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    if (!(await deleteSetup(session.user.id, id))) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup delete');
  }
}
