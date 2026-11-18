import { NextResponse } from 'next/server';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { decideProposal, readRevision } from '@/lib/setups';

// The driver's decision on a Setup Engineer proposal: { accepted: [paths] }. The accepted changes make one new revision
// of the setup (setups.ts's decideProposal); the rest are recorded as rejected. Nothing is changed without this
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const body = await readJsonLimited(request, 16 * 1024).catch(() => null);
    if (!Array.isArray(body?.accepted) || body.accepted.length > 50) return NextResponse.json({ error: session.t.invalid }, { status: 400 });
    const accepted = body.accepted.filter((p: unknown): p is string => typeof p === 'string').slice(0, 50);
    const { proposal, revisionId } = await decideProposal(session.user.id, id, accepted);
    const revision = revisionId ? await readRevision(session.user.id, revisionId) : null;
    return NextResponse.json({ proposal, revision: revision && { ...revision, parameters: undefined } });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup proposal decision');
  }
}
