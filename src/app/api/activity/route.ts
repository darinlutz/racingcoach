import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { activityBatchSchema, logActivity, VISITOR_COOKIE } from '@/lib/activityLog';
import { getCurrentUser } from '@/lib/session';

// A batch of 50 events is a few KB; anything much bigger isn't from the tracker
const MAX_BODY_BYTES = 64 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Page views and clicks from src/components/ActivityTracker.tsx, saved to racingcoach."ActivityLog".
// Open to visitors who aren't signed in (their rows have no user). The tracker ignores the response,
// so errors are logged here rather than shown to anyone.
export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Batch is too large' }, { status: 413 });
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
    }
    const parsed = activityBatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid activity batch' }, { status: 400 });
    }

    const cookieStore = await cookies();
    let visitorId = cookieStore.get(VISITOR_COOKIE)?.value;
    if (!visitorId || !UUID_RE.test(visitorId)) {
      visitorId = randomUUID();
      cookieStore.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    const user = await getCurrentUser();
    // Render (and most hosts) put the visitor's address first in X-Forwarded-For
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || null;

    await logActivity(parsed.data, {
      userId: user?.id ?? null,
      visitorId,
      ipAddress,
      userAgent: request.headers.get('user-agent'),
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Activity log error:', error);
    return NextResponse.json({ error: 'Failed to log activity' }, { status: 500 });
  }
}
