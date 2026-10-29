import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiText } from '@/lib/i18n/server';
import { MAX_MESSAGE_CHARS, queueDriverMessage } from '@/lib/liveRacing';
import { getCurrentUser } from '@/lib/session';

const messageSchema = z.object({
  driverId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

// The Live Racing page's Message Driver box: { driverId, text } for a live driver the signed-in user may watch. The
// message goes to the driver's collector with its next live update, and their In-Car AI Coach voice says it
// (src/lib/liveRacing.ts). Answers 404 when the driver isn't live, 403 when the user may not watch them, 409 when
// their collector is too old to take messages, and 429 when sent too often.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user) {
      return NextResponse.json({ error: t.logInLiveRacing }, { status: 401 });
    }
    const parsed = messageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: t.invalidDriverMessage }, { status: 400 });
    }
    const status = await queueDriverMessage(user, parsed.data.driverId, parsed.data.text);
    switch (status) {
      case 'queued':
        return NextResponse.json({ success: true });
      case 'notAllowed':
        return NextResponse.json({ error: t.cannotMessageDriver }, { status: 403 });
      case 'notLive':
        return NextResponse.json({ error: t.driverNotLive }, { status: 404 });
      case 'collectorTooOld':
        return NextResponse.json({ error: t.collectorTooOldForMessages }, { status: 409 });
      case 'tooMany':
        return NextResponse.json({ error: t.tooManyDriverMessages }, { status: 429 });
    }
  } catch (error) {
    console.error('Live Racing message error:', error);
    return NextResponse.json({ error: t.failedSendDriverMessage }, { status: 500 });
  }
}
