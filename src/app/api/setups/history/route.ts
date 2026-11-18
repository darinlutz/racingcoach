import { NextResponse } from 'next/server';
import { idOf, setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readHistory } from '@/lib/setups';

// The History tab: revisions, inspections, Setup Engineer proposals and change sheets, newest first, for all the
// signed-in user's setups or one (?setup=<id>)
export async function GET(request: Request) {
  const session = await setupsSession();
  if (session.response) return session.response;
  try {
    const setupId = idOf(new URL(request.url).searchParams.get('setup'));
    return NextResponse.json({ history: await readHistory(session.user.id, setupId) });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup history');
  }
}
