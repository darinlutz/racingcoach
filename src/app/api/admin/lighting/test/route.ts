import { NextResponse } from 'next/server';
import type { EventDraft } from '@/lib/lighting/events';
import { emitTestEvent } from '@/lib/lighting/hub';
import { lightingAdmin, lightingError, overLightingAttempts } from '@/lib/lighting/routeHelpers';
import { readJsonLimited } from '@/lib/requestBody';

// Lighting Control's Test Lab: a simulated event to the account's own lighting agents, marked source: 'test' so it's
// never taken for live racing (src/lib/lighting/hub.ts keeps it apart from the live state, and nothing else on the
// site reads it). POST { event }. Admins only; anyone else 404.
const TEST_EVENTS: Record<string, EventDraft> = {
  pitLimiterOn: { eventType: 'pitLimiter.changed', data: { active: true } },
  pitLimiterOff: { eventType: 'pitLimiter.changed', data: { active: false } },
  sessionStart: { eventType: 'session.changed', data: { onTrack: true } },
  sessionEnd: { eventType: 'session.ended', data: { reason: 'test' } },
};

export async function POST(request: Request) {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  if (overLightingAttempts(request, `test:${admin.user.id}`, 600)) return lightingError('tooManyAttempts', 429);
  const body = await readJsonLimited(request, 1000).catch(() => null);
  const draft = typeof body?.event === 'string' ? TEST_EVENTS[body.event] : undefined;
  if (!draft) return lightingError('invalid', 400);
  emitTestEvent(admin.user.id, draft);
  return NextResponse.json({ success: true });
}
