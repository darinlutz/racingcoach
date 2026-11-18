import { NextResponse } from 'next/server';
import { setupErrorResponse, setupsSession } from '@/lib/setupRoutes';
import { readInspections } from '@/lib/setups';

// The Inspection tab: iRacing's inspection results for the signed-in user's setups, newest first
export async function GET() {
  const session = await setupsSession();
  if (session.response) return session.response;
  try {
    return NextResponse.json({ inspections: await readInspections(session.user.id) });
  } catch (error) {
    return setupErrorResponse(error, session.t, 'Setup inspections');
  }
}
