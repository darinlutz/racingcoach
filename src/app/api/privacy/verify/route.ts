import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { notifyOwnerOfRequest, quietly } from '@/lib/privacyEmail';
import { verifyRequestByToken } from '@/lib/privacyRequests';

// The Confirm Request button on /privacy-request/verify: POST { token } from the emailed link verifies the request
// (Pending Verification becomes Submitted) and tells the site owner. A POST rather than the link's GET, so an email
// scanner that opens links can't confirm a request nobody made.
export async function POST(request: Request) {
  const t = getDictionary(await getLanguage()).privacyRights;
  try {
    const body = await request.json().catch(() => ({}));
    const verified = typeof body.token === 'string' ? await verifyRequestByToken(body.token) : null;
    if (!verified) return NextResponse.json({ error: t.public.verifyFailed }, { status: 400 });
    await quietly(notifyOwnerOfRequest({ requestId: verified.id, type: verified.type, review: true }), 'owner notice');
    return NextResponse.json({ message: t.public.verified });
  } catch (error) {
    console.error('Privacy verification error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.errors.failed }, { status: 500 });
  }
}
