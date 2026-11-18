import { NextResponse } from 'next/server';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { duplicateSetup, SETUP_LIMITS } from '@/lib/setups';

// A copy of one of the signed-in user's setups, { name }, with its latest values as its first revision
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await setupsSession();
  if (session.response) return session.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: session.t.notFound }, { status: 404 });
  try {
    const body = await readJsonLimited(request, 4096).catch(() => ({}));
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, SETUP_LIMITS.nameChars) : null;
    if (!name) return NextResponse.json({ error: session.t.invalid }, { status: 400 });
    return NextResponse.json({ setupId: await duplicateSetup(session.user.id, id, name) }, { status: 201 });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup duplicate');
  }
}
