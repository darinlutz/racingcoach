import { NextResponse } from 'next/server';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { createRevisionFromChanges, readLinkedLaps, readRevision, restoreRevision } from '@/lib/setups';

// One revision of one of the signed-in user's setups. GET: its values and the laps driven on it (captures only,
// setups.ts's readLinkedLaps). POST { action: 'restore' }: brought back as the setup's newest revision; POST
// { action: 'change', changes: [{ path, value }], summary? }: a new revision with those values changed. Neither changes
// this revision.
type Params = { params: Promise<{ revisionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).revisionId);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const revision = await readRevision(session.user.id, id);
    if (!revision) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
    const laps = await readLinkedLaps(session.user.id, id);
    return NextResponse.json({ revision, laps: laps && { ...laps, clientLapIds: undefined } });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup revision');
  }
}

export async function POST(request: Request, { params }: Params) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).revisionId);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const body = await readJsonLimited(request, 32 * 1024).catch(() => null);
    if (body?.action === 'restore') {
      const revisionId = await restoreRevision(session.user.id, id);
      return NextResponse.json({ revision: await readRevision(session.user.id, revisionId) }, { status: 201 });
    }
    if (body?.action === 'change' && Array.isArray(body.changes) && body.changes.length > 0 && body.changes.length <= 100) {
      const changes = body.changes.map((c: { path?: unknown; value?: unknown }) => ({ path: String(c?.path ?? ''), value: Number(c?.value) }));
      if (changes.some((c: { path: string; value: number }) => !c.path || !Number.isFinite(c.value))) {
        return NextResponse.json({ error: session.t.badChange }, { status: 400 });
      }
      const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 300) : '';
      const made = await createRevisionFromChanges(session.user.id, id, changes, { kind: 'manual', author: 'user', summary });
      return NextResponse.json({ revision: await readRevision(session.user.id, made.revisionId) }, { status: 201 });
    }
    return NextResponse.json({ error: session.t.invalid }, { status: 400 });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup revision change');
  }
}
